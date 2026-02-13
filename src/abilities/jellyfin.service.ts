import logger from '../utils/logger.js';
import { config } from '../config/index.js';

export interface JellyfinItem {
  id: string;
  name: string;
  type: 'Audio' | 'Video' | 'Movie' | 'Series' | 'Episode' | 'MusicAlbum' | 'MusicVideo';
  artist?: string;
  album?: string;
  year?: number;
  durationTicks?: number;
  imageUrl?: string;
  streamUrl?: string;
}

interface JellyfinAuth {
  token: string;
  userId: string;
  serverId: string;
}

let cachedAuth: JellyfinAuth | null = null;

function getJellyfinConfig() {
  return config.jellyfin;
}

function isEnabled(): boolean {
  const jf = getJellyfinConfig();
  return !!(jf?.enabled && jf.url);
}

function getAuthHeader(): string {
  return 'MediaBrowser Client="Luna Chat", Device="Server", DeviceId="luna-chat-server", Version="1.0.0"';
}

async function authenticate(): Promise<JellyfinAuth> {
  if (cachedAuth) return cachedAuth;

  const jf = getJellyfinConfig();
  if (!jf?.url || !jf.username) {
    throw new Error('Jellyfin not configured');
  }

  const url = `${jf.url}/Users/AuthenticateByName`;
  logger.info('Authenticating with Jellyfin', { url: jf.url, username: jf.username });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Authorization': getAuthHeader(),
    },
    body: JSON.stringify({
      Username: jf.username,
      Pw: jf.password || '',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Jellyfin auth failed (${response.status}): ${text}`);
  }

  const data = await response.json() as any;
  cachedAuth = {
    token: data.AccessToken,
    userId: data.User.Id,
    serverId: data.ServerId,
  };

  logger.info('Jellyfin authenticated', { userId: cachedAuth.userId, serverId: cachedAuth.serverId });
  return cachedAuth;
}

async function jellyfinFetch(path: string, _options: RequestInit = {}): Promise<any> {
  if (!isEnabled()) throw new Error('Jellyfin is not enabled');

  let auth = await authenticate();
  const jf = getJellyfinConfig()!;
  const url = `${jf.url}${path}`;

  const makeRequest = async (token: string) => {
    return fetch(url, {
      ..._options,
      headers: {
        'Content-Type': 'application/json',
        'X-Emby-Authorization': `${getAuthHeader()}, Token="${token}"`,
        ...(_options.headers || {}),
      },
    });
  };

  let response = await makeRequest(auth.token);

  // Re-auth on 401
  if (response.status === 401) {
    logger.warn('Jellyfin token expired, re-authenticating');
    cachedAuth = null;
    auth = await authenticate();
    response = await makeRequest(auth.token);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Jellyfin API error (${response.status}): ${text}`);
  }

  return response.json();
}

function buildImageUrl(itemId: string, imageTag?: string): string {
  const jf = getJellyfinConfig();
  if (!jf?.url) return '';
  const tag = imageTag ? `&tag=${imageTag}` : '';
  return `${jf.url}/Items/${itemId}/Images/Primary?maxWidth=300${tag}`;
}

function buildStreamUrl(item: any): string {
  const jf = getJellyfinConfig();
  if (!jf?.url || !cachedAuth) return '';

  const token = cachedAuth.token;
  const type = item.Type;

  if (type === 'Audio' || type === 'MusicAlbum') {
    return `${jf.url}/Audio/${item.Id}/universal?api_key=${token}&audioCodec=mp3`;
  }
  // Video types
  return `${jf.url}/Videos/${item.Id}/stream?static=true&api_key=${token}`;
}

function mapItemType(type: string): JellyfinItem['type'] {
  const typeMap: Record<string, JellyfinItem['type']> = {
    Audio: 'Audio',
    MusicAlbum: 'MusicAlbum',
    MusicVideo: 'MusicVideo',
    Movie: 'Movie',
    Series: 'Series',
    Episode: 'Episode',
    Video: 'Video',
  };
  return typeMap[type] || 'Video';
}

