import { query, queryOne } from '../db/postgres.js';
import type { ProviderId } from '../llm/types.js';

export type BackgroundLlmFeature =
  | 'mood_analysis'
  | 'context_summary'
  | 'memory_curation'
  | 'friend_summary'
  | 'friend_fact_extraction'
  | 'intent_detection'
  | 'news_filter'
  | 'research_synthesis'
  | 'session_gap_analysis'
  | 'knowledge_verification'
  | 'supervisor_critique';

export interface FeatureModelSelection {
  provider: ProviderId;
  model: string;
}

export interface BackgroundFeatureModelConfig {
  primary: FeatureModelSelection;
  fallback: FeatureModelSelection;
}

export type BackgroundLlmSettings = Record<BackgroundLlmFeature, BackgroundFeatureModelConfig>;

export interface BackgroundLlmFeatureMeta {
  id: BackgroundLlmFeature;
  label: string;
  description: string;
}

const VALID_PROVIDERS: ProviderId[] = [
  'openai',
  'groq',
  'anthropic',
  'xai',
  'openrouter',
  'ollama',
  'ollama_secondary',
  'ollama_tertiary',
  'google',
  'sanhedrin',
  'moonshot',
];

export const BACKGROUND_LLM_FEATURES: BackgroundLlmFeatureMeta[] = [
  {
    id: 'mood_analysis',
    label: 'Mood Analysis',
    description: 'Emotional/sentiment detection on user messages.',
  },
  {
    id: 'context_summary',
    label: 'Context Summary',
    description: 'Rolling conversation summary and recompression.',
  },
  {
    id: 'memory_curation',
    label: 'Memory Curation',
    description: 'Selects relevant facts/history for context injection.',
  },
  {
    id: 'friend_summary',
    label: 'Friend Discussion Summary',
    description: 'Summarizes autonomous friend discussions.',
  },
  {
    id: 'friend_fact_extraction',
    label: 'Friend Fact Extraction',
    description: 'Extracts insights/facts from friend discussions.',
  },
  {
    id: 'intent_detection',
    label: 'Intent Detection',
    description: 'LLM fallback for classifying user intent when regex signals are unclear.',
  },
  {
    id: 'news_filter',
    label: 'News Filter',
    description: 'Filters autonomous news articles by signal vs noise.',
  },
  {
    id: 'research_synthesis',
    label: 'Research Synthesis',
    description: 'Synthesizes trusted sources into consolidated findings.',
  },
  {
    id: 'session_gap_analysis',
    label: 'Session Gap Analysis',
    description: 'Identifies knowledge gaps from recent user sessions.',
  },
  {
    id: 'knowledge_verification',
    label: 'Knowledge Verification',
    description: 'Verifies synthesized research before embedding into memory.',
  },
  {
    id: 'supervisor_critique',
    label: 'Supervisor Critique',
    description: 'Compliance review of layered-agent drafts before final output.',
  },
];

export const DEFAULT_BACKGROUND_LLM_SETTINGS: BackgroundLlmSettings = {
  mood_analysis: {
    primary: { provider: 'ollama', model: 'llama3.2:3b' },
    fallback: { provider: 'openai', model: 'gpt-5-nano' },
  },
  context_summary: {
    primary: { provider: 'ollama', model: 'llama3.2:3b' },
    fallback: { provider: 'openai', model: 'gpt-5-nano' },
  },
  memory_curation: {
    primary: { provider: 'ollama', model: 'llama3.2:3b' },
    fallback: { provider: 'openai', model: 'gpt-5-nano' },
  },
  friend_summary: {
    primary: { provider: 'ollama', model: 'llama3.2:3b' },
    fallback: { provider: 'openai', model: 'gpt-5-mini' },
  },
  friend_fact_extraction: {
    primary: { provider: 'ollama', model: 'llama3.2:3b' },
    fallback: { provider: 'openai', model: 'gpt-5-mini' },
  },
  intent_detection: {
    primary: { provider: 'ollama', model: 'llama3.2:3b' },
    fallback: { provider: 'openai', model: 'gpt-5-mini' },
  },
  news_filter: {
    primary: { provider: 'ollama', model: 'llama3.2:3b' },
    fallback: { provider: 'openai', model: 'gpt-5-mini' },
  },
  research_synthesis: {
    primary: { provider: 'ollama', model: 'llama3.2:3b' },
    fallback: { provider: 'openai', model: 'gpt-5-mini' },
  },
  session_gap_analysis: {
    primary: { provider: 'ollama', model: 'llama3.2:3b' },
    fallback: { provider: 'openai', model: 'gpt-5-mini' },
  },
  knowledge_verification: {
    primary: { provider: 'ollama', model: 'llama3.2:3b' },
    fallback: { provider: 'openai', model: 'gpt-5-mini' },
  },
  supervisor_critique: {
    primary: { provider: 'ollama_tertiary', model: 'HoseaDev/qwen2.5-7b-instruct-q4-gguf:latest' },
    fallback: { provider: 'openai', model: 'gpt-5-mini' },
  },
};

interface DbSettingsRow {
  settings: Record<string, unknown> | null;
}

function isValidProvider(value: unknown): value is ProviderId {
  return typeof value === 'string' && VALID_PROVIDERS.includes(value as ProviderId);
}

