import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import { spawn } from 'child_process';

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER || 'luna-sandbox';
const EXECUTION_TIMEOUT = 10000; // 10 seconds
const MAX_OUTPUT_LENGTH = 10000;

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
      SANDBOX_CONTAINER,
      command,
      ...args,
    ];

    const proc = spawn('docker', dockerArgs);

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

export default {
  executePython,
  executeJavaScript,
  executeCode,
  detectLanguage,
  getRecentExecutions,
};
