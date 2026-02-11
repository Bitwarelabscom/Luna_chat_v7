'use client';

import { useState, useEffect, useRef } from 'react';
import { Video, Clock, Radio } from 'lucide-react';
import { useWindowStore, type VideoResult } from '@/lib/window-store';

export default function VideosWindow() {
  const consumePendingVideoResults = useWindowStore((state) => state.consumePendingVideoResults);
  const pendingVideoResults = useWindowStore((state) => state.pendingVideoResults);

  // Consume pending results on first render
  const initialData = useRef<{ videos: VideoResult[]; query: string } | null>(null);
  if (initialData.current === null) {
    const pending = consumePendingVideoResults();
    initialData.current = pending || { videos: [], query: '' };
  }

  const [videos, setVideos] = useState<VideoResult[]>(initialData.current.videos);
  const [query, setQuery] = useState(initialData.current.query);
  const [activeIndex, setActiveIndex] = useState(0);

  // Watch for new pending results (when window is already open)
  useEffect(() => {
    if (pendingVideoResults) {
      setVideos(pendingVideoResults.videos);
      setQuery(pendingVideoResults.query);
      setActiveIndex(0);
      consumePendingVideoResults();
    }
  }, [pendingVideoResults, consumePendingVideoResults]);

  const activeVideo = videos[activeIndex];

  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4" style={{ color: 'var(--theme-text-muted)' }}>
        <Video className="w-16 h-16 opacity-40" />
        <p className="text-lg font-medium" style={{ color: 'var(--theme-text-secondary)' }}>No videos yet</p>
        <p className="text-sm">Ask Luna to search for videos</p>
      </div>
    );
  }

  return (
    <div className="flex h-full" style={{ background: 'var(--theme-bg-primary)' }}>
      {/* Main player area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Video player */}
        <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
          <iframe
            className="absolute top-0 left-0 w-full h-full border-0"
            src={`https://www.youtube.com/embed/${activeVideo.id}?autoplay=1&rel=0`}
            title={activeVideo.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>

        {/* Now playing info */}
        <div className="p-4 border-t" style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-bg-secondary)' }}>
          <h3 className="font-semibold text-sm line-clamp-2" style={{ color: 'var(--theme-text-primary)' }}>
            {activeVideo.title}
          </h3>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>{activeVideo.channelTitle}</span>
            {activeVideo.duration && (
              <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                <Clock className="w-3 h-3" />
                {activeVideo.duration}
              </span>
            )}
            {activeVideo.isLive && (
              <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
                <Radio className="w-3 h-3" />
                LIVE
              </span>
            )}
          </div>
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

        {/* Video list */}
        <div className="flex-1 overflow-y-auto">
          {videos.map((video, index) => (
            <button
              key={video.id}
              onClick={() => setActiveIndex(index)}
              className="w-full text-left p-2 flex gap-2 hover:brightness-110 transition-all"
              style={{
                background: index === activeIndex ? 'var(--theme-bg-tertiary)' : 'transparent',
                borderLeft: index === activeIndex ? '3px solid var(--theme-accent-primary)' : '3px solid transparent',
              }}
            >
              {/* Thumbnail */}
              <div className="w-28 flex-shrink-0 relative rounded overflow-hidden" style={{ aspectRatio: '16/9' }}>
                <img
                  src={video.thumbnail}
                  alt={video.title}
                  className="w-full h-full object-cover"
                />
                {video.duration && (
                  <span
                    className="absolute bottom-0.5 right-0.5 text-[10px] px-1 rounded"
                    style={{ background: 'rgba(0,0,0,0.8)', color: '#fff' }}
                  >
                    {video.duration}
                  </span>
                )}
                {video.isLive && (
                  <span className="absolute bottom-0.5 right-0.5 text-[10px] px-1 rounded bg-red-600 text-white">
                    LIVE
                  </span>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium line-clamp-2 leading-tight" style={{ color: 'var(--theme-text-primary)' }}>
                  {video.title}
                </p>
                <p className="text-[11px] mt-1 truncate" style={{ color: 'var(--theme-text-muted)' }}>
                  {video.channelTitle}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
