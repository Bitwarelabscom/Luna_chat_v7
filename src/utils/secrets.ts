import { readFileSync, existsSync } from 'fs';

/**
 * Read a secret from Docker secrets or fall back to environment variable.
 * Docker secrets are mounted at /run/secrets/<name> in containers.
 */
export function getSecret(name: string, fallbackEnv?: string): string {
  const secretPath = `/run/secrets/${name}`;

  // Try Docker secret first
  if (existsSync(secretPath)) {
    try {
      return readFileSync(secretPath, 'utf8').trim();
    } catch {
      // If secret exists but is unreadable, fall back to env if provided
      if (fallbackEnv && process.env[fallbackEnv]) {
        return process.env[fallbackEnv]!;
      }
      throw new Error(`Secret "${name}" exists but could not be read at ${secretPath}`);
    }
  }

  // Fall back to environment variable
  if (fallbackEnv && process.env[fallbackEnv]) {
    return process.env[fallbackEnv]!;
  }

  throw new Error(`Secret "${name}" not found at ${secretPath} and no fallback provided`);
}

/**
 * Read an optional secret - returns undefined if not found.
 */
export function getOptionalSecret(name: string, fallbackEnv?: string): string | undefined {
  try {
    return getSecret(name, fallbackEnv);
  } catch {
    return undefined;
  }
}
