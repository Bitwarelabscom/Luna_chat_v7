import { createCompletion } from '../llm/router.js';
import { getBackgroundFeatureModelConfig } from '../settings/background-llm-settings.service.js';
import { readFile } from './workspace.service.js';
import type { GenrePreset, GenreCategory } from './genre-presets.js';
import type { ChatMessage, ProviderId } from '../llm/types.js';
import logger from '../utils/logger.js';

// ============================================================
// Types
// ============================================================

interface StylePreset {
  id: string;
  name: string;
  tags: string;
  color?: string;
}

interface StylesJson {
  custom?: StylePreset[];
}

// ============================================================
// Cache
// ============================================================

interface CacheEntry {
  preset: GenrePreset;
  expiresAt: number;
}

const inferredCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function cacheKey(userId: string, presetId: string): string {
  return `${userId}:${presetId}`;
}

// ============================================================
// Helpers
// ============================================================

function slugifyPreset(name: string): string {
  return 'dj-custom-' + name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 55)
    .replace(/^-|-$/g, '');
}

/**
 * Parse BPM from tags string, e.g. "140 bpm" → 140
 */
function parseBpmFromTags(tags: string): number | null {
  const match = tags.match(/(\d{2,3})\s*bpm/i);
  if (match) {
    const bpm = parseInt(match[1], 10);
    if (bpm >= 60 && bpm <= 220) return bpm;
  }
  return null;
}

function coerceString(val: unknown, fallback: string): string {
  return typeof val === 'string' && val.trim() ? val.trim() : fallback;
}

function coerceNumber(val: unknown, fallback: number): number {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function coerceRhymeScheme(val: unknown): GenrePreset['rhymeScheme'] {
  const valid = ['AABB', 'ABAB', 'ABCB', 'loose', 'none'];
  return valid.includes(val as string) ? (val as GenrePreset['rhymeScheme']) : 'ABAB';
}

function coerceEnergy(val: unknown): GenrePreset['energy'] {
  const valid = ['low', 'medium', 'high'];
  return valid.includes(val as string) ? (val as GenrePreset['energy']) : 'medium';
}

function coerceCategory(val: unknown): GenreCategory {
  const valid: GenreCategory[] = [
    'pop', 'rock', 'electronic', 'hip-hop', 'r-and-b',
    'folk-country', 'latin', 'world', 'jazz-blues',
    'chill', 'classical-cinematic', 'experimental',
  ];
  return valid.includes(val as GenreCategory) ? (val as GenreCategory) : 'electronic';
}

function coerceBpmRange(val: unknown, tagBpm: number | null): { min: number; max: number } {
  if (tagBpm !== null) {
    return { min: Math.max(60, tagBpm - 10), max: Math.min(220, tagBpm + 10) };
  }
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    const min = coerceNumber(obj.min, 80);
    const max = coerceNumber(obj.max, 140);
    if (min < max) return { min, max };
  }
  return { min: 80, max: 140 };
}

// ============================================================
// Load Style Presets
// ============================================================

export async function loadStylePresets(userId: string): Promise<StylePreset[]> {
  try {
    const content = await readFile(userId, 'dj-luna/styles.json');
    const parsed: StylesJson = JSON.parse(content);
    const presets = Array.isArray(parsed.custom) ? parsed.custom : [];
    return presets.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // File not found is expected for users who haven't saved any presets
    if (code === 'ENOENT' || (err as Error).message?.includes('not found')) {
      return [];
    }
    logger.warn('Failed to load DJ Luna styles.json', { userId, error: (err as Error).message });
    return [];
  }
}

// ============================================================
// LLM Inference
// ============================================================

