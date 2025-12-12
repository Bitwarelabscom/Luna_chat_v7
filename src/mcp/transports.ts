/**
 * MCP Transport Abstraction
 * Supports both HTTP and stdio-based MCP servers
 */
import { spawn, ChildProcess } from 'child_process';
import logger from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface IMcpTransport {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export interface HttpTransportConfig {
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface StdioTransportConfig {
  commandPath: string;
  commandArgs?: string[];
  envVars?: Record<string, string>;
  workingDirectory?: string;
  timeout?: number;
}

// ============================================================================
// HTTP Transport
// ============================================================================

let httpRequestId = 1;

export class HttpTransport implements IMcpTransport {
  private url: string;
  private headers: Record<string, string>;
  private timeout: number;

  constructor(config: HttpTransportConfig) {
    this.url = config.url;
    this.headers = config.headers || {};
    this.timeout = config.timeout || 30000;
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: httpRequestId++,
      method,
      params,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-06-18',
          ...this.headers,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      let data: JsonRpcResponse;

      // Handle SSE streaming response
      if (contentType.includes('text/event-stream')) {
        data = await this.parseSSEResponse(response);
      } else {
        data = await response.json() as JsonRpcResponse;
      }

      if (data.error) {
        throw new Error(`MCP Error ${data.error.code}: ${data.error.message}`);
      }

      return data.result;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error('MCP request timeout');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async close(): Promise<void> {
    // HTTP transport is stateless, nothing to close
  }

  /**
   * Parse Server-Sent Events (SSE) response from MCP server
   * SSE format: data: <JSON>\n\n
   */
  private async parseSSEResponse(response: Response): Promise<JsonRpcResponse> {
    const text = await response.text();
    const lines = text.split('\n');

    // Find the last data line (in case of multiple events)
    let lastData: string | null = null;
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        lastData = line.slice(6);
      }
    }

    if (!lastData) {
      throw new Error('No data found in SSE response');
    }

    return JSON.parse(lastData) as JsonRpcResponse;
  }
}

// ============================================================================
// Stdio Transport
// ============================================================================

export class StdioTransport implements IMcpTransport {
  private process: ChildProcess | null = null;
  private commandPath: string;
  private commandArgs: string[];
  private envVars: Record<string, string>;
  private workingDirectory?: string;
  private timeout: number;
  private messageBuffer: string = '';
  private requestId: number = 1;
  private pendingRequests: Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeoutId: NodeJS.Timeout;
  }> = new Map();
  private isClosing: boolean = false;

  constructor(config: StdioTransportConfig) {
    this.commandPath = config.commandPath;
    this.commandArgs = config.commandArgs || [];
    this.envVars = config.envVars || {};
    this.workingDirectory = config.workingDirectory;
    this.timeout = config.timeout || 30000;
  }

  private ensureProcess(): ChildProcess {
    if (this.process && !this.isClosing) {
      return this.process;
    }

    logger.info('Spawning MCP stdio process', {
      command: this.commandPath,
      args: this.commandArgs,
      cwd: this.workingDirectory,
    });

    this.process = spawn(this.commandPath, this.commandArgs, {
      env: { ...process.env, ...this.envVars },
      cwd: this.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleStdout(data);
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const message = data.toString().trim();
      if (message) {
        logger.debug('MCP stderr', { message });
      }
    });

    this.process.on('error', (error: Error) => {
      logger.error('MCP process error', { error: error.message });
      this.rejectAllPending(new Error(`Process error: ${error.message}`));
    });

    this.process.on('exit', (code: number | null, signal: string | null) => {
      logger.info('MCP process exited', { code, signal });
      if (!this.isClosing) {
        this.rejectAllPending(new Error(`Process exited with code ${code}`));
      }
      this.process = null;
    });

    return this.process;
  }

  private handleStdout(data: Buffer): void {
    this.messageBuffer += data.toString();

    // Process complete lines (newline-delimited JSON)
    const lines = this.messageBuffer.split('\n');
    this.messageBuffer = lines[lines.length - 1]; // Keep incomplete line

    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        const response = JSON.parse(line) as JsonRpcResponse;
        const pending = this.pendingRequests.get(response.id);

        if (pending) {
          clearTimeout(pending.timeoutId);
          this.pendingRequests.delete(response.id);

          if (response.error) {
            pending.reject(new Error(`MCP Error ${response.error.code}: ${response.error.message}`));
          } else {
            pending.resolve(response.result);
          }
        } else {
          logger.warn('Received response for unknown request', { id: response.id });
        }
      } catch (parseError) {
        logger.error('Failed to parse MCP response', {
          error: (parseError as Error).message,
          line: line.substring(0, 200),
        });
      }
    }
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (this.isClosing) {
      throw new Error('Transport is closing');
    }

    const proc = this.ensureProcess();
    const id = this.requestId++;

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('MCP request timeout'));
      }, this.timeout);

      this.pendingRequests.set(id, { resolve, reject, timeoutId });

      const message = JSON.stringify(request) + '\n';
      proc.stdin?.write(message, (error) => {
        if (error) {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(id);
          reject(new Error(`Failed to write to stdin: ${error.message}`));
        }
      });
    });
  }

  async close(): Promise<void> {
    this.isClosing = true;
    this.rejectAllPending(new Error('Transport closed'));

    if (this.process) {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          logger.warn('MCP process did not exit gracefully, killing');
          this.process?.kill('SIGKILL');
          resolve();
        }, 5000);

        this.process?.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.process?.kill('SIGTERM');
      });
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export interface TransportConfig {
  transportType: 'http' | 'stdio';
  // HTTP
  url?: string | null;
  headers?: Record<string, string>;
  // Stdio
  commandPath?: string | null;
  commandArgs?: string[];
  envVars?: Record<string, string>;
  workingDirectory?: string | null;
}

export function createTransport(config: TransportConfig): IMcpTransport {
  if (config.transportType === 'http') {
    if (!config.url) {
      throw new Error('URL is required for HTTP transport');
    }
    return new HttpTransport({
      url: config.url,
      headers: config.headers,
    });
  }

  if (config.transportType === 'stdio') {
    if (!config.commandPath) {
      throw new Error('Command path is required for stdio transport');
    }
    return new StdioTransport({
      commandPath: config.commandPath,
      commandArgs: config.commandArgs,
      envVars: config.envVars,
      workingDirectory: config.workingDirectory || undefined,
    });
  }

  throw new Error(`Unknown transport type: ${config.transportType}`);
}
