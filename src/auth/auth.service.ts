import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { query, queryOne } from '../db/postgres.js';
import { generateTokens, verifyToken, getRefreshExpiry } from './jwt.js';
import type { User, UserCreate, AuthTokens } from '../types/index.js';
import logger from '../utils/logger.js';

const SALT_ROUNDS = 12;
const REFRESH_TOKEN_SALT_ROUNDS = 12;

interface DbUser {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: Date;
  updated_at: Date;
  last_login: Date | null;
  is_active: boolean;
  settings: Record<string, unknown>;
}

function mapDbUser(row: DbUser): Omit<User, 'settings'> & { settings: Record<string, unknown> } {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLogin: row.last_login,
    isActive: row.is_active,
    settings: row.settings,
  };
}

export async function register(data: UserCreate): Promise<{ user: Omit<User, 'settings'> & { settings: Record<string, unknown> }; tokens: AuthTokens }> {
  // Check if user exists
  const existing = await queryOne<DbUser>(
    'SELECT id FROM users WHERE email = $1',
    [data.email.toLowerCase()]
  );

  if (existing) {
    throw new Error('Email already registered');
  }

  // Hash password
  const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

  // Create user
  const user = await queryOne<DbUser>(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [data.email.toLowerCase(), passwordHash, data.displayName || null]
  );

  if (!user) {
    throw new Error('Failed to create user');
  }

  // Generate tokens
  const tokens = generateTokens(user.id, user.email);

  // Store refresh token
  await storeRefreshToken(user.id, tokens.refreshToken);

  logger.info('User registered', { userId: user.id, email: user.email });

  return { user: mapDbUser(user), tokens };
}

export async function login(email: string, password: string): Promise<{ user: Omit<User, 'settings'> & { settings: Record<string, unknown> }; tokens: AuthTokens }> {
  // Find user
  const user = await queryOne<DbUser>(
    'SELECT * FROM users WHERE email = $1 AND is_active = true',
    [email.toLowerCase()]
  );

  if (!user) {
    throw new Error('Invalid credentials');
  }

  // Verify password
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new Error('Invalid credentials');
  }

  // Update last login
  await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

  // Generate tokens
  const tokens = generateTokens(user.id, user.email);

  // Store refresh token
  await storeRefreshToken(user.id, tokens.refreshToken);

  logger.info('User logged in', { userId: user.id });

  return { user: mapDbUser(user), tokens };
}

