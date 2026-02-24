'use client';

import { useEffect, useRef, useState } from 'react';
import { useDJLunaStore } from '@/lib/dj-luna-store';
import { DJLunaChat } from '@/components/dj-luna/DJLunaChat';
import { LyricsCanvas } from '@/components/dj-luna/LyricsCanvas';
import { SongList } from '@/components/dj-luna/SongList';
import { StylePanel } from '@/components/dj-luna/StylePanel';
import { StartupModal } from '@/components/dj-luna/StartupModal';
import { GenerationsPanel } from '@/components/dj-luna/GenerationsPanel';

type RightTab = 'songs' | 'style' | 'factory';

export default function DJLunaWindow() {
  const { showStartupModal, loadSongList } = useDJLunaStore();
  const initialized = useRef(false);
  const [rightTab, setRightTab] = useState<RightTab>('songs');

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

        {/* Right: tabbed panel (Songs | Style | Factory) */}
        <div className="flex flex-col border-l border-gray-700 overflow-hidden" style={{ width: '30%', minWidth: 240 }}>
          {/* Tab bar */}
          <div className="flex border-b border-gray-700 shrink-0">
            {(['songs', 'style', 'factory'] as RightTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setRightTab(tab)}
                className={`flex-1 py-1.5 text-xs capitalize transition-colors ${
                  rightTab === tab
                    ? 'text-white border-b-2 border-purple-500'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">
            {rightTab === 'songs' && <SongList />}
            {rightTab === 'style' && <StylePanel />}
            {rightTab === 'factory' && <GenerationsPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