function sanitizeFeatureConfig(raw: unknown, fallback: BackgroundFeatureModelConfig): BackgroundFeatureModelConfig {
  if (!raw || typeof raw !== 'object') return fallback;
  const candidate = raw as Record<string, unknown>;
  const primary = candidate.primary as Record<string, unknown> | undefined;
  const secondary = candidate.fallback as Record<string, unknown> | undefined;

  const primaryProvider = isValidProvider(primary?.provider) ? primary.provider : fallback.primary.provider;
  const primaryModel = typeof primary?.model === 'string' && primary.model.trim() ? primary.model : fallback.primary.model;
  const fallbackProvider = isValidProvider(secondary?.provider) ? secondary.provider : fallback.fallback.provider;
  const fallbackModel = typeof secondary?.model === 'string' && secondary.model.trim() ? secondary.model : fallback.fallback.model;

  return {
    primary: { provider: primaryProvider, model: primaryModel },
    fallback: { provider: fallbackProvider, model: fallbackModel },
  };
}

function mergeWithDefaults(raw: unknown): BackgroundLlmSettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    mood_analysis: sanitizeFeatureConfig(obj.mood_analysis, DEFAULT_BACKGROUND_LLM_SETTINGS.mood_analysis),
    context_summary: sanitizeFeatureConfig(obj.context_summary, DEFAULT_BACKGROUND_LLM_SETTINGS.context_summary),
    memory_curation: sanitizeFeatureConfig(obj.memory_curation, DEFAULT_BACKGROUND_LLM_SETTINGS.memory_curation),
    friend_summary: sanitizeFeatureConfig(obj.friend_summary, DEFAULT_BACKGROUND_LLM_SETTINGS.friend_summary),
    friend_fact_extraction: sanitizeFeatureConfig(obj.friend_fact_extraction, DEFAULT_BACKGROUND_LLM_SETTINGS.friend_fact_extraction),
    intent_detection: sanitizeFeatureConfig(obj.intent_detection, DEFAULT_BACKGROUND_LLM_SETTINGS.intent_detection),
    news_filter: sanitizeFeatureConfig(obj.news_filter, DEFAULT_BACKGROUND_LLM_SETTINGS.news_filter),
    research_synthesis: sanitizeFeatureConfig(obj.research_synthesis, DEFAULT_BACKGROUND_LLM_SETTINGS.research_synthesis),
    session_gap_analysis: sanitizeFeatureConfig(obj.session_gap_analysis, DEFAULT_BACKGROUND_LLM_SETTINGS.session_gap_analysis),
    knowledge_verification: sanitizeFeatureConfig(obj.knowledge_verification, DEFAULT_BACKGROUND_LLM_SETTINGS.knowledge_verification),
    supervisor_critique: sanitizeFeatureConfig(obj.supervisor_critique, DEFAULT_BACKGROUND_LLM_SETTINGS.supervisor_critique),
  };
}

export async function getBackgroundLlmSettings(userId: string): Promise<BackgroundLlmSettings> {
  const row = await queryOne<DbSettingsRow>('SELECT settings FROM users WHERE id = $1', [userId]);
  const stored = row?.settings && typeof row.settings === 'object'
    ? (row.settings as Record<string, unknown>).backgroundLlmModels
    : undefined;
  return mergeWithDefaults(stored);
}

export async function getBackgroundFeatureModelConfig(
  userId: string,
  feature: BackgroundLlmFeature
): Promise<BackgroundFeatureModelConfig> {
  const settings = await getBackgroundLlmSettings(userId);
  return settings[feature];
}

export async function updateBackgroundLlmSettings(
  userId: string,
  updates: Partial<BackgroundLlmSettings>
): Promise<BackgroundLlmSettings> {
  const current = await getBackgroundLlmSettings(userId);
  const merged: BackgroundLlmSettings = {
    mood_analysis: updates.mood_analysis ? sanitizeFeatureConfig(updates.mood_analysis, current.mood_analysis) : current.mood_analysis,
    context_summary: updates.context_summary ? sanitizeFeatureConfig(updates.context_summary, current.context_summary) : current.context_summary,
    memory_curation: updates.memory_curation ? sanitizeFeatureConfig(updates.memory_curation, current.memory_curation) : current.memory_curation,
    friend_summary: updates.friend_summary ? sanitizeFeatureConfig(updates.friend_summary, current.friend_summary) : current.friend_summary,
    friend_fact_extraction: updates.friend_fact_extraction ? sanitizeFeatureConfig(updates.friend_fact_extraction, current.friend_fact_extraction) : current.friend_fact_extraction,
    intent_detection: updates.intent_detection ? sanitizeFeatureConfig(updates.intent_detection, current.intent_detection) : current.intent_detection,
    news_filter: updates.news_filter ? sanitizeFeatureConfig(updates.news_filter, current.news_filter) : current.news_filter,
    research_synthesis: updates.research_synthesis ? sanitizeFeatureConfig(updates.research_synthesis, current.research_synthesis) : current.research_synthesis,
    session_gap_analysis: updates.session_gap_analysis ? sanitizeFeatureConfig(updates.session_gap_analysis, current.session_gap_analysis) : current.session_gap_analysis,
    knowledge_verification: updates.knowledge_verification ? sanitizeFeatureConfig(updates.knowledge_verification, current.knowledge_verification) : current.knowledge_verification,
    supervisor_critique: updates.supervisor_critique ? sanitizeFeatureConfig(updates.supervisor_critique, current.supervisor_critique) : current.supervisor_critique,
  };

  await query(
    `UPDATE users
     SET settings = settings || jsonb_build_object('backgroundLlmModels', $1::jsonb)
     WHERE id = $2`,
    [JSON.stringify(merged), userId]
  );

  return merged;
}
