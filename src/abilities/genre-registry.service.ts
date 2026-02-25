import { pool } from '../db/index.js';
import { GENRE_PRESETS, type GenrePreset } from './genre-presets.js';
import logger from '../utils/logger.js';

interface ProposedGenreRow {
  id: string;
  genre_id: string;
  name: string;
  category: string;
  preset_data: Record<string, unknown>;
  confidence: number;
  status: string;
  created_at: string;
}

// Per-user cache with 5-minute TTL
const cache = new Map<string, { presets: GenrePreset[]; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Returns all available genre presets for a user:
 * 55 builtins + any user-approved proposed presets.
 */
export async function getAllPresets(userId: string): Promise<GenrePreset[]> {
  const now = Date.now();
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > now) {
    return cached.presets;
  }

  try {
    const result = await pool.query<ProposedGenreRow>(
      `SELECT id, genre_id, name, category, preset_data, confidence, status, created_at
       FROM proposed_genre_presets
       WHERE user_id = $1 AND status = 'approved'
       ORDER BY created_at`,
      [userId],
    );

    const approvedPresets: GenrePreset[] = result.rows.map(row => {
      const data = row.preset_data as Record<string, unknown>;
      return {
        id: row.genre_id,
        name: row.name,
        description: (data.description as string) || `Approved genre: ${row.name}`,
        structure: (data.structure as GenrePreset['structure']) || [
          { tag: 'verse', required: true },
          { tag: 'verse', required: true },
          { tag: 'chorus', required: true },
          { tag: 'chorus', required: true },
        ],
        syllableRange: (data.syllableRange as GenrePreset['syllableRange']) || { min: 5, max: 10 },
        rhymeScheme: (data.rhymeScheme as GenrePreset['rhymeScheme']) || 'ABAB',
        notes: (data.notes as string) || '',
        defaultSongCount: (data.defaultSongCount as number) || 10,
        category: (data.category as GenrePreset['category']) || row.category as GenrePreset['category'],
        styleTags: (data.styleTags as string) || '',
        bpmRange: (data.bpmRange as GenrePreset['bpmRange']) || { min: 80, max: 140 },
        energy: (data.energy as GenrePreset['energy']) || 'medium',
      };
    });

    // Merge: builtins first, then approved (skip if id already exists)
    const existingIds = new Set(GENRE_PRESETS.map(p => p.id));
    const merged = [
      ...GENRE_PRESETS,
      ...approvedPresets.filter(p => !existingIds.has(p.id)),
    ];

    cache.set(userId, { presets: merged, expiresAt: now + CACHE_TTL_MS });
    return merged;
  } catch (err) {
    logger.error('Failed to load approved genre presets', { userId, error: (err as Error).message });
    // Fall back to builtins only
    return GENRE_PRESETS;
  }
}

/**
 * Get a specific preset by ID for a user (includes approved proposals).
 */
export async function getPresetById(userId: string, id: string): Promise<GenrePreset | undefined> {
  const all = await getAllPresets(userId);
  return all.find(p => p.id === id);
}

/**
 * Invalidate the cache for a user (e.g. after approving/rejecting a proposal).
 */
export function invalidateCache(userId: string): void {
  cache.delete(userId);
}
