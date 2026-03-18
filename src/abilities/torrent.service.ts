import { config } from '../config/index.js';
import logger from '../utils/logger.js';

const PROWLARR_URL = config.prowlarr?.url || 'http://10.0.0.2:9696';
const PROWLARR_KEY = config.prowlarr?.apiKey || '';
const PROWLARR_DL_CLIENT_ID = config.prowlarr?.downloadClientId || 1;
const TRANSMISSION_URL = config.transmission?.url || 'http://10.0.0.2:9091/transmission/rpc';

let transmissionSessionId = '';

// -- Prowlarr --

interface ProwlarrResult {
  title: string;
  size: number;
  sizeHuman: string;
  seeders: number;
  leechers: number;
  indexer: string;
  guid: string;
  indexerId: number;
  category: string;
}

async function prowlarrFetch(method: string, path: string, body?: unknown): Promise<any> {
  const resp = await fetch(`${PROWLARR_URL}${path}`, {
    method,
    headers: {
      'X-Api-Key': PROWLARR_KEY,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Prowlarr ${method} ${path} failed: HTTP ${resp.status} - ${text.slice(0, 200)}`);
  }

  return resp.json();
}

export async function searchProwlarr(query: string): Promise<ProwlarrResult[]> {
  if (!PROWLARR_KEY) throw new Error('Prowlarr API key not configured');

  logger.info('Prowlarr search', { query });
  const params = new URLSearchParams({ query, type: 'search' });
  const results = await prowlarrFetch('GET', `/api/v1/search?${params}`);

  if (!Array.isArray(results)) return [];

  const maxSize = 15 * 1024 * 1024 * 1024; // 15GB
  const filtered: ProwlarrResult[] = [];

  Array.from(results as any[]).forEach((r: any) => {
    const size = r.size || 0;
    if (size > maxSize || size <= 0) return;

    const cats: number[] = (r.categories || []).map((c: any) => c.id);
    let category = 'other';
    Array.from(cats).forEach((catId: number) => {
      if (catId >= 2000 && catId <= 2999) category = 'movie';
      if (catId >= 5000 && catId <= 5999) category = 'series';
      if (catId >= 3000 && catId <= 3999) category = 'audio';
      if (catId >= 4000 && catId <= 4999) category = 'pc';
      if (catId >= 6000 && catId <= 6999) category = 'xxx';
      if (catId >= 7000 && catId <= 7999) category = 'other';
    });

    const sizeGB = size / (1024 * 1024 * 1024);
    filtered.push({
      title: r.title || '',
      size,
      sizeHuman: sizeGB >= 1 ? `${sizeGB.toFixed(2)} GB` : `${(size / (1024 * 1024)).toFixed(0)} MB`,
      seeders: r.seeders || 0,
      leechers: r.leechers || 0,
      indexer: r.indexer || '',
      guid: r.guid || '',
      indexerId: r.indexerId || 0,
      category,
    });
  });

  // Sort by seeders descending
  filtered.sort((a, b) => b.seeders - a.seeders);

  logger.info('Prowlarr search results', { query, total: results.length, filtered: filtered.length });
  return filtered;
}

export async function grabTorrent(guid: string, indexerId: number): Promise<void> {
  if (!PROWLARR_KEY) throw new Error('Prowlarr API key not configured');

  logger.info('Prowlarr grab', { guid, indexerId });
  await prowlarrFetch('POST', '/api/v1/search', {
    guid,
    indexerId,
    downloadClientId: PROWLARR_DL_CLIENT_ID,
  });
  logger.info('Prowlarr grab sent to Transmission', { guid });
}

// -- Transmission --

interface TransmissionTorrent {
  id: number;
  name: string;
  percentDone: number;
  rateDownload: number;
  rateUpload: number;
  eta: number;
  status: number;
  totalSize: number;
  sizeWhenDone: number;
  downloadDir: string;
  files: Array<{ name: string; length: number; bytesCompleted: number }>;
}

interface TransmissionFile {
  name: string;
  size: string;
  fileId: string;
  type: 'video' | 'audio' | 'other';
}

async function transmissionRPC(method: string, args: Record<string, unknown> = {}): Promise<any> {
  const payload = JSON.stringify({ method, arguments: args });

  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await fetch(TRANSMISSION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Transmission-Session-Id': transmissionSessionId,
      },
      body: payload,
      signal: AbortSignal.timeout(10000),
    });

    if (resp.status === 409) {
      const newId = resp.headers.get('x-transmission-session-id');
      if (newId) transmissionSessionId = newId;
      continue;
    }

    if (!resp.ok) {
      throw new Error(`Transmission RPC failed: HTTP ${resp.status}`);
    }

    const data = await resp.json() as { result: string; arguments: any };
    if (data.result !== 'success') {
      throw new Error(`Transmission RPC error: ${data.result}`);
    }
    return data.arguments;
  }

  throw new Error('Transmission: failed to obtain session ID');
}

// Transmission status codes
const STATUS_LABELS: Record<number, string> = {
  0: 'stopped',
  1: 'queued to verify',
  2: 'verifying',
  3: 'queued to download',
  4: 'downloading',
  5: 'queued to seed',
  6: 'seeding',
};

const MEDIA_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.mp3', '.flac', '.wav', '.m4a', '.ogg', '.webm', '.wmv'];
const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.m4a', '.ogg'];

function classifyFile(name: string): 'video' | 'audio' | 'other' {
  const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
  if (MEDIA_EXTENSIONS.includes(ext)) return 'video';
  return 'other';
}

export async function getTransmissionTorrents(): Promise<Array<{
  id: number;
  name: string;
  percentDone: number;
  rateDownload: string;
  rateUpload: string;
  eta: string;
  status: string;
  totalSize: string;
  downloadDir: string;
  mediaFiles: TransmissionFile[];
}>> {
  const result = await transmissionRPC('torrent-get', {
    fields: ['id', 'name', 'percentDone', 'rateDownload', 'rateUpload', 'eta', 'status', 'totalSize', 'sizeWhenDone', 'downloadDir', 'files'],
  });

  const torrents: TransmissionTorrent[] = result.torrents || [];

  return torrents.map(t => {
    const mediaFiles: TransmissionFile[] = [];
    const isComplete = t.percentDone >= 1;

    if (isComplete && t.files) {
      Array.from(t.files).forEach((f: { name: string; length: number }) => {
        const type = classifyFile(f.name);
        if (type !== 'other') {
          const fullPath = `${t.downloadDir}/${f.name}`;
          mediaFiles.push({
            name: f.name,
            size: formatSize(f.length),
            fileId: Buffer.from(fullPath).toString('base64url'),
            type,
          });
        }
      });
    }

    return {
      id: t.id,
      name: t.name,
      percentDone: Math.round(t.percentDone * 100 * 10) / 10,
      rateDownload: formatSpeed(t.rateDownload),
      rateUpload: formatSpeed(t.rateUpload),
      eta: t.eta > 0 ? formatEta(t.eta) : t.eta === 0 ? 'done' : '-',
      status: STATUS_LABELS[t.status] || `unknown(${t.status})`,
      totalSize: formatSize(t.sizeWhenDone || t.totalSize),
      downloadDir: t.downloadDir || '',
      mediaFiles,
    };
  });
}

export async function removeTorrent(id: number, deleteData: boolean): Promise<void> {
  await transmissionRPC('torrent-remove', {
    ids: [id],
    'delete-local-data': deleteData,
  });
  logger.info('Transmission torrent removed', { id, deleteData });
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '0 KB/s';
  const kbps = bytesPerSec / 1024;
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} MB/s`;
  return `${Math.round(kbps)} KB/s`;
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}
