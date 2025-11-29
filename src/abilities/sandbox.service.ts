import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import { spawn } from 'child_process';
import * as path from 'path';

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER || 'luna-sandbox';
// Point docker CLI to the restricted docker-socket-proxy
const DOCKER_HOST = process.env.DOCKER_HOST || 'http://docker-proxy:2375';
const EXECUTION_TIMEOUT = 30000; // 30 seconds for file execution
const INLINE_EXECUTION_TIMEOUT = 10000; // 10 seconds for inline code
const MAX_OUTPUT_LENGTH = 10000;

// Workspace paths
const SANDBOX_WORKSPACE_ROOT = '/workspace'; // Inside sandbox container

export interface ExecutionResult {
  id?: string;
  success: boolean;
  output: string;
  error?: string;
  executionTimeMs: number;
  language: string;
}

/**
 * Execute Python code in sandbox
 */
export async function executePython(
  code: string,
  userId: string,
  sessionId?: string
): Promise<ExecutionResult> {
  const startTime = Date.now();

  try {
    // Wrap code to capture output
    const wrappedCode = `
import sys
from io import StringIO

_stdout = StringIO()
_stderr = StringIO()
sys.stdout = _stdout
sys.stderr = _stderr

try:
${code.split('\n').map(line => '    ' + line).join('\n')}
except Exception as e:
    print(f"Error: {type(e).__name__}: {e}", file=sys.stderr)

sys.stdout = sys.__stdout__
sys.stderr = sys.__stderr__

output = _stdout.getvalue()
errors = _stderr.getvalue()
if output:
    print(output, end='')
if errors:
    print(errors, file=sys.stderr, end='')
`;

    const result = await executeInContainer('python3', ['-c', wrappedCode]);
    const executionTimeMs = Date.now() - startTime;

    // Store execution record
    const execId = await storeExecution(userId, sessionId, 'python', code, result, executionTimeMs);

    return {
      id: execId,
      success: !result.error,
      output: result.output.slice(0, MAX_OUTPUT_LENGTH),
      error: result.error?.slice(0, MAX_OUTPUT_LENGTH),
      executionTimeMs,
      language: 'python',
    };
  } catch (error) {
    const executionTimeMs = Date.now() - startTime;
    const errorMessage = (error as Error).message;

    await storeExecution(userId, sessionId, 'python', code, { output: '', error: errorMessage }, executionTimeMs);

    return {
      success: false,
      output: '',
      error: errorMessage,
      executionTimeMs,
      language: 'python',
    };
  }
}

/**
 * Execute JavaScript code in sandbox
 */
export async function executeJavaScript(
  code: string,
  userId: string,
  sessionId?: string
): Promise<ExecutionResult> {
  const startTime = Date.now();

  try {
    // Wrap code to capture output and handle async
    const wrappedCode = `
const _logs = [];
const _originalLog = console.log;
console.log = (...args) => _logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));

(async () => {
  try {
${code.split('\n').map(line => '    ' + line).join('\n')}
  } catch (e) {
    console.error('Error:', e.message);
  }
  console.log = _originalLog;
  console.log(_logs.join('\\n'));
})();
`;

    const result = await executeInContainer('node', ['-e', wrappedCode]);
    const executionTimeMs = Date.now() - startTime;

    const execId = await storeExecution(userId, sessionId, 'javascript', code, result, executionTimeMs);

    return {
      id: execId,
      success: !result.error,
      output: result.output.slice(0, MAX_OUTPUT_LENGTH),
      error: result.error?.slice(0, MAX_OUTPUT_LENGTH),
      executionTimeMs,
      language: 'javascript',
    };
  } catch (error) {
    const executionTimeMs = Date.now() - startTime;
    const errorMessage = (error as Error).message;

    await storeExecution(userId, sessionId, 'javascript', code, { output: '', error: errorMessage }, executionTimeMs);

    return {
      success: false,
      output: '',
      error: errorMessage,
      executionTimeMs,
      language: 'javascript',
    };
  }
}

