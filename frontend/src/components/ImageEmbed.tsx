'use client';

import { useState } from 'react';
import { getMediaUrl } from '@/lib/api';

interface ImageEmbedProps {
  url: string;
  caption?: string;
}

export default function ImageEmbed({ url, caption }: ImageEmbedProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Add base path prefix for API URLs (e.g., /api/images -> /api/images)
  const imageUrl = getMediaUrl(url);

  return (
    <>
      <div className="image-embed my-4 max-w-lg">
        <div
          className="relative rounded-lg overflow-hidden border border-theme-border bg-theme-bg-tertiary cursor-pointer"
          onClick={() => setIsExpanded(true)}
        >
          {isLoading && !hasError && (
            <div className="absolute inset-0 flex items-center justify-center bg-theme-bg-tertiary">
              <div className="animate-pulse text-theme-text-muted">Loading image...</div>
            </div>
          )}
          {hasError ? (
            <div className="p-4 text-center text-theme-text-muted">
              <svg className="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm">Failed to load image</p>
            </div>
          ) : (
            <img
              src={imageUrl}
              alt={caption || 'Generated image'}
              className={`w-full h-auto max-h-96 object-contain transition-opacity ${isLoading ? 'opacity-0' : 'opacity-100'}`}
              onLoad={() => setIsLoading(false)}
              onError={() => {
                setIsLoading(false);
                setHasError(true);
              }}
            />
          )}
          {/* Zoom indicator */}
          {!hasError && !isLoading && (
            <div className="absolute bottom-2 right-2 bg-black/50 text-white px-2 py-1 rounded text-xs">
              Click to expand
            </div>
          )}
        </div>
        {caption && (
          <p className="mt-2 text-sm text-theme-text-muted">{caption}</p>
        )}
      </div>

      {/* Expanded modal */}
      {isExpanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setIsExpanded(false)}
        >
          <div className="relative max-w-7xl max-h-full">
            <img
              src={imageUrl}
              alt={caption || 'Generated image'}
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
            />
            <button
              className="absolute top-4 right-4 bg-black/50 text-white p-2 rounded-full hover:bg-black/70 transition-colors"
              onClick={() => setIsExpanded(false)}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            {caption && (
              <p className="absolute bottom-4 left-4 right-4 text-center text-white text-sm bg-black/50 px-4 py-2 rounded">
                {caption}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export interface ImageBlock {
  type: 'image';
  url: string;
  caption?: string;
}
