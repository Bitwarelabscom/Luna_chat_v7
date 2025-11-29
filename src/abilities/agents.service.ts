import { pool } from '../db/index.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createChatCompletion } from '../llm/openai.client.js';
import * as searxng from '../search/searxng.client.js';
import logger from '../utils/logger.js';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import * as workspace from './workspace.service.js';

const execFileAsync = promisify(execFile);

/**
 * Interface for extracted code files from agent output
 */
interface ExtractedFile {
  filename: string;
  language: string;
  content: string;
}

/**
 * Extract code blocks with filename annotations from markdown
 * Supports format: ```language:filename.ext
 */
function extractFilesFromOutput(output: string): ExtractedFile[] {
  const files: ExtractedFile[] = [];

  // Match code blocks with filename annotation: ```language:filename
  const codeBlockRegex = /```(\w+):([^\n]+)\n([\s\S]*?)```/g;
  let match;

  while ((match = codeBlockRegex.exec(output)) !== null) {
    const [, language, filename, content] = match;
    if (filename && content) {
      files.push({
        filename: filename.trim(),
        language: language.trim(),
        content: content.trim(),
      });
    }
  }

  return files;
}

/**
 * Save extracted files to user's workspace
 */
async function saveExtractedFiles(
  userId: string,
  files: ExtractedFile[]
): Promise<workspace.WorkspaceFile[]> {
  const savedFiles: workspace.WorkspaceFile[] = [];

  for (const file of files) {
    try {
      const saved = await workspace.writeFile(userId, file.filename, file.content);
      savedFiles.push(saved);
      logger.info('Saved workspace file from coder agent', {
        userId,
        filename: file.filename,
        size: saved.size,
      });
    } catch (error) {
      logger.error('Failed to save workspace file', {
        filename: file.filename,
        error: (error as Error).message,
      });
    }
  }

  return savedFiles;
}

/**
 * Extract JSON from a text response (handles markdown code blocks)
 */
function extractJSON(text: string): string {
  // Try to find JSON in code blocks first
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find raw JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  return text;
}

/**
 * Interface for orchestration plan steps
 */
export interface PlanStep {
  step: number;
  agent: string;
  task: string;
  dependsOn: number[];
}

export interface OrchestrationPlan {
  steps: PlanStep[];
}

export interface SequentialExecutionResult {
  success: boolean;
  results: Map<number, AgentResult>;
  failedStep?: PlanStep;
  error?: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  tools: string[];
  isDefault: boolean;
  createdAt: Date;
}

export interface AgentTask {
  agentName: string;
  task: string;
  context?: string;
}

export interface AgentResult {
  agentName: string;
  success: boolean;
  result: string;
  executionTimeMs: number;
  savedFiles?: string[]; // Files saved to workspace by coder agent
}

// Agents now use Claude CLI

