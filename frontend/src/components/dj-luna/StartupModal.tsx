'use client';

import { useState } from 'react';
import { Music2, X } from 'lucide-react';
import { useDJLunaStore, type StylePreset } from '@/lib/dj-luna-store';

const BUILTIN_PRESETS: StylePreset[] = [
  { id: 'dark-techno',    name: 'Dark Techno',    tags: 'dark techno, 140 bpm, industrial, heavy kick, Berlin underground, hypnotic',   color: '#6b21a8' },
  { id: 'lofi-hiphop',   name: 'Lo-fi Hip Hop',  tags: 'lo-fi hip hop, 90 bpm, chill, boom bap, vinyl texture, mellow',                color: '#b45309' },
  { id: 'melodic-house', name: 'Melodic House',   tags: 'melodic house, 124 bpm, progressive, emotional, warm synths, female vocal',    color: '#0e7490' },
  { id: 'trap',          name: 'Trap',            tags: 'trap, 140 bpm, 808 bass, hi-hats, dark, hard-hitting',                        color: '#1e1b4b' },
  { id: 'ambient',       name: 'Ambient',         tags: 'ambient, 70 bpm, atmospheric, pads, cinematic, ethereal',                     color: '#064e3b' },
  { id: 'pop',           name: 'Pop',             tags: 'pop, 120 bpm, catchy, upbeat, polished production',                           color: '#be185d' },
  { id: 'rnb',           name: 'R&B',             tags: 'r&b, 90 bpm, soulful, smooth, groovy, contemporary',                         color: '#92400e' },
  { id: 'phonk',         name: 'Phonk',           tags: 'phonk, 130 bpm, dark, drift, memphis rap, 808 bass',                         color: '#374151' },
];

export function StartupModal() {
  const { setShowStartupModal, setActiveStyle, newSong, projects, loadSong } = useDJLunaStore();
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [songTitle, setSongTitle] = useState('');
  const [projectName, setProjectName] = useState('');
  const [tab, setTab] = useState<'new' | 'open'>('new');

  const recentSongs = projects.flatMap((p) => p.songs).slice(0, 5);

  const selectedPreset = BUILTIN_PRESETS.find((p) => p.id === selectedPresetId);

  const handleStart = () => {
    if (selectedPreset) {
      setActiveStyle(selectedPreset.tags, selectedPreset.id);
    }
    if (tab === 'new' && songTitle.trim() && projectName.trim()) {
      newSong(songTitle.trim(), projectName.trim());
    }
    setShowStartupModal(false);
  };

  const handleOpenSong = async (path: string) => {
    if (selectedPreset) {
      setActiveStyle(selectedPreset.tags, selectedPreset.id);
    }
    await loadSong(path);
    setShowStartupModal(false);
  };

  const handleSkip = () => {
    setShowStartupModal(false);
  };

  return (
    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-[640px] max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-700">
          <div className="p-2 bg-purple-600/20 rounded-xl">
            <Music2 size={24} className="text-purple-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">DJ Luna Studio</h2>
            <p className="text-sm text-gray-400">Suno AI music production</p>
          </div>
          <button onClick={handleSkip} className="ml-auto text-gray-500 hover:text-gray-300 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Style preset grid */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Pick a Style</h3>
            <div className="grid grid-cols-4 gap-2">
              {BUILTIN_PRESETS.map((preset) => {
                const isSelected = selectedPresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => setSelectedPresetId(isSelected ? null : preset.id)}
                    className={`relative rounded-xl p-3 text-left transition-all border-2 ${
                      isSelected
                        ? 'border-purple-500 bg-purple-900/30'
                        : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                    }`}
                  >
                    <div
                      className="w-6 h-6 rounded-full mb-2 opacity-80"
                      style={{ backgroundColor: preset.color }}
                    />
                    <div className="text-xs font-medium text-white">{preset.name}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{preset.tags}</div>
                    {isSelected && (
                      <div className="absolute top-1.5 right-1.5 w-3 h-3 bg-purple-500 rounded-full" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* New / Open tabs */}
          <div>
            <div className="flex border-b border-gray-700 mb-4">
              <button
                onClick={() => setTab('new')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  tab === 'new' ? 'text-purple-300 border-b-2 border-purple-500 -mb-px' : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                New Song
              </button>
              <button
                onClick={() => setTab('open')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  tab === 'open' ? 'text-purple-300 border-b-2 border-purple-500 -mb-px' : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                Open Recent
              </button>
            </div>

            {tab === 'new' ? (
              <div className="space-y-3">
                <input
                  autoFocus
                  type="text"
                  value={songTitle}
                  onChange={(e) => setSongTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleStart(); }}
                  placeholder="Song title..."
                  className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 border border-gray-700 focus:border-purple-500 focus:outline-none text-sm"
                />
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleStart(); }}
                  placeholder="Album / project name..."
                  className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 border border-gray-700 focus:border-purple-500 focus:outline-none text-sm"
                />
              </div>
            ) : (
              <div className="space-y-1">
                {recentSongs.length === 0 ? (
                  <div className="text-sm text-gray-500 py-4 text-center">No recent songs</div>
                ) : (
                  recentSongs.map((song) => (
                    <button
                      key={song.path}
                      onClick={() => handleOpenSong(song.path)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-left transition-colors"
                    >
                      <Music2 size={14} className="text-purple-400 shrink-0" />
                      <div>
                        <div className="text-sm text-white">{song.title}</div>
                        <div className="text-xs text-gray-500">{song.project}</div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-700">
          <button onClick={handleSkip} className="text-sm text-gray-500 hover:text-gray-400 transition-colors">
            Skip - just start
          </button>
          <button
            onClick={handleStart}
            className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {tab === 'new' && songTitle.trim() ? 'Start Writing' : 'Open Studio'}
          </button>
        </div>
      </div>
    </div>
  );
}
