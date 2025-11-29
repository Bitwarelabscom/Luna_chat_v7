import { pool } from '../db/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '../utils/logger.js';

const execAsync = promisify(exec);

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
    model: 'claude-cli',
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

Use the code execution sandbox when appropriate to test solutions.`,
    model: 'claude-cli',
    temperature: 0.2,
    tools: ['code_execution'],
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
    model: 'claude-cli',
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
    model: 'claude-cli',
    temperature: 0.3,
    tools: ['code_execution'],
    isDefault: false,
  },
  planner: {
    name: 'planner',
    description: 'Task planning and organization',
    systemPrompt: `You are a strategic planner. Your job is to:
- Break down complex goals into actionable steps
- Identify dependencies and priorities
- Estimate effort and resources needed
- Anticipate obstacles and risks
- Create clear timelines and milestones

Be practical and realistic. Focus on execution.`,
    model: 'claude-cli',
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
 * Execute a task with a specific agent using Claude CLI
 */
export async function executeAgentTask(
  userId: string,
  task: AgentTask
): Promise<AgentResult> {
  const startTime = Date.now();

  try {
    // Get agent config
    let systemPrompt: string;

    // Check built-in agents first
    if (BUILT_IN_AGENTS[task.agentName]) {
      const builtIn = BUILT_IN_AGENTS[task.agentName];
      systemPrompt = builtIn.systemPrompt;
    } else {
      // Check custom agents
      const result = await pool.query(
        `SELECT system_prompt FROM agent_configs WHERE user_id = $1 AND name = $2`,
        [userId, task.agentName]
      );

      if (result.rows.length === 0) {
        return {
          agentName: task.agentName,
          success: false,
          result: `Agent "${task.agentName}" not found`,
          executionTimeMs: Date.now() - startTime,
        };
      }

      systemPrompt = result.rows[0].system_prompt;
    }

    // Build the full prompt for Claude CLI
    let fullPrompt = `${systemPrompt}\n\n`;

    if (task.context) {
      fullPrompt += `Context:\n${task.context}\n\n`;
    }

    fullPrompt += `Task: ${task.task}`;

    // Execute using Claude CLI
    // Escape the prompt for shell safety
    const escapedPrompt = fullPrompt.replace(/'/g, "'\\''");
    const command = `/home/luna/.local/bin/claude -p '${escapedPrompt}'`;

    logger.info('Executing agent task via Claude CLI', {
      agentName: task.agentName,
      userId
    });

    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 100 * 1024 * 1024, // 100MB buffer
      timeout: 300000, // 5 minute timeout
    });

    if (stderr) {
      logger.warn('Claude CLI stderr', { stderr, agentName: task.agentName });
    }

    const result = stdout.trim() || 'No response generated';

    return {
      agentName: task.agentName,
      success: true,
      result,
      executionTimeMs: Date.now() - startTime,
    };
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
 * Execute multiple agent tasks in parallel
 */
export async function executeMultiAgentTasks(
  userId: string,
  tasks: AgentTask[]
): Promise<AgentResult[]> {
  return Promise.all(tasks.map(task => executeAgentTask(userId, task)));
}

/**
 * Orchestrate complex task with multiple agents
 */
export async function orchestrateTask(
  userId: string,
  task: string,
  context?: string
): Promise<{
  plan: string;
  results: AgentResult[];
  synthesis: string;
}> {
  // First, use planner to break down the task
  const planResult = await executeAgentTask(userId, {
    agentName: 'planner',
    task: `Break down this task and identify which specialists should handle each part. Available specialists: researcher, coder, writer, analyst.

Task: ${task}

Return a structured plan with clear assignments.`,
    context,
  });

  if (!planResult.success) {
    return {
      plan: 'Failed to create plan',
      results: [planResult],
      synthesis: planResult.result,
    };
  }

  // Parse plan to identify agent tasks (simplified)
  const agentTasks: AgentTask[] = [];

  // Check which agents are mentioned and create tasks
  const agentMentions = {
    researcher: planResult.result.toLowerCase().includes('researcher') || planResult.result.toLowerCase().includes('research'),
    coder: planResult.result.toLowerCase().includes('coder') || planResult.result.toLowerCase().includes('code'),
    writer: planResult.result.toLowerCase().includes('writer') || planResult.result.toLowerCase().includes('write'),
    analyst: planResult.result.toLowerCase().includes('analyst') || planResult.result.toLowerCase().includes('analy'),
  };

  for (const [agent, mentioned] of Object.entries(agentMentions)) {
    if (mentioned) {
      agentTasks.push({
        agentName: agent,
        task: `Complete your portion of this task:\n\nOriginal task: ${task}\n\nPlan: ${planResult.result}`,
        context,
      });
    }
  }

  // Execute agent tasks
  const results = await executeMultiAgentTasks(userId, agentTasks);

  // Synthesize results
  const synthesisResult = await executeAgentTask(userId, {
    agentName: 'writer',
    task: `Synthesize these results from multiple specialists into a cohesive response:

${results.map(r => `### ${r.agentName}\n${r.result}`).join('\n\n')}

Create a unified, well-structured response that addresses the original task: ${task}`,
  });

  return {
    plan: planResult.result,
    results,
    synthesis: synthesisResult.result,
  };
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

export default {
  getBuiltInAgents,
  createAgent,
  getAgents,
  executeAgentTask,
  executeMultiAgentTasks,
  orchestrateTask,
  deleteAgent,
};
