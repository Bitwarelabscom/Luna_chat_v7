'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Save, RotateCcw, Clipboard } from 'lucide-react';
import { useDJLunaStore } from '@/lib/dj-luna-store';
import { analyzeLineSyllables } from '@/lib/syllable-counter';

interface LyricsCanvasProps {
  onRegenerateSection?: (section: string) => void;
}

function SyllableGutter({ lines }: { lines: { count: number; isFlagged: boolean }[] }) {
  return (
    <div className="flex flex-col text-right pr-2 select-none pointer-events-none" style={{ minWidth: '2.5rem' }}>
      {lines.map((l, i) => (
        <div
          key={i}
          className={`text-[10px] leading-6 font-mono ${
            l.count === 0 ? 'text-transparent' : l.isFlagged ? 'text-amber-400' : 'text-gray-600'
          }`}
          style={{ height: '1.5rem' }}
        >
          {l.count > 0 ? l.count : ''}
        </div>
      ))}
    </div>
  );
}

export function LyricsCanvas({ onRegenerateSection }: LyricsCanvasProps) {
  const { canvasContent, currentSong, activeStyle, setCanvasContent, saveSong, canvasDirty } = useDJLunaStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [lineAnalysis, setLineAnalysis] = useState<ReturnType<typeof analyzeLineSyllables>>([]);
  const [hoveredSection, setHoveredSection] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [editableTitle, setEditableTitle] = useState<string>(currentSong?.title || 'Untitled');

  useEffect(() => {
    setEditableTitle(currentSong?.title || 'Untitled');
  }, [currentSong]);

  useEffect(() => {
    const analysis = analyzeLineSyllables(canvasContent);
    setLineAnalysis(analysis);
  }, [canvasContent]);

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCanvasContent(e.target.value);
  }, [setCanvasContent]);

  const handleSave = useCallback(async () => {
    setSaveStatus('saving');
    try {
      await saveSong();
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  }, [saveSong]);

  // Cmd/Ctrl+S to save
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave]);

  const handleCopySunoPrompt = () => {
    const prompt = `${activeStyle}\n\n${canvasContent}`;
    navigator.clipboard.writeText(prompt).catch(console.error);
  };

  const handleCopySection = (sectionContent: string) => {
    navigator.clipboard.writeText(sectionContent).catch(console.error);
  };

  // Parse sections for hover toolbar
  const sections = (() => {
    const result: { name: string; startLine: number; endLine: number; content: string }[] = [];
    const lines = canvasContent.split('\n');
    let currentSection: { name: string; startLine: number; lines: string[] } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\[(.+?)\]/);
      if (m) {
        if (currentSection) {
          result.push({
            name: currentSection.name,
            startLine: currentSection.startLine,
            endLine: i - 1,
            content: currentSection.lines.join('\n'),
          });
        }
        currentSection = { name: m[1], startLine: i, lines: [lines[i]] };
      } else if (currentSection) {
        currentSection.lines.push(lines[i]);
      }
    }
    if (currentSection) {
      result.push({
        name: currentSection.name,
        startLine: currentSection.startLine,
        endLine: lines.length - 1,
        content: currentSection.lines.join('\n'),
      });
    }
    return result;
  })();

  const lineHeight = 24; // px - must match textarea line-height

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 shrink-0 bg-gray-900">
        {/* Editable song title */}
        <input
          value={editableTitle}
          onChange={(e) => setEditableTitle(e.target.value)}
          className="flex-1 bg-transparent text-sm font-semibold text-white focus:outline-none focus:border-b focus:border-purple-500"
          placeholder="Untitled Song"
        />
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={handleCopySunoPrompt}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-purple-300 rounded transition-colors"
            title="Copy Suno prompt (style + lyrics)"
          >
            <Clipboard size={12} /> Copy Suno Prompt
          </button>
          <button
            onClick={handleSave}
            disabled={!currentSong || saveStatus === 'saving'}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded transition-colors ${
              saveStatus === 'saved' ? 'bg-green-700 text-white' :
              saveStatus === 'error' ? 'bg-red-700 text-white' :
              canvasDirty ? 'bg-purple-600 hover:bg-purple-700 text-white' :
              'bg-gray-800 hover:bg-gray-700 text-gray-400'
            }`}
            title="Save song (Cmd/Ctrl+S)"
          >
            <Save size={12} />
            {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved!' : saveStatus === 'error' ? 'Error' : 'Save'}
          </button>
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-hidden relative">
        {/* Section hover overlays */}
        {onRegenerateSection && sections.map((sec) => {
          const isHovered = hoveredSection === sec.name;
          const topPx = sec.startLine * lineHeight + 8; // 8px padding
          return (
            <div
              key={`${sec.name}-${sec.startLine}`}
              style={{ top: topPx, left: 0, right: 42 }}
              className="absolute z-10 pointer-events-none"
            >
              {isHovered && (
                <div className="flex gap-1 ml-12 pointer-events-auto">
                  <button
                    onClick={() => onRegenerateSection(sec.name)}
                    className="flex items-center gap-1 px-2 py-0.5 bg-purple-900/90 hover:bg-purple-800 text-purple-200 text-xs rounded shadow-lg border border-purple-700"
                  >
                    <RotateCcw size={10} /> Regenerate
                  </button>
                  <button
                    onClick={() => handleCopySection(sec.content)}
                    className="flex items-center gap-1 px-2 py-0.5 bg-gray-800/90 hover:bg-gray-700 text-gray-300 text-xs rounded shadow-lg border border-gray-600"
                  >
                    <Copy size={10} /> Copy
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <div className="flex h-full">
          {/* Syllable gutter */}
          <div className="bg-gray-950 pt-2 shrink-0 overflow-hidden" style={{ paddingTop: '0.5rem' }}>
            <SyllableGutter lines={lineAnalysis.map((l) => ({ count: l.count, isFlagged: l.isFlagged }))} />
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={canvasContent}
            onChange={handleContentChange}
            onMouseMove={(e) => {
              // Detect which section we're hovering over based on y position
              const rect = (e.currentTarget as HTMLTextAreaElement).getBoundingClientRect();
              const y = e.clientY - rect.top;
              const lineIndex = Math.floor(y / lineHeight);
              const sec = sections.find((s) => lineIndex >= s.startLine && lineIndex <= s.endLine);
              setHoveredSection(sec?.name ?? null);
            }}
            onMouseLeave={() => setHoveredSection(null)}
            placeholder={'[Intro]\n\n[Verse 1]\nWrite your lyrics here...\n\n[Chorus]\nChorus lyrics...'}
            className="flex-1 h-full bg-gray-950 text-gray-200 font-mono text-sm resize-none focus:outline-none p-2"
            style={{
              lineHeight: `${lineHeight}px`,
              caretColor: '#a855f7',
            }}
            spellCheck={false}
          />
        </div>

        {/* Flagged lines highlight overlay - rendered as absolutely positioned divs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden pl-10">
          {lineAnalysis.map((l, i) => {
            if (!l.isFlagged || l.count === 0) return null;
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  top: i * lineHeight + 8,
                  left: 0,
                  right: 0,
                  height: lineHeight,
                  backgroundColor: 'rgba(245, 158, 11, 0.08)',
                  borderLeft: '2px solid rgba(245, 158, 11, 0.5)',
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
