import logger from '../utils/logger.js';
import { spawn } from 'child_process';
import * as path from 'path';

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER || 'luna-sandbox';
const DOCKER_HOST = process.env.DOCKER_HOST || 'http://docker-proxy:2375';
const RESEARCH_TIMEOUT = 600000; // 10 minutes for thorough research
const MAX_OUTPUT_LENGTH = 100000; // 100KB output limit
const SANDBOX_WORKSPACE_ROOT = '/workspace';

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
 * Execute research using Claude CLI in luna-sandbox container
 */
export async function executeResearch(
  query: string,
  userId: string,
  options: ResearchOptions = {}
): Promise<ResearchResult> {
  const startTime = Date.now();
  const { saveToFile, depth = 'thorough' } = options;

  // Ensure research directory exists in user workspace
  const userResearchDir = path.join(SANDBOX_WORKSPACE_ROOT, userId, 'research');

  try {
    // Build research prompt
    const researchPrompt = buildResearchPrompt(query, depth, options.focus);

    logger.info('Starting research task', {
      userId,
      query: query.substring(0, 100),
      depth,
      saveToFile,
    });

    // Execute Claude CLI in sandbox container
    const result = await executeClaudeInSandbox(
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
 * Execute Claude CLI in the sandbox container
 */
async function executeClaudeInSandbox(
  prompt: string,
  workDir: string,
  userId: string
): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    const userWorkspace = path.join(SANDBOX_WORKSPACE_ROOT, userId);

    // Run as 'sandbox' user (non-root) - Claude CLI requires this for bypassPermissions
    const dockerArgs = [
      'exec',
      '-i',
      '-u', 'sandbox',
      '-w', workDir,
      '-e', 'HOME=/home/sandbox',
      SANDBOX_CONTAINER,
      'claude',
      '--permission-mode', 'bypassPermissions',
      '--add-dir', userWorkspace,
      '-p',
      prompt,
    ];

    logger.debug('Executing Claude CLI in sandbox', {
      container: SANDBOX_CONTAINER,
      workDir,
    });

    const proc = spawn('docker', dockerArgs, {
      env: { ...process.env, DOCKER_HOST },
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

  // Use docker exec to write file in sandbox
  const fullPath = path.join(SANDBOX_WORKSPACE_ROOT, userId, relPath);
  const dirPath = path.dirname(fullPath);

  const fileContent = `# Research: ${query}

*Generated: ${new Date().toISOString()}*

---

${content}
`;

  // Create directory and write file via docker exec
  await new Promise<void>((resolve, reject) => {
    const mkdirArgs = [
      'exec', '-i',
      SANDBOX_CONTAINER,
      'mkdir', '-p', dirPath,
    ];

    const proc = spawn('docker', mkdirArgs, {
      env: { ...process.env, DOCKER_HOST },
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Failed to create directory: ${code}`));
    });

    proc.on('error', reject);
  });

  // Write file via docker exec with stdin
  await new Promise<void>((resolve, reject) => {
    const writeArgs = [
      'exec', '-i',
      SANDBOX_CONTAINER,
      'sh', '-c', `cat > "${fullPath}"`,
    ];

    const proc = spawn('docker', writeArgs, {
      env: { ...process.env, DOCKER_HOST },
    });

    proc.stdin.write(fileContent);
    proc.stdin.end();

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Failed to write file: ${code}`));
    });

    proc.on('error', reject);
  });

  logger.info('Saved research to file', { userId, path: relPath });

  return relPath;
}

export default {
  executeResearch,
};
