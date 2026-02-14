import { execFile } from 'child_process';
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import { config } from '../config/index.js';

export interface DownloadJob {
  id: string;
  videoId: string;
  title: string;
  format: 'video' | 'audio';
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  progress?: string;
  filePath?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

const downloads = new Map<string, DownloadJob>();
let downloadCounter = 0;

function getVideoPath(): string {
  return '/mnt/data/media/Videos';
}

function getMusicPath(): string {
  return '/mnt/data/media/Music';
}

/**
 * Sanitize a filename to prevent path traversal and invalid characters
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '_')  // Remove invalid file chars
    .replace(/\.\./g, '_')           // Prevent path traversal
    .replace(/^\./g, '_')            // No hidden files
    .trim()
    .substring(0, 200);              // Reasonable length limit
}

async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    logger.error('Failed to create directory', { dirPath, error: (error as Error).message });
    throw error;
  }
}

function generateDownloadId(): string {
  downloadCounter++;
  return `dl_${Date.now()}_${downloadCounter}`;
}

function getCommonArgs(): string[] {
  const args: string[] = [
    '--no-playlist',
    '--no-overwrites',
    '--extractor-args', 'youtube:player_client=web',
    '--js-runtimes', 'node',
    '--remote-components', 'ejs:github',
  ];

  const cookiesPath = config.ytdlp?.cookiesPath;
  const writableCookiesPath = '/tmp/yt-dlp-cookies.txt';

  if (cookiesPath && existsSync(cookiesPath)) {
    try {
      // Copy cookies to writable location so yt-dlp can update them
      const fs = require('fs');
      const content = fs.readFileSync(cookiesPath, 'utf-8');
      fs.writeFileSync(writableCookiesPath, content);
      args.push('--cookies', writableCookiesPath);
      logger.info('Using cookies for yt-dlp', { cookiesPath, writableCookiesPath });
    } catch (error) {
      logger.warn('Could not setup cookies, proceeding without', { error: (error as Error).message });
    }
  }

  return args;
}

export async function downloadVideo(videoId: string, title: string): Promise<DownloadJob> {
  const id = generateDownloadId();
  const outputDir = getVideoPath();
  await ensureDirectory(outputDir);

  const sanitizedTitle = sanitizeFilename(title);
  const outputTemplate = path.join(outputDir, `${sanitizedTitle}.%(ext)s`);
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  const job: DownloadJob = {
    id,
    videoId,
    title,
    format: 'video',
    status: 'downloading',
    startedAt: Date.now(),
  };
  downloads.set(id, job);

  logger.info('Starting video download', { id, videoId, title, outputDir });

  // Run yt-dlp in background
  const args = [
    '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '--merge-output-format', 'mp4',
    '-o', outputTemplate,
    ...getCommonArgs(),
    url,
  ];

  runDownload(id, args);
  return job;
}

export async function downloadAudio(videoId: string, title: string): Promise<DownloadJob> {
  const id = generateDownloadId();
  const outputDir = getMusicPath();
  await ensureDirectory(outputDir);

  const sanitizedTitle = sanitizeFilename(title);
  const outputTemplate = path.join(outputDir, `${sanitizedTitle}.%(ext)s`);
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  const job: DownloadJob = {
    id,
    videoId,
    title,
    format: 'audio',
    status: 'downloading',
    startedAt: Date.now(),
  };
  downloads.set(id, job);

  logger.info('Starting audio download', { id, videoId, title, outputDir });

  const args = [
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '0',
    '-o', outputTemplate,
    ...getCommonArgs(),
    url,
  ];

  runDownload(id, args);
  return job;
}

function runDownload(id: string, args: string[]): void {
  const job = downloads.get(id);
  if (!job) return;

  execFile('/usr/bin/yt-dlp', args, { timeout: 600000 }, (error, stdout, stderr) => {
    const updatedJob = downloads.get(id);
    if (!updatedJob) return;

    if (error) {
      updatedJob.status = 'failed';
      updatedJob.error = stderr || error.message;
      updatedJob.completedAt = Date.now();
      logger.error('Download failed', { id, error: updatedJob.error });
    } else {
      updatedJob.status = 'completed';
      updatedJob.completedAt = Date.now();
      // Try to extract the output file path from stdout
      const destMatch = stdout.match(/\[Merger\] Merging formats into "(.+?)"|Destination: (.+?)$/m);
      if (destMatch) {
        updatedJob.filePath = destMatch[1] || destMatch[2];
      }
      logger.info('Download completed', { id, filePath: updatedJob.filePath, duration: updatedJob.completedAt - updatedJob.startedAt });
    }
  });
}

export function getDownloadStatus(downloadId: string): DownloadJob | null {
  return downloads.get(downloadId) || null;
}

export function getAllDownloads(): DownloadJob[] {
  return Array.from(downloads.values())
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 20);
}
