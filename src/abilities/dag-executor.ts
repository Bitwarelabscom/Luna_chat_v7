/**
 * DAG-based parallel executor for agent orchestration
 * Replaces sequential execution with dependency-graph parallel execution
 */

import { PlanStep, AgentResult, AgentTask } from './agents.service.js';
import { summarizeAgentOutput } from './summarizer.service.js';
import { createCompletion } from '../llm/router.js';
import logger from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ExecutionNode {
  step: PlanStep;
  status: 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: AgentResult;
  retryCount: number;
  dependencies: Set<number>;
  dependents: Set<number>;
}

export interface ExecutionGraph {
  nodes: Map<number, ExecutionNode>;
  roots: number[]; // Steps with no dependencies (can start immediately)
}

export interface DAGExecutorConfig {
  maxConcurrency: number;
  maxRetries: number;
  enableSummarization: boolean;
  summarizationModel: string;
  lockedCodingAgent?: 'coder-claude' | 'coder-gemini' | 'coder-codex' | 'coder-api';
}

export interface FixerSuggestion {
  action: 'retry_same' | 'modify_task' | 'switch_agent' | 'abort';
  modifiedTask?: string;
  newAgent?: string;
  explanation: string;
}

export type DAGExecutionEvent =
  | { type: 'step_started'; step: number; agent: string }
  | { type: 'step_completed'; step: number; agent: string; result: AgentResult }
  | { type: 'step_failed'; step: number; agent: string; error: string; retryCount: number }
  | { type: 'step_retrying'; step: number; agent: string; suggestion: FixerSuggestion }
  | { type: 'step_skipped'; step: number; agent: string; reason: string }
  | { type: 'parallel_status'; running: string[]; completed: number; total: number }
  | { type: 'status'; status: string }
  | { type: 'done'; results: Map<number, AgentResult>; success: boolean; error?: string };

const DEFAULT_CONFIG: DAGExecutorConfig = {
  maxConcurrency: 3,
  maxRetries: 3,
  enableSummarization: true,
  summarizationModel: 'qwen2.5:3b',
};

// Fixer agent system prompt
const FIXER_SYSTEM_PROMPT = `You are a debugging specialist. When given a failed task, analyze why it failed and suggest ONE action:

- retry_same: Retry with the same approach (transient error, timeout, rate limit)
- modify_task: Rewrite the task more specifically to avoid the error
- switch_agent: Use a different agent type better suited for this task
- abort: Task is fundamentally impossible or blocked, stop trying

Output JSON only:
{
  "action": "retry_same|modify_task|switch_agent|abort",
  "modifiedTask": "new task text if action is modify_task",
  "newAgent": "researcher|coder-claude|coder-gemini|coder-codex|writer|analyst if action is switch_agent",
  "explanation": "brief explanation of your reasoning"
}

Available agents:
- researcher: Deep research, information gathering, web search
- coder-claude: SENIOR ENGINEER - Complex architecture, refactoring, debugging hard errors, security-critical
- coder-gemini: RAPID PROTOTYPER - Simple scripts, unit tests, large context analysis, code explanations
- coder-codex: BALANCED CODER - Practical implementation, focused patches, test-oriented delivery
- writer: Creative writing, content synthesis, drafting
- analyst: Data analysis, calculations, insights

CODING AGENT FAILOVER:
- If coder-claude fails on a simple task, suggest switch to coder-gemini
- If coder-gemini fails on complex logic, suggest switch to coder-claude
- If coder-codex fails on deep architecture, suggest coder-claude
- If either fails on large context, suggest coder-gemini (1M token window)`;

// Coding agent pairs for auto-failover
const CODING_AGENT_FAILOVER: Record<string, string> = {
  'coder-claude': 'coder-gemini',
  'coder-gemini': 'coder-claude',
  'coder-codex': 'coder-claude',
};

const ALL_CODING_AGENTS = new Set(['coder-claude', 'coder-gemini', 'coder-codex', 'coder-api']);

