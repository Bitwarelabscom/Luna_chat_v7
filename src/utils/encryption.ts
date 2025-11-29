import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { config } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

export interface EncryptedData {
  encrypted: string;
  iv: string;
  tag: string;
}

/**
 * Get the encryption key from config (must be 64 hex chars = 32 bytes)
 */
function getEncryptionKey(): Buffer {
  if (!config.encryptionKey) {
    throw new Error('Encryption key not configured. Set ENCRYPTION_KEY or encryption_key secret.');
  }
  return Buffer.from(config.encryptionKey, 'hex');
}

/**
 * Encrypt a string using AES-256-GCM
 */
export function encrypt(plaintext: string): EncryptedData {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return {
    encrypted,
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
  };
}

/**
 * Decrypt data encrypted with AES-256-GCM
 */
export function decrypt(data: EncryptedData): string {
  const key = getEncryptionKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(data.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(data.tag, 'hex'));

  let decrypted = decipher.update(data.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Encrypt a token for database storage (combines all parts into one string)
 */
export function encryptToken(token: string): string {
  const data = encrypt(token);
  return `${data.iv}:${data.tag}:${data.encrypted}`;
}

/**
 * Decrypt a token from database storage
 */
export function decryptToken(storedValue: string): string {
  const [iv, tag, encrypted] = storedValue.split(':');
  if (!iv || !tag || !encrypted) {
    throw new Error('Invalid encrypted token format');
  }
  return decrypt({ iv, tag, encrypted });
}

/**
 * Check if encryption is available
 */
export function isEncryptionAvailable(): boolean {
  return !!config.encryptionKey;
}
