import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import type { TokenPayload, AuthTokens } from '../types/index.js';

function parseExpiry(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60; // default 7 days

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 60 * 60;
    case 'd': return value * 24 * 60 * 60;
    default: return 7 * 24 * 60 * 60;
  }
}

export function generateAccessToken(userId: string, email: string): string {
  const payload: TokenPayload = {
    userId,
    email,
    type: 'access',
  };

  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn as string,
  } as jwt.SignOptions);
}

export function generateRefreshToken(userId: string, email: string): string {
  const payload: TokenPayload = {
    userId,
    email,
    type: 'refresh',
  };

  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.refreshExpiresIn as string,
  } as jwt.SignOptions);
}

export function generateTokens(userId: string, email: string): AuthTokens {
  return {
    accessToken: generateAccessToken(userId, email),
    refreshToken: generateRefreshToken(userId, email),
    expiresIn: parseExpiry(config.jwt.expiresIn),
  };
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, config.jwt.secret) as TokenPayload;
}

export function decodeToken(token: string): TokenPayload | null {
  try {
    return jwt.decode(token) as TokenPayload;
  } catch {
    return null;
  }
}

export function getRefreshExpiry(): Date {
  const seconds = parseExpiry(config.jwt.refreshExpiresIn);
  return new Date(Date.now() + seconds * 1000);
}
