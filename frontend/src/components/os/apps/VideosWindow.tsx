'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Video, Clock, Radio, Music, Download, Loader2, Check,
  Library, MonitorPlay, Play, ChevronDown, ChevronRight,
  ChevronLeft, Copy,
} from 'lucide-react';
import { useWindowStore, type VideoResult, type MediaItem } from '@/lib/window-store';
import { mediaApi } from '@/lib/api';

type ActiveItem =
  | { kind: 'youtube'; video: VideoResult }
  | { kind: 'media'; item: MediaItem };

interface DownloadState {
  id: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  format: 'video' | 'audio';
  progress?: string;
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
        source: 'youtube',
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

  // UI state
  const [ytCollapsed, setYtCollapsed] = useState(false);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [titleCopied, setTitleCopied] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);

  // Media refs for keyboard control
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Combined ordered list for queue navigation
  const allItems: ActiveItem[] = [
    ...youtubeVideos.map(v => ({ kind: 'youtube' as const, video: v })),
    ...mediaItems.map(i => ({ kind: 'media' as const, item: i })),
  ];

  // Active position in combined list
  const activeIndex = allItems.findIndex(item => {
    if (activeItem?.kind === 'youtube' && item.kind === 'youtube') return item.video.id === activeItem.video.id;
    if (activeItem?.kind === 'media' && item.kind === 'media') return item.item.id === activeItem.item.id;
    return false;
  });
  const nextUpIndex = activeIndex >= 0 && activeIndex < allItems.length - 1 ? activeIndex + 1 : -1;

  // Stable refs for keyboard handler (avoids stale closure without re-attaching listener)
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const allItemsRef = useRef(allItems);
  allItemsRef.current = allItems;

  // Reset audio playing state when active item changes
  useEffect(() => {
    setIsAudioPlaying(false);
  }, [activeItem]);

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
              next.set(dl.id, {
                ...existing,
                status: status.status as DownloadState['status'],
                progress: status.progress,
              });
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

  // Keyboard shortcuts - attached once, uses refs for current values
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as Element).tagName)) return;
      const mediaEl = videoRef.current || audioRef.current;
      const idx = activeIndexRef.current;
      const items = allItemsRef.current;

      switch (e.code) {
        case 'Space':
          if (!mediaEl) return;
          e.preventDefault();
          if (mediaEl.paused) mediaEl.play();
          else mediaEl.pause();
          break;
        case 'ArrowLeft':
          if (!mediaEl) return;
          e.preventDefault();
          mediaEl.currentTime = Math.max(0, mediaEl.currentTime - 10);
          break;
        case 'ArrowRight':
          if (!mediaEl) return;
          e.preventDefault();
          mediaEl.currentTime += 10;
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (idx > 0) setActiveItem(items[idx - 1]);
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (idx < items.length - 1) setActiveItem(items[idx + 1]);
          break;
        case 'KeyM':
          if (mediaEl) mediaEl.muted = !mediaEl.muted;
          break;
        case 'KeyF':
          videoRef.current?.requestFullscreen?.();
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-advance to next item when local media ends (YouTube iframe has no onEnded)
  const handleEnded = useCallback(() => {
    const idx = activeIndexRef.current;
    const items = allItemsRef.current;
    if (idx >= 0 && idx < items.length - 1) {
      setActiveItem(items[idx + 1]);
    }
  }, []);

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

  const handleCopyTitle = useCallback(async (title: string) => {
    try {
      await navigator.clipboard.writeText(title);
      setTitleCopied(true);
      setTimeout(() => setTitleCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  }, []);

  // Helper: is this item the next up in queue
  const isNextUp = (kind: 'youtube' | 'media', id: string) => {
    if (nextUpIndex < 0) return false;
    const next = allItems[nextUpIndex];
    if (!next) return false;
    if (kind === 'youtube' && next.kind === 'youtube') return next.video.id === id;
    if (kind === 'media' && next.kind === 'media') return next.item.id === id;
    return false;
  };

  const hasContent = youtubeVideos.length > 0 || mediaItems.length > 0;

  if (!hasContent) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4" style={{ color: 'var(--theme-text-muted)' }}>
        <Video className="w-16 h-16 opacity-40" />
        <p className="text-lg font-medium" style={{ color: 'var(--theme-text-secondary)' }}>No media yet</p>
        <p className="text-sm text-center px-8">Ask Luna to find something to watch or listen to</p>
        <div className="flex gap-2 mt-1">
          <span
            className="px-3 py-1.5 rounded-full text-xs font-medium"
            style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-secondary)', border: '1px solid var(--theme-border)' }}
          >
            Search YouTube
          </span>
          <span
            className="px-3 py-1.5 rounded-full text-xs font-medium"
            style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-secondary)', border: '1px solid var(--theme-border)' }}
          >
            Browse Library
          </span>
        </div>
      </div>
    );
  }

  // Downloads for the currently active YouTube video
  const activeYoutubeId = activeItem?.kind === 'youtube' ? activeItem.video.id : undefined;
  const activeDownloads = activeYoutubeId
    ? Array.from(downloads.values()).filter(d => d.id)
    : [];

  return (
    <div className="flex h-full" style={{ background: 'var(--theme-bg-primary)' }}>
      {/* Main player area */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Player */}
        <div className="transition-opacity duration-150">
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

          {activeItem?.kind === 'media' && activeItem.item.type === 'media-video' && activeItem.item.streamUrl && (
            <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
              <video
                ref={videoRef}
                className="absolute top-0 left-0 w-full h-full"
                src={activeItem.item.streamUrl}
                controls
                autoPlay
                onEnded={handleEnded}
                style={{ background: '#000' }}
              />
            </div>
          )}

          {activeItem?.kind === 'media' && activeItem.item.type === 'media-audio' && (
            <div
              className="flex flex-col items-center justify-center p-8 gap-5"
              style={{
                minHeight: '268px',
                background: 'linear-gradient(180deg, var(--theme-bg-tertiary) 0%, var(--theme-bg-primary) 100%)',
              }}
            >
              {/* Album art with pulsing ring when playing */}
              <div className="relative flex items-center justify-center">
                {isAudioPlaying && (
                  <div
                    className="absolute animate-ping rounded-xl opacity-40"
                    style={{
                      inset: '-10px',
                      border: '2px solid var(--theme-accent-primary)',
                      background: 'transparent',
                    }}
                  />
                )}
                {activeItem.item.imageUrl ? (
                  <img
                    src={activeItem.item.imageUrl}
                    alt={activeItem.item.name}
                    className="w-56 h-56 rounded-xl object-cover shadow-2xl relative z-10"
                    style={{
                      border: isAudioPlaying ? '2px solid var(--theme-accent-primary)' : '2px solid transparent',
                      boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                      transition: 'border-color 0.3s',
                    }}
                  />
                ) : (
                  <div
                    className="w-56 h-56 rounded-xl flex items-center justify-center relative z-10"
                    style={{
                      background: 'var(--theme-bg-tertiary)',
                      border: isAudioPlaying ? '2px solid var(--theme-accent-primary)' : '2px solid var(--theme-border)',
                      boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
                      transition: 'border-color 0.3s',
                    }}
                  >
                    <Music className="w-20 h-20 opacity-30" style={{ color: 'var(--theme-text-muted)' }} />
                  </div>
                )}
              </div>

              {/* Artist + album name prominently above controls */}
              <div className="text-center">
                <p className="text-base font-semibold" style={{ color: 'var(--theme-text-primary)' }}>
                  {activeItem.item.name}
                </p>
                {(activeItem.item.artist || activeItem.item.album) && (
                  <p className="text-sm mt-0.5" style={{ color: 'var(--theme-text-secondary)' }}>
                    {[activeItem.item.artist, activeItem.item.album].filter(Boolean).join(' - ')}
                  </p>
                )}
              </div>

              <audio
                ref={audioRef}
                src={activeItem.item.streamUrl}
                controls
                autoPlay
                className="w-full max-w-sm"
                onPlay={() => setIsAudioPlaying(true)}
                onPause={() => setIsAudioPlaying(false)}
                onEnded={() => { setIsAudioPlaying(false); handleEnded(); }}
              />
            </div>
          )}
        </div>

        {/* Now playing info bar */}
        <div className="p-4 border-t" style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-bg-secondary)' }}>
          {activeItem?.kind === 'youtube' && (
            <>
              <div className="flex items-start gap-2">
                <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-red-500/20 text-red-400 mt-0.5 flex-shrink-0">
                  YT
                </span>
                <button
                  onClick={() => handleCopyTitle(activeItem.video.title)}
                  className="group flex items-center gap-1.5 text-left hover:opacity-80 transition-opacity"
                  title="Copy title"
                >
                  <h3 className="font-semibold text-sm line-clamp-2" style={{ color: 'var(--theme-text-primary)' }}>
                    {activeItem.video.title}
                  </h3>
                  <Copy className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-50 transition-opacity" style={{ color: 'var(--theme-text-muted)' }} />
                  {titleCopied && (
                    <span className="text-[10px] text-green-400 flex-shrink-0">Copied!</span>
                  )}
                </button>
              </div>
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
              <div className="flex items-start gap-2">
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded font-bold mt-0.5 flex-shrink-0 flex items-center gap-0.5"
                  style={{ background: 'var(--theme-accent-primary)', color: '#fff', opacity: 0.9 }}
                >
                  <Library className="w-2.5 h-2.5" />
                  {activeItem.item.type === 'media-audio' ? 'Music' : 'Video'}
                </span>
                <button
                  onClick={() => handleCopyTitle(activeItem.item.name)}
                  className="group flex items-center gap-1.5 text-left hover:opacity-80 transition-opacity"
                  title="Copy title"
                >
                  <h3 className="font-semibold text-sm line-clamp-2" style={{ color: 'var(--theme-text-primary)' }}>
                    {activeItem.item.name}
                  </h3>
                  <Copy className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-50 transition-opacity" style={{ color: 'var(--theme-text-muted)' }} />
                  {titleCopied && (
                    <span className="text-[10px] text-green-400 flex-shrink-0">Copied!</span>
                  )}
                </button>
              </div>
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
        className="flex-shrink-0 flex flex-col border-l overflow-hidden transition-all duration-200"
        style={{
          width: sidebarCollapsed ? '56px' : '288px',
          borderColor: 'var(--theme-border)',
          background: 'var(--theme-bg-secondary)',
        }}
      >
        {/* Sidebar header with collapse toggle */}
        <div className="px-3 py-2.5 border-b flex items-center gap-2 min-h-[52px]" style={{ borderColor: 'var(--theme-border)' }}>
          {!sidebarCollapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: 'var(--theme-text-muted)' }}>
                Results for
              </p>
              <p className="text-sm font-semibold truncate" style={{ color: 'var(--theme-text-primary)' }}>
                {query}
              </p>
            </div>
          )}
          <button
            onClick={() => setSidebarCollapsed(v => !v)}
            className="flex-shrink-0 p-1 rounded hover:opacity-70 transition-opacity ml-auto"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{ color: 'var(--theme-text-muted)' }}
          >
            {sidebarCollapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>

        {/* Item list */}
        <div className="flex-1 overflow-y-auto">

          {/* YouTube section */}
          {youtubeVideos.length > 0 && (
            <>
              {!sidebarCollapsed && (
                <button
                  onClick={() => setYtCollapsed(v => !v)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:opacity-80 transition-opacity border-b"
                  style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-bg-tertiary)' }}
                >
                  {ytCollapsed
                    ? <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--theme-accent-primary)' }} />
                    : <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--theme-accent-primary)' }} />
                  }
                  <span className="text-xs font-bold" style={{ color: 'var(--theme-accent-primary)' }}>
                    YouTube Results
                  </span>
                  <span
                    className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                    style={{ background: 'var(--theme-accent-primary)', color: '#fff', opacity: 0.8 }}
                  >
                    {youtubeVideos.length}
                  </span>
                </button>
              )}

              {(!ytCollapsed || sidebarCollapsed) && youtubeVideos.map((video) => {
                const isActive = activeItem?.kind === 'youtube' && activeItem.video.id === video.id;
                const isNext = isNextUp('youtube', video.id);

                if (sidebarCollapsed) {
                  return (
                    <button
                      key={`yt-${video.id}`}
                      onClick={() => setActiveItem({ kind: 'youtube', video })}
                      className="w-full p-1.5 flex justify-center hover:brightness-110 transition-all"
                      style={{
                        background: isActive ? 'var(--theme-bg-tertiary)' : 'transparent',
                        borderLeft: isActive ? '2px solid var(--theme-accent-primary)' : '2px solid transparent',
                      }}
                      title={video.title}
                    >
                      <div className="w-9 h-9 rounded overflow-hidden">
                        <img src={video.thumbnail} alt={video.title} className="w-full h-full object-cover" />
                      </div>
                    </button>
                  );
                }

                return (
                  <button
                    key={`yt-${video.id}`}
                    onClick={() => setActiveItem({ kind: 'youtube', video })}
                    className="w-full text-left p-2 flex gap-2 hover:brightness-110 transition-all group"
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
                      {/* Hover play overlay */}
                      <div
                        className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ background: 'rgba(0,0,0,0.5)' }}
                      >
                        <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.92)' }}>
                          <Play className="w-4 h-4 ml-0.5" style={{ color: '#000' }} />
                        </div>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 mb-0.5">
                        <span className="text-[9px] px-1 py-0.5 rounded font-medium bg-red-500/20 text-red-400">YT</span>
                        {isNext && (
                          <span
                            className="text-[9px] px-1 py-0.5 rounded font-medium"
                            style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-muted)' }}
                          >
                            next
                          </span>
                        )}
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
            </>
          )}

          {/* Local Library section */}
          {mediaItems.length > 0 && (
            <>
              {!sidebarCollapsed && (
                <button
                  onClick={() => setLibraryCollapsed(v => !v)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:opacity-80 transition-opacity border-b"
                  style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-bg-tertiary)' }}
                >
                  {libraryCollapsed
                    ? <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--theme-accent-primary)' }} />
                    : <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--theme-accent-primary)' }} />
                  }
                  <span className="text-xs font-bold" style={{ color: 'var(--theme-accent-primary)' }}>
                    Local Library
                  </span>
                  <span
                    className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                    style={{ background: 'var(--theme-accent-primary)', color: '#fff', opacity: 0.8 }}
                  >
                    {mediaItems.length}
                  </span>
                </button>
              )}

              {(!libraryCollapsed || sidebarCollapsed) && mediaItems.map((item) => {
                const isActive = activeItem?.kind === 'media' && activeItem.item.id === item.id;
                const isAudio = item.type === 'media-audio';
                const isNext = isNextUp('media', item.id);

                if (sidebarCollapsed) {
                  return (
                    <button
                      key={`media-${item.id}`}
                      onClick={() => setActiveItem({ kind: 'media', item })}
                      className="w-full p-1.5 flex justify-center hover:brightness-110 transition-all"
                      style={{
                        background: isActive ? 'var(--theme-bg-tertiary)' : 'transparent',
                        borderLeft: isActive ? '2px solid var(--theme-accent-primary)' : '2px solid transparent',
                      }}
                      title={item.name}
                    >
                      <div className="w-9 h-9 rounded overflow-hidden">
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--theme-bg-tertiary)' }}>
                            {isAudio ? <Music className="w-4 h-4 opacity-50" /> : <Video className="w-4 h-4 opacity-50" />}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                }

                return (
                  <button
                    key={`media-${item.id}`}
                    onClick={() => setActiveItem({ kind: 'media', item })}
                    className="w-full text-left p-2 flex gap-2 hover:brightness-110 transition-all group"
                    style={{
                      background: isActive ? 'var(--theme-bg-tertiary)' : 'transparent',
                      borderLeft: isActive ? '3px solid var(--theme-accent-primary)' : '3px solid transparent',
                    }}
                  >
                    <div className="w-14 h-14 flex-shrink-0 rounded overflow-hidden relative">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--theme-bg-tertiary)' }}>
                          {isAudio ? <Music className="w-5 h-5 opacity-50" /> : <Video className="w-5 h-5 opacity-50" />}
                        </div>
                      )}
                      {/* Hover play overlay */}
                      <div
                        className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ background: 'rgba(0,0,0,0.5)' }}
                      >
                        <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.92)' }}>
                          <Play className="w-3.5 h-3.5 ml-0.5" style={{ color: '#000' }} />
                        </div>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 mb-0.5">
                        <span
                          className="text-[9px] px-1 py-0.5 rounded font-medium flex items-center gap-0.5"
                          style={{ background: 'var(--theme-accent-primary)', color: '#fff', opacity: 0.8 }}
                        >
                          <Library className="w-2.5 h-2.5" />
                          {isAudio ? 'Music' : 'Video'}
                        </span>
                        {isNext && (
                          <span
                            className="text-[9px] px-1 py-0.5 rounded font-medium"
                            style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-muted)' }}
                          >
                            next
                          </span>
                        )}
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
            </>
          )}
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

  const progressLabel = dl?.progress
    ? `Downloading ${dl.progress}`
    : 'Downloading...';

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
      {isDownloading ? progressLabel : isComplete ? 'Saved' : label}
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