export async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  // Verify token
  const payload = verifyToken(refreshToken);
  if (payload.type !== 'refresh') {
    throw new Error('Invalid token type');
  }

  // Check if presented token matches the most recent, unrevoked stored hash
  const storedToken = await queryOne<{ id: string; token_hash: string }>(
    `SELECT id, token_hash FROM refresh_tokens
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [payload.userId]
  );

  if (!storedToken) {
    throw new Error('Token revoked or expired');
  }

  const matches = await bcrypt.compare(refreshToken, storedToken.token_hash);
  if (!matches) {
    throw new Error('Token revoked or expired');
  }

  // Generate new tokens
  const tokens = generateTokens(payload.userId, payload.email);

  // Revoke old token and store new one
  await query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [payload.userId]
  );
  await storeRefreshToken(payload.userId, tokens.refreshToken);

  logger.debug('Tokens refreshed', { userId: payload.userId });

  return tokens;
}

export async function logout(userId: string): Promise<void> {
  await query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  );
  logger.debug('User logged out', { userId });
}

export async function getUserById(userId: string): Promise<Omit<User, 'settings'> & { settings: Record<string, unknown> } | null> {
  const user = await queryOne<DbUser>(
    'SELECT * FROM users WHERE id = $1 AND is_active = true',
    [userId]
  );
  return user ? mapDbUser(user) : null;
}

async function storeRefreshToken(userId: string, token: string): Promise<void> {
  const hash = await bcrypt.hash(token, REFRESH_TOKEN_SALT_ROUNDS);
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hash, getRefreshExpiry()]
  );
}

export async function updateUserSettings(
  userId: string,
  settings: Record<string, unknown>
): Promise<void> {
  await query(
    `UPDATE users SET settings = settings || $1::jsonb WHERE id = $2`,
    [JSON.stringify(settings), userId]
  );
}

// Get the first active user (for auto-login on trusted local network)
export async function getFirstUser(): Promise<(Omit<User, 'settings'> & { settings: Record<string, unknown> }) | null> {
  const user = await queryOne<DbUser>(
    'SELECT * FROM users WHERE is_active = true ORDER BY created_at ASC LIMIT 1',
    []
  );
  return user ? mapDbUser(user) : null;
}

// Generate tokens for a user by ID (for auto-login)
export async function generateTokensForUser(userId: string): Promise<AuthTokens> {
  const user = await queryOne<DbUser>(
    'SELECT * FROM users WHERE id = $1 AND is_active = true',
    [userId]
  );

  if (!user) {
    throw new Error('User not found');
  }

  // Update last login
  await query('UPDATE users SET last_login = NOW() WHERE id = $1', [userId]);

  // Generate tokens
  const tokens = generateTokens(user.id, user.email);

  // Store refresh token
  await storeRefreshToken(user.id, tokens.refreshToken);

  return tokens;
}

export async function getAllActiveUsers(): Promise<Array<Omit<User, 'settings'> & { settings: Record<string, unknown> }>> {
  const users = await query<DbUser>(
    'SELECT * FROM users WHERE is_active = true'
  );
  return users.map(mapDbUser);
}

// Invite code system

export async function createInviteCode(createdByUserId: string): Promise<{ code: string; expiresAt: Date }> {
  const code = crypto.randomBytes(4).toString('hex'); // 8 chars
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await query(
    `INSERT INTO invite_codes (code, created_by, expires_at)
     VALUES ($1, $2, $3)`,
    [code, createdByUserId, expiresAt]
  );

  logger.info('Invite code created', { code, createdBy: createdByUserId });
  return { code, expiresAt };
}

export async function listInviteCodes(createdByUserId: string): Promise<Array<{
  code: string;
  expiresAt: Date;
  usedBy: string | null;
  usedAt: Date | null;
  createdAt: Date;
}>> {
  const rows = await query<{
    code: string;
    expires_at: Date;
    used_by: string | null;
    used_at: Date | null;
    created_at: Date;
  }>(
    `SELECT code, expires_at, used_by, used_at, created_at
     FROM invite_codes WHERE created_by = $1
     ORDER BY created_at DESC LIMIT 50`,
    [createdByUserId]
  );
  return rows.map(r => ({
    code: r.code,
    expiresAt: r.expires_at,
    usedBy: r.used_by,
    usedAt: r.used_at,
    createdAt: r.created_at,
  }));
}

export async function registerWithInvite(
  inviteCode: string,
  email: string,
  password: string,
  displayName: string
): Promise<{ user: Omit<User, 'settings'> & { settings: Record<string, unknown> }; tokens: AuthTokens }> {
  // Validate invite code
  const invite = await queryOne<{ id: string; used_by: string | null; expires_at: Date }>(
    `SELECT id, used_by, expires_at FROM invite_codes WHERE code = $1`,
    [inviteCode]
  );

  if (!invite) {
    throw new Error('Invalid invite code');
  }
  if (invite.used_by) {
    throw new Error('Invite code already used');
  }
  if (new Date(invite.expires_at) < new Date()) {
    throw new Error('Invite code expired');
  }

  // Register user using existing register function
  const result = await register({ email, password, displayName });

  // Mark invite code as used
  await query(
    `UPDATE invite_codes SET used_by = $1, used_at = NOW() WHERE code = $2`,
    [result.user.id, inviteCode]
  );

  logger.info('User registered with invite code', { userId: result.user.id, inviteCode });

  return result;
}
