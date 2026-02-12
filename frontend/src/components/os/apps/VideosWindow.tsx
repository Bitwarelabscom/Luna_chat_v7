'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Video, Clock, Radio, Music, Download, Loader2, Check, Library, MonitorPlay } from 'lucide-react';
import { useWindowStore, type VideoResult, type MediaItem } from '@/lib/window-store';
import { mediaApi } from '@/lib/api';

type ActiveItem =
  | { kind: 'youtube'; video: VideoResult }
  | { kind: 'media'; item: MediaItem };

interface DownloadState {
  id: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  format: 'video' | 'audio';
}

export default function VideosWindow() {
  const consumePendingVideoResults = useWindowStore((state) => state.consumePendingVideoResults);
  const pendingVideoResults = useWindowStore((state) => state.pendingVideoResults);
  const consumePendingMediaResults = useWindowStore((state) => state.consumePendingMediaResults);
  const pendingMediaResults = useWindowStore((state) => state.pendingMediaResults);

  // Consume pending results on first render
  const initialData = useRef<{
    youtubeVideos: VideoResult[];
    mediaItems: MediaItem[];
    query: string;
    source: 'youtube' | 'jellyfin' | 'mixed';
  } | null>(null);

  if (initialData.current === null) {
    const pendingVideo = consumePendingVideoResults();
    const pendingMedia = consumePendingMediaResults();

    if (pendingMedia) {
      initialData.current = {
        youtubeVideos: [],
        mediaItems: pendingMedia.items,
        query: pendingMedia.query,
        source: pendingMedia.source,
      };
    } else if (pendingVideo) {
      initialData.current = {
        youtubeVideos: pendingVideo.videos,
        mediaItems: [],
        query: pendingVideo.query,
        source: 'youtube',
      };
    } else {
      initialData.current = { youtubeVideos: [], mediaItems: [], query: '', source: 'youtube' };
    }
  }

  const [youtubeVideos, setYoutubeVideos] = useState<VideoResult[]>(initialData.current.youtubeVideos);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>(initialData.current.mediaItems);
  const [query, setQuery] = useState(initialData.current.query);
  const [activeItem, setActiveItem] = useState<ActiveItem | null>(() => {
    if (initialData.current!.mediaItems.length > 0) {
      return { kind: 'media', item: initialData.current!.mediaItems[0] };
    }
    if (initialData.current!.youtubeVideos.length > 0) {
      return { kind: 'youtube', video: initialData.current!.youtubeVideos[0] };
    }
    return null;
  });
  const [downloads, setDownloads] = useState<Map<string, DownloadState>>(new Map());

  // Watch for new pending YouTube results
  useEffect(() => {
    if (pendingVideoResults) {
      setYoutubeVideos(pendingVideoResults.videos);
      setMediaItems([]);
      setQuery(pendingVideoResults.query);
      if (pendingVideoResults.videos.length > 0) {
        setActiveItem({ kind: 'youtube', video: pendingVideoResults.videos[0] });
      }
      consumePendingVideoResults();
    }
  }, [pendingVideoResults, consumePendingVideoResults]);

  // Watch for new pending media results
  useEffect(() => {
    if (pendingMediaResults) {
      setMediaItems(pendingMediaResults.items);
      setYoutubeVideos([]);
      setQuery(pendingMediaResults.query);
      if (pendingMediaResults.items.length > 0) {
        setActiveItem({ kind: 'media', item: pendingMediaResults.items[0] });
      }
      consumePendingMediaResults();
    }
  }, [pendingMediaResults, consumePendingMediaResults]);

  // Poll download status
  useEffect(() => {
    const active = Array.from(downloads.values()).filter(d => d.status === 'downloading' || d.status === 'pending');
    if (active.length === 0) return;

    const interval = setInterval(async () => {
      for (const dl of active) {
        try {
          const status = await mediaApi.getDownloadStatus(dl.id);
          setDownloads(prev => {
            const next = new Map(prev);
            const existing = next.get(dl.id);
            if (existing) {
              next.set(dl.id, { ...existing, status: status.status as DownloadState['status'] });
            }
            return next;
          });
        } catch {
          // ignore polling errors
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [downloads]);

  const handleDownload = useCallback(async (videoId: string, title: string, format: 'video' | 'audio') => {
    try {
      const result = await mediaApi.downloadMedia(videoId, title, format);
      setDownloads(prev => {
        const next = new Map(prev);
        next.set(result.downloadId, { id: result.downloadId, status: 'downloading', format });
        return next;
      });
    } catch (err) {
      console.error('Download failed:', err);
    }
  }, []);

  const hasContent = youtubeVideos.length > 0 || mediaItems.length > 0;

  if (!hasContent) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4" style={{ color: 'var(--theme-text-muted)' }}>
        <Video className="w-16 h-16 opacity-40" />
        <p className="text-lg font-medium" style={{ color: 'var(--theme-text-secondary)' }}>No media yet</p>
        <p className="text-sm text-center px-8">Ask Luna to search YouTube or your local media library</p>
      </div>
    );
  }

  // Get the active YouTube video ID for download button state
  const activeYoutubeId = activeItem?.kind === 'youtube' ? activeItem.video.id : undefined;
  const activeDownloads = activeYoutubeId
    ? Array.from(downloads.values()).filter(d => d.id) // All tracked downloads
    : [];

  return (
    <div className="flex h-full" style={{ background: 'var(--theme-bg-primary)' }}>
      {/* Main player area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Player */}
        {activeItem?.kind === 'youtube' && (
          <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
            <iframe
              className="absolute top-0 left-0 w-full h-full border-0"
              src={`https://www.youtube.com/embed/${activeItem.video.id}?autoplay=1&rel=0`}
              title={activeItem.video.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        )}

        {activeItem?.kind === 'media' && activeItem.item.type === 'jellyfin-video' && activeItem.item.streamUrl && (
          <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
            <video
              className="absolute top-0 left-0 w-full h-full"
              src={activeItem.item.streamUrl}
              controls
              autoPlay
              style={{ background: '#000' }}
            />
          </div>
        )}

        {activeItem?.kind === 'media' && activeItem.item.type === 'jellyfin-audio' && (
          <div className="flex flex-col items-center justify-center p-8 gap-4" style={{ minHeight: '200px' }}>
            {activeItem.item.imageUrl ? (
              <img
                src={activeItem.item.imageUrl}
                alt={activeItem.item.name}
                className="w-48 h-48 rounded-lg object-cover shadow-lg"
              />
            ) : (
              <div
                className="w-48 h-48 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--theme-bg-tertiary)' }}
              >
                <Music className="w-16 h-16 opacity-40" style={{ color: 'var(--theme-text-muted)' }} />
              </div>
            )}
            <audio
              src={activeItem.item.streamUrl}
              controls
              autoPlay
              className="w-full max-w-md"
            />
          </div>
        )}

        {/* Now playing info */}
        <div className="p-4 border-t" style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-bg-secondary)' }}>
          {activeItem?.kind === 'youtube' && (
            <>
              <h3 className="font-semibold text-sm line-clamp-2" style={{ color: 'var(--theme-text-primary)' }}>
                {activeItem.video.title}
              </h3>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>{activeItem.video.channelTitle}</span>
                {activeItem.video.duration && (
                  <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                    <Clock className="w-3 h-3" />
                    {activeItem.video.duration}
                  </span>
                )}
                {activeItem.video.isLive && (
                  <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
                    <Radio className="w-3 h-3" />
                    LIVE
                  </span>
                )}
              </div>
              {/* Download buttons for YouTube */}
              <div className="flex gap-2 mt-3">
                <DownloadButton
                  label="Download Video"
                  icon={<MonitorPlay className="w-3.5 h-3.5" />}
                  onClick={() => handleDownload(activeItem.video.id, activeItem.video.title, 'video')}
                  downloads={activeDownloads}
                  format="video"
                />
                <DownloadButton
                  label="Download Music"
                  icon={<Music className="w-3.5 h-3.5" />}
                  onClick={() => handleDownload(activeItem.video.id, activeItem.video.title, 'audio')}
                  downloads={activeDownloads}
                  format="audio"
                />
              </div>
            </>
          )}

          {activeItem?.kind === 'media' && (
            <>
              <h3 className="font-semibold text-sm line-clamp-2" style={{ color: 'var(--theme-text-primary)' }}>
                {activeItem.item.name}
              </h3>
              <div className="flex items-center gap-3 mt-1">
                {activeItem.item.artist && (
                  <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>{activeItem.item.artist}</span>
                )}
                {activeItem.item.album && (
                  <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>{activeItem.item.album}</span>
                )}
                {activeItem.item.durationTicks && (
                  <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                    <Clock className="w-3 h-3" />
                    {formatTicks(activeItem.item.durationTicks)}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" style={{ background: 'var(--theme-bg-primary)' }} />
      </div>

      {/* Sidebar */}
      <div
        className="w-72 flex-shrink-0 flex flex-col border-l overflow-hidden"
        style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-bg-secondary)' }}
      >
        {/* Query header */}
        <div className="px-3 py-2.5 border-b" style={{ borderColor: 'var(--theme-border)' }}>
          <p className="text-xs font-medium truncate" style={{ color: 'var(--theme-text-muted)' }}>
            Results for
          </p>
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--theme-text-primary)' }}>
            {query}
          </p>
        </div>

        {/* Item list */}
        <div className="flex-1 overflow-y-auto">
          {/* YouTube results */}
          {youtubeVideos.map((video) => {
            const isActive = activeItem?.kind === 'youtube' && activeItem.video.id === video.id;
            return (
              <button
                key={`yt-${video.id}`}
                onClick={() => setActiveItem({ kind: 'youtube', video })}
                className="w-full text-left p-2 flex gap-2 hover:brightness-110 transition-all"
                style={{
                  background: isActive ? 'var(--theme-bg-tertiary)' : 'transparent',
                  borderLeft: isActive ? '3px solid var(--theme-accent-primary)' : '3px solid transparent',
                }}
              >
                <div className="w-28 flex-shrink-0 relative rounded overflow-hidden" style={{ aspectRatio: '16/9' }}>
                  <img src={video.thumbnail} alt={video.title} className="w-full h-full object-cover" />
                  {video.duration && (
                    <span className="absolute bottom-0.5 right-0.5 text-[10px] px-1 rounded" style={{ background: 'rgba(0,0,0,0.8)', color: '#fff' }}>
                      {video.duration}
                    </span>
                  )}
                  {video.isLive && (
                    <span className="absolute bottom-0.5 right-0.5 text-[10px] px-1 rounded bg-red-600 text-white">LIVE</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="text-[9px] px-1 py-0.5 rounded font-medium bg-red-500/20 text-red-400">YT</span>
                  </div>
                  <p className="text-xs font-medium line-clamp-2 leading-tight" style={{ color: 'var(--theme-text-primary)' }}>
                    {video.title}
                  </p>
                  <p className="text-[11px] mt-1 truncate" style={{ color: 'var(--theme-text-muted)' }}>
                    {video.channelTitle}
                  </p>
                </div>
              </button>
            );
          })}

          {/* Jellyfin results */}
          {mediaItems.map((item) => {
            const isActive = activeItem?.kind === 'media' && activeItem.item.id === item.id;
            const isAudio = item.type === 'jellyfin-audio';
            return (
              <button
                key={`jf-${item.id}`}
                onClick={() => setActiveItem({ kind: 'media', item })}
                className="w-full text-left p-2 flex gap-2 hover:brightness-110 transition-all"
                style={{
                  background: isActive ? 'var(--theme-bg-tertiary)' : 'transparent',
                  borderLeft: isActive ? '3px solid var(--theme-accent-primary)' : '3px solid transparent',
                }}
              >
                <div className="w-14 h-14 flex-shrink-0 rounded overflow-hidden">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--theme-bg-tertiary)' }}>
                      {isAudio ? <Music className="w-5 h-5 opacity-50" /> : <Video className="w-5 h-5 opacity-50" />}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="text-[9px] px-1 py-0.5 rounded font-medium" style={{ background: 'var(--theme-accent-primary)', color: '#fff', opacity: 0.8 }}>
                      <Library className="w-2.5 h-2.5 inline mr-0.5" />
                      {isAudio ? 'Music' : 'Video'}
                    </span>
                  </div>
                  <p className="text-xs font-medium line-clamp-2 leading-tight" style={{ color: 'var(--theme-text-primary)' }}>
                    {item.name}
                  </p>
                  {item.artist && (
                    <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--theme-text-muted)' }}>
                      {item.artist}
                    </p>
                  )}
                  {item.durationTicks && (
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--theme-text-muted)' }}>
                      {formatTicks(item.durationTicks)}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DownloadButton({
  label,
  icon,
  onClick,
  downloads,
  format,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  downloads: DownloadState[];
  format: 'video' | 'audio';
}) {
  const dl = downloads.find(d => d.format === format);
  const isDownloading = dl?.status === 'downloading' || dl?.status === 'pending';
  const isComplete = dl?.status === 'completed';

  return (
    <button
      onClick={onClick}
      disabled={isDownloading || isComplete}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all disabled:opacity-60"
      style={{
        background: isComplete ? 'var(--theme-success, #22c55e)' : 'var(--theme-bg-tertiary)',
        color: isComplete ? '#fff' : 'var(--theme-text-secondary)',
        opacity: isDownloading ? 0.7 : 1,
      }}
    >
      {isDownloading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : isComplete ? (
        <Check className="w-3.5 h-3.5" />
      ) : (
        <>
          <Download className="w-3.5 h-3.5" />
          {icon}
        </>
      )}
      {isDownloading ? 'Downloading...' : isComplete ? 'Saved' : label}
    </button>
  );
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