/**
 * Execute command in Docker container
 */
async function executeInContainer(
  command: string,
  args: string[]
): Promise<{ output: string; error?: string }> {
  return new Promise((resolve, reject) => {
    const dockerArgs = [
      'exec',
      '-i',
      // Use proxy host via env
      SANDBOX_CONTAINER,
      command,
      ...args,
    ];

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
      reject(new Error('Execution timeout'));
    }, INLINE_EXECUTION_TIMEOUT);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 || stdout) {
        resolve({
          output: stdout.trim(),
          error: stderr.trim() || undefined,
        });
      } else {
        resolve({
          output: stdout.trim(),
          error: stderr.trim() || `Process exited with code ${code}`,
        });
      }
    });

    proc.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

/**
 * Store execution record
 */
async function storeExecution(
  userId: string,
  sessionId: string | undefined,
  language: string,
  code: string,
  result: { output: string; error?: string },
  executionTimeMs: number
): Promise<string | undefined> {
  try {
    const status = result.error ? 'error' : 'success';
    const queryResult = await pool.query(
      `INSERT INTO code_executions (user_id, session_id, language, code, output, error, execution_time_ms, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [userId, sessionId, language, code, result.output, result.error, executionTimeMs, status]
    );
    return queryResult.rows[0]?.id;
  } catch (error) {
    logger.error('Failed to store execution', { error: (error as Error).message });
    return undefined;
  }
}

/**
 * Get recent executions for a user
 */
export async function getRecentExecutions(
  userId: string,
  limit: number = 10
): Promise<ExecutionResult[]> {
  try {
    const result = await pool.query(
      `SELECT id, language, code, output, error, execution_time_ms, status, created_at
       FROM code_executions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      success: row.status === 'success',
      output: row.output as string,
      error: row.error as string | undefined,
      executionTimeMs: row.execution_time_ms as number,
      language: row.language as string,
    }));
  } catch (error) {
    logger.error('Failed to get executions', { error: (error as Error).message });
    return [];
  }
}

/**
 * Detect language from code
 */
