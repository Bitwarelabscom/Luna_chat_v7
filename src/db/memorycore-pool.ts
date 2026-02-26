import { Pool } from 'pg';
import logger from '../utils/logger.js';

// Secondary PostgreSQL pool connecting to MemoryCore's database
// Used for direct graph CRUD operations in the Memory Lab
export const memorycorePool = new Pool({
  host: process.env.MEMORYCORE_DB_HOST || 'memorycore-postgres',
  port: parseInt(process.env.MEMORYCORE_DB_PORT || '5432'),
  user: process.env.MEMORYCORE_DB_USER || 'memorycore',
  password: process.env.MEMORYCORE_DB_PASSWORD || '',
  database: process.env.MEMORYCORE_DB_NAME || 'memorycore',
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 3000,
  // No SSL needed for Docker internal network
  ssl: false,
});

memorycorePool.on('error', (err) => {
  logger.error('Unexpected MemoryCore PostgreSQL error', { error: err.message });
});

memorycorePool.on('connect', () => {
  logger.debug('New MemoryCore PostgreSQL connection established');
});

export async function mcQuery<T>(text: string, params?: unknown[]): Promise<T[]> {
  const start = Date.now();
  const result = await memorycorePool.query(text, params);
  const duration = Date.now() - start;
  logger.debug('MemoryCore query executed', { text: text.slice(0, 80), duration, rows: result.rowCount });
  return result.rows as T[];
}

export async function mcQueryOne<T>(text: string, params?: unknown[]): Promise<T | null> {
  const rows = await mcQuery<T>(text, params);
  return rows[0] || null;
}

export async function mcHealthCheck(): Promise<boolean> {
  try {
    await mcQuery('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closeMemorycorePool(): Promise<void> {
  await memorycorePool.end();
  logger.info('MemoryCore PostgreSQL pool closed');
}

export default { mcQuery, mcQueryOne, mcHealthCheck, closeMemorycorePool };