// Built-in agent templates
const BUILT_IN_AGENTS: Record<string, Omit<AgentConfig, 'id' | 'createdAt'>> = {
  researcher: {
    name: 'researcher',
    description: 'Deep research and information gathering',
    systemPrompt: `You are a thorough research assistant. Your job is to:
- Analyze questions deeply and identify key aspects to investigate
- Provide comprehensive, well-sourced information
- Distinguish between facts and opinions
- Acknowledge uncertainty when appropriate
- Summarize findings clearly

Be thorough but concise. Focus on accuracy over speed.`,
    model: 'o4-mini',
    temperature: 0.3,
    tools: ['search'],
    isDefault: false,
  },
  coder: {
    name: 'coder',
    description: 'Code writing, debugging, and explanation',
    systemPrompt: `You are an expert programmer. Your job is to:
- Write clean, efficient, well-documented code
- Debug issues systematically
- Explain code clearly at any level
- Follow best practices and design patterns
- Consider edge cases and error handling

Use the code execution sandbox when appropriate to test solutions.

WORKSPACE: You can save scripts to the user's persistent workspace. When writing substantial scripts or files:
- Use markdown code blocks with a filename annotation like: \`\`\`python:analysis.py
- Supported file types: .py, .js, .ts, .sh, .json, .txt, .md, .csv, .sql
- Saved files can be executed later from the workspace
- Example format for saving:
  \`\`\`python:data_processor.py
  # Your Python code here
  \`\`\``,
    model: 'o4-mini',
    temperature: 0.2,
    tools: ['code_execution', 'workspace'],
    isDefault: false,
  },
  writer: {
    name: 'writer',
    description: 'Creative and professional writing',
    systemPrompt: `You are a skilled writer. Your job is to:
- Adapt tone and style to the task
- Structure content effectively
- Use engaging, clear language
- Edit and refine drafts
- Match the user's voice when requested

Be creative but purposeful. Quality over quantity.`,
    model: 'o4-mini',
    temperature: 0.7,
    tools: [],
    isDefault: false,
  },
  analyst: {
    name: 'analyst',
    description: 'Data analysis and insights',
    systemPrompt: `You are a data analyst. Your job is to:
- Analyze data patterns and trends
- Perform calculations and statistics
- Create clear visualizations (describe them)
- Draw actionable insights
- Explain findings in accessible terms

Use code execution for calculations when helpful.`,
    model: 'o4-mini',
    temperature: 0.3,
    tools: ['code_execution'],
    isDefault: false,
  },
  planner: {
    name: 'planner',
    description: 'Task planning and organization',
    systemPrompt: `You are a strategic planner. When given a task, break it down into steps and assign each to a specialist.

Available specialists:
- researcher: Finds information, data, facts
- analyst: Performs calculations, data analysis
- coder: Writes code, debugs
- writer: Creates content, synthesizes information

Output your plan as JSON with this exact format:
{
  "steps": [
    {"step": 1, "agent": "researcher", "task": "Description of what to research", "dependsOn": []},
    {"step": 2, "agent": "analyst", "task": "Description of analysis to perform", "dependsOn": [1]}
  ]
}

Rules:
- Use "dependsOn" to list step numbers that must complete first
- Steps with no dependencies use an empty array: []
- Be specific in task descriptions
- Only use the agents listed above`,
    model: 'o4-mini',
    temperature: 0.4,
    tools: [],
    isDefault: false,
  },
};

/**
 * Get built-in agents
 */
export function getBuiltInAgents(): Array<Omit<AgentConfig, 'id' | 'createdAt'>> {
  return Object.values(BUILT_IN_AGENTS);
}

/**
 * Create a custom agent
 */
export async function createAgent(
  userId: string,
  agent: {
    name: string;
    description?: string;
    systemPrompt: string;
    model?: string;
    temperature?: number;
    tools?: string[];
    isDefault?: boolean;
  }
): Promise<AgentConfig> {
  try {
    // If setting as default, unset other defaults
    if (agent.isDefault) {
      await pool.query(
        `UPDATE agent_configs SET is_default = false WHERE user_id = $1`,
        [userId]
      );
    }

    const result = await pool.query(
      `INSERT INTO agent_configs (user_id, name, description, system_prompt, model, temperature, tools, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, description, system_prompt, model, temperature, tools, is_default, created_at`,
      [userId, agent.name, agent.description, agent.systemPrompt, agent.model || 'claude-cli', agent.temperature || 0.7, agent.tools || [], agent.isDefault || false]
    );

    return mapRowToAgent(result.rows[0]);
  } catch (error) {
    if ((error as Error).message.includes('duplicate key')) {
      throw new Error(`Agent "${agent.name}" already exists`);
    }
    throw error;
  }
}

/**
 * Get user's custom agents
 */
export async function getAgents(userId: string): Promise<AgentConfig[]> {
  try {
    const result = await pool.query(
      `SELECT id, name, description, system_prompt, model, temperature, tools, is_default, created_at
       FROM agent_configs
       WHERE user_id = $1
       ORDER BY is_default DESC, created_at DESC`,
      [userId]
    );
    return result.rows.map(mapRowToAgent);
  } catch (error) {
    logger.error('Failed to get agents', { error: (error as Error).message, userId });
    return [];
  }
}

