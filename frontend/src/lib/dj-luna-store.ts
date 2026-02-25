'use client';

import { create } from 'zustand';
import { workspaceApi } from './api/workspace';
import type { SunoGeneration } from './api/suno';

export interface SongMeta {
  title: string;
  project: string;
  style: string;
  path: string;
  slug?: string;
}

export interface StylePreset {
  id: string;
  name: string;
  tags: string;
  color?: string;
}

export interface ProjectFolder {
  name: string;
  songs: SongMeta[];
}

interface DJLunaState {
  // Session
  sessionId: string | null;

  // Canvas
  canvasContent: string;
  canvasDirty: boolean;

  // Current song
  currentSong: SongMeta | null;

  // Style
  activeStyle: string;
  activePresetId: string | null;
  customPresets: StylePreset[];

  // Song list
  projects: ProjectFolder[];
  isLoadingSongs: boolean;

  // Active genre for Check tab (shared with chat context)
  activeGenreId: string | null;

  // UI state
  showStartupModal: boolean;

  // Generations (Suno factory)
  generations: SunoGeneration[];
  isLoadingGenerations: boolean;

  // Actions
  setCanvasContent: (content: string, markDirty?: boolean) => void;
  setActiveStyle: (style: string, presetId?: string | null) => void;
  loadSong: (path: string) => Promise<void>;
  saveSong: () => Promise<void>;
  newSong: (title: string, project: string, initialContent?: string) => void;
  loadSongList: () => Promise<void>;
  addCustomPreset: (name: string, tags: string) => void;
  removeCustomPreset: (id: string) => void;
  setActiveGenreId: (id: string | null) => void;
  setSessionId: (id: string) => void;
  setShowStartupModal: (show: boolean) => void;
  markCanvasClean: () => void;
  triggerBatch: (count: number, style?: string) => Promise<void>;
  triggerSongGeneration: (title: string, lyrics: string, style: string) => Promise<void>;
  pollGenerations: () => Promise<void>;
}

function slugify(text: string): string {
  // Only strip filesystem-unsafe characters; preserve åäö and other Unicode
  return text
    .replace(/[/\\:*?"<>|]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      meta[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
    }
  }
  return { meta, body: match[2] };
}

