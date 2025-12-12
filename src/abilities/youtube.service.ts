import { GetListByKeyword } from 'youtube-search-api';
import logger from '../utils/logger.js';

export interface YouTubeVideo {
  id: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  duration: string;
  isLive: boolean;
}

export interface YouTubeSearchResult {
  videos: YouTubeVideo[];
  query: string;
  error?: string;
}

/**
 * Search YouTube for videos matching the query
 */
export async function searchYouTube(
  query: string,
  limit: number = 3
): Promise<YouTubeSearchResult> {
  try {
    logger.info('Searching YouTube', { query, limit });

    // Search for videos only (not playlists)
    const result = await GetListByKeyword(
      query,
      false, // withPlaylist
      Math.min(limit, 10), // limit
      [{ type: 'video' }] // options - only videos
    );

    if (!result.items || result.items.length === 0) {
      return {
        videos: [],
        query,
        error: 'No videos found for this search.',
      };
    }

    const videos: YouTubeVideo[] = result.items
      .filter((item: any) => item.type === 'video')
      .slice(0, limit)
      .map((item: any) => ({
        id: item.id,
        title: item.title || 'Untitled',
        channelTitle: item.channelTitle || item.shortBylineText || 'Unknown Channel',
        thumbnail: item.thumbnail?.thumbnails?.[0]?.url ||
                   `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
        duration: formatDuration(item.length),
        isLive: item.isLive || false,
      }));

    logger.info('YouTube search completed', { query, resultsCount: videos.length });

    return {
      videos,
      query,
    };
  } catch (error) {
    logger.error('YouTube search failed', { query, error: (error as Error).message });

    return {
      videos: [],
      query,
      error: 'YouTube search is temporarily unavailable. Please try again later.',
    };
  }
}

/**
 * Format duration from YouTube format to human readable
 */
function formatDuration(length: any): string {
  if (!length) return '';

  // If it's already a string like "10:34", return it
  if (typeof length === 'string') {
    return length;
  }

  // If it's an object with simpleText
  if (length.simpleText) {
    return length.simpleText;
  }

  // If it's an object with accessibilityData
  if (length.accessibility?.accessibilityData?.label) {
    return length.accessibility.accessibilityData.label;
  }

  return '';
}

/**
 * Format YouTube search results for the LLM prompt
 */
export function formatYouTubeForPrompt(results: YouTubeSearchResult): string {
  if (results.error && results.videos.length === 0) {
    return results.error;
  }

  if (results.videos.length === 0) {
    return `No YouTube videos found for "${results.query}".`;
  }

  const lines = [`Found ${results.videos.length} YouTube video${results.videos.length > 1 ? 's' : ''} for "${results.query}":\n`];

  results.videos.forEach((video, index) => {
    const liveTag = video.isLive ? ' [LIVE]' : '';
    const duration = video.duration ? ` | Duration: ${video.duration}` : '';

    lines.push(`${index + 1}. **${video.title}**${liveTag} (VIDEO_ID: ${video.id})`);
    lines.push(`   Channel: ${video.channelTitle}${duration}`);
    lines.push('');
  });

  lines.push('\nTo embed a video in your response, use this format:');
  lines.push(':::youtube[VIDEO_ID]');
  lines.push('**Video Title**');
  lines.push('Channel: X | Duration: X');
  lines.push(':::');

  return lines.join('\n');
}

/**
 * Generate the custom markdown syntax for embedding a YouTube video
 */
export function generateEmbedMarkdown(
  videoId: string,
  title: string,
  channelTitle: string,
  duration?: string
): string {
  const metadata = [channelTitle];
  if (duration) {
    metadata.push(`Duration: ${duration}`);
  }

  return `:::youtube[${videoId}]
**${title}**
${metadata.join(' | ')}
:::`;
}
