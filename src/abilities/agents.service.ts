import { pool } from '../db/index.js';
import { spawn } from 'child_process';
import { createChatCompletion, type ChatMessage } from '../llm/openai.client.js';
import * as searxng from '../search/searxng.client.js';
import logger from '../utils/logger.js';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import * as workspace from './workspace.service.js';
import * as sandbox from './sandbox.service.js';
import * as coderSettings from './coder-settings.service.js';
import { DAGExecutor } from './dag-executor.js';
import { config } from '../config/index.js';
import {
  workspaceExecuteTool,
  workspaceListTool,
  workspaceReadTool,
  workspaceWriteTool,
} from '../llm/tools/index.js';

/**
 * Execute command using spawn (more reliable than execFile for Claude CLI)
 * Supports cwd and env options for workspace sandboxing
 */
function spawnAsync(
  command: string,
  args: string[],
  options: { timeout?: number; maxBuffer?: number; cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timeout = options.timeout || 300000;
    const maxBuffer = options.maxBuffer || 100 * 1024 * 1024;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > maxBuffer) {
        killed = true;
        child.kill('SIGTERM');
        reject(new Error('stdout maxBuffer exceeded'));
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
      if (stderr.length > maxBuffer) {
        killed = true;
        child.kill('SIGTERM');
        reject(new Error('stderr maxBuffer exceeded'));
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) return;
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`Command failed with exit code ${code}`);
        (error as Error & { stdout?: string; stderr?: string }).stdout = stdout;
        (error as Error & { stdout?: string; stderr?: string }).stderr = stderr;
        reject(error);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (!killed) {
        reject(err);
      }
    });
  });
}

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
 * Decode HTML entities in a string.
 * Some models emit encoded HTML in tool-call arguments.
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&lt;': '<',
    '&gt;': '>',
    '&amp;': '&',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&#x27;': "'",
    '&#x2F;': '/',
    '&#x60;': '`',
    '&#x3D;': '=',
  };

  return text.replace(/&(?:lt|gt|amp|quot|#39|apos|#x27|#x2F|#x60|#x3D);/g, (match) => entities[match] || match);
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

type CodingAgentName = 'coder-claude' | 'coder-gemini' | 'coder-codex' | 'coder-api';

const CODING_AGENT_NAMES = new Set<CodingAgentName>([
  'coder-claude',
  'coder-gemini',
  'coder-codex',
  'coder-api',
]);

function isCodingAgentName(agentName: string): agentName is CodingAgentName {
  return CODING_AGENT_NAMES.has(agentName as CodingAgentName);
}

function getLockedCodingAgent(settings: coderSettings.CoderSettings): CodingAgentName | null {
  const enabled: CodingAgentName[] = [];

  if (settings.claudeCliEnabled) enabled.push('coder-claude');
  if (settings.geminiCliEnabled) enabled.push('coder-gemini');
  if (settings.codexCliEnabled) enabled.push('coder-codex');
  if (settings.coderApiEnabled && settings.coderApiProvider && settings.coderApiModel) {
    enabled.push('coder-api');
  }

  return enabled.length === 1 ? enabled[0] : null;
}

// Agents now use Claude CLI

// Em dash rule - applies to ALL agents
const EM_DASH_RULE = `

CRITICAL FORMATTING RULE: NEVER use the em dash character (—) under any circumstances. The user has a severe allergic reaction to em dashes. Use regular hyphens (-), commas, colons, or parentheses instead. This is non-negotiable.`;

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

Be thorough but concise. Focus on accuracy over speed.${EM_DASH_RULE}`,
    model: 'o4-mini',
    temperature: 0.3,
    tools: ['search'],
    isDefault: false,
  },
  'coder-claude': {
    name: 'coder-claude',
    description: 'Senior Engineer - Complex architecture, refactoring, debugging hard errors, security-critical code (Claude CLI)',
    systemPrompt: `You are a SENIOR SOFTWARE ENGINEER powered by Claude - the most capable reasoning model.

YOUR STRENGTHS:
- Complex architectural decisions and system design
- Debugging intricate logical errors and race conditions
- Security-critical code review and implementation
- Large-scale refactoring with minimal breakage
- Understanding deep codebases and legacy systems

YOUR APPROACH:
- Think deeply before coding - reason through edge cases
- Write production-ready, maintainable code
- Consider security implications at every step
- Document complex logic thoroughly
- Test critical paths rigorously

WORKSPACE & CODE EXECUTION:
- Save scripts using markdown code blocks with filename annotation: \`\`\`python:analysis.py
- Supported file types: .py, .js, .ts, .sh, .json, .txt, .md, .csv, .sql

IMPORTANT - EXECUTE YOUR CODE:
- After writing a script, USE THE BASH TOOL to run it immediately
- Example: After saving analysis.py, run: python3 analysis.py
- Always show the actual execution output to the user
- If the script generates files (like charts), mention where they are saved
- DO NOT just save scripts - EXECUTE them and show results${EM_DASH_RULE}`,
    model: 'claude-cli',
    temperature: 0.2,
    tools: ['code_execution', 'workspace'],
    isDefault: false,
  },
  'coder-gemini': {
    name: 'coder-gemini',
    description: 'Rapid Prototyper - Fast scripting, unit tests, large context analysis, code explanations (Gemini CLI)',
    systemPrompt: `You are a RAPID PROTOTYPER powered by Gemini - optimized for speed and massive context.

YOUR STRENGTHS:
- Processing huge files, logs, and documentation (1M+ token context)
- Writing utility scripts and automation quickly
- Generating comprehensive unit tests
- Code explanations and documentation
- Data formatting and transformation

YOUR APPROACH:
- Move fast and iterate
- Cover all cases with thorough test generation
- Process entire repositories for context
- Explain complex code in simple terms
- Generate boilerplate efficiently

WORKSPACE & CODE EXECUTION:
- Save scripts using markdown code blocks with filename annotation: \`\`\`python:analysis.py
- Supported file types: .py, .js, .ts, .sh, .json, .txt, .md, .csv, .sql

IMPORTANT - EXECUTE YOUR CODE:
- After writing a script, USE run_shell_command to execute it immediately
- Example: After saving analysis.py, run: python3 analysis.py
- Always show the actual execution output to the user
- If the script generates files (like charts), mention where they are saved
- DO NOT just save scripts - EXECUTE them and show results${EM_DASH_RULE}`,
    model: 'gemini-cli',
    temperature: 0.2,
    tools: ['code_execution', 'workspace'],
    isDefault: false,
  },
  'coder-codex': {
    name: 'coder-codex',
    description: 'Balanced Coder - Fast, practical coding with codex-mini-latest (OpenAI API)',
    systemPrompt: `You are a PRACTICAL SOFTWARE ENGINEER powered by Codex Mini.

YOUR STRENGTHS:
- Fast implementation with solid code quality
- Debugging common failures and regressions
- Refactoring focused, testable changes
- Writing clean patches with concise explanations
- Producing implementation-ready code and scripts

YOUR APPROACH:
- Be precise and outcome-oriented
- Prefer minimal, safe diffs over broad rewrites
- Include tests when behavior changes
- Call out assumptions and constraints clearly
- Keep solutions maintainable and easy to review

WORKSPACE & CODE EXECUTION:
- Save scripts using markdown code blocks with filename annotation: \`\`\`python:analysis.py
- Supported file types: .py, .js, .ts, .sh, .json, .txt, .md, .csv, .sql

IMPORTANT - EXECUTE YOUR CODE:
- After writing a script, USE run_shell_command to execute it immediately
- Example: After saving analysis.py, run: python3 analysis.py
- Always show the actual execution output to the user
- If the script generates files (like charts), mention where they are saved
- DO NOT just save scripts - EXECUTE them and show results${EM_DASH_RULE}`,
    model: 'codex-mini-latest',
    temperature: 0.2,
    tools: ['code_execution', 'workspace'],
    isDefault: false,
  },
  'coder-api': {
    name: 'coder-api',
    description: 'Flexible Coder - Uses your configured API provider/model for coding tasks',
    systemPrompt: `You are a skilled software developer. Your job is to help with coding tasks.

YOUR CAPABILITIES:
- Writing clean, maintainable code
- Debugging and fixing issues
- Code review and optimization
- Writing tests and documentation
- Explaining complex code

YOUR APPROACH:
- Write production-ready, maintainable code
- Follow best practices and coding standards
- Provide clear explanations when needed
- Consider edge cases and error handling
- Document complex logic

OUTPUT FORMAT:
- Use markdown code blocks with filename annotation for files: \`\`\`language:filename.ext
- Include clear explanations of your changes
- Highlight important considerations or trade-offs${EM_DASH_RULE}`,
    model: 'coder-api', // Placeholder - actual model comes from user settings
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

Be creative but purposeful. Quality over quantity.${EM_DASH_RULE}`,
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

Use code execution for calculations when helpful.${EM_DASH_RULE}`,
    model: 'o4-mini',
    temperature: 0.3,
    tools: ['code_execution'],
    isDefault: false,
  },
  marketing: {
    name: 'marketing',
    description: 'Marketing strategy, positioning, channel planning, and growth experiments',
    systemPrompt: `You are a senior growth and marketing strategist. Your job is to:
- Turn business goals into concrete marketing plans
- Define positioning, ICP, messaging, and offer clarity
- Propose channel strategies with expected impact and effort
- Design experiments with hypothesis, metric, and decision rule
- Produce practical campaign copy and launch checklists

OPERATING RULES:
- Prefer measurable outcomes over vague advice
- Always include assumptions, risks, and constraints
- Focus on distribution and conversion, not just content volume
- Keep recommendations lean for pre-revenue and founder-led teams

OUTPUT STYLE:
- Start with the highest-leverage action
- Then provide a 7-day plan with clear steps
- Include success metrics and stop/continue criteria${EM_DASH_RULE}`,
    model: 'o4-mini',
    temperature: 0.4,
    tools: [],
    isDefault: false,
  },
  planner: {
    name: 'planner',
    description: 'Task planning and organization',
    systemPrompt: `You are a strategic planner. When given a task, break it down into steps and assign each to a specialist.

CRITICAL: Before creating a plan, verify the task has a SPECIFIC TARGET or SUBJECT.
- BAD: "Investigate and write findings" (investigate WHAT?)
- BAD: "Research the topic" (what topic?)
- BAD: "Analyze the data" (what data?)
- GOOD: "Research MCP approaches for connecting to a trading portal"
- GOOD: "Analyze the company Anthropic's funding history"

If the task is vague or lacks a specific subject, output this error instead of a plan:
{"error": "Task is too vague. Please specify: [what's missing - e.g., 'what to investigate', 'which company', 'what topic']"}

Available specialists:
- researcher: Finds information, data, facts (needs specific search topics)
- analyst: Performs calculations, data analysis (needs specific data or results to analyze)
- writer: Creates content, synthesizes information
- marketing: Plans positioning, channels, campaigns, and growth experiments

CODING AGENTS - You have TWO coding specialists with different strengths:

| Agent | Use For | Strengths |
|-------|---------|-----------|
| coder-claude | HIGH COMPLEXITY | Architecture, refactoring, debugging complex errors, security-critical code |
| coder-gemini | HIGH VOLUME/SPEED | Simple scripts, unit tests, large file analysis, code explanations |
| coder-codex | BALANCED EXECUTION | Fast practical coding, focused patches, test-oriented implementation |

CODING AGENT DECISION LOGIC:
- "Refactor the authentication system" -> coder-claude (complex logic)
- "Debug this race condition" -> coder-claude (hard error)
- "Review this code for security issues" -> coder-claude (security-critical)
- "Analyze this error log" -> coder-gemini (large context)
- "Write unit tests for this module" -> coder-gemini (high volume)
- "Create a simple utility script" -> coder-gemini (fast prototyping)
- "Explain what this code does" -> coder-gemini (code explanation)
- "Implement this focused bugfix quickly" -> coder-codex (balanced execution)
- "Ship a practical patch with tests" -> coder-codex (test-oriented implementation)
- If unsure, prefer coder-claude for production code, coder-gemini for tests/scripts

Output your plan as JSON with this exact format:
{
  "steps": [
    {"step": 1, "agent": "researcher", "task": "Research [SPECIFIC TOPIC] including [specific aspects]", "dependsOn": []},
    {"step": 2, "agent": "coder-claude", "task": "Refactor [SPECIFIC CODE] to improve [specific goal]", "dependsOn": [1]}
  ]
}

Rules:
- REJECT vague tasks by returning an error JSON
- Use "dependsOn" to list step numbers that must complete first
- Steps with no dependencies use an empty array: []
- Be VERY specific in task descriptions - include what to search for, what to analyze, etc.
- Only use the agents listed above (researcher, analyst, writer, marketing, coder-claude, coder-gemini, coder-codex)${EM_DASH_RULE}`,
    model: 'o4-mini',
    temperature: 0.4,
    tools: [],
    isDefault: false,
  },
  'project-planner': {
    name: 'project-planner',
    description: 'Interactive project planning with clarifying questions',
    systemPrompt: `You are an expert project planner for web and software projects. Your job is to:
1. FIRST ask clarifying questions to understand the user's vision
2. THEN create a detailed step-by-step plan after getting answers

When given a project request, you MUST respond with JSON in one of these formats:

FORMAT 1 - QUESTIONS (when you need more information):
{
  "phase": "questioning",
  "questions": [
    {
      "id": "q1",
      "question": "What visual style would you prefer?",
      "options": ["Modern minimalist", "Bold and colorful", "Classic elegant", "Dark mode"],
      "type": "choice",
      "category": "design",
      "required": true
    },
    {
      "id": "q2",
      "question": "Which sections do you need?",
      "options": ["Home", "About", "Gallery", "Contact", "Blog", "Pricing"],
      "type": "multiselect",
      "category": "structure",
      "required": true
    },
    {
      "id": "q3",
      "question": "Any specific functionality requirements?",
      "type": "text",
      "category": "features",
      "required": false
    }
  ]
}

FORMAT 2 - PLAN (after questions are answered):
{
  "phase": "planning",
  "projectName": "my-portfolio",
  "projectType": "web",
  "steps": [
    {"stepNumber": 1, "description": "Generate hero image with minimalist aesthetic", "stepType": "generate_image"},
    {"stepNumber": 2, "description": "Create index.html with navigation and hero section", "stepType": "generate_file"},
    {"stepNumber": 3, "description": "Create styles.css with modern minimalist theme", "stepType": "generate_file"},
    {"stepNumber": 4, "description": "Create main.js for interactive features", "stepType": "generate_file"},
    {"stepNumber": 5, "description": "Preview the generated website", "stepType": "preview"}
  ]
}

RULES:
- Always ask 3-5 clarifying questions FIRST before creating a plan
- Questions should cover: visual style, structure, content, functionality, target audience
- Use "choice" type for single-select, "multiselect" for multiple options, "text" for free-form
- Step types: "generate_file", "generate_image", "execute", "preview", "modify"
- Be specific in step descriptions - include exact file names and what content they should have
- For web projects: always include HTML, CSS, and JS files minimum
- For fullstack: include backend files (Python/Node) as well${EM_DASH_RULE}`,
    model: 'o4-mini',
    temperature: 0.4,
    tools: [],
    isDefault: false,
  },
  'project-generator': {
    name: 'project-generator',
    description: 'Generates project files based on specifications',
    systemPrompt: `You are an expert web developer and designer. Your job is to generate complete, production-ready files for projects.

When given a file generation task, output the complete file content in a markdown code block with the filename:

\`\`\`html:index.html
<!DOCTYPE html>
...complete HTML content...
\`\`\`

RULES:
- Generate COMPLETE, WORKING files - no placeholders or "add your content here"
- Use modern best practices (semantic HTML5, CSS Grid/Flexbox, ES6+ JavaScript)
- Make files visually appealing with good default styling
- Include responsive design for mobile
- Add appropriate comments for complex sections
- For images, use placeholder URLs that will be replaced: ./images/[description].jpg
- Ensure all files work together (correct paths, class names match CSS selectors, etc.)

FORMATTING:
- Use the exact format: \`\`\`language:filename.ext
- Supported: html, css, js, py, json, md, txt
- Output ONE file per code block
- Be thorough - a landing page HTML should be 100+ lines, CSS 200+ lines${EM_DASH_RULE}`,
    model: 'o4-mini',
    temperature: 0.5,
    tools: [],
    isDefault: false,
  },
  debugger: {
    name: 'debugger',
    description: 'Analyzes errors and suggests fixes for failed agent tasks',
    systemPrompt: `You are a debugging specialist. When given a failed task, analyze why it failed and suggest ONE action:

- retry_same: Retry with the same approach (transient error, timeout, rate limit)
- modify_task: Rewrite the task more specifically to avoid the error
- switch_agent: Use a different agent type better suited for this task
- abort: Task is fundamentally impossible or blocked, stop trying

Output JSON only:
{
  "action": "retry_same|modify_task|switch_agent|abort",
  "modifiedTask": "new task text if action is modify_task",
  "newAgent": "researcher|coder-claude|coder-gemini|coder-codex|writer|analyst|marketing if action is switch_agent",
  "explanation": "brief explanation of your reasoning"
}

Available agents:
- researcher: Deep research, information gathering, web search
- coder-claude: SENIOR ENGINEER - Complex architecture, refactoring, debugging hard errors, security-critical
- coder-gemini: RAPID PROTOTYPER - Simple scripts, unit tests, large context analysis, code explanations
- coder-codex: BALANCED CODER - Practical implementation, focused patches, test-oriented delivery
- writer: Creative writing, content synthesis, drafting
- analyst: Data analysis, calculations, insights
- marketing: Go-to-market strategy, channel plans, messaging, growth experiments

CODING AGENT FAILOVER:
- If coder-claude fails on a simple task, suggest switch to coder-gemini
- If coder-gemini fails on complex logic, suggest switch to coder-claude
- If coder-codex fails on deep architecture, suggest coder-claude
- If either fails on large context, suggest coder-gemini (1M token window)

IMPORTANT: Only suggest switch_agent if the current agent type is clearly wrong for the task.
Most failures should retry_same (transient) or modify_task (unclear requirements).${EM_DASH_RULE}`,
    model: 'llama3.2:3b', // Lightweight local model fallback metadata
    temperature: 0.2,
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
  let effectiveAgentName = task.agentName;

  try {
    // Enforce coder lock if user has exactly one coder backend enabled
    if (isCodingAgentName(task.agentName)) {
      try {
        const settings = await coderSettings.getCoderSettings(userId);
        const lockedCoder = getLockedCodingAgent(settings);
        if (lockedCoder && lockedCoder !== task.agentName) {
          logger.info('Overriding requested coding agent due to lock', {
            userId,
            requested: task.agentName,
            locked: lockedCoder,
          });
          effectiveAgentName = lockedCoder;
        }
      } catch (settingsError) {
        logger.warn('Failed to read coder settings for lock enforcement', {
          userId,
          error: (settingsError as Error).message,
        });
      }
    }

    // Get agent config
    let systemPrompt: string;
    let temperature = 0.7;

    // Check built-in agents first
    if (BUILT_IN_AGENTS[effectiveAgentName]) {
      const builtIn = BUILT_IN_AGENTS[effectiveAgentName];
      systemPrompt = builtIn.systemPrompt;
      temperature = builtIn.temperature;
    } else {
      // Check custom agents
      const dbResult = await pool.query(
        `SELECT system_prompt, temperature FROM agent_configs WHERE user_id = $1 AND name = $2`,
        [userId, effectiveAgentName]
      );

      if (dbResult.rows.length === 0) {
        return {
          agentName: effectiveAgentName,
          success: false,
          result: `Agent "${effectiveAgentName}" not found`,
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
    if (effectiveAgentName === 'coder-claude') {
      // Claude CLI for senior engineer agent
      return executeWithClaudeCLI(effectiveAgentName, systemPrompt, userMessage, startTime, userId);
    } else if (effectiveAgentName === 'coder-gemini') {
      // Gemini CLI for rapid prototyper agent
      return executeWithGeminiCLI(effectiveAgentName, systemPrompt, userMessage, startTime, userId);
    } else if (effectiveAgentName === 'coder-codex') {
      // OpenAI Codex Mini for balanced coding tasks
      return executeWithCodexMini(effectiveAgentName, systemPrompt, userMessage, startTime, userId);
    } else if (effectiveAgentName === 'coder-api') {
      // User-configured API provider/model for coding tasks
      return executeWithCoderAPI(effectiveAgentName, systemPrompt, userMessage, startTime, userId);
    } else if (effectiveAgentName === 'researcher') {
      return executeResearcherWithWebSearch(effectiveAgentName, systemPrompt, userMessage, startTime, userId);
    } else {
      return executeWithOpenAI(effectiveAgentName, systemPrompt, userMessage, temperature, startTime, userId);
    }
  } catch (error) {
    logger.error('Agent task failed', {
      error: (error as Error).message,
      agentName: effectiveAgentName,
      userId
    });
    return {
      agentName: effectiveAgentName,
      success: false,
      result: `Error: ${(error as Error).message}`,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Execute agent task with streaming status updates
 * Used for project planning/generation where we want to stream progress
 */
export async function* executeAgentStream(
  agentName: string,
  userId: string,
  task: string,
  context?: string
): AsyncGenerator<{ type: 'status' | 'content' | 'done'; status?: string; content?: string; result?: AgentResult }> {
  yield { type: 'status', status: `Running ${agentName} agent...` };

  // Execute the task using the standard executeAgentTask
  const result = await executeAgentTask(userId, {
    agentName,
    task,
    context,
  });

  // Yield the result as content
  if (result.success && result.result) {
    yield { type: 'content', content: result.result };
  } else if (!result.success) {
    yield { type: 'content', content: `Agent error: ${result.result}` };
  }

  yield { type: 'done', result };
}

/**
 * Execute task with OpenAI o4-mini
 */
async function executeWithOpenAI(
  agentName: string,
  systemPrompt: string,
  userMessage: string,
  _temperature: number,
  startTime: number,
  userId: string
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
    loggingContext: {
      userId,
      source: 'agents',
      nodeName: agentName,
    },
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
  startTime: number,
  userId: string
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
      loggingContext: {
        userId,
        source: 'agents',
        nodeName: 'researcher_synthesis',
      },
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
 * Get or create user's workspace directory
 * Returns the absolute path to the user's workspace
 */
async function ensureUserWorkspace(userId: string): Promise<string> {
  const workspaceDir = process.env.WORKSPACE_DIR || '/app/workspace';
  const userWorkspace = path.join(workspaceDir, userId);

  // Create workspace directory if it doesn't exist
  if (!existsSync(userWorkspace)) {
    mkdirSync(userWorkspace, { recursive: true, mode: 0o750 });
    logger.info('Created user workspace', { userId, path: userWorkspace });
  }

  return userWorkspace;
}

/**
 * Execute task with Claude CLI (for coder agent)
 * SECURITY: Uses spawn with arguments array to prevent command injection
 * SANDBOXING: Runs in user's workspace directory with restricted access
 * Automatically extracts and saves code files to workspace
 */
async function executeWithClaudeCLI(
  agentName: string,
  systemPrompt: string,
  userMessage: string,
  startTime: number,
  userId: string
): Promise<AgentResult> {
  const claudePath = process.env.CLAUDE_PATH || '/usr/local/bin/claude';

  // Setup credentials using safe file operations (no shell)
  setupClaudeCredentials();

  // SANDBOXING: Ensure user workspace exists and get its path
  const userWorkspace = await ensureUserWorkspace(userId);

  // Add workspace context to the prompt
  const workspacePrompt = `${systemPrompt}

WORKSPACE CONTEXT:
- You are running in a sandboxed workspace directory: ${userWorkspace}
- All files you create or modify will be saved in this workspace
- You can create subdirectories within this workspace as needed
- The workspace is persistent - files will be available in future sessions
- Use relative paths when creating files (e.g., 'analysis.py' not '/app/workspace/user/analysis.py')

SANDBOX EXECUTION:
- To run code inside the secure sandbox (REQUIRED for servers, npm install, etc.), use:
  \`docker exec -w /workspace/${userId} luna-sandbox <command>\`
- Example: \`docker exec -w /workspace/${userId} luna-sandbox npm install\`
- The workspace is mounted at \`/workspace/${userId}\` inside the container.

${userMessage}`;

  logger.info('Executing agent task via Claude CLI', {
    agentName,
    workspace: userWorkspace,
  });

  try {
    // SECURITY: Use spawn with arguments array - no shell invocation
    // This prevents command injection as arguments are passed directly to the process
    // Use --permission-mode bypassPermissions to avoid interactive prompts in container
    // SANDBOXING: Set cwd to user's workspace and restrict with --add-dir
    const { stdout, stderr } = await spawnAsync(claudePath, [
      '--permission-mode', 'bypassPermissions',
      '--add-dir', userWorkspace,
      '-p',
      workspacePrompt
    ], {
      maxBuffer: 100 * 1024 * 1024,
      timeout: 300000,
      cwd: userWorkspace, // Run from user's workspace directory
      env: config.anthropic?.apiKey ? { ANTHROPIC_API_KEY: config.anthropic.apiKey } : {},
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
 * Execute task with Gemini CLI (for gemini-coder agent)
 * SECURITY: Uses spawn with arguments array to prevent command injection
 * SANDBOXING: Runs in user's workspace directory with restricted access
 * Automatically extracts and saves code files to workspace
 */
async function executeWithGeminiCLI(
  agentName: string,
  systemPrompt: string,
  userMessage: string,
  startTime: number,
  userId: string
): Promise<AgentResult> {
  const geminiPath = process.env.GEMINI_PATH || '/usr/local/bin/gemini';

  // SANDBOXING: Ensure user workspace exists and get its path
  const userWorkspace = await ensureUserWorkspace(userId);

  // Add workspace context to the prompt
  const workspacePrompt = `${systemPrompt}

WORKSPACE CONTEXT:
- You are running in a sandboxed workspace directory: ${userWorkspace}
- All files you create or modify will be saved in this workspace
- You can create subdirectories within this workspace as needed
- The workspace is persistent - files will be available in future sessions
- Use relative paths when creating files (e.g., 'analysis.py' not '/app/workspace/user/analysis.py')

SANDBOX EXECUTION:
- To run code inside the secure sandbox (REQUIRED for servers, npm install, etc.), use:
  \`docker exec -w /workspace/${userId} luna-sandbox <command>\`
- Example: \`docker exec -w /workspace/${userId} luna-sandbox npm install\`
- The workspace is mounted at \`/workspace/${userId}\` inside the container.

${userMessage}`;

  logger.info('Executing agent task via Gemini CLI', {
    agentName,
    workspace: userWorkspace,
  });

  try {
    // SECURITY: Use spawn with arguments array - no shell invocation
    // Gemini CLI uses -p for prompt mode, --yolo auto-approves tools
    // --include-directories allows workspace access
    const { stdout, stderr } = await spawnAsync(geminiPath, [
      '--yolo',
      '--include-directories', userWorkspace,
      '-p',
      workspacePrompt
    ], {
      maxBuffer: 100 * 1024 * 1024,
      timeout: 300000,
      cwd: userWorkspace, // Run from user's workspace directory
      env: config.google?.apiKey ? { GOOGLE_API_KEY: config.google.apiKey } : {},
    });

    if (stderr) {
      logger.warn('Gemini CLI stderr', { stderr, agentName });
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

    logger.info('Gemini agent task completed', {
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
    logger.error('Gemini CLI execution failed', {
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
 * Execute task with user-configured API provider/model (for coder-api agent)
 * Uses the provider and model from user's coder settings
 * Automatically extracts and saves code files to workspace
 */
async function executeWithCoderAPI(
  agentName: string,
  systemPrompt: string,
  userMessage: string,
  startTime: number,
  userId: string
): Promise<AgentResult> {
  try {
    // Get user's coder settings for provider/model
    const settings = await coderSettings.getCoderSettings(userId);

    if (!settings.coderApiProvider || !settings.coderApiModel) {
      return {
        agentName,
        success: false,
        result: 'Coder API is not configured. Please set a provider and model in Settings > Coder.',
        executionTimeMs: Date.now() - startTime,
      };
    }

    logger.info('Executing agent task via Coder API', {
      agentName,
      provider: settings.coderApiProvider,
      model: settings.coderApiModel,
    });

    // Give coder-api the same workspace tool access as chat (read/write/list/execute).
    const userWorkspace = await ensureUserWorkspace(userId);
    const workspaceSystemPrompt = `${systemPrompt}

WORKSPACE CONTEXT:
- You are working against the user's persistent workspace at: ${userWorkspace}
- Use workspace tools to inspect files, write files, and execute scripts.
- Prefer workspace_write for file creation/updates instead of only describing code.
- Use relative filenames (e.g., "main.py", "src/app.ts"), never absolute paths.
- For execution, use workspace_execute with filename and optional args.
`;

    const toolEnabledMessages: ChatMessage[] = [
      { role: 'system', content: workspaceSystemPrompt },
      { role: 'user', content: userMessage },
    ];

    const coderWorkspaceTools = [
      workspaceWriteTool,
      workspaceReadTool,
      workspaceListTool,
      workspaceExecuteTool,
    ];

    let completion = await createChatCompletion({
      messages: toolEnabledMessages,
      tools: coderWorkspaceTools,
      provider: settings.coderApiProvider,
      model: settings.coderApiModel,
      loggingContext: {
        userId,
        source: 'agents',
        nodeName: 'coder',
      },
    });

    let toolRounds = 0;
    const maxToolRounds = 8;

    while (completion.toolCalls && completion.toolCalls.length > 0 && toolRounds < maxToolRounds) {
      toolRounds++;

      toolEnabledMessages.push({
        role: 'assistant',
        content: completion.content || '',
        tool_calls: completion.toolCalls,
      } as ChatMessage);

      for (const toolCall of completion.toolCalls) {
        if (toolCall.function.name === 'workspace_write') {
          const args = JSON.parse(toolCall.function.arguments || '{}');
          try {
            const decodedContent = decodeHtmlEntities(args.content || '');
            const file = await workspace.writeFile(userId, args.filename, decodedContent);
            toolEnabledMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `File "${args.filename}" saved successfully (${file.size} bytes)`,
            } as ChatMessage);
          } catch (error) {
            toolEnabledMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Error saving file: ${(error as Error).message}`,
            } as ChatMessage);
          }
        } else if (toolCall.function.name === 'workspace_read') {
          const args = JSON.parse(toolCall.function.arguments || '{}');
          try {
            const content = await workspace.readFile(userId, args.filename);
            toolEnabledMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Contents of ${args.filename}:\n\`\`\`\n${content}\n\`\`\``,
            } as ChatMessage);
          } catch (error) {
            toolEnabledMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Error reading file: ${(error as Error).message}`,
            } as ChatMessage);
          }
        } else if (toolCall.function.name === 'workspace_list') {
          const files = await workspace.listFiles(userId);
          const fileList = files.length > 0
            ? files.map(f => `- ${f.name} (${f.size} bytes, ${f.mimeType})`).join('\n')
            : 'No files in workspace';
          toolEnabledMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Workspace files:\n${fileList}`,
          } as ChatMessage);
        } else if (toolCall.function.name === 'workspace_execute') {
          const args = JSON.parse(toolCall.function.arguments || '{}');
          const execution = await sandbox.executeWorkspaceFile(userId, args.filename, undefined, args.args || []);
          toolEnabledMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: execution.success
              ? `Execution output:\n${execution.output}`
              : `Execution error:\n${execution.error}`,
          } as ChatMessage);
        } else {
          toolEnabledMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Unsupported tool: ${toolCall.function.name}`,
          } as ChatMessage);
        }
      }

      completion = await createChatCompletion({
        messages: toolEnabledMessages,
        tools: coderWorkspaceTools,
        provider: settings.coderApiProvider,
        model: settings.coderApiModel,
        loggingContext: {
          userId,
          source: 'agents',
          nodeName: 'coder',
        },
      });
    }

    let result = completion.content || 'No response generated';
    if (completion.toolCalls && completion.toolCalls.length > 0 && toolRounds >= maxToolRounds) {
      result += '\n\nTool execution limit reached. Please continue with a narrower follow-up request.';
    }

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

    logger.info('Coder API task completed', {
      agentName,
      provider: settings.coderApiProvider,
      model: settings.coderApiModel,
      executionTimeMs: Date.now() - startTime,
      savedFiles: savedFileNames.length,
      tokensUsed: completion.tokensUsed,
    });

    return {
      agentName,
      success: true,
      result,
      executionTimeMs: Date.now() - startTime,
      savedFiles: savedFileNames.length > 0 ? savedFileNames : undefined,
    };
  } catch (error) {
    logger.error('Coder API execution failed', {
      error: (error as Error).message,
      agentName,
      userId,
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
 * Execute task with OpenAI Codex Mini (for coder-codex agent)
 * Automatically extracts and saves code files to workspace
 */
async function executeWithCodexMini(
  agentName: string,
  systemPrompt: string,
  userMessage: string,
  startTime: number,
  userId: string
): Promise<AgentResult> {
  try {
    const userWorkspace = await ensureUserWorkspace(userId);

    const workspacePrompt = `WORKSPACE CONTEXT:
- You are working against the user's persistent workspace at: ${userWorkspace}
- Use relative file paths when generating files
- Output full file content in code blocks with filename annotations when creating or updating files

${userMessage}`;

    logger.info('Executing agent task via OpenAI Codex Mini', {
      agentName,
      model: 'codex-mini-latest',
      workspace: userWorkspace,
    });

    const completion = await createChatCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: workspacePrompt }
      ],
      provider: 'openai',
      model: 'codex-mini-latest',
      loggingContext: {
        userId,
        source: 'agents',
        nodeName: 'coder-codex',
      },
    });

    let result = completion.content || 'No response generated';

    // Extract and save any files from the output
    const extractedFiles = extractFilesFromOutput(result);
    const savedFileNames: string[] = [];

    if (extractedFiles.length > 0) {
      const savedFiles = await saveExtractedFiles(userId, extractedFiles);
      savedFileNames.push(...savedFiles.map(f => f.name));

      if (savedFiles.length > 0) {
        result += `\n\n📁 **Saved to workspace:** ${savedFiles.map(f => f.name).join(', ')}`;
      }
    }

    logger.info('Codex Mini agent task completed', {
      agentName,
      model: 'codex-mini-latest',
      executionTimeMs: Date.now() - startTime,
      savedFiles: savedFileNames.length,
      tokensUsed: completion.tokensUsed,
    });

    return {
      agentName,
      success: true,
      result,
      executionTimeMs: Date.now() - startTime,
      savedFiles: savedFileNames.length > 0 ? savedFileNames : undefined,
    };
  } catch (error) {
    logger.error('Codex Mini execution failed', {
      error: (error as Error).message,
      agentName,
      userId,
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
    const parsed = JSON.parse(jsonStr) as OrchestrationPlan | { error: string };

    // Check if planner returned an error (task too vague)
    if ('error' in parsed && parsed.error) {
      logger.info('Planner rejected task as too vague', { error: parsed.error });
      yield {
        type: 'done',
        result: {
          plan: planResult.result,
          results: [planResult],
          synthesis: `I need more details to work on this task. ${parsed.error}`,
          success: false,
          error: 'Task too vague',
        }
      };
      return;
    }

    plan = parsed as OrchestrationPlan;

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

  // Enforce coder lock in orchestration plans
  let lockedCodingAgent: CodingAgentName | null = null;
  try {
    const settings = await coderSettings.getCoderSettings(userId);
    lockedCodingAgent = getLockedCodingAgent(settings);

    if (lockedCodingAgent) {
      const lockedAgent = lockedCodingAgent;
      let rewrites = 0;
      plan.steps = plan.steps.map((step) => {
        if (isCodingAgentName(step.agent) && step.agent !== lockedAgent) {
          rewrites++;
          return { ...step, agent: lockedAgent };
        }
        return step;
      });

      if (rewrites > 0) {
        logger.info('Rewrote orchestration plan to honor coder lock', {
          userId,
          lockedCodingAgent,
          rewrites,
        });
        yield { type: 'status', status: `Coding agent locked to ${lockedCodingAgent}` };
      }
    }
  } catch (settingsError) {
    logger.warn('Failed to enforce coder lock during orchestration planning', {
      userId,
      error: (settingsError as Error).message,
    });
  }

  // Step 3: Execute steps using DAG parallel executor with retry logic
  const dagConfig = {
    maxConcurrency: config.orchestration?.maxConcurrency ?? 3,
    maxRetries: config.orchestration?.maxRetries ?? 3,
    enableSummarization: config.orchestration?.enableSummarization ?? true,
    summarizationModel: config.ollama?.chatModel ?? 'llama3.2:3b',
    lockedCodingAgent: lockedCodingAgent ?? undefined,
  };

  const executor = new DAGExecutor(
    plan.steps,
    (uid, agentTask) => executeAgentTask(uid, agentTask),
    dagConfig
  );

  let results = new Map<number, AgentResult>();
  let dagSuccess = true;
  let dagError: string | undefined;

  for await (const event of executor.execute(userId, context)) {
    switch (event.type) {
      case 'status':
        yield { type: 'status', status: event.status };
        break;

      case 'step_started':
        yield { type: 'status', status: `Running ${event.agent} agent (step ${event.step})...` };
        break;

      case 'step_completed':
        yield { type: 'status', status: `${event.agent} agent completed (step ${event.step})` };
        break;

      case 'step_failed':
        yield { type: 'status', status: `${event.agent} agent failed (step ${event.step}): ${event.error}` };
        break;

      case 'step_retrying':
        yield { type: 'status', status: `Retrying ${event.agent} (step ${event.step}): ${event.suggestion.explanation}` };
        break;

      case 'step_skipped':
        yield { type: 'status', status: `Skipped ${event.agent} (step ${event.step}): ${event.reason}` };
        break;

      case 'parallel_status':
        if (event.running.length > 0) {
          yield { type: 'status', status: `Progress: ${event.completed}/${event.total} - running: ${event.running.join(', ')}` };
        }
        break;

      case 'done':
        results = event.results;
        dagSuccess = event.success;
        dagError = event.error;
        break;
    }
  }

  // Check if DAG execution failed completely
  if (!dagSuccess && results.size === 0) {
    yield {
      type: 'done',
      result: {
        plan: planResult.result,
        results: [],
        synthesis: `Orchestration failed: ${dagError || 'Unknown error'}`,
        success: false,
        error: dagError,
      }
    };
    return;
  }

  // Step 4: Synthesize results with writer
  yield { type: 'status', status: 'Synthesizing results with writer agent...' };

  // Filter to only successful results for synthesis
  const successfulResults = Array.from(results.entries())
    .filter(([_, r]) => r.success);

  const allResultsText = successfulResults
    .map(([stepNum, r]) => `### Step ${stepNum} (${r.agentName})\n${r.result}`)
    .join('\n\n');

  // Add note about partial completion if some steps failed
  const partialNote = !dagSuccess
    ? `\n\nNote: Some steps failed or were skipped. Results may be incomplete.`
    : '';

  const synthesisResult = await executeAgentTask(userId, {
    agentName: 'writer',
    task: `Synthesize these results into a clear, unified response for the original task: "${task}"${partialNote}`,
    context: allResultsText || 'No successful results to synthesize.',
  });

  yield {
    type: 'done',
    result: {
      plan: planResult.result,
      results: Array.from(results.values()),
      synthesis: synthesisResult.result,
      success: dagSuccess, // Reflect actual success status
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
