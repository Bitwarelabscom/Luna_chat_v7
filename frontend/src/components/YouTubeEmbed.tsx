'use client';

interface YouTubeEmbedProps {
  videoId: string;
  title: string;
  channel?: string;
  duration?: string;
}

export default function YouTubeEmbed({ videoId, title, channel, duration }: YouTubeEmbedProps) {
  return (
    <div className="youtube-embed rounded-lg overflow-hidden my-4 max-w-lg border border-theme-border">
      <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
        <iframe
          className="absolute top-0 left-0 w-full h-full border-0"
          src={`https://www.youtube.com/embed/${videoId}`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
      <div className="p-3 bg-theme-bg-tertiary">
        <p className="font-medium text-theme-text-primary text-sm line-clamp-2">{title}</p>
        {(channel || duration) && (
          <p className="text-xs text-theme-text-muted mt-1">
            {[channel, duration].filter(Boolean).join(' | ')}
          </p>
        )}
      </div>
    </div>
  );
}

export interface YouTubeBlock {
  type: 'youtube';
  videoId: string;
  title: string;
  channel?: string;
  duration?: string;
}

export interface ImageBlock {
  type: 'image';
  url: string;
  caption?: string;
}

export interface TextBlock {
  type: 'text';
  content: string;
}

export type ContentBlock = YouTubeBlock | ImageBlock | TextBlock;

/**
 * Parse message content and extract YouTube embed blocks
 * Supports multiple formats:
 * - :::youtube[VIDEO_ID]\n**Title**\nChannel: X | Duration: X\n:::
 * - :::youtube[VIDEO_ID] Title here :::
 * - :::youtube[VIDEO_ID] Title\nChannel: X | Duration: X :::
 */
export function parseYouTubeBlocks(content: string): ContentBlock[] {
  // More flexible regex that handles both newlines and spaces, with optional closing :::
  const youtubeRegex = /:::youtube\[([a-zA-Z0-9_-]{11})\][\s]*([\s\S]*?)(?:\s*:::\s*|(?=:::youtube\[)|$)/g;
  const parts: ContentBlock[] = [];
  let lastIndex = 0;
  let match;

  while ((match = youtubeRegex.exec(content)) !== null) {
    // Add text before the YouTube block
    if (match.index > lastIndex) {
      const textContent = content.slice(lastIndex, match.index).trim();
      if (textContent) {
        parts.push({ type: 'text', content: textContent });
      }
    }

    // Parse video metadata from the block content
    const videoId = match[1];
    const blockContent = match[2];
    const metadata = parseVideoMetadata(blockContent);

    parts.push({
      type: 'youtube',
      videoId,
      ...metadata,
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    const textContent = content.slice(lastIndex).trim();
    if (textContent) {
      parts.push({ type: 'text', content: textContent });
    }
  }

  // If no YouTube blocks found, return original content as single text block
  if (parts.length === 0) {
    return [{ type: 'text', content }];
  }

  return parts;
}

/**
 * Parse video metadata from the block content
 * Handles multiple formats:
 * - **Title**\nChannel: X | Duration: X
 * - Title here\nChannel: X | Duration: X
 * - Title {Full Album} Channel: X | Duration: X (single line)
 */
function parseVideoMetadata(blockContent: string): { title: string; channel?: string; duration?: string } {
  const content = blockContent.trim();

  // Try to extract channel and duration from anywhere in the content
  let channel: string | undefined;
  let duration: string | undefined;

  const channelMatch = content.match(/Channel:\s*([^|\n]+)/i);
  if (channelMatch) {
    channel = channelMatch[1].trim();
  }

  const durationMatch = content.match(/Duration:\s*([^\s|\n]+)/i);
  if (durationMatch) {
    duration = durationMatch[1].trim();
  }

  // For title, take everything before "Channel:" or the first line
  let title = content;

  // Remove channel and duration parts from title
  title = title.replace(/Channel:\s*[^|\n]+/i, '');
  title = title.replace(/Duration:\s*[^\s|\n]+/i, '');
  title = title.replace(/\|/g, '');

  // Clean up the title
  title = title.split('\n')[0]; // Take first line if multiple
  title = title.replace(/^\*\*/, '').replace(/\*\*$/, ''); // Remove markdown bold
  title = title.trim();

  if (!title) {
    title = 'YouTube Video';
  }

  return { title, channel, duration };
}

/**
 * Parse message content and extract both YouTube and Image embed blocks
 * Image format: :::image[/api/images/generated/file.png]\nCaption\n:::
 */
export function parseMediaBlocks(content: string): ContentBlock[] {
  // Combined regex for both YouTube and Image blocks
  const mediaRegex = /:::(youtube|image)\[([^\]]+)\][\s]*([\s\S]*?)(?:\s*:::\s*|(?=:::(?:youtube|image)\[)|$)/g;
  const parts: ContentBlock[] = [];
  let lastIndex = 0;
  let match;

  while ((match = mediaRegex.exec(content)) !== null) {
    // Add text before the media block
    if (match.index > lastIndex) {
      const textContent = content.slice(lastIndex, match.index).trim();
      if (textContent) {
        parts.push({ type: 'text', content: textContent });
      }
    }

    const blockType = match[1];
    const blockId = match[2];
    const blockContent = match[3];

    if (blockType === 'youtube') {
      // Parse video metadata from the block content
      const metadata = parseVideoMetadata(blockContent);
      parts.push({
        type: 'youtube',
        videoId: blockId,
        ...metadata,
      });
    } else if (blockType === 'image') {
      // Parse image caption from the block content
      const caption = blockContent.trim() || undefined;
      parts.push({
        type: 'image',
        url: blockId,
        caption,
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    const textContent = content.slice(lastIndex).trim();
    if (textContent) {
      parts.push({ type: 'text', content: textContent });
    }
  }

  // If no media blocks found, return original content as single text block
  if (parts.length === 0) {
    return [{ type: 'text', content }];
  }

  return parts;
}
