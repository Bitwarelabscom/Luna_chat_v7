import { query, queryOne } from '../db/postgres.js';
import type { ProviderId } from '../llm/types.js';
import { gpuOrchestrator } from '../gpu/gpu-orchestrator.service.js';

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
  | 'supervisor_critique'
  | 'music_trend_analysis'
  | 'query_refinement'
  | 'domain_evaluation'
  | 'ceo_org_execution'
  | 'edge_classification'
  | 'trading_analysis'
  | 'luna_affect_analysis';

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
  'groq',
  'anthropic',
  'xai',
  'openrouter',
  'ollama',
  'ollama_secondary',
  'ollama_tertiary',
  'ollama_micro',
  'google',
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
  {
    id: 'music_trend_analysis',
    label: 'Music Trend Analysis',
    description: 'Analyzes scraped music trends to identify emerging genres and market signals.',
  },
  {
    id: 'query_refinement',
    label: 'Query Refinement',
    description: 'Refines search queries when initial autonomous research fails to find trusted sources.',
  },
  {
    id: 'domain_evaluation',
    label: 'Domain Evaluation',
    description: 'Evaluates unknown domains found during research for trust score provisioning.',
  },
  {
    id: 'ceo_org_execution',
    label: 'CEO Org Execution',
    description: 'Runs department tasks, weekly planning, and daily checks for CEO organization system.',
  },
  {
    id: 'edge_classification',
    label: 'Edge Classification',
    description: 'Classifies graph memory edges into semantic types (interested_in, working_on, etc.).',
  },
  {
    id: 'trading_analysis',
    label: 'Trading Analysis',
    description: 'LLM analysis of crypto market intelligence for Luna AI trading strategy decisions.',
  },
  {
    id: 'luna_affect_analysis',
    label: 'Luna Affect Analysis',
    description: 'Analyzes Luna\'s own responses for internal mood/affect state and style calibration.',
  },
];

