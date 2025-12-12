'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { lunaMediaApi, getMediaUrl, LunaMediaSelection } from '@/lib/api';
import Image from 'next/image';
import clsx from 'clsx';

interface LunaAvatarProps {
  mood?: string;           // Current emotional state
  isSpeaking?: boolean;    // Show speaking animation
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  onVideoChange?: (video: LunaMediaSelection) => void;
}

const sizeClasses = {
  sm: 'w-24 h-24',
  md: 'w-32 h-32',
  lg: 'w-40 h-40 md:w-48 md:h-48',
  xl: 'w-48 h-48 md:w-64 md:h-64',
};

export default function LunaAvatar({
  mood,
  isSpeaking = false,
  size = 'lg',
  className,
  onVideoChange,
}: LunaAvatarProps) {
  const [currentVideo, setCurrentVideo] = useState<LunaMediaSelection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoopSupport, setHasLoopSupport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastMoodRef = useRef<string | undefined>(mood);

  // Check if loop-based system is available
  useEffect(() => {
    const checkLoopSupport = async () => {
      try {
        const { loopSets } = await lunaMediaApi.getLoopSets();
        const hasNeutral = loopSets && loopSets.neutral > 0;
        setHasLoopSupport(hasNeutral);
        if (hasNeutral) {
          // Load initial video
          await loadNextVideo();
        }
      } catch (err) {
        console.error('Failed to check loop support:', err);
        setHasLoopSupport(false);
      }
      setIsLoading(false);
    };

    checkLoopSupport();
  }, []);

  // Load next video from API
  const loadNextVideo = useCallback(async (set?: string) => {
    try {
      const video = await lunaMediaApi.getNextVideo(set);
      setCurrentVideo(video);
      setError(null);
      onVideoChange?.(video);
    } catch (err) {
      console.error('Failed to load next video:', err);
      setError('Failed to load video');
    }
  }, [onVideoChange]);

  // Handle mood changes
  useEffect(() => {
    if (!hasLoopSupport || !mood || mood === lastMoodRef.current) return;

    const updateMood = async () => {
      try {
        const { loopSet } = await lunaMediaApi.setMood(mood);
        lastMoodRef.current = mood;
        // Load video from new set
        await loadNextVideo(loopSet);
      } catch (err) {
        console.error('Failed to update mood:', err);
      }
    };

    updateMood();
  }, [mood, hasLoopSupport, loadNextVideo]);

  // Handle video end - load next video
  const handleVideoEnded = useCallback(() => {
    if (!hasLoopSupport) return;

    // If it was a special gesture, notify backend and load regular loop video
    if (currentVideo?.isSpecial) {
      lunaMediaApi.finishSpecialGesture().catch(console.error);
    }

    loadNextVideo();
  }, [hasLoopSupport, currentVideo, loadNextVideo]);

  // Auto-play video when it changes
  useEffect(() => {
    if (videoRef.current && currentVideo?.type === 'video') {
      videoRef.current.play().catch(err => {
        // Autoplay might be blocked, that's ok
        console.log('Autoplay prevented:', err);
      });
    }
  }, [currentVideo]);

  // Fallback to static image if no loop support
  if (!hasLoopSupport || isLoading) {
    return (
      <div className={clsx('relative', className)}>
        <div
          className={clsx(
            'relative rounded-full overflow-hidden border-4 transition-all duration-300',
            sizeClasses[size],
            isSpeaking
              ? 'border-green-400 shadow-2xl shadow-green-500/40'
              : 'border-gray-700'
          )}
        >
          <Image
            src={getMediaUrl('/api/images/luna2.jpg')}
            alt="Luna"
            width={256}
            height={256}
            className={clsx(
              'w-full h-full object-cover transition-transform duration-300',
              isSpeaking && 'scale-105'
            )}
            priority
          />
        </div>
        {isSpeaking && (
          <>
            <div className="absolute inset-0 -m-2 rounded-full border-2 border-green-400/50 animate-ping" style={{ animationDuration: '1.5s' }} />
            <div className="absolute inset-0 -m-4 rounded-full border border-green-400/30 animate-ping" style={{ animationDuration: '2s' }} />
          </>
        )}
      </div>
    );
  }

  return (
    <div className={clsx('relative', className)}>
      {/* Glow effect behind avatar */}
      <div
        className={clsx(
          'absolute -inset-4 rounded-full transition-all duration-500',
          isSpeaking
            ? 'bg-green-500/20 blur-xl scale-110'
            : 'bg-theme-accent-primary/10 blur-lg scale-100'
        )}
      />

      {/* Video Avatar Container */}
      <div
        className={clsx(
          'relative rounded-full overflow-hidden border-4 transition-all duration-300',
          sizeClasses[size],
          isSpeaking
            ? 'border-green-400 shadow-2xl shadow-green-500/40'
            : 'border-gray-700'
        )}
      >
        {currentVideo?.type === 'video' && (
          <video
            ref={videoRef}
            src={getMediaUrl(currentVideo.url)}
            className="w-full h-full object-cover"
            muted
            playsInline
            onEnded={handleVideoEnded}
            onError={() => setError('Video failed to load')}
          />
        )}

        {currentVideo?.type === 'image' && (
          <Image
            src={getMediaUrl(currentVideo.url)}
            alt="Luna"
            width={256}
            height={256}
            className="w-full h-full object-cover"
          />
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80">
            <Image
              src={getMediaUrl('/api/images/luna2.jpg')}
              alt="Luna"
              width={256}
              height={256}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Speaking overlay effect */}
        {isSpeaking && (
          <div className="absolute inset-0 bg-gradient-to-t from-green-500/20 to-transparent pointer-events-none" />
        )}
      </div>

      {/* Audio visualizer rings when speaking */}
      {isSpeaking && (
        <>
          <div className="absolute inset-0 -m-2 rounded-full border-2 border-green-400/50 animate-ping" style={{ animationDuration: '1.5s' }} />
          <div className="absolute inset-0 -m-4 rounded-full border border-green-400/30 animate-ping" style={{ animationDuration: '2s' }} />
        </>
      )}

      {/* Debug info (remove in production) */}
      {process.env.NODE_ENV === 'development' && currentVideo && (
        <div className="absolute -bottom-8 left-0 right-0 text-center text-xs text-gray-500 truncate">
          {currentVideo.loopSet || currentVideo.trigger}
        </div>
      )}
    </div>
  );
}
