'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Gamepad2, Upload, Link2, RotateCcw, Play } from 'lucide-react';

type EmulatorSystem = 'c64' | 'amiga500';

const LOCAL_EMULATOR_DATA_PATH = '/emulatorjs/data/';
const CDN_EMULATOR_DATA_PATH = 'https://cdn.emulatorjs.org/stable/data/';
const LOCAL_EMULATOR_LOADER = `${LOCAL_EMULATOR_DATA_PATH}loader.js`;
const CDN_EMULATOR_LOADER = `${CDN_EMULATOR_DATA_PATH}loader.js`;

const SYSTEM_CONFIG: Record<
  EmulatorSystem,
  {
    label: string;
    core: string;
    accept: string;
    hint: string;
  }
> = {
  c64: {
    label: 'Commodore 64',
    core: 'vice_x64sc',
    accept: '.d64,.t64,.prg,.crt,.tap,.zip',
    hint: 'Supported: D64, T64, PRG, CRT, TAP, ZIP',
  },
  amiga500: {
    label: 'Amiga 500',
    core: 'puae',
    accept: '.adf,.adz,.dms,.hdf,.ipf,.lha,.zip',
    hint: 'Supported: ADF, ADZ, DMS, HDF, IPF, LHA, ZIP',
  },
};

function buildEmulatorHtml(core: string, gameUrl: string, dataPath: string, loaderUrl: string): string {
  return `<!DOCTYPE html>
<html><head>
<style>body{margin:0;overflow:hidden;background:#0f172a}#game{width:100%;height:100vh}</style>
</head><body>
<div id="game"></div>
<script>
var EJS_player = '#game';
var EJS_core = ${JSON.stringify(core)};
var EJS_gameUrl = ${JSON.stringify(gameUrl)};
var EJS_pathtodata = ${JSON.stringify(dataPath)};
var EJS_startOnLoaded = true;
var EJS_color = '#0f172a';
var EJS_volume = 0.85;
<\/script>
<script src="${loaderUrl}" onerror="
  if (this.src.indexOf('cdn.emulatorjs.org') === -1) {
    this.src = '${CDN_EMULATOR_LOADER}';
  }
"><\/script>
</body></html>`;
}