// Background model routing:
// - Chat-triggered (groq): mood_analysis, intent_detection, edge_classification, query_refinement, domain_evaluation
// - Background (openrouter free): news_filter, friend_fact_extraction, knowledge_verification, music_trend_analysis,
//   context_summary, memory_curation, friend_summary, research_synthesis, session_gap_analysis, supervisor_critique, ceo_org_execution
// - Trading -> xai: trading_analysis
export const DEFAULT_BACKGROUND_LLM_SETTINGS: BackgroundLlmSettings = {
  // Chat-triggered: always groq (fastest)
  mood_analysis: {
    primary: { provider: 'groq', model: 'llama-3.1-8b-instant' },
    fallback: { provider: 'openrouter', model: 'qwen/qwen3-4b' },
  },
  intent_detection: {
    primary: { provider: 'groq', model: 'llama-3.1-8b-instant' },
    fallback: { provider: 'openrouter', model: 'qwen/qwen3-4b' },
  },
  edge_classification: {
    primary: { provider: 'groq', model: 'llama-3.1-8b-instant' },
    fallback: { provider: 'openrouter', model: 'qwen/qwen3-4b' },
  },
  domain_evaluation: {
    primary: { provider: 'groq', model: 'llama-3.1-8b-instant' },
    fallback: { provider: 'openrouter', model: 'qwen/qwen3-4b' },
  },
  query_refinement: {
    primary: { provider: 'groq', model: 'llama-3.1-8b-instant' },
    fallback: { provider: 'openrouter', model: 'qwen/qwen3-4b' },
  },
  // Background features: openrouter primary (paid, no TPM issues), groq fallback
  news_filter: {
    primary: { provider: 'openrouter', model: 'qwen/qwen3-4b:free' },
    fallback: { provider: 'groq', model: 'llama-3.1-8b-instant' },
  },
  friend_fact_extraction: {
    primary: { provider: 'openrouter', model: 'qwen/qwen3-4b:free' },
    fallback: { provider: 'groq', model: 'llama-3.1-8b-instant' },
  },
  knowledge_verification: {
    primary: { provider: 'openrouter', model: 'qwen/qwen3-4b:free' },
    fallback: { provider: 'groq', model: 'llama-3.1-8b-instant' },
  },
  music_trend_analysis: {
    primary: { provider: 'openrouter', model: 'qwen/qwen3-4b:free' },
    fallback: { provider: 'groq', model: 'llama-3.1-8b-instant' },
  },
  context_summary: {
    primary: { provider: 'openrouter', model: 'qwen/qwen3-4b:free' },
    fallback: { provider: 'groq', model: 'llama-3.1-8b-instant' },
  },
  memory_curation: {
    primary: { provider: 'openrouter', model: 'qwen/qwen3-4b:free' },
    fallback: { provider: 'groq', model: 'llama-3.1-8b-instant' },
  },
  friend_summary: {
    primary: { provider: 'openrouter', model: 'qwen/qwen3-4b:free' },
    fallback: { provider: 'groq', model: 'llama-3.1-8b-instant' },
  },
  research_synthesis: {
    primary: { provider: 'openrouter', model: 'qwen/qwen3-4b:free' },
    fallback: { provider: 'groq', model: 'llama-3.1-8b-instant' },
  },
  session_gap_analysis: {
    primary: { provider: 'openrouter', model: 'qwen/qwen3-4b:free' },
    fallback: { provider: 'groq', model: 'llama-3.1-8b-instant' },
  },
  supervisor_critique: {
    primary: { provider: 'openrouter', model: 'qwen/qwen3-4b:free' },
    fallback: { provider: 'groq', model: 'llama-3.1-8b-instant' },
  },
  ceo_org_execution: {
    primary: { provider: 'openrouter', model: 'qwen/qwen3-4b:free' },
    fallback: { provider: 'groq', model: 'llama-3.1-8b-instant' },
  },
  // Quality-critical: always xai
  trading_analysis: {
    primary: { provider: 'xai', model: 'grok-4-1-fast' },
    fallback: { provider: 'openrouter', model: 'qwen/qwen3-4b' },
  },
  // Luna cognitive: low-token affect analysis
  luna_affect_analysis: {
    primary: { provider: 'groq', model: 'llama-3.1-8b-instant' },
    fallback: { provider: 'openrouter', model: 'qwen/qwen3-4b' },
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
    music_trend_analysis: sanitizeFeatureConfig(obj.music_trend_analysis, DEFAULT_BACKGROUND_LLM_SETTINGS.music_trend_analysis),
    query_refinement: sanitizeFeatureConfig(obj.query_refinement, DEFAULT_BACKGROUND_LLM_SETTINGS.query_refinement),
    domain_evaluation: sanitizeFeatureConfig(obj.domain_evaluation, DEFAULT_BACKGROUND_LLM_SETTINGS.domain_evaluation),
    ceo_org_execution: sanitizeFeatureConfig(obj.ceo_org_execution, DEFAULT_BACKGROUND_LLM_SETTINGS.ceo_org_execution),
    edge_classification: sanitizeFeatureConfig(obj.edge_classification, DEFAULT_BACKGROUND_LLM_SETTINGS.edge_classification),
    trading_analysis: sanitizeFeatureConfig(obj.trading_analysis, DEFAULT_BACKGROUND_LLM_SETTINGS.trading_analysis),
    luna_affect_analysis: sanitizeFeatureConfig(obj.luna_affect_analysis, DEFAULT_BACKGROUND_LLM_SETTINGS.luna_affect_analysis),
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
  const base = settings[feature];

  // GPU orchestrator dynamic override: during TTS mode, reroute ollama_tertiary tasks to ollama_secondary
  const override = gpuOrchestrator.getBackgroundProvider(feature);
  if (override) {
    return {
      primary: { provider: override.provider, model: override.model },
      fallback: base.fallback,
    };
  }

  return base;
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
    music_trend_analysis: updates.music_trend_analysis ? sanitizeFeatureConfig(updates.music_trend_analysis, current.music_trend_analysis) : current.music_trend_analysis,
    query_refinement: updates.query_refinement ? sanitizeFeatureConfig(updates.query_refinement, current.query_refinement) : current.query_refinement,
    domain_evaluation: updates.domain_evaluation ? sanitizeFeatureConfig(updates.domain_evaluation, current.domain_evaluation) : current.domain_evaluation,
    ceo_org_execution: updates.ceo_org_execution ? sanitizeFeatureConfig(updates.ceo_org_execution, current.ceo_org_execution) : current.ceo_org_execution,
    edge_classification: updates.edge_classification ? sanitizeFeatureConfig(updates.edge_classification, current.edge_classification) : current.edge_classification,
    trading_analysis: updates.trading_analysis ? sanitizeFeatureConfig(updates.trading_analysis, current.trading_analysis) : current.trading_analysis,
    luna_affect_analysis: updates.luna_affect_analysis ? sanitizeFeatureConfig(updates.luna_affect_analysis, current.luna_affect_analysis) : current.luna_affect_analysis,
  };

  await query(
    `UPDATE users
     SET settings = settings || jsonb_build_object('backgroundLlmModels', $1::jsonb)
     WHERE id = $2`,
    [JSON.stringify(merged), userId]
  );

  return merged;
}