function isCodingAgent(agentName: string): boolean {
  return ALL_CODING_AGENTS.has(agentName);
}

// ============================================================================
// DAG Executor Class
// ============================================================================

export class DAGExecutor {
  private graph: ExecutionGraph;
  private config: DAGExecutorConfig;
  private completedResults: Map<number, AgentResult>;
  private summarizedResults: Map<number, string>;
  private executeAgentFn: (userId: string, task: AgentTask) => Promise<AgentResult>;

  constructor(
    steps: PlanStep[],
    executeAgentFn: (userId: string, task: AgentTask) => Promise<AgentResult>,
    configOverrides: Partial<DAGExecutorConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...configOverrides };
    this.graph = this.buildGraph(steps);
    this.completedResults = new Map();
    this.summarizedResults = new Map();
    this.executeAgentFn = executeAgentFn;
  }

  /**
   * Build execution graph from plan steps
   */
  private buildGraph(steps: PlanStep[]): ExecutionGraph {
    const nodes = new Map<number, ExecutionNode>();
    const roots: number[] = [];

    // Detect circular dependencies
    const visited = new Set<number>();
    const recursionStack = new Set<number>();

    const detectCycle = (stepNum: number, stepMap: Map<number, PlanStep>): boolean => {
      visited.add(stepNum);
      recursionStack.add(stepNum);

      const step = stepMap.get(stepNum);
      if (step) {
        for (const depNum of step.dependsOn) {
          if (!visited.has(depNum) && detectCycle(depNum, stepMap)) {
            return true;
          } else if (recursionStack.has(depNum)) {
            return true;
          }
        }
      }

      recursionStack.delete(stepNum);
      return false;
    };

    // Create step map for cycle detection
    const stepMap = new Map<number, PlanStep>();
    for (const step of steps) {
      stepMap.set(step.step, step);
    }

    // Check for cycles
    for (const step of steps) {
      if (!visited.has(step.step)) {
        if (detectCycle(step.step, stepMap)) {
          throw new Error(`Circular dependency detected involving step ${step.step}`);
        }
      }
    }

    // Build nodes
    for (const step of steps) {
      nodes.set(step.step, {
        step,
        status: 'pending',
        retryCount: 0,
        dependencies: new Set(step.dependsOn),
        dependents: new Set(),
      });
    }

    // Build reverse dependency graph (dependents)
    for (const [stepNum, node] of nodes) {
      for (const depNum of node.dependencies) {
        const depNode = nodes.get(depNum);
        if (depNode) {
          depNode.dependents.add(stepNum);
        }
      }

      // Mark root nodes (no dependencies)
      if (node.dependencies.size === 0) {
        roots.push(stepNum);
        node.status = 'ready';
      }
    }

    logger.info('Built execution graph', {
      totalSteps: nodes.size,
      rootSteps: roots.length,
      roots: roots,
    });

    return { nodes, roots };
  }

  /**
   * Get steps that are ready to execute (dependencies satisfied)
   */
  private getReadySteps(): number[] {
    const ready: number[] = [];

    for (const [stepNum, node] of this.graph.nodes) {
      if (node.status === 'ready') {
        ready.push(stepNum);
      }
    }

    return ready;
  }

  /**
   * Check if a step can be unlocked (all dependencies completed)
   */
  private checkAndUnlock(stepNum: number): boolean {
    const node = this.graph.nodes.get(stepNum);
    if (!node || node.status !== 'pending') {
      return false;
    }

    // Check if all dependencies are completed
    for (const depNum of node.dependencies) {
      const depNode = this.graph.nodes.get(depNum);
      if (!depNode || depNode.status !== 'completed') {
        return false;
      }
    }

    node.status = 'ready';
    return true;
  }

  /**
   * Mark step and all dependents as skipped
   */
  private skipStepAndDependents(stepNum: number, reason: string): number[] {
    const skipped: number[] = [];
    const toSkip = [stepNum];

    while (toSkip.length > 0) {
      const current = toSkip.pop()!;
      const node = this.graph.nodes.get(current);

      if (node && node.status !== 'skipped' && node.status !== 'completed') {
        node.status = 'skipped';
        node.result = {
          agentName: node.step.agent,
          success: false,
          result: `Skipped: ${reason}`,
          executionTimeMs: 0,
        };
        skipped.push(current);

        // Add all dependents to skip list
        for (const depNum of node.dependents) {
          toSkip.push(depNum);
        }
      }
    }

    return skipped;
  }

  /**
   * Check if there's still work to do
   */
  private hasWork(): boolean {
    for (const node of this.graph.nodes.values()) {
      if (node.status === 'pending' || node.status === 'ready' || node.status === 'running') {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if all steps succeeded
   */
  private allSucceeded(): boolean {
    for (const node of this.graph.nodes.values()) {
      if (node.status !== 'completed') {
        return false;
      }
    }
    return true;
  }

  /**
   * Get completed and total counts
   */
  private getCounts(): { completed: number; total: number } {
    let completed = 0;
    const total = this.graph.nodes.size;

    for (const node of this.graph.nodes.values()) {
      if (node.status === 'completed' || node.status === 'skipped') {
        completed++;
      }
    }

    return { completed, total };
  }

  /**
   * Build context string for a step from its dependencies
   */
  private buildStepContext(step: PlanStep, originalContext?: string): string {
    let context = '';

    // Include original context for root steps
    if (step.dependsOn.length === 0 && originalContext) {
      context += `[Original Context]\n${originalContext}\n\n`;
    }

    // Use summarized results from dependencies (not full output)
    for (const depId of step.dependsOn) {
      const summary = this.summarizedResults.get(depId);
      const fullResult = this.completedResults.get(depId);

      if (summary) {
        context += `[Result from step ${depId} (${fullResult?.agentName || 'unknown'})]\n${summary}\n\n`;
      } else if (fullResult?.success) {
        // Fallback to truncated full result
        const truncated = fullResult.result.length > 1000
          ? fullResult.result.slice(0, 1000) + '...'
          : fullResult.result;
        context += `[Result from step ${depId} (${fullResult.agentName})]\n${truncated}\n\n`;
      }
    }

    return context.trim();
  }

  /**
   * Call fixer agent to get suggestion for failed step
   */
  private async callFixer(
    node: ExecutionNode,
    errorMessage: string
  ): Promise<FixerSuggestion> {
    const prompt = `A task has failed. Please analyze and suggest a fix.

Task: ${node.step.task}
Agent: ${node.step.agent}
Error: ${errorMessage}
Attempt: ${node.retryCount} of ${this.config.maxRetries}

What should we do?`;

    try {
      const result = await createCompletion(
        'ollama',
        this.config.summarizationModel,
        [
          { role: 'system', content: FIXER_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.2, maxTokens: 500 }
      );

      const content = result.content || '{}';
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as FixerSuggestion;
        logger.info('Fixer suggestion', {
          step: node.step.step,
          action: parsed.action,
          explanation: parsed.explanation,
        });
        return parsed;
      }
    } catch (error) {
      logger.warn('Fixer failed to parse response', { error: (error as Error).message });
    }

    // Default: retry same approach
    return { action: 'retry_same', explanation: 'Parse error, retrying' };
  }

  /**
   * Execute a single step with retry logic
   */
  private async executeStepWithRetry(
    userId: string,
    node: ExecutionNode,
    originalContext?: string,
    onEvent: (event: DAGExecutionEvent) => void = () => {}
  ): Promise<void> {
    while (node.retryCount <= this.config.maxRetries) {
      try {
        // Enforce locked coding agent on every retry attempt
        if (
          this.config.lockedCodingAgent &&
          isCodingAgent(node.step.agent) &&
          node.step.agent !== this.config.lockedCodingAgent
        ) {
          logger.info('Overriding coding agent due to orchestration lock', {
            step: node.step.step,
            from: node.step.agent,
            to: this.config.lockedCodingAgent,
          });
          node.step = { ...node.step, agent: this.config.lockedCodingAgent };
        }

        const context = this.buildStepContext(node.step, originalContext);

        const result = await this.executeAgentFn(userId, {
          agentName: node.step.agent,
          task: node.step.task,
          context: context || undefined,
        });

        if (result.success) {
          node.status = 'completed';
          node.result = result;
          this.completedResults.set(node.step.step, result);

          // Summarize if enabled
          if (this.config.enableSummarization && result.result.length > 500) {
            try {
              const summaryResult = await summarizeAgentOutput(
                node.step.agent,
                result.result,
                node.step.task
              );
              this.summarizedResults.set(node.step.step, summaryResult.summary);
              logger.debug('Summarized step output', {
                step: node.step.step,
                originalLength: result.result.length,
                summaryLength: summaryResult.summary.length,
              });
            } catch (sumError) {
              // Fallback: use truncated output
              this.summarizedResults.set(node.step.step, result.result.slice(0, 500) + '...');
              logger.warn('Summarization failed, using truncated output', {
                step: node.step.step,
                error: (sumError as Error).message,
              });
            }
          } else {
            // Short output, use as-is
            this.summarizedResults.set(node.step.step, result.result);
          }

          return;
        }

        // Failed - try to fix
        node.retryCount++;

        if (node.retryCount <= this.config.maxRetries) {
          // AUTO-FAILOVER: If a coding agent failed on first attempt, try the other coding agent
          const currentAgent = node.step.agent;
          const failoverAgent = CODING_AGENT_FAILOVER[currentAgent];

          if (node.retryCount === 1 && failoverAgent && !this.config.lockedCodingAgent) {
            // First failure of a coding agent - auto-switch to the other one
            logger.info('Auto-failover: switching coding agent', {
              step: node.step.step,
              from: currentAgent,
              to: failoverAgent,
            });

            node.step = { ...node.step, agent: failoverAgent };

            onEvent({
              type: 'step_retrying',
              step: node.step.step,
              agent: failoverAgent,
              suggestion: {
                action: 'switch_agent',
                newAgent: failoverAgent,
                explanation: `Auto-failover: ${currentAgent} failed, trying ${failoverAgent}`,
              },
            });

            continue; // Skip the fixer, just retry with new agent
          }

          // Non-coding agent or second+ failure - call the fixer
          const suggestion = await this.callFixer(node, result.result);

          onEvent({
            type: 'step_retrying',
            step: node.step.step,
            agent: node.step.agent,
            suggestion,
          });

          if (suggestion.action === 'abort') {
            logger.info('Fixer suggested abort', { step: node.step.step });
            node.status = 'failed';
            node.result = result;
            return;
          }

          // Apply fix
          if (suggestion.action === 'modify_task' && suggestion.modifiedTask) {
            node.step = { ...node.step, task: suggestion.modifiedTask };
            logger.info('Modified task per fixer suggestion', {
              step: node.step.step,
              newTask: suggestion.modifiedTask.slice(0, 100),
            });
          } else if (suggestion.action === 'switch_agent' && suggestion.newAgent) {
            if (
              this.config.lockedCodingAgent &&
              isCodingAgent(suggestion.newAgent) &&
              suggestion.newAgent !== this.config.lockedCodingAgent
            ) {
              logger.info('Ignoring fixer coding-agent switch due to lock', {
                step: node.step.step,
                requested: suggestion.newAgent,
                locked: this.config.lockedCodingAgent,
              });
            } else {
              node.step = { ...node.step, agent: suggestion.newAgent };
              logger.info('Switched agent per fixer suggestion', {
                step: node.step.step,
                newAgent: suggestion.newAgent,
              });
            }
          }
          // retry_same: just loop again
        } else {
          node.status = 'failed';
          node.result = result;
        }
      } catch (error) {
        node.retryCount++;
        logger.error('Step execution error', {
          step: node.step.step,
          attempt: node.retryCount,
          error: (error as Error).message,
        });

        if (node.retryCount > this.config.maxRetries) {
          node.status = 'failed';
          node.result = {
            agentName: node.step.agent,
            success: false,
            result: (error as Error).message,
            executionTimeMs: 0,
          };
        }
      }
    }

    // Exhausted retries
    if (node.status !== 'completed') {
      node.status = 'failed';
    }
  }

  /**
   * Main execution method - async generator yielding progress events
   */
  async *execute(
    userId: string,
    originalContext?: string
  ): AsyncGenerator<DAGExecutionEvent> {
    const running = new Map<number, Promise<void>>();

    yield { type: 'status', status: `Starting parallel execution (${this.graph.nodes.size} steps, max ${this.config.maxConcurrency} concurrent)` };

    while (this.hasWork()) {
      // Find ready steps
      const readySteps = this.getReadySteps();

      // Calculate available slots
      const slotsAvailable = this.config.maxConcurrency - running.size;
      const stepsToStart = readySteps.slice(0, slotsAvailable);

      // Start new steps
      for (const stepNum of stepsToStart) {
        const node = this.graph.nodes.get(stepNum)!;
        node.status = 'running';

        yield { type: 'step_started', step: stepNum, agent: node.step.agent };

        // Start execution (non-blocking)
        const eventCollector: DAGExecutionEvent[] = [];
        const promise = this.executeStepWithRetry(
          userId,
          node,
          originalContext,
          (event) => eventCollector.push(event)
        ).then(() => {
          // Mark as done in running map will be handled by race
        });

        running.set(stepNum, promise);
      }

      // Wait for at least one to complete if we have running tasks
      if (running.size > 0) {
        // Create a race that tells us which step finished
        const racePromises = [...running.entries()].map(async ([stepNum, promise]) => {
          await promise;
          return stepNum;
        });

        const completedStep = await Promise.race(racePromises);

        // Clean up the completed promise
        running.delete(completedStep);

        const node = this.graph.nodes.get(completedStep)!;

        if (node.status === 'completed') {
          yield {
            type: 'step_completed',
            step: completedStep,
            agent: node.step.agent,
            result: node.result!,
          };

          // Unlock dependents
          for (const depNum of node.dependents) {
            if (this.checkAndUnlock(depNum)) {
              logger.debug('Unlocked step', { step: depNum });
            }
          }
        } else if (node.status === 'failed') {
          yield {
            type: 'step_failed',
            step: completedStep,
            agent: node.step.agent,
            error: node.result?.result || 'Unknown error',
            retryCount: node.retryCount,
          };

          // Skip dependent steps
          const skipped = this.skipStepAndDependents(completedStep, `Dependency step ${completedStep} failed`);
          for (const skippedNum of skipped) {
            if (skippedNum !== completedStep) {
              const skippedNode = this.graph.nodes.get(skippedNum)!;
              yield {
                type: 'step_skipped',
                step: skippedNum,
                agent: skippedNode.step.agent,
                reason: `Dependency step ${completedStep} failed`,
              };
            }
          }
        }

        // Emit progress
        const { completed, total } = this.getCounts();
        const runningAgents = [...running.keys()].map(
          (s) => this.graph.nodes.get(s)!.step.agent
        );

        yield {
          type: 'parallel_status',
          running: runningAgents,
          completed,
          total,
        };
      }
    }

    // Final result
    const success = this.allSucceeded();
    const { completed, total } = this.getCounts();

    yield {
      type: 'done',
      results: this.completedResults,
      success,
      error: success ? undefined : `${total - completed} step(s) failed or skipped`,
    };
  }
}
