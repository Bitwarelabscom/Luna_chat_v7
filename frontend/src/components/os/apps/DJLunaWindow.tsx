'use client';

import { useEffect, useRef } from 'react';
import { useDJLunaStore } from '@/lib/dj-luna-store';
import { DJLunaChat } from '@/components/dj-luna/DJLunaChat';
import { LyricsCanvas } from '@/components/dj-luna/LyricsCanvas';
import { SongList } from '@/components/dj-luna/SongList';
import { StylePanel } from '@/components/dj-luna/StylePanel';
import { StartupModal } from '@/components/dj-luna/StartupModal';

export default function DJLunaWindow() {
  const { showStartupModal, loadSongList } = useDJLunaStore();
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      loadSongList();
    }
  }, [loadSongList]);

  const handleRegenerateSection = (section: string) => {
    // Dispatch event that DJLunaChat listens to
    window.dispatchEvent(new CustomEvent('dj-luna:regenerate', { detail: section }));
  };

  return (
    <div className="relative flex h-full overflow-hidden bg-gray-950">
      {/* Startup modal */}
      {showStartupModal && <StartupModal />}

      {/* 3-column layout: 30% chat | 40% canvas | 30% right panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Chat panel */}
        <div className="flex flex-col border-r border-gray-700 overflow-hidden" style={{ width: '30%', minWidth: 280 }}>
          <DJLunaChat />
        </div>

        {/* Center: Lyrics canvas */}
        <div className="flex flex-col overflow-hidden flex-1">
          <LyricsCanvas onRegenerateSection={handleRegenerateSection} />
        </div>

        {/* Right: Song list + style panel */}
        <div className="flex flex-col border-l border-gray-700 overflow-hidden" style={{ width: '30%', minWidth: 240 }}>
          {/* Songs - top 60% */}
          <div className="overflow-hidden" style={{ flex: '0 0 60%' }}>
            <SongList />
          </div>

          {/* Style panel - bottom 40% */}
          <div className="relative overflow-hidden" style={{ flex: '0 0 40%' }}>
            <StylePanel />
          </div>
        </div>
      </div>
    </div>
  );
}
