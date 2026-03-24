import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import type { BackgroundLlmFeature } from '../settings/background-llm-settings.service.js';
import type { ProviderId } from '../llm/types.js';

export type GpuMode = 'normal' | 'tts' | 'transitioning';

export interface GpuProviderOverride {
  provider: ProviderId;
  model: string;
}

// Features that always use groq (chat-triggered, need speed)
const CHAT_TRIGGERED_FEATURES: BackgroundLlmFeature[] = [
  'mood_analysis',
  'intent_detection',
  'edge_classification',
  'query_refinement',
  'domain_evaluation',
];

// Features that always use xai (need quality)
const XAI_FEATURES: BackgroundLlmFeature[] = [
  'trading_analysis',
];

// Background features now use groq defaults - no GPU routing needed

class GpuOrchestrator {
  private mode: GpuMode = 'normal';
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private mutex = false;

  get enabled(): boolean {
    return config.gpuOrchestrator?.enabled === true;
  }

  private get agentUrl(): string {
    return config.gpuOrchestrator?.agentUrl || 'http://10.0.0.30:9876';
  }

  private get idleTimeoutMs(): number {
    return config.gpuOrchestrator?.idleTimeoutMs || 300000;
  }

  private get healthCheckTimeoutMs(): number {
    return config.gpuOrchestrator?.healthCheckTimeoutMs || 15000;
  }

  getGpuMode(): GpuMode {
    return this.mode;
  }

  /**
   * Ensure Orpheus TTS is ready. Transitions to TTS mode if needed.
   * Blocks until Orpheus health check passes or times out.
   */
  async ensureOrpheusReady(): Promise<void> {
    if (!this.enabled) return;

    if (this.mode === 'tts') {
      this.resetIdleTimer();
      return;
    }

    if (this.mode === 'transitioning') {
      // Wait for current transition to complete
      await this.waitForTransition();
      if ((this.mode as GpuMode) === 'tts') {
        this.resetIdleTimer();
        return;
      }
    }

    await this.transitionToTts();
  }

  /**
   * Record TTS activity - resets the idle timer.
   */
  recordTtsActivity(): void {
    if (!this.enabled) return;
    if (this.mode === 'tts') {
      this.resetIdleTimer();
    }
  }

  /**
   * Get provider override for a background feature based on current GPU mode.
   * Returns null if the feature should use its default provider (groq/xai).
   */
  getBackgroundProvider(feature: BackgroundLlmFeature): GpuProviderOverride | null {
    if (!this.enabled) return null;

    // Chat-triggered features always use groq defaults
    if (CHAT_TRIGGERED_FEATURES.includes(feature)) return null;

    // Trading always uses xai defaults
    if (XAI_FEATURES.includes(feature)) return null;

    // Background features use groq defaults - no GPU dependency, no override needed
    return null;
  }

  /**
   * Initialize on startup - detect current state.
   */
  async initialize(): Promise<void> {
    if (!this.enabled) {
      logger.info('GPU orchestrator disabled');
      return;
    }

    try {
      const status = await this.fetchJson(`${this.agentUrl}/orpheus/status`);
      if (status.running) {
        this.mode = 'tts';
        this.resetIdleTimer();
        logger.info('GPU orchestrator initialized in TTS mode (Orpheus already running)');
      } else {
        this.mode = 'normal';
        logger.info('GPU orchestrator initialized in normal mode');
      }
    } catch (err) {
      this.mode = 'normal';
      logger.warn('GPU orchestrator: agent unreachable on init, defaulting to normal mode', {
        error: (err as Error).message,
      });
    }
  }

  /**
   * Cleanup on shutdown.
   */
  shutdown(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  // -- Private --

  private async transitionToTts(): Promise<void> {
    if (this.mutex) return;
    this.mutex = true;
    this.mode = 'transitioning';

    try {
      // 1. LFM now on OpenRouter - no local model to unload

      // 2. Start Orpheus containers
      logger.info('GPU orchestrator: starting Orpheus containers...');
      await this.fetchJson(`${this.agentUrl}/orpheus/start`, { method: 'POST' });

      // 3. Poll health
      logger.info('GPU orchestrator: waiting for Orpheus health...');
      await this.pollHealth();

      this.mode = 'tts';
      this.resetIdleTimer();
      logger.info('GPU orchestrator: transitioned to TTS mode');
    } catch (err) {
      logger.error('GPU orchestrator: transition to TTS failed', {
        error: (err as Error).message,
      });
      // Revert to normal - Orpheus may not have started
      this.mode = 'normal';
      throw err;
    } finally {
      this.mutex = false;
    }
  }

  private async transitionToNormal(): Promise<void> {
    if (this.mutex) return;
    this.mutex = true;

    try {
      logger.info('GPU orchestrator: stopping Orpheus (idle timeout)...');
      await this.fetchJson(`${this.agentUrl}/orpheus/stop`, { method: 'POST' });
      this.mode = 'normal';
      logger.info('GPU orchestrator: returned to normal mode');
    } catch (err) {
      logger.error('GPU orchestrator: transition to normal failed', {
        error: (err as Error).message,
      });
      // Stay in TTS mode, will retry on next idle timeout
    } finally {
      this.mutex = false;
    }
  }

  private async pollHealth(): Promise<void> {
    const orpheusUrl = config.orpheus?.url || 'http://10.0.0.30:5005';
    const deadline = Date.now() + this.healthCheckTimeoutMs;

    while (Date.now() < deadline) {
      try {
        const resp = await fetch(`${orpheusUrl}/v1/audio/voices`, {
          signal: AbortSignal.timeout(3000),
        });
        if (resp.ok) return;
      } catch {
        // Not ready yet
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    throw new Error('Orpheus health check timed out');
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.transitionToNormal().catch(err => {
        logger.error('GPU orchestrator: idle transition failed', {
          error: (err as Error).message,
        });
      });
    }, this.idleTimeoutMs);
  }

  private async waitForTransition(): Promise<void> {
    const deadline = Date.now() + 20000;
    while (this.mode === 'transitioning' && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  private async fetchJson(url: string, options?: RequestInit): Promise<any> {
    const resp = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      signal: AbortSignal.timeout(30000),
    });
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

export const gpuOrchestrator = new GpuOrchestrator();
