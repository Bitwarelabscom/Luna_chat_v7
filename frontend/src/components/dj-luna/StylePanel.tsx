'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Plus, X, Check } from 'lucide-react';
import { useDJLunaStore, type StylePreset } from '@/lib/dj-luna-store';
import { GENRE_PRESETS, GENRE_CATEGORIES, GENRE_CATEGORY_LABELS, type GenreCategory } from '@/lib/genre-presets';

type CategoryFilter = 'all' | GenreCategory;

export function StylePanel() {
  const { activeStyle, activePresetId, customPresets, setActiveStyle, addCustomPreset, removeCustomPreset } = useDJLunaStore();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleStyleChange = useCallback((value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setActiveStyle(value, null);
    }, 300);
  }, [setActiveStyle]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handlePresetClick = (preset: { id: string; tags: string }) => {
    setActiveStyle(preset.tags, preset.id);
  };

  const handleSavePreset = () => {
    if (!newPresetName.trim()) return;
    addCustomPreset(newPresetName.trim(), activeStyle);
    setNewPresetName('');
    setShowSaveDialog(false);
  };

  // Convert genre presets to style presets for display
  const builtinPresets: Array<{ id: string; name: string; tags: string; category: GenreCategory }> =
    GENRE_PRESETS.map(g => ({ id: g.id, name: g.name, tags: g.styleTags, category: g.category }));

  const filteredPresets = categoryFilter === 'all'
    ? builtinPresets
    : builtinPresets.filter(p => p.category === categoryFilter);

  // Group by category when showing all
  const groupedPresets = categoryFilter === 'all'
    ? GENRE_CATEGORIES.map(cat => ({
        category: cat,
        label: GENRE_CATEGORY_LABELS[cat],
        presets: builtinPresets.filter(p => p.category === cat),
      })).filter(g => g.presets.length > 0)
    : null;

  return (
    <div className="flex flex-col h-full bg-gray-900 border-t border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <span className="text-xs font-semibold text-purple-300 uppercase tracking-wider">Style</span>
        <button
          onClick={() => setShowSaveDialog(true)}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-purple-300 hover:bg-gray-800 rounded transition-colors"
          title="Save as preset"
        >
          <Plus size={12} />
          Save preset
        </button>
      </div>

      {/* Style textarea */}
      <div className="px-3 pt-2 pb-1">
        <textarea
          defaultValue={activeStyle}
          key={activeStyle}
          onChange={(e) => handleStyleChange(e.target.value)}
          placeholder="dark techno, 140 bpm, industrial, heavy kick..."
          className="w-full h-20 bg-gray-800 text-gray-200 text-xs rounded px-2 py-2 resize-none border border-gray-700 focus:border-purple-500 focus:outline-none placeholder-gray-600 font-mono"
        />
      </div>

      {/* Category filter pills */}
      <div className="px-3 py-1.5 flex flex-wrap gap-1 border-b border-gray-800">
        <button
          onClick={() => setCategoryFilter('all')}
          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
            categoryFilter === 'all'
              ? 'bg-purple-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-gray-300'
          }`}
        >
          All
        </button>
        {GENRE_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              categoryFilter === cat
                ? 'bg-purple-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-300'
            }`}
          >
            {GENRE_CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Preset chips */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {groupedPresets ? (
          // Grouped view when "All" is selected
          groupedPresets.map((group) => (
            <div key={group.category} className="mb-2">
              <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1">
                {group.label}
              </div>
              <div className="flex flex-wrap gap-1.5 mb-1">
                {group.presets.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => handlePresetClick(preset)}
                    className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                      activePresetId === preset.id
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-purple-300'
                    }`}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>
          ))
        ) : (
          // Flat view when a specific category is selected
          <div className="flex flex-wrap gap-1.5">
            {filteredPresets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handlePresetClick(preset)}
                className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                  activePresetId === preset.id
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-purple-300'
                }`}
              >
                {preset.name}
              </button>
            ))}
          </div>
        )}

        {/* Custom presets section */}
        {customPresets.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-800">
            <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1">
              Custom
            </div>
            <div className="flex flex-wrap gap-1.5">
              {customPresets.map((preset: StylePreset) => (
                <div key={preset.id} className="relative group">
                  <button
                    onClick={() => handlePresetClick(preset)}
                    className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                      activePresetId === preset.id
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-purple-300'
                    }`}
                  >
                    {preset.name}
                  </button>
                  <button
                    onClick={() => removeCustomPreset(preset.id)}
                    className="absolute -top-1 -right-1 hidden group-hover:flex items-center justify-center w-3.5 h-3.5 bg-red-600 rounded-full text-white"
                  >
                    <X size={8} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Save preset dialog */}
      {showSaveDialog && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-10">
          <div className="bg-gray-800 rounded-lg p-4 w-64 border border-gray-700 shadow-xl">
            <h3 className="text-sm font-semibold text-white mb-3">Save Style Preset</h3>
            <input
              autoFocus
              type="text"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSavePreset();
                if (e.key === 'Escape') setShowSaveDialog(false);
              }}
              placeholder="Preset name..."
              className="w-full bg-gray-700 text-white text-sm rounded px-3 py-2 border border-gray-600 focus:border-purple-500 focus:outline-none mb-3"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSavePreset}
                disabled={!newPresetName.trim()}
                className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs rounded transition-colors"
              >
                <Check size={12} /> Save
              </button>
              <button
                onClick={() => setShowSaveDialog(false)}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