export const useDJLunaStore = create<DJLunaState>((set, get) => ({
  sessionId: null,
  canvasContent: '',
  activeGenreId: null,
  canvasDirty: false,
  currentSong: null,
  activeStyle: '',
  activePresetId: null,
  customPresets: [],
  projects: [],
  isLoadingSongs: false,
  showStartupModal: true,
  generations: [],
  isLoadingGenerations: false,

  setCanvasContent: (content, markDirty = true) => {
    set({ canvasContent: content, canvasDirty: markDirty });
  },

  setActiveStyle: (style, presetId = null) => {
    set({ activeStyle: style, activePresetId: presetId });
  },

  loadSong: async (path: string) => {
    try {
      const { content } = await workspaceApi.getFile(path);
      const { meta, body } = parseFrontmatter(content);
      const song: SongMeta = {
        title: meta.title || path,
        project: meta.project || 'Unknown',
        style: meta.style || '',
        path,
      };
      set({
        currentSong: song,
        canvasContent: body.trim(),
        canvasDirty: false,
      });
      if (meta.style) {
        set({ activeStyle: meta.style, activePresetId: null });
      }
    } catch (err) {
      console.error('Failed to load song:', err);
    }
  },

  saveSong: async () => {
    const { currentSong, canvasContent, activeStyle } = get();
    if (!currentSong) return;

    const frontmatter = [
      '---',
      `title: ${currentSong.title}`,
      `project: ${currentSong.project}`,
      `style: ${activeStyle || currentSong.style}`,
      `saved: ${new Date().toISOString().split('T')[0]}`,
      '---',
      '',
    ].join('\n');

    const fileContent = frontmatter + canvasContent;

    try {
      // Try update first, then create
      try {
        await workspaceApi.updateFile(currentSong.path, fileContent);
      } catch {
        await workspaceApi.createFile(currentSong.path, fileContent);
      }
      set({ canvasDirty: false });
      // Refresh song list
      get().loadSongList();
    } catch (err) {
      console.error('Failed to save song:', err);
      throw err;
    }
  },

  newSong: (title: string, project: string, initialContent?: string) => {
    const slug = slugify(title);
    const path = `dj-luna/${project}/${slug}.md`;
    const song: SongMeta = { title, project, style: get().activeStyle, path, slug };
    set({
      currentSong: song,
      // If initialContent provided (Save As flow), preserve it; otherwise use blank template
      canvasContent: initialContent !== undefined
        ? initialContent
        : '[Intro]\n\n[Verse 1]\n\n[Chorus]\n\n[Verse 2]\n\n[Chorus]\n\n[Outro]\n',
      canvasDirty: true,
    });
  },

  loadSongList: async () => {
    set({ isLoadingSongs: true });
    try {
      const files = await workspaceApi.listFiles();
      const songFiles = files.filter((f) => f.path.startsWith('dj-luna/') && f.path.endsWith('.md') && !f.path.endsWith('styles.json'));

      // Load frontmatter from each song file in parallel to get actual titles (preserves åäö)
      const songDetails = await Promise.all(
        songFiles.map(async (file) => {
          const parts = file.path.split('/');
          const projectName = parts.length >= 3 ? parts[1] : 'Unsorted';
          const basenameTitle = (parts[parts.length - 1] ?? '').replace(/\.md$/, '').replace(/-/g, ' ');
          try {
            const { content } = await workspaceApi.getFile(file.path);
            const { meta } = parseFrontmatter(content);
            return { file, projectName, title: meta.title || basenameTitle };
          } catch {
            return { file, projectName, title: basenameTitle };
          }
        })
      );

      const projectMap: Record<string, SongMeta[]> = {};
      for (const { file, projectName, title } of songDetails) {
        if (!projectMap[projectName]) projectMap[projectName] = [];
        projectMap[projectName].push({
          title,
          project: projectName,
          style: '',
          path: file.path,
        });
      }

      const projects: ProjectFolder[] = Object.entries(projectMap).map(([name, songs]) => ({ name, songs }));
      set({ projects });
    } catch (err) {
      console.error('Failed to load song list:', err);
    } finally {
      set({ isLoadingSongs: false });
    }
  },

  addCustomPreset: (name: string, tags: string) => {
    const preset: StylePreset = {
      id: `custom-${Date.now()}`,
      name,
      tags,
    };
    set((state) => ({ customPresets: [...state.customPresets, preset] }));
    // Save to workspace
    const { customPresets } = get();
    workspaceApi.createFile('dj-luna/styles.json', JSON.stringify({ custom: customPresets }, null, 2))
      .catch(() => workspaceApi.updateFile('dj-luna/styles.json', JSON.stringify({ custom: customPresets }, null, 2)));
  },

  removeCustomPreset: (id: string) => {
    set((state) => ({ customPresets: state.customPresets.filter((p) => p.id !== id) }));
    const { customPresets } = get();
    workspaceApi.updateFile('dj-luna/styles.json', JSON.stringify({ custom: customPresets }, null, 2))
      .catch(console.error);
  },

  setActiveGenreId: (id: string | null) => set({ activeGenreId: id }),

  setSessionId: (id: string) => set({ sessionId: id }),

  setShowStartupModal: (show: boolean) => set({ showStartupModal: show }),

  markCanvasClean: () => set({ canvasDirty: false }),

  triggerBatch: async (count: number, style?: string) => {
    const { triggerGeneration } = await import('./api/suno');
    const result = await triggerGeneration(count, style);
    // Prepend new pending generations to list
    set((state) => ({
      generations: [...result.generations, ...state.generations],
    }));
  },

  triggerSongGeneration: async (title: string, lyrics: string, style: string) => {
    const { triggerGeneration } = await import('./api/suno');
    const result = await triggerGeneration(1, style, lyrics, title);
    set((state) => ({
      generations: [...result.generations, ...state.generations],
    }));
  },

  pollGenerations: async () => {
    const { isLoadingGenerations } = get();
    if (isLoadingGenerations) return;
    set({ isLoadingGenerations: true });
    try {
      const { getGenerations } = await import('./api/suno');
      const result = await getGenerations(50);
      set({ generations: result.generations });
    } catch (err) {
      console.error('Failed to poll generations:', err);
    } finally {
      set({ isLoadingGenerations: false });
    }
  },
}));