export function detectLanguage(code: string): 'python' | 'javascript' | 'unknown' {
  // Python indicators
  const pythonPatterns = [
    /^import\s+\w+/m,
    /^from\s+\w+\s+import/m,
    /^def\s+\w+\s*\(/m,
    /^class\s+\w+.*:/m,
    /print\s*\(/,
    /:\s*$/m,
    /^\s+/m, // Indentation-based
  ];

  // JavaScript indicators
  const jsPatterns = [
    /^(const|let|var)\s+\w+/m,
    /^function\s+\w+\s*\(/m,
    /=>\s*\{?/,
    /console\.(log|error|warn)/,
    /\{\s*$/m,
    /require\s*\(/,
    /async\s+function/,
  ];

  const pythonScore = pythonPatterns.filter(p => p.test(code)).length;
  const jsScore = jsPatterns.filter(p => p.test(code)).length;

  if (pythonScore > jsScore) return 'python';
  if (jsScore > pythonScore) return 'javascript';

  // Default to Python for simple calculations
  if (/^\d+\s*[\+\-\*\/]\s*\d+/.test(code)) return 'python';

  return 'unknown';
}

/**
 * Execute code with auto-detection
 */
export async function executeCode(
  code: string,
  userId: string,
  sessionId?: string,
  language?: string
): Promise<ExecutionResult> {
  const detectedLang = language || detectLanguage(code);

  if (detectedLang === 'python') {
    return executePython(code, userId, sessionId);
  } else if (detectedLang === 'javascript') {
    return executeJavaScript(code, userId, sessionId);
  } else {
    // Default to Python
    return executePython(code, userId, sessionId);
  }
}

/**
 * Execute a file from user's workspace in sandbox
 */
export async function executeWorkspaceFile(
  userId: string,
  filename: string,
  sessionId?: string,
  args: string[] = []
): Promise<ExecutionResult> {
  const startTime = Date.now();

  // Security: validate filename to prevent path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return {
      success: false,
      output: '',
      error: 'Invalid filename - path traversal not allowed',
      executionTimeMs: Date.now() - startTime,
      language: 'unknown',
    };
  }

  // Determine language from extension
  const ext = path.extname(filename).toLowerCase();
  let command: string;
  let language: string;

  switch (ext) {
    case '.py':
      command = 'python3';
      language = 'python';
      break;
    case '.js':
      command = 'node';
      language = 'javascript';
      break;
    case '.sh':
      command = 'sh';
      language = 'shell';
      break;
    default:
      return {
        success: false,
        output: '',
        error: `Unsupported file type: ${ext}. Supported: .py, .js, .sh`,
        executionTimeMs: Date.now() - startTime,
        language: 'unknown',
      };
  }

  try {
    // Build path inside sandbox container
    const sandboxFilePath = path.join(SANDBOX_WORKSPACE_ROOT, userId, filename);

    const result = await executeFileInContainer(command, sandboxFilePath, args, userId);
    const executionTimeMs = Date.now() - startTime;

    // Store execution record
    const execId = await storeExecution(
      userId,
      sessionId,
      language,
      `[file: ${filename}]`,
      result,
      executionTimeMs
    );

    logger.info('Executed workspace file', { userId, filename, language, success: !result.error });

    return {
      id: execId,
      success: !result.error,
      output: result.output.slice(0, MAX_OUTPUT_LENGTH),
      error: result.error?.slice(0, MAX_OUTPUT_LENGTH),
      executionTimeMs,
      language,
    };
  } catch (error) {
    const executionTimeMs = Date.now() - startTime;
    const errorMessage = (error as Error).message;

    logger.error('Failed to execute workspace file', { userId, filename, error: errorMessage });

    return {
      success: false,
      output: '',
      error: errorMessage,
      executionTimeMs,
      language,
    };
  }
}

/**
 * Execute a file in Docker container with working directory set to user's workspace
 */
async function executeFileInContainer(
  command: string,
  filePath: string,
  args: string[],
  userId: string
): Promise<{ output: string; error?: string }> {
  return new Promise((resolve, reject) => {
    const workDir = path.join(SANDBOX_WORKSPACE_ROOT, userId);

    const dockerArgs = [
      'exec',
      '-i',
      '-w', workDir, // Set working directory to user's workspace
      SANDBOX_CONTAINER,
      command,
      filePath,
      ...args,
    ];

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
      reject(new Error('Execution timeout (30s limit)'));
    }, EXECUTION_TIMEOUT);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 || stdout) {
        resolve({
          output: stdout.trim(),
          error: stderr.trim() || undefined,
        });
      } else {
        resolve({
          output: stdout.trim(),
          error: stderr.trim() || `Process exited with code ${code}`,
        });
      }
    });

    proc.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

/**
 * List files in user's workspace from sandbox perspective
 */
export async function listWorkspaceFiles(userId: string): Promise<string[]> {
  return new Promise((resolve) => {
    const workDir = path.join(SANDBOX_WORKSPACE_ROOT, userId);

    const dockerArgs = [
      'exec',
      '-i',
      SANDBOX_CONTAINER,
      'ls', '-la', workDir,
    ];

    const proc = spawn('docker', dockerArgs, {
      env: { ...process.env, DOCKER_HOST },
    });

    let stdout = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.on('close', () => {
      // Parse ls output to get filenames
      const lines = stdout.split('\n').slice(1); // Skip total line
      const files = lines
        .map(line => line.split(/\s+/).pop())
        .filter((f): f is string => !!f && f !== '.' && f !== '..');
      resolve(files);
    });

    proc.on('error', () => {
      resolve([]);
    });

    setTimeout(() => {
      proc.kill();
      resolve([]);
    }, 5000);
  });
}

export default {
  executePython,
  executeJavaScript,
  executeCode,
  detectLanguage,
  getRecentExecutions,
  executeWorkspaceFile,
  listWorkspaceFiles,
};
