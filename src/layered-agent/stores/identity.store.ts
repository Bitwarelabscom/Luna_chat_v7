/**
 * Identity Store - Policy Object Persistence
 *
 * Manages loading, persisting, and pinning identity versions.
 * Identity is immutable once created - versions are append-only.
 */

import { readFile } from 'fs/promises';
import { parse as parseYaml } from 'yaml';
import { query, queryOne } from '../../db/postgres.js';
import { IdentityProfileSchema, type IdentityProfile, type IdentityRow, type IdentityPinRow } from '../schemas/identity.js';
import logger from '../../utils/logger.js';

/**
 * Load identity from YAML file and validate
 */
export async function loadIdentityFromFile(filePath: string): Promise<IdentityProfile> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const raw = parseYaml(content);
    const identity = IdentityProfileSchema.parse(raw);
    return identity;
  } catch (error) {
    logger.error('Failed to load identity from file', {
      filePath,
      error: (error as Error).message,
    });
    throw error;
  }
}

/**
 * Get an identity by ID and version from the database
 */
export async function getIdentity(
  identityId: string,
  version: number
): Promise<IdentityProfile | null> {
  try {
    const row = await queryOne<IdentityRow>(
      `SELECT id, version, policy, created_at
       FROM identities
       WHERE id = $1 AND version = $2`,
      [identityId, version]
    );

    if (!row) return null;

    // Policy is stored as JSONB, parse and validate
    return IdentityProfileSchema.parse(row.policy);
  } catch (error) {
    logger.error('Failed to get identity', {
      identityId,
      version,
      error: (error as Error).message,
    });
    throw error;
  }
}

/**
 * Get the latest version of an identity
 */
export async function getLatestIdentity(identityId: string): Promise<IdentityProfile | null> {
  try {
    const row = await queryOne<IdentityRow>(
      `SELECT id, version, policy, created_at
       FROM identities
       WHERE id = $1
       ORDER BY version DESC
       LIMIT 1`,
      [identityId]
    );

    if (!row) return null;

    return IdentityProfileSchema.parse(row.policy);
  } catch (error) {
    logger.error('Failed to get latest identity', {
      identityId,
      error: (error as Error).message,
    });
    throw error;
  }
}

/**
 * Get the latest version number for an identity
 */
export async function getLatestVersion(identityId: string): Promise<number> {
  try {
    const row = await queryOne<{ max_version: number }>(
      `SELECT COALESCE(MAX(version), 0) as max_version
       FROM identities
       WHERE id = $1`,
      [identityId]
    );

    return row?.max_version ?? 0;
  } catch (error) {
    logger.error('Failed to get latest version', {
      identityId,
      error: (error as Error).message,
    });
    return 0;
  }
}

/**
 * Persist identity to database (append-only - creates new version)
 * If the exact version already exists, this is a no-op.
 */
export async function persistIdentity(identity: IdentityProfile): Promise<void> {
  try {
    // Check if this exact version already exists
    const existing = await getIdentity(identity.id, identity.version);
    if (existing) {
      logger.debug('Identity version already exists', {
        id: identity.id,
        version: identity.version,
      });
      return;
    }

    await query(
      `INSERT INTO identities (id, version, policy)
       VALUES ($1, $2, $3)
       ON CONFLICT (id, version) DO NOTHING`,
      [identity.id, identity.version, JSON.stringify(identity)]
    );

    logger.info('Persisted identity', {
      id: identity.id,
      version: identity.version,
    });
  } catch (error) {
    logger.error('Failed to persist identity', {
      id: identity.id,
      version: identity.version,
      error: (error as Error).message,
    });
    throw error;
  }
}

/**
 * Pin identity version to a session
 * Once pinned, the identity version never changes for that session.
 */
export async function pinIdentityToSession(
  sessionId: string,
  identityId: string,
  identityVersion: number
): Promise<void> {
  try {
    await query(
      `INSERT INTO identity_pins (session_id, identity_id, identity_version)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id) DO NOTHING`,
      [sessionId, identityId, identityVersion]
    );

    logger.debug('Pinned identity to session', {
      sessionId,
      identityId,
      identityVersion,
    });
  } catch (error) {
    logger.error('Failed to pin identity to session', {
      sessionId,
      identityId,
      identityVersion,
      error: (error as Error).message,
    });
    throw error;
  }
}

/**
 * Get the pinned identity for a session
 */
export async function getSessionIdentity(sessionId: string): Promise<IdentityProfile | null> {
  try {
    const row = await queryOne<IdentityRow & IdentityPinRow>(
      `SELECT i.id, i.version, i.policy, i.created_at, ip.pinned_at
       FROM identity_pins ip
       JOIN identities i ON i.id = ip.identity_id AND i.version = ip.identity_version
       WHERE ip.session_id = $1`,
      [sessionId]
    );

    if (!row) return null;

    return IdentityProfileSchema.parse(row.policy);
  } catch (error) {
    logger.error('Failed to get session identity', {
      sessionId,
      error: (error as Error).message,
    });
    throw error;
  }
}

/**
 * Check if a session has a pinned identity
 */
export async function hasSessionIdentity(sessionId: string): Promise<boolean> {
  try {
    const row = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS(
        SELECT 1 FROM identity_pins WHERE session_id = $1
      ) as exists`,
      [sessionId]
    );

    return row?.exists ?? false;
  } catch (error) {
    logger.error('Failed to check session identity', {
      sessionId,
      error: (error as Error).message,
    });
    return false;
  }
}

/**
 * Ensure identity is loaded, persisted, and pinned for a session
 * This is the main entry point for identity management.
 */
export async function ensureSessionIdentity(
  sessionId: string,
  identityFilePath: string
): Promise<IdentityProfile> {
  // Check if session already has pinned identity
  const existing = await getSessionIdentity(sessionId);
  if (existing) {
    return existing;
  }

  // Load identity from file
  const identity = await loadIdentityFromFile(identityFilePath);

  // Persist to database if not exists
  await persistIdentity(identity);

  // Pin to session
  await pinIdentityToSession(sessionId, identity.id, identity.version);

  logger.info('Ensured session identity', {
    sessionId,
    identityId: identity.id,
    identityVersion: identity.version,
  });

  return identity;
}

/**
 * Get all identity versions (for admin/debugging)
 */
export async function getAllIdentityVersions(identityId: string): Promise<Array<{ version: number; createdAt: Date }>> {
  try {
    const rows = await query<{ version: number; created_at: Date }>(
      `SELECT version, created_at
       FROM identities
       WHERE id = $1
       ORDER BY version DESC`,
      [identityId]
    );

    return rows.map(r => ({
      version: r.version,
      createdAt: r.created_at,
    }));
  } catch (error) {
    logger.error('Failed to get identity versions', {
      identityId,
      error: (error as Error).message,
    });
    return [];
  }
}

export default {
  loadIdentityFromFile,
  getIdentity,
  getLatestIdentity,
  getLatestVersion,
  persistIdentity,
  pinIdentityToSession,
  getSessionIdentity,
  hasSessionIdentity,
  ensureSessionIdentity,
  getAllIdentityVersions,
};
