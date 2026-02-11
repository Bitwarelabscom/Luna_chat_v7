import logger from '../utils/logger.js';
import { spawn } from 'child_process';
import * as path from 'path';

const RESEARCH_TIMEOUT = 600000; // 10 minutes for thorough research
const MAX_OUTPUT_LENGTH = 100000; // 100KB output limit
const WORKSPACE_ROOT = '/app/workspace';

export interface ResearchOptions {
  saveToFile?: string;
  depth?: 'quick' | 'thorough';
  focus?: string[];
}

export interface ResearchResult {
  success: boolean;
  summary: string;
  details: string;
  savedFile?: string;
  executionTimeMs: number;
  error?: string;
}

/**
 * Execute research using Gemini CLI
 */
export async function executeResearch(
  query: string,
  userId: string,
  options: ResearchOptions = {}
): Promise<ResearchResult> {
  const startTime = Date.now();
  const { saveToFile, depth = 'thorough' } = options;

  // Ensure research directory exists in user workspace
  const userResearchDir = path.join(WORKSPACE_ROOT, userId, 'research');

  try {
    // Build research prompt
    const researchPrompt = buildResearchPrompt(query, depth, options.focus);

    logger.info('Starting research task', {
      userId,
      query: query.substring(0, 100),
      depth,
      saveToFile,
    });

    // Execute Gemini CLI
    const result = await executeGeminiCLI(
      researchPrompt,
      userResearchDir,
      userId
    );

    const executionTimeMs = Date.now() - startTime;

    if (!result.success) {
      logger.error('Research failed', { userId, error: result.error });
      return {
        success: false,
        summary: 'Research failed',
        details: result.error || 'Unknown error',
        executionTimeMs,
        error: result.error,
      };
    }

    // Extract summary from output (first paragraph or first 500 chars)
    const summary = extractSummary(result.output);

    // Save to file if requested
    let savedFilePath: string | undefined;
    if (saveToFile) {
      savedFilePath = await saveResearchToFile(
        userId,
        saveToFile,
        query,
        result.output
      );
    }

    logger.info('Research completed', {
      userId,
      executionTimeMs,
      outputLength: result.output.length,
      savedFile: savedFilePath,
    });

    return {
      success: true,
      summary,
      details: result.output,
      savedFile: savedFilePath,
      executionTimeMs,
    };
  } catch (error) {
    const executionTimeMs = Date.now() - startTime;
    const errorMessage = (error as Error).message;

    logger.error('Research execution error', { userId, error: errorMessage });

    return {
      success: false,
      summary: 'Research failed due to an error',
      details: errorMessage,
      executionTimeMs,
      error: errorMessage,
    };
  }
}

/**
 * Build a research prompt for Claude CLI
 */
function buildResearchPrompt(
  query: string,
  depth: 'quick' | 'thorough',
  focus?: string[]
): string {
  const depthInstructions = depth === 'quick'
    ? 'Provide a concise, focused answer. Aim for brevity while maintaining accuracy.'
    : 'Conduct thorough research. Explore multiple angles, provide detailed analysis, and cite sources where possible.';

  const focusInstructions = focus && focus.length > 0
    ? `Focus areas: ${focus.join(', ')}.`
    : '';

  return `You are a research assistant. ${depthInstructions} ${focusInstructions}

Research Question: ${query}

Provide your research findings in a clear, structured format. Include:
1. Key findings and insights
2. Supporting details and evidence
3. Any caveats or limitations

Be factual and objective in your analysis.`;
}

/**
 * Execute Gemini CLI for research
 */
async function executeGeminiCLI(
  prompt: string,
  workDir: string,
  userId: string
): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    const userWorkspace = path.join(WORKSPACE_ROOT, userId);

    // Execute Gemini CLI with yolo mode (auto-approve tools) for research
    const geminiArgs = [
      '-p', prompt,  // Non-interactive mode
      '--approval-mode', 'yolo',  // Auto-approve all tools
      '--include-directories', userWorkspace,  // Add user workspace
      '--output-format', 'text',  // Plain text output
    ];

    logger.debug('Executing Gemini CLI for research', {
      workDir,
      userId,
    });

    const proc = spawn('gemini', geminiArgs, {
      cwd: workDir,
      env: {
        ...process.env,
        HOME: '/home/node',
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      if (stdout.length > MAX_OUTPUT_LENGTH) {
        proc.kill();
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      proc.kill();
      resolve({
        success: false,
        output: stdout.trim(),
        error: 'Research timeout (10 min limit)',
      });
    }, RESEARCH_TIMEOUT);

    proc.on('close', (code) => {
      clearTimeout(timeout);

      if (code === 0 || stdout.trim()) {
        resolve({
          success: true,
          output: stdout.trim().slice(0, MAX_OUTPUT_LENGTH),
          error: stderr.trim() || undefined,
        });
      } else {
        resolve({
          success: false,
          output: stdout.trim(),
          error: stderr.trim() || `Process exited with code ${code}`,
        });
      }
    });

    proc.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        output: '',
        error: error.message,
      });
    });
  });
}

/**
 * Extract a summary from research output
 */
function extractSummary(output: string): string {
  // Try to get first paragraph or section
  const lines = output.split('\n').filter(line => line.trim());

  // Skip markdown headers and get first substantive content
  let summary = '';
  for (const line of lines) {
    if (line.startsWith('#')) continue;
    if (line.startsWith('---')) continue;
    if (line.startsWith('```')) continue;

    summary += line + ' ';
    if (summary.length > 400) break;
  }

  summary = summary.trim();
  if (summary.length > 500) {
    summary = summary.substring(0, 497) + '...';
  }

  return summary || output.substring(0, 500);
}

/**
 * Save research results to a file in user's workspace
 */
async function saveResearchToFile(
  userId: string,
  filename: string,
  query: string,
  content: string
): Promise<string> {
  // Sanitize filename
  const safeFilename = filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_');

  // Ensure .md extension
  const finalFilename = safeFilename.endsWith('.md')
    ? safeFilename
    : `${safeFilename}.md`;

  const relPath = path.join('research', finalFilename);

  // Write file directly to workspace using Node.js fs
  const fs = await import('fs/promises');
  const fullPath = path.join(WORKSPACE_ROOT, userId, relPath);
  const dirPath = path.dirname(fullPath);

  const fileContent = `# Research: ${query}

*Generated: ${new Date().toISOString()}*

---

${content}
`;

  // Create directory if it doesn't exist
  await fs.mkdir(dirPath, { recursive: true });

  // Write file
  await fs.writeFile(fullPath, fileContent, 'utf-8');

  logger.info('Saved research to file', { userId, path: relPath });

  return relPath;
}

export default {
  executeResearch,
};
