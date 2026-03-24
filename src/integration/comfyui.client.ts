/**
 * ComfyUI HTTP client for Flux 2 Klein 4B GGUF image generation.
 *
 * 13-node workflow: UnetLoaderGGUF -> CLIPLoader -> VAELoader -> CLIPTextEncode
 * -> RandomNoise -> BasicGuider -> BasicScheduler -> SamplerCustomAdvanced
 * -> VAEDecode -> SaveImage (+ EmptySD3LatentImage + FluxGuidance)
 */

import { config } from '../config/index.js';
import logger from '../utils/logger.js';

export interface GenerateOptions {
  prompt: string;
  width?: number;
  height?: number;
  steps?: number;
  guidance?: number;
  seed?: number;
}

export interface GenerateResult {
  buffer: Buffer;
  filename: string;
}

// Flux 2 Klein 4B GGUF workflow template
function buildWorkflow(options: GenerateOptions): Record<string, unknown> {
  const {
    prompt,
    width = 1024,
    height = 1024,
    steps = config.comfyui?.defaultSteps ?? 20,
    guidance = config.comfyui?.defaultGuidance ?? 3.5,
    seed = Math.floor(Math.random() * 2 ** 32),
  } = options;

  return {
    // Node 1: UnetLoaderGGUF - load the Flux 2 Klein model
    '1': {
      class_type: 'UnetLoaderGGUF',
      inputs: {
        unet_name: 'flux2-klein-4b.q4_k.gguf',
      },
    },
    // Node 2: CLIPLoader - load Qwen 3 4B for text encoding
    '2': {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: 'qwen_3_4b.safetensors',
        type: 'flux2',
      },
    },
    // Node 3: CLIPTextEncode - encode the prompt
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: prompt,
        clip: ['2', 0],
      },
    },
    // Node 4: FluxGuidance - apply guidance scale
    '4': {
      class_type: 'FluxGuidance',
      inputs: {
        guidance: guidance,
        conditioning: ['3', 0],
      },
    },
    // Node 5: VAELoader - load Flux 2 VAE
    '5': {
      class_type: 'VAELoader',
      inputs: {
        vae_name: 'flux2-vae.safetensors',
      },
    },
    // Node 6: EmptySD3LatentImage - create latent at target resolution
    '6': {
      class_type: 'EmptySD3LatentImage',
      inputs: {
        width: width,
        height: height,
        batch_size: 1,
      },
    },
    // Node 7: BasicGuider - combine model + conditioning
    '7': {
      class_type: 'BasicGuider',
      inputs: {
        model: ['1', 0],
        conditioning: ['4', 0],
      },
    },
    // Node 8: KSamplerSelect - euler sampler
    '8': {
      class_type: 'KSamplerSelect',
      inputs: {
        sampler_name: 'euler',
      },
    },
    // Node 9: BasicScheduler - steps + denoise config
    '9': {
      class_type: 'BasicScheduler',
      inputs: {
        scheduler: 'simple',
        steps: steps,
        denoise: 1.0,
        model: ['1', 0],
      },
    },
    // Node 10: RandomNoise - seed
    '10': {
      class_type: 'RandomNoise',
      inputs: {
        noise_seed: seed,
      },
    },
    // Node 11: SamplerCustomAdvanced - run the sampler
    '11': {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['10', 0],
        guider: ['7', 0],
        sampler: ['8', 0],
        sigmas: ['9', 0],
        latent_image: ['6', 0],
      },
    },
    // Node 12: VAEDecode - decode latent to pixels
    '12': {
      class_type: 'VAEDecode',
      inputs: {
        samples: ['11', 0],
        vae: ['5', 0],
      },
    },
    // Node 13: SaveImage - write output
    '13': {
      class_type: 'SaveImage',
      inputs: {
        filename_prefix: 'luna',
        images: ['12', 0],
      },
    },
  };
}

const baseUrl = (): string => config.comfyui?.url ?? 'http://10.0.0.30:8188';
const timeoutMs = (): number => config.comfyui?.timeoutMs ?? 30000;

/**
 * Queue a workflow for execution. Returns the prompt_id for polling.
 */
async function queuePrompt(workflow: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${baseUrl()}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
    signal: AbortSignal.timeout(timeoutMs()),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ComfyUI /prompt failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { prompt_id: string };
  return data.prompt_id;
}

/**
 * Poll /history/{promptId} until outputs are available.
 */
async function pollForCompletion(promptId: string): Promise<{ filename: string; subfolder: string; type: string }> {
  const interval = config.comfyui?.pollIntervalMs ?? 5000;
  const maxAttempts = config.comfyui?.pollMaxAttempts ?? 60;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, interval));

    const res = await fetch(`${baseUrl()}/history/${promptId}`, {
      signal: AbortSignal.timeout(timeoutMs()),
    });

    if (!res.ok) continue;

    const history = await res.json() as Record<string, { outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }> }>;
    const entry = history[promptId];

    if (entry?.outputs) {
      // Find the first output node with images
      const outputKeys = Object.keys(entry.outputs);
      for (const key of outputKeys) {
        const images = entry.outputs[key]?.images;
        if (images && images.length > 0) {
          return images[0];
        }
      }
    }
  }

  throw new Error(`ComfyUI generation timed out after ${maxAttempts * interval / 1000}s`);
}

/**
 * Download a rendered image from ComfyUI.
 */
async function fetchImage(filename: string, subfolder: string, type: string): Promise<Buffer> {
  const params = new URLSearchParams({ filename, subfolder, type });
  const res = await fetch(`${baseUrl()}/view?${params}`, {
    signal: AbortSignal.timeout(timeoutMs()),
  });

  if (!res.ok) {
    throw new Error(`ComfyUI /view failed (${res.status})`);
  }

  return Buffer.from(await res.arrayBuffer());
}

/**
 * Full generation pipeline: build workflow -> queue -> poll -> download.
 */
export async function generateImage(options: GenerateOptions): Promise<GenerateResult> {
  const startTime = Date.now();
  logger.info('ComfyUI generation starting', {
    promptLength: options.prompt.length,
    width: options.width ?? 1024,
    height: options.height ?? 1024,
    steps: options.steps ?? config.comfyui?.defaultSteps ?? 20,
  });

  const workflow = buildWorkflow(options);
  const promptId = await queuePrompt(workflow);
  logger.info('ComfyUI prompt queued', { promptId });

  const imageInfo = await pollForCompletion(promptId);
  logger.info('ComfyUI generation complete', { promptId, filename: imageInfo.filename, durationMs: Date.now() - startTime });

  const buffer = await fetchImage(imageInfo.filename, imageInfo.subfolder, imageInfo.type);

  return { buffer, filename: imageInfo.filename };
}

export default { generateImage };