async function inferGenrePreset(userId: string, stylePreset: StylePreset): Promise<GenrePreset> {
  const config = await getBackgroundFeatureModelConfig(userId, 'music_trend_analysis');
  const { provider, model } = config.primary;

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: 'You are a music production expert. Given a DJ style preset name and tags, infer full genre metadata for song production. Return ONLY valid JSON, no markdown, no explanation.',
    },
    {
      role: 'user',
      content: `DJ Luna style preset:
Name: "${stylePreset.name}"
Tags: "${stylePreset.tags}"

Infer production metadata and return JSON:
{
  "description": "1-2 sentence description of this genre/style",
  "category": "one of: pop, rock, electronic, hip-hop, r-and-b, folk-country, latin, world, jazz-blues, chill, classical-cinematic, experimental",
  "bpmRange": { "min": number, "max": number },
  "energy": "low|medium|high",
  "rhymeScheme": "AABB|ABAB|ABCB|loose|none",
  "syllableRange": { "min": number, "max": number },
  "defaultSongCount": number (8-14),
  "structure": [
    { "tag": "verse|chorus|bridge|pre-chorus|intro|outro|hook|breakdown", "required": true|false }
  ],
  "notes": "brief production/style notes for lyric generation"
}`,
    },
  ];

  const tagBpm = parseBpmFromTags(stylePreset.tags);

  const tryParse = async (p: ProviderId, m: string): Promise<GenrePreset> => {
    const result = await createCompletion(p, m, messages, {
      temperature: 0.2,
      maxTokens: 1000,
    });
    const cleaned = result.content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const data = JSON.parse(cleaned) as Record<string, unknown>;

    const bpmRange = coerceBpmRange(data.bpmRange, tagBpm);

    return {
      id: slugifyPreset(stylePreset.name),
      name: stylePreset.name,
      description: coerceString(data.description, `Custom DJ preset: ${stylePreset.name}`),
      category: coerceCategory(data.category),
      bpmRange,
      energy: coerceEnergy(data.energy),
      rhymeScheme: coerceRhymeScheme(data.rhymeScheme),
      syllableRange: {
        min: coerceNumber((data.syllableRange as Record<string, unknown>)?.min, 5),
        max: coerceNumber((data.syllableRange as Record<string, unknown>)?.max, 10),
      },
      defaultSongCount: coerceNumber(data.defaultSongCount, 10),
      structure: Array.isArray(data.structure) && data.structure.length > 0
        ? (data.structure as GenrePreset['structure'])
        : [
            { tag: 'verse', required: true },
            { tag: 'verse', required: true },
            { tag: 'chorus', required: true },
            { tag: 'chorus', required: true },
            { tag: 'bridge', required: false },
          ],
      notes: coerceString(data.notes, stylePreset.tags),
      styleTags: stylePreset.tags,
    };
  };

  try {
    return await tryParse(provider, model);
  } catch (primaryErr) {
    logger.warn('Custom genre inference primary failed, trying fallback', {
      userId, presetId: stylePreset.id, error: (primaryErr as Error).message,
    });
    try {
      const { provider: fp, model: fm } = config.fallback;
      return await tryParse(fp, fm);
    } catch (fallbackErr) {
      logger.error('Custom genre inference fallback also failed', {
        userId, presetId: stylePreset.id, error: (fallbackErr as Error).message,
      });
      throw fallbackErr;
    }
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Returns inferred GenrePreset[] for all saved DJ Luna style presets.
 * Results are cached per (userId, presetId) for 24 hours.
 * Stale entries for deleted presets are pruned on each call.
 */
export async function getCustomGenrePresets(userId: string): Promise<GenrePreset[]> {
  const stylePresets = await loadStylePresets(userId);

  if (stylePresets.length === 0) {
    return [];
  }

  // Prune stale cache entries for presets that no longer exist
  const currentIds = new Set(stylePresets.map(p => p.id));
  for (const key of inferredCache.keys()) {
    if (!key.startsWith(`${userId}:`)) continue;
    const presetId = key.slice(userId.length + 1);
    if (!currentIds.has(presetId)) {
      inferredCache.delete(key);
    }
  }

  const now = Date.now();

  // For each preset, use cache if valid; otherwise infer
  const results = await Promise.allSettled(
    stylePresets.map(async (sp) => {
      const key = cacheKey(userId, sp.id);
      const cached = inferredCache.get(key);
      if (cached && cached.expiresAt > now) {
        return cached.preset;
      }

      const preset = await inferGenrePreset(userId, sp);
      inferredCache.set(key, { preset, expiresAt: now + CACHE_TTL_MS });
      return preset;
    })
  );

  const presets: GenrePreset[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      presets.push(result.value);
    }
    // Failed inferences are silently omitted (not cached)
  }

  return presets;
}

/**
 * Invalidate cached inferences for a user (e.g. after saving new presets).
 */
export function invalidateCustomGenreCache(userId: string): void {
  for (const key of inferredCache.keys()) {
    if (key.startsWith(`${userId}:`)) {
      inferredCache.delete(key);
    }
  }
}