/**
 * Execute a task with a specific agent
 * - coder agent uses Claude CLI
 * - all other agents use OpenAI o4-mini
 */
export async function executeAgentTask(
  userId: string,
  task: AgentTask
): Promise<AgentResult> {
  const startTime = Date.now();

  try {
    // Get agent config
    let systemPrompt: string;
    let temperature = 0.7;

    // Check built-in agents first
    if (BUILT_IN_AGENTS[task.agentName]) {
      const builtIn = BUILT_IN_AGENTS[task.agentName];
      systemPrompt = builtIn.systemPrompt;
      temperature = builtIn.temperature;
    } else {
      // Check custom agents
      const dbResult = await pool.query(
        `SELECT system_prompt, temperature FROM agent_configs WHERE user_id = $1 AND name = $2`,
        [userId, task.agentName]
      );

      if (dbResult.rows.length === 0) {
        return {
          agentName: task.agentName,
          success: false,
          result: `Agent "${task.agentName}" not found`,
          executionTimeMs: Date.now() - startTime,
        };
      }

      systemPrompt = dbResult.rows[0].system_prompt;
      temperature = parseFloat(dbResult.rows[0].temperature) || 0.7;
    }

    // Build the user message
    let userMessage = '';
    if (task.context) {
      userMessage += `Context:\n${task.context}\n\n`;
    }
    userMessage += `Task: ${task.task}`;

    // Route agents to appropriate execution method
    if (task.agentName === 'coder') {
      return executeWithClaudeCLI(task.agentName, systemPrompt, userMessage, startTime, userId);
    } else if (task.agentName === 'researcher') {
      return executeResearcherWithWebSearch(task.agentName, systemPrompt, userMessage, startTime);
    } else {
      return executeWithOpenAI(task.agentName, systemPrompt, userMessage, temperature, startTime);
    }
  } catch (error) {
    logger.error('Agent task failed', {
      error: (error as Error).message,
      agentName: task.agentName,
      userId
    });
    return {
      agentName: task.agentName,
      success: false,
      result: `Error: ${(error as Error).message}`,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Execute task with OpenAI o4-mini
 */
async function executeWithOpenAI(
  agentName: string,
  systemPrompt: string,
  userMessage: string,
  _temperature: number,
  startTime: number
): Promise<AgentResult> {
  logger.info('Executing agent task via OpenAI o4-mini', { agentName });

  // o4-mini doesn't support custom temperature, only default (1)
  const completion = await createChatCompletion({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    provider: 'openai',
    model: 'o4-mini',
  });

  const result = completion.content || 'No response generated';

  logger.info('Agent task completed', {
    agentName,
    executionTimeMs: Date.now() - startTime,
    tokensUsed: completion.tokensUsed
  });

  return {
    agentName,
    success: true,
    result,
    executionTimeMs: Date.now() - startTime,
  };
}

/**
 * Execute researcher task with real web search via SearXNG
 */
async function executeResearcherWithWebSearch(
  agentName: string,
  systemPrompt: string,
  userMessage: string,
  startTime: number
): Promise<AgentResult> {
  logger.info('Executing researcher with web search', { agentName });

  try {
    // Extract search query from the task
    const taskMatch = userMessage.match(/Task:\s*(.+)/s);
    const searchTopic = taskMatch ? taskMatch[1].trim() : userMessage;

    // Create a focused search query
    const searchQuery = searchTopic.substring(0, 200); // Limit query length

    logger.info('Searching web', { query: searchQuery });

    // Search the web
    const searchResults = await searxng.search(searchQuery, {
      maxResults: 10,
      engines: ['google', 'bing', 'duckduckgo'],
    });

    if (searchResults.length === 0) {
      return {
        agentName,
        success: false,
        result: 'No search results found for this query.',
        executionTimeMs: Date.now() - startTime,
      };
    }

    // Format search results for the LLM
    const searchContext = searchResults.map((r, i) =>
      `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`
    ).join('\n\n');

    logger.info('Got search results', { count: searchResults.length });

    // Use LLM to synthesize the search results
    const synthesisPrompt = `${systemPrompt}

You have access to the following web search results:

${searchContext}

Based on these search results, provide a comprehensive answer. Include specific facts, figures, and cite your sources using [1], [2], etc.`;

    const completion = await createChatCompletion({
      messages: [
        { role: 'system', content: synthesisPrompt },
        { role: 'user', content: userMessage }
      ],
      provider: 'openai',
      model: 'o4-mini',
    });

    // Append sources to the result
    const sources = searchResults.map((r, i) => `[${i + 1}] ${r.title}: ${r.url}`).join('\n');
    const resultWithSources = `${completion.content}\n\n**Sources:**\n${sources}`;

    logger.info('Researcher task completed with web search', {
      agentName,
      executionTimeMs: Date.now() - startTime,
      sourcesCount: searchResults.length,
    });

    return {
      agentName,
      success: true,
      result: resultWithSources,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    logger.error('Researcher web search failed', {
      error: (error as Error).message,
      agentName
    });
    return {
      agentName,
      success: false,
      result: `Research error: ${(error as Error).message}`,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Prepare Claude CLI credentials (safe file operations, no shell)
 */
function setupClaudeCredentials(): void {
  const credentialsSource = '/claude-credentials.json';
  const claudeDir = path.join(homedir(), '.claude');
  const credentialsDest = path.join(claudeDir, '.credentials.json');

  try {
    // Create .claude directory if it doesn't exist
    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true, mode: 0o700 });
    }

    // Copy credentials if source exists
    if (existsSync(credentialsSource)) {
      copyFileSync(credentialsSource, credentialsDest);
    }
  } catch (err) {
    // Silently ignore credential setup errors (same as original behavior)
    logger.debug('Claude credentials setup skipped', { error: (err as Error).message });
  }
}

/**
 * Execute task with Claude CLI (for coder agent)
 * SECURITY: Uses execFile instead of exec to prevent command injection
 * Automatically extracts and saves code files to workspace
 */
async function executeWithClaudeCLI(
  agentName: string,
  systemPrompt: string,
  userMessage: string,
  startTime: number,
  userId: string
): Promise<AgentResult> {
  const fullPrompt = `${systemPrompt}\n\n${userMessage}`;
  const claudePath = process.env.CLAUDE_PATH || '/usr/local/bin/claude';

  // Setup credentials using safe file operations (no shell)
  setupClaudeCredentials();

  logger.info('Executing agent task via Claude CLI', { agentName });

  try {
    // SECURITY: Use execFile with arguments array - no shell invocation
    // This prevents command injection as arguments are passed directly to the process
    const { stdout, stderr } = await execFileAsync(claudePath, ['-p', fullPrompt], {
      maxBuffer: 100 * 1024 * 1024,
      timeout: 300000,
      // Note: No shell option - execFile doesn't use shell by default
    });

    if (stderr) {
      logger.warn('Claude CLI stderr', { stderr, agentName });
    }

    let result = stdout.trim() || 'No response generated';

    // Extract and save any files from the output
    const extractedFiles = extractFilesFromOutput(result);
    const savedFileNames: string[] = [];

    if (extractedFiles.length > 0) {
      const savedFiles = await saveExtractedFiles(userId, extractedFiles);
      savedFileNames.push(...savedFiles.map(f => f.name));

      // Append saved file info to the result
      if (savedFiles.length > 0) {
        result += `\n\n📁 **Saved to workspace:** ${savedFiles.map(f => f.name).join(', ')}`;
      }
    }

    logger.info('Agent task completed', {
      agentName,
      executionTimeMs: Date.now() - startTime,
      savedFiles: savedFileNames.length,
    });

    return {
      agentName,
      success: true,
      result,
      executionTimeMs: Date.now() - startTime,
      savedFiles: savedFileNames.length > 0 ? savedFileNames : undefined,
    };
  } catch (error) {
    logger.error('Claude CLI execution failed', {
      error: (error as Error).message,
      agentName
    });
    return {
      agentName,
      success: false,
      result: `Error: ${(error as Error).message}`,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Execute multiple agent tasks in parallel
 */
export async function executeMultiAgentTasks(
  userId: string,
  tasks: AgentTask[]
): Promise<AgentResult[]> {
  return Promise.all(tasks.map(task => executeAgentTask(userId, task)));
}

/**
 * Execute agent tasks sequentially with context passing
 */
export async function executeSequentialAgentTasks(
  userId: string,
  steps: PlanStep[],
  onStepStart?: (step: PlanStep) => void
): Promise<SequentialExecutionResult> {
  const results = new Map<number, AgentResult>();

  for (const step of steps) {
    // Notify step start
    if (onStepStart) {
      onStepStart(step);
    }

    // Build context from dependencies
    let context = '';
    for (const depId of step.dependsOn) {
      const depResult = results.get(depId);
      if (depResult && depResult.success) {
        context += `\n\n[Result from step ${depId} (${depResult.agentName})]:\n${depResult.result}`;
      }
    }

    logger.info('Executing sequential step', {
      step: step.step,
      agent: step.agent,
      hasDependencies: step.dependsOn.length > 0,
    });

    const result = await executeAgentTask(userId, {
      agentName: step.agent,
      task: step.task,
      context: context.trim() || undefined,
    });

    // Stop on failure
    if (!result.success) {
      logger.error('Sequential step failed', {
        step: step.step,
        agent: step.agent,
        error: result.result,
      });
      return {
        success: false,
        results,
        failedStep: step,
        error: result.result,
      };
    }

    results.set(step.step, result);
    logger.info('Sequential step completed', {
      step: step.step,
      agent: step.agent,
      executionTimeMs: result.executionTimeMs,
    });
  }

  return {
    success: true,
    results,
  };
}

/**
 * Orchestration result type
 */
export interface OrchestrationResult {
  plan: string;
  results: AgentResult[];
  synthesis: string;
  success: boolean;
  error?: string;
}

/**
 * Orchestration event types for streaming
 */
export type OrchestrationEvent =
  | { type: 'status'; status: string }
  | { type: 'done'; result: OrchestrationResult };

/**
 * Orchestrate complex task with multiple agents using structured planning (streaming version)
 */
export async function* orchestrateTaskStream(
  userId: string,
  task: string,
  context?: string
): AsyncGenerator<OrchestrationEvent> {
  // Step 1: Get structured plan from planner
  yield { type: 'status', status: 'Planning task with planner agent...' };

  const planResult = await executeAgentTask(userId, {
    agentName: 'planner',
    task: `Create an execution plan for this task: ${task}`,
    context,
  });

  if (!planResult.success) {
    yield {
      type: 'done',
      result: {
        plan: 'Failed to create plan',
        results: [planResult],
        synthesis: planResult.result,
        success: false,
        error: 'Planning failed',
      }
    };
    return;
  }

  // Step 2: Parse JSON plan
  let plan: OrchestrationPlan;
  try {
    const jsonStr = extractJSON(planResult.result);
    plan = JSON.parse(jsonStr) as OrchestrationPlan;

    if (!plan.steps || !Array.isArray(plan.steps)) {
      throw new Error('Invalid plan format: missing steps array');
    }

    logger.info('Parsed orchestration plan', {
      stepCount: plan.steps.length,
      agents: plan.steps.map(s => s.agent),
    });

    yield { type: 'status', status: `Plan ready: ${plan.steps.length} steps` };
  } catch (parseError) {
    logger.error('Failed to parse plan JSON', {
      error: (parseError as Error).message,
      planResult: planResult.result.substring(0, 500),
    });
    yield {
      type: 'done',
      result: {
        plan: planResult.result,
        results: [planResult],
        synthesis: `Failed to parse execution plan: ${(parseError as Error).message}`,
        success: false,
        error: 'Plan parsing failed',
      }
    };
    return;
  }

  // Step 3: Execute steps sequentially with context passing
  const results = new Map<number, AgentResult>();

  for (const step of plan.steps) {
    yield { type: 'status', status: `Running ${step.agent} agent (step ${step.step}/${plan.steps.length})...` };

    // Build context from dependencies
    let stepContext = '';
    for (const depId of step.dependsOn) {
      const depResult = results.get(depId);
      if (depResult && depResult.success) {
        stepContext += `\n\n[Result from step ${depId} (${depResult.agentName})]:\n${depResult.result}`;
      }
    }

    const result = await executeAgentTask(userId, {
      agentName: step.agent,
      task: step.task,
      context: stepContext.trim() || undefined,
    });

    if (!result.success) {
      yield {
        type: 'done',
        result: {
          plan: planResult.result,
          results: Array.from(results.values()),
          synthesis: `Orchestration failed at step ${step.step} (${step.agent}): ${result.result}`,
          success: false,
          error: result.result,
        }
      };
      return;
    }

    results.set(step.step, result);
    yield { type: 'status', status: `${step.agent} agent completed` };
  }

  // Step 4: Synthesize results with writer
  yield { type: 'status', status: 'Synthesizing results with writer agent...' };

  const allResultsText = Array.from(results.entries())
    .map(([stepNum, r]) => `### Step ${stepNum} (${r.agentName})\n${r.result}`)
    .join('\n\n');

  const synthesisResult = await executeAgentTask(userId, {
    agentName: 'writer',
    task: `Synthesize these results into a clear, unified response for the original task: "${task}"`,
    context: allResultsText,
  });

  yield {
    type: 'done',
    result: {
      plan: planResult.result,
      results: Array.from(results.values()),
      synthesis: synthesisResult.result,
      success: true,
    }
  };
}

/**
 * Orchestrate complex task (non-streaming wrapper for backwards compatibility)
 */
export async function orchestrateTask(
  userId: string,
  task: string,
  context?: string,
  onStatus?: (status: string) => void
): Promise<OrchestrationResult> {
  for await (const event of orchestrateTaskStream(userId, task, context)) {
    if (event.type === 'status' && onStatus) {
      onStatus(event.status);
    } else if (event.type === 'done') {
      return event.result;
    }
  }
  // Should never reach here
  return { plan: '', results: [], synthesis: 'No result', success: false, error: 'Unexpected end' };
}

/**
 * Delete an agent
 */
export async function deleteAgent(userId: string, agentId: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `DELETE FROM agent_configs WHERE id = $1 AND user_id = $2`,
      [agentId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    logger.error('Failed to delete agent', { error: (error as Error).message, userId, agentId });
    return false;
  }
}

function mapRowToAgent(row: Record<string, unknown>): AgentConfig {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | undefined,
    systemPrompt: row.system_prompt as string,
    model: row.model as string,
    temperature: parseFloat(row.temperature as string),
    tools: (row.tools as string[]) || [],
    isDefault: row.is_default as boolean,
    createdAt: row.created_at as Date,
  };
}

/**
 * Detect if a message requires multi-agent orchestration
 */
export function needsOrchestration(message: string): boolean {
  const orchestrationKeywords = [
    'research and analyze',
    'research and calculate',
    'find and calculate',
    'gather data and',
    'investigate and',
    'look up and analyze',
    'multiple steps',
    'complex task',
    'orchestrate',
    'plan and execute',
    'find out and compute',
    'estimate the total',
    'calculate based on',
  ];

  const lowerMessage = message.toLowerCase();
  return orchestrationKeywords.some(kw => lowerMessage.includes(kw));
}

export default {
  getBuiltInAgents,
  createAgent,
  getAgents,
  executeAgentTask,
  executeMultiAgentTasks,
  executeSequentialAgentTasks,
  orchestrateTask,
  orchestrateTaskStream,
  needsOrchestration,
  deleteAgent,
};