function mapItem(item: any): JellyfinItem {
  const imageTag = item.ImageTags?.Primary;
  return {
    id: item.Id,
    name: item.Name,
    type: mapItemType(item.Type),
    artist: item.AlbumArtist || item.Artists?.[0],
    album: item.Album,
    year: item.ProductionYear,
    durationTicks: item.RunTimeTicks,
    imageUrl: imageTag ? buildImageUrl(item.Id, imageTag) : undefined,
    streamUrl: buildStreamUrl(item),
  };
}

export async function searchMedia(
  query: string,
  mediaType: 'audio' | 'video' | 'all' = 'all',
  limit: number = 5
): Promise<JellyfinItem[]> {
  if (!isEnabled()) return [];

  try {
    const auth = await authenticate();

    const includeTypes: string[] = [];
    if (mediaType === 'audio' || mediaType === 'all') {
      includeTypes.push('Audio', 'MusicAlbum');
    }
    if (mediaType === 'video' || mediaType === 'all') {
      includeTypes.push('Movie', 'Series', 'Episode', 'Video', 'MusicVideo');
    }

    const params = new URLSearchParams({
      IncludeItemTypes: includeTypes.join(','),
      Recursive: 'true',
      Limit: String(Math.min(limit, 10)),
      UserId: auth.userId,
      Fields: 'Overview,Path',
    });

    // Only add SearchTerm for real queries - Jellyfin treats '*' as literal, not wildcard
    const trimmed = query.trim();
    if (trimmed && trimmed !== '*') {
      params.set('SearchTerm', trimmed);
    }

    const data = await jellyfinFetch(`/Items?${params}`);
    const items = (data.Items || []).map(mapItem);
    logger.info('Jellyfin search completed', { query, mediaType, results: items.length });
    return items;
  } catch (error) {
    logger.error('Jellyfin search failed', { query, error: (error as Error).message });
    return [];
  }
}

export async function getStreamUrl(itemId: string): Promise<{ streamUrl: string; item: JellyfinItem } | null> {
  if (!isEnabled()) return null;

  try {
    const auth = await authenticate();
    const params = new URLSearchParams({
      UserId: auth.userId,
      Fields: 'Overview,Path',
    });
    const data = await jellyfinFetch(`/Items/${itemId}?${params}`);
    const item = mapItem(data);
    return { streamUrl: item.streamUrl || '', item };
  } catch (error) {
    logger.error('Failed to get Jellyfin stream URL', { itemId, error: (error as Error).message });
    return null;
  }
}

export async function getLibraries(): Promise<Array<{ id: string; name: string; type: string }>> {
  if (!isEnabled()) return [];

  try {
    const auth = await authenticate();
    const data = await jellyfinFetch(`/Users/${auth.userId}/Views`);
    return (data.Items || []).map((item: any) => ({
      id: item.Id,
      name: item.Name,
      type: item.CollectionType || 'unknown',
    }));
  } catch (error) {
    logger.error('Failed to get Jellyfin libraries', { error: (error as Error).message });
    return [];
  }
}

export async function triggerLibraryScan(): Promise<void> {
  if (!isEnabled()) return;

  try {
    await jellyfinFetch('/Library/Refresh', { method: 'POST' });
    logger.info('Jellyfin library scan triggered');
  } catch (error) {
    logger.error('Failed to trigger Jellyfin library scan', { error: (error as Error).message });
  }
}

export function formatForPrompt(items: JellyfinItem[], query: string): string {
  if (items.length === 0) {
    return `No results found in local media library for "${query}".`;
  }

  const lines = [`Found ${items.length} item${items.length > 1 ? 's' : ''} in local library for "${query}":\n`];

  items.forEach((item, index) => {
    const artist = item.artist ? ` by ${item.artist}` : '';
    const album = item.album ? ` (Album: ${item.album})` : '';
    const year = item.year ? ` [${item.year}]` : '';
    const duration = item.durationTicks
      ? ` | Duration: ${formatTicks(item.durationTicks)}`
      : '';

    lines.push(`${index + 1}. **${item.name}**${artist}${album}${year} (JELLYFIN_ID: ${item.id})`);
    lines.push(`   Type: ${item.type}${duration}`);
    lines.push('');
  });

  lines.push('\nThe results are displayed in the user\'s media player. Use jellyfin_play to play a specific item.');

  return lines.join('\n');
}

function formatTicks(ticks: number): string {
  const totalSeconds = Math.floor(ticks / 10000000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function isJellyfinEnabled(): boolean {
  return isEnabled();
}