export default function GamesWindow() {
  const [system, setSystem] = useState<EmulatorSystem>('c64');
  const [gameUrl, setGameUrl] = useState<string | null>(null);
  const [gameName, setGameName] = useState<string>('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [collectionGames, setCollectionGames] = useState<string[]>([]);
  const [collectionQuery, setCollectionQuery] = useState('');
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const emuHostRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  const config = useMemo(() => SYSTEM_CONFIG[system], [system]);
  const filteredCollectionGames = useMemo(() => {
    if (!collectionQuery.trim()) {
      return collectionGames;
    }

    const query = collectionQuery.trim().toLowerCase();
    return collectionGames.filter((name) => name.toLowerCase().includes(query));
  }, [collectionGames, collectionQuery]);

  const cleanupHost = () => {
    if (emuHostRef.current) {
      emuHostRef.current.innerHTML = '';
    }
  };

  const loadGame = (nextGameUrl?: string) => {
    const resolvedGameUrl = nextGameUrl || gameUrl;
    if (!resolvedGameUrl || !emuHostRef.current) return;

    setError(null);
    setIsLoading(true);
    cleanupHost();

    const iframe = document.createElement('iframe');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.allow = 'autoplay';
    iframe.srcdoc = buildEmulatorHtml(config.core, resolvedGameUrl, LOCAL_EMULATOR_DATA_PATH, LOCAL_EMULATOR_LOADER);
    iframe.onload = () => setIsLoading(false);
    emuHostRef.current.appendChild(iframe);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    const nextUrl = URL.createObjectURL(file);
    objectUrlRef.current = nextUrl;
    setGameUrl(nextUrl);
    setGameName(file.name);
    setError(null);
  };

  const handleLoadRemote = () => {
    const trimmed = remoteUrl.trim();
    if (!trimmed) return;

    try {
      const parsed = new URL(trimmed);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        setError('Only http/https URLs are supported.');
        return;
      }

      setGameUrl(parsed.toString());
      setGameName(parsed.pathname.split('/').pop() || parsed.host);
      setError(null);
    } catch {
      setError('Invalid game URL.');
    }
  };

  const handleCollectionSelect = (filename: string) => {
    const encodedName = encodeURIComponent(filename);
    const url = `/games/c64/collection/${encodedName}`;
    setSystem('c64');
    setGameUrl(url);
    setGameName(filename);
    setError(null);
    loadGame(url);
  };

  const handleReset = () => {
    cleanupHost();
    setIsLoading(false);
    setError(null);
  };

  useEffect(() => {
    return () => {
      cleanupHost();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (system !== 'c64') return;

    const loadCollectionIndex = async () => {
      setCollectionLoading(true);
      try {
        const response = await fetch('/games/c64/collection-index.txt', { cache: 'no-store' });
        if (!response.ok) {
          setCollectionGames([]);
          return;
        }

        const text = await response.text();
        const names = text
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        setCollectionGames(names);
      } catch {
        setCollectionGames([]);
      } finally {
        setCollectionLoading(false);
      }
    };

    loadCollectionIndex();
  }, [system]);

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--theme-bg-primary)' }}>
      <div
        className="p-3 border-b flex flex-wrap items-center gap-2"
        style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-bg-secondary)' }}
      >
        <div className="flex items-center gap-2 mr-2">
          <Gamepad2 className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
            Retro Games
          </span>
        </div>

        <div className="inline-flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--theme-border)' }}>
          <button
            onClick={() => setSystem('c64')}
            className="px-3 py-1.5 text-xs font-medium"
            style={{
              background: system === 'c64' ? 'var(--theme-accent-primary)' : 'var(--theme-bg-tertiary)',
              color: system === 'c64' ? '#fff' : 'var(--theme-text-secondary)',
            }}
          >
            C64
          </button>
          <button
            onClick={() => setSystem('amiga500')}
            className="px-3 py-1.5 text-xs font-medium"
            style={{
              background: system === 'amiga500' ? 'var(--theme-accent-primary)' : 'var(--theme-bg-tertiary)',
              color: system === 'amiga500' ? '#fff' : 'var(--theme-text-secondary)',
            }}
          >
            Amiga 500
          </button>
        </div>

        <label
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs cursor-pointer"
          style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-secondary)' }}
        >
          <Upload className="w-3.5 h-3.5" />
          Load Game File
          <input
            type="file"
            accept={config.accept}
            className="hidden"
            onChange={handleFileSelect}
          />
        </label>

        <div className="flex items-center gap-2 min-w-[280px] flex-1 max-w-[520px]">
          <div className="relative flex-1">
            <Link2 className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-text-muted)' }} />
            <input
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder="Or paste game file URL"
              className="w-full rounded-lg border pl-7 pr-2 py-1.5 text-xs bg-transparent focus:outline-none"
              style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
            />
          </div>
          <button
            onClick={handleLoadRemote}
            className="px-2.5 py-1.5 text-xs rounded-lg border"
            style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-secondary)' }}
          >
            Use URL
          </button>
        </div>

        <button
          onClick={() => loadGame()}
          disabled={!gameUrl || isLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
          style={{ background: 'var(--theme-accent-primary)', color: '#fff' }}
        >
          <Play className="w-3.5 h-3.5" />
          {isLoading ? 'Loading...' : 'Run'}
        </button>

        <button
          onClick={handleReset}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border"
          style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-secondary)' }}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset
        </button>
      </div>

      <div className="px-3 py-2 text-xs border-b" style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-muted)' }}>
        <span className="font-medium" style={{ color: 'var(--theme-text-secondary)' }}>{config.label}</span>
        {' - '}
        {config.hint}
        {gameName ? (
          <>
            {' - '}
            Loaded: <span style={{ color: 'var(--theme-text-secondary)' }}>{gameName}</span>
          </>
        ) : null}
      </div>

      {error ? (
        <div className="px-3 py-2 text-xs border-b text-red-400" style={{ borderColor: 'var(--theme-border)' }}>
          {error}
        </div>
      ) : null}

      <div className="flex-1 p-3 min-h-0 flex gap-3">
        <aside
          className="w-[280px] shrink-0 border rounded-lg overflow-hidden flex flex-col"
          style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-bg-secondary)' }}
        >
          <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--theme-border)' }}>
            <p className="text-xs font-medium" style={{ color: 'var(--theme-text-secondary)' }}>
              C64 Collection
            </p>
            <p className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
              {collectionGames.length} games
            </p>
          </div>

          <div className="p-2 border-b" style={{ borderColor: 'var(--theme-border)' }}>
            <input
              value={collectionQuery}
              onChange={(e) => setCollectionQuery(e.target.value)}
              placeholder="Search games..."
              className="w-full rounded-md border px-2 py-1.5 text-xs bg-transparent focus:outline-none"
              style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
            />
          </div>

          <div className="flex-1 overflow-y-auto p-1.5">
            {system !== 'c64' ? (
              <p className="text-xs px-2 py-2" style={{ color: 'var(--theme-text-muted)' }}>
                Switch to C64 to browse this collection.
              </p>
            ) : collectionLoading ? (
              <p className="text-xs px-2 py-2" style={{ color: 'var(--theme-text-muted)' }}>
                Loading game list...
              </p>
            ) : filteredCollectionGames.length === 0 ? (
              <p className="text-xs px-2 py-2" style={{ color: 'var(--theme-text-muted)' }}>
                No games found.
              </p>
            ) : (
              filteredCollectionGames.map((name) => (
                <button
                  key={name}
                  onClick={() => handleCollectionSelect(name)}
                  className="w-full text-left text-xs px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors"
                  style={{ color: gameName === name ? 'var(--theme-accent-primary)' : 'var(--theme-text-primary)' }}
                  title={name}
                >
                  {name.replace(/\.zip$/i, '')}
                </button>
              ))
            )}
          </div>
        </aside>

        <div
          className="flex-1 h-full rounded-lg overflow-hidden border relative"
          style={{
            borderColor: 'var(--theme-border)',
            background:
              'radial-gradient(circle at 20% 20%, rgba(56, 189, 248, 0.08), transparent 50%), var(--theme-bg-secondary)',
          }}
        >
          <div ref={emuHostRef} className="w-full h-full" />
          {!gameUrl ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8">
              <Gamepad2 className="w-10 h-10 mb-2 opacity-60" style={{ color: 'var(--theme-text-muted)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--theme-text-secondary)' }}>
                Load a game to start
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--theme-text-muted)' }}>
                Choose C64 or Amiga 500, then load a local file or URL and click Run.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
