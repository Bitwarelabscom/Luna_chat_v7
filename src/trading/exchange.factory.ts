// Exchange client factory - Crypto.com only

import { pool } from '../db/index.js';
import { decryptToken } from '../utils/encryption.js';
import { logger } from '../utils/logger.js';
import { CryptoComClient } from './crypto-com.client.js';
import type {
  ExchangeType,
  ExchangeCredentials,
  IExchangeClient,
  IMarginExchangeClient,
} from './exchange.interface.js';

// Client cache with TTL
interface CachedClient {
  client: IExchangeClient;
  exchange: ExchangeType;
  expiresAt: number;
}

const clientCache = new Map<string, CachedClient>();
const CLIENT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get user's exchange credentials from database
 */
async function getUserExchangeCredentials(
  userId: string
): Promise<{ credentials: ExchangeCredentials; exchange: ExchangeType } | null> {
  const result = await pool.query(
    `SELECT api_key_encrypted, api_secret_encrypted, exchange
     FROM user_trading_keys
     WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  try {
    const apiKey = decryptToken(row.api_key_encrypted);
    const apiSecret = decryptToken(row.api_secret_encrypted);
    const exchange: ExchangeType = 'crypto_com';
    return {
      credentials: { apiKey, apiSecret },
      exchange,
    };
  } catch (error) {
    logger.error('Failed to decrypt API keys', { userId, error });
    return null;
  }
}

/**
 * Get user's configured exchange type - always returns crypto_com
 */
export async function getUserExchangeType(userId: string): Promise<ExchangeType | null> {
  const result = await pool.query(
    `SELECT 1 FROM user_trading_keys WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return 'crypto_com';
}

/**
 * Get user's margin settings (Crypto.com only)
 */
export async function getUserMarginSettings(
  userId: string
): Promise<{ marginEnabled: boolean; leverage: number } | null> {
  const result = await pool.query(
    `SELECT margin_enabled, leverage FROM user_trading_keys WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return {
    marginEnabled: result.rows[0].margin_enabled ?? false,
    leverage: result.rows[0].leverage ?? 1,
  };
}

/**
 * Create exchange client - Crypto.com only
 */
export function createExchangeClient(
  _exchange: ExchangeType,
  credentials: ExchangeCredentials
): IExchangeClient {
  return new CryptoComClient(credentials);
}

/**
 * Get exchange client for a user (with caching)
 */
export async function getExchangeClient(userId: string): Promise<IExchangeClient | null> {
  // Check cache
  const cached = clientCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.client;
  }

  // Get credentials and exchange type
  const data = await getUserExchangeCredentials(userId);
  if (!data) {
    return null;
  }

  // Create client
  const client = createExchangeClient(data.exchange, data.credentials);

  // Cache it
  clientCache.set(userId, {
    client,
    exchange: data.exchange,
    expiresAt: Date.now() + CLIENT_CACHE_TTL,
  });

  return client;
}

/**
 * Get margin-capable exchange client for a user
 * Returns null if user's exchange doesn't support margin
 */
export async function getMarginClient(userId: string): Promise<IMarginExchangeClient | null> {
  const client = await getExchangeClient(userId);
  if (!client) {
    return null;
  }

  if (!client.supportsMargin) {
    return null;
  }

  return client as IMarginExchangeClient;
}

/**
 * Invalidate cached client for a user
 */
export function invalidateClientCache(userId: string): void {
  clientCache.delete(userId);
}

/**
 * Clear all cached clients
 */
export function clearClientCache(): void {
  clientCache.clear();
}

/**
 * Check if user has an exchange connected
 */
export async function hasExchangeConnected(userId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM user_trading_keys WHERE user_id = $1`,
    [userId]
  );
  return result.rows.length > 0;
}

/**
 * Check if user's exchange supports margin trading - always true for Crypto.com
 */
export async function userSupportsMargin(userId: string): Promise<boolean> {
  const exchange = await getUserExchangeType(userId);
  return exchange !== null;
}
