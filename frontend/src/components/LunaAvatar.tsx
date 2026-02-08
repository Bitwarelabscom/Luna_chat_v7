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
  // Use two video states for seamless buffering
  const [videoA, setVideoA] = useState<LunaMediaSelection | null>(null);
  const [videoB, setVideoB] = useState<LunaMediaSelection | null>(null);
  const [activeBuffer, setActiveBuffer] = useState<'A' | 'B'>('A');
  
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoopSupport, setHasLoopSupport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const videoRefA = useRef<HTMLVideoElement>(null);
  const videoRefB = useRef<HTMLVideoElement>(null);
  const lastMoodRef = useRef<string | undefined>(mood);

  // Helper to fetch next video from API
  const fetchNextFromApi = async (set?: string) => {
    try {
      return await lunaMediaApi.getNextVideo(set);
    } catch (err) {
      console.error('Failed to fetch next video from API:', err);
      return null;
    }
  };

  // Initial load
  useEffect(() => {
    const init = async () => {
      try {
        const { loopSets } = await lunaMediaApi.getLoopSets();
        const hasNeutral = loopSets && loopSets.neutral > 0;
        setHasLoopSupport(hasNeutral);
        
        if (hasNeutral) {
          // Load first two videos to fill both buffers
          const first = await fetchNextFromApi();
          const second = await fetchNextFromApi();
          
          setVideoA(first);
          setVideoB(second);
          if (first) onVideoChange?.(first);
        }
      } catch (err) {
        console.error('Failed to check loop support:', err);
        setHasLoopSupport(false);
      }
      setIsLoading(false);
    };

    init();
  }, [onVideoChange]);

  // Handle mood changes
  useEffect(() => {
    if (!hasLoopSupport || !mood || mood === lastMoodRef.current) return;

    const updateMood = async () => {
      try {
        const { loopSet } = await lunaMediaApi.setMood(mood);
        lastMoodRef.current = mood;
        
        // When mood changes, we want to update the NEXT video buffer immediately
        // and potentially skip to it if it's a high priority change
        const nextMoodVideo = await fetchNextFromApi(loopSet);
        if (activeBuffer === 'A') {
          setVideoB(nextMoodVideo);
        } else {
          setVideoA(nextMoodVideo);
        }
      } catch (err) {
        console.error('Failed to update mood:', err);
      }
    };

    updateMood();
  }, [mood, hasLoopSupport, activeBuffer]);

  // Seamless transition handler
  const handleVideoEnded = useCallback(async () => {
    if (!hasLoopSupport) return;

    const currentVideo = activeBuffer === 'A' ? videoA : videoB;
    
    // If it was a special gesture, notify backend
    if (currentVideo?.isSpecial) {
      lunaMediaApi.finishSpecialGesture().catch(console.error);
    }

    // Switch buffers
    const newActiveBuffer = activeBuffer === 'A' ? 'B' : 'A';
    setActiveBuffer(newActiveBuffer);
    
    // Notify parent
    const nowPlaying = newActiveBuffer === 'A' ? videoA : videoB;
    if (nowPlaying) onVideoChange?.(nowPlaying);

    // Play the newly active video immediately
    const activeRef = newActiveBuffer === 'A' ? videoRefA : videoRefB;
    if (activeRef.current) {
      activeRef.current.play().catch(console.error);
    }

    // Load the NEXT video into the now-inactive buffer
    const nextVideo = await fetchNextFromApi();
    if (newActiveBuffer === 'A') {
      setVideoB(nextVideo);
    } else {
      setVideoA(nextVideo);
    }
  }, [hasLoopSupport, activeBuffer, videoA, videoB, onVideoChange]);

  // Ensure active video is playing
  useEffect(() => {
    const activeRef = activeBuffer === 'A' ? videoRefA : videoRefB;
    if (activeRef.current && (activeBuffer === 'A' ? videoA : videoB)) {
      activeRef.current.play().catch(() => {});
    }
  }, [activeBuffer, videoA, videoB]);

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
        {/* Buffer A */}
        <video
          ref={videoRefA}
          src={videoA ? getMediaUrl(videoA.url) : undefined}
          className={clsx(
            'absolute inset-0 w-full h-full object-cover transition-opacity duration-300',
            activeBuffer === 'A' ? 'opacity-100 z-10' : 'opacity-0 z-0'
          )}
          muted
          playsInline
          onEnded={activeBuffer === 'A' ? handleVideoEnded : undefined}
          preload="auto"
        />

        {/* Buffer B */}
        <video
          ref={videoRefB}
          src={videoB ? getMediaUrl(videoB.url) : undefined}
          className={clsx(
            'absolute inset-0 w-full h-full object-cover transition-opacity duration-300',
            activeBuffer === 'B' ? 'opacity-100 z-10' : 'opacity-0 z-0'
          )}
          muted
          playsInline
          onEnded={activeBuffer === 'B' ? handleVideoEnded : undefined}
          preload="auto"
        />

        {/* Fallback Image (background) */}
        <Image
          src={getMediaUrl('/api/images/luna2.jpg')}
          alt="Luna"
          width={256}
          height={256}
          className="absolute inset-0 w-full h-full object-cover -z-10"
        />

        {/* Speaking overlay effect */}
        {isSpeaking && (
          <div className="absolute inset-0 bg-gradient-to-t from-green-500/20 to-transparent pointer-events-none z-20" />
        )}
      </div>

      {/* Audio visualizer rings when speaking */}
      {isSpeaking && (
        <>
          <div className="absolute inset-0 -m-2 rounded-full border-2 border-green-400/50 animate-ping z-0" style={{ animationDuration: '1.5s' }} />
          <div className="absolute inset-0 -m-4 rounded-full border border-green-400/30 animate-ping z-0" style={{ animationDuration: '2s' }} />
        </>
      )}

      {/* Debug info */}
      {process.env.NODE_ENV === 'development' && (
        <div className="absolute -bottom-8 left-0 right-0 text-center text-xs text-gray-500 truncate">
          Active: {activeBuffer} | {activeBuffer === 'A' ? videoA?.loopSet : videoB?.loopSet}
        </div>
      )}
    </div>
  );
}