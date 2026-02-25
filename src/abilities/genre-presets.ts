export interface GenreStructureSection {
  tag: string;
  required: boolean;
}

export interface GenrePreset {
  id: string;
  name: string;
  description: string;
  structure: GenreStructureSection[];
  syllableRange: { min: number; max: number };
  rhymeScheme: 'AABB' | 'ABAB' | 'ABCB' | 'loose' | 'none';
  notes: string;
  defaultSongCount: number;
}

export const GENRE_PRESETS: GenrePreset[] = [
  {
    id: 'pop',
    name: 'Pop',
    description: 'Radio-friendly pop with verse-chorus structure and a bridge.',
    structure: [
      { tag: 'verse', required: true },
      { tag: 'verse', required: true },
      { tag: 'pre-chorus', required: true },
      { tag: 'pre-chorus', required: true },
      { tag: 'chorus', required: true },
      { tag: 'chorus', required: true },
      { tag: 'chorus', required: true },
      { tag: 'bridge', required: true },
    ],
    syllableRange: { min: 6, max: 10 },
    rhymeScheme: 'ABAB',
    notes: 'Pre-chorus builds tension before each chorus. Bridge provides contrast before final chorus.',
    defaultSongCount: 12,
  },
  {
    id: 'hip-hop-trap',
    name: 'Hip-Hop / Trap',
    description: 'Rap/trap with verses and hooks. Longer lines with dense rhyme patterns.',
    structure: [
      { tag: 'verse', required: true },
      { tag: 'verse', required: true },
      { tag: 'hook', required: true },
      { tag: 'hook', required: true },
      { tag: 'intro', required: false },
      { tag: 'outro', required: false },
    ],
    syllableRange: { min: 8, max: 14 },
    rhymeScheme: 'AABB',
    notes: 'Hooks are shorter than verses. Internal rhymes are common. Intro/outro optional.',
    defaultSongCount: 14,
  },
  {
    id: 'edm-dance',
    name: 'EDM / Dance',
    description: 'Electronic dance music built around drops and builds.',
    structure: [
      { tag: 'drop', required: true },
      { tag: 'drop', required: true },
      { tag: 'intro', required: false },
      { tag: 'build', required: false },
      { tag: 'break', required: false },
      { tag: 'outro', required: false },
    ],
    syllableRange: { min: 4, max: 8 },
    rhymeScheme: 'loose',
    notes: 'Drops are the main event. Short, punchy lyric lines. Melodic hooks over driving beats.',
    defaultSongCount: 10,
  },
  {
    id: 'reggae',
    name: 'Reggae',
    description: 'Laid-back reggae with offbeat rhythms and uplifting themes.',
    structure: [
      { tag: 'verse', required: true },
      { tag: 'verse', required: true },
      { tag: 'chorus', required: true },
      { tag: 'chorus', required: true },
      { tag: 'chorus', required: true },
      { tag: 'bridge', required: false },
    ],
    syllableRange: { min: 6, max: 10 },
    rhymeScheme: 'ABAB',
    notes: 'Syncopated rhythms, conscious or love themes. Bridge optional.',
    defaultSongCount: 10,
  },
  {
    id: 'punk',
    name: 'Punk',
    description: 'Fast, aggressive punk with short sharp lines.',
    structure: [
      { tag: 'verse', required: true },
      { tag: 'verse', required: true },
      { tag: 'chorus', required: true },
      { tag: 'chorus', required: true },
      { tag: 'chorus', required: true },
      { tag: 'bridge', required: false },
    ],
    syllableRange: { min: 4, max: 8 },
    rhymeScheme: 'AABB',
    notes: 'Short, direct lines. Aggressive energy. Keep it raw and simple.',
    defaultSongCount: 10,
  },
  {
    id: 'swedish-folk',
    name: 'Swedish Folk',
    description: 'Traditional Swedish folk with refrains. Lyrics often in Swedish.',
    structure: [
      { tag: 'verse', required: true },
      { tag: 'verse', required: true },
      { tag: 'refrain', required: true },
      { tag: 'refrain', required: true },
      { tag: 'refrain', required: true },
    ],
    syllableRange: { min: 6, max: 9 },
    rhymeScheme: 'ABAB',
    notes: 'Section tags must be in English even for Swedish lyrics. Use [Verse] not [Vers], [Refrain] not [Refrang]. Natural, flowing melodies.',
    defaultSongCount: 10,
  },
  {
    id: 'rnb-soul',
    name: 'R&B / Soul',
    description: 'Smooth R&B/soul with emotional depth and vocal runs.',
    structure: [
      { tag: 'verse', required: true },
      { tag: 'verse', required: true },
      { tag: 'pre-chorus', required: true },
      { tag: 'pre-chorus', required: true },
      { tag: 'chorus', required: true },
      { tag: 'chorus', required: true },
      { tag: 'chorus', required: true },
      { tag: 'bridge', required: true },
    ],
    syllableRange: { min: 6, max: 12 },
    rhymeScheme: 'ABAB',
    notes: 'Emphasis on vocal performance and emotion. Bridge often features melisma or spoken word.',
    defaultSongCount: 10,
  },
  {
    id: 'ballad',
    name: 'Ballad / Emotional',
    description: 'Slow, emotional ballad with storytelling focus.',
    structure: [
      { tag: 'verse', required: true },
      { tag: 'verse', required: true },
      { tag: 'chorus', required: true },
      { tag: 'chorus', required: true },
      { tag: 'chorus', required: true },
      { tag: 'bridge', required: false },
    ],
    syllableRange: { min: 8, max: 12 },
    rhymeScheme: 'ABAB',
    notes: 'Longer, more poetic lines. Bridge optional but adds emotional peak before final chorus.',
    defaultSongCount: 10,
  },
  {
    id: 'rock',
    name: 'Rock / Alternative',
    description: 'Classic rock or alternative with guitar-driven energy.',
    structure: [
      { tag: 'verse', required: true },
      { tag: 'verse', required: true },
      { tag: 'chorus', required: true },
      { tag: 'chorus', required: true },
      { tag: 'chorus', required: true },
      { tag: 'solo', required: false },
      { tag: 'bridge', required: false },
    ],
    syllableRange: { min: 5, max: 9 },
    rhymeScheme: 'ABAB',
    notes: 'Guitar solo and bridge are optional. Energy builds through the song.',
    defaultSongCount: 10,
  },
  {
    id: 'lofi',
    name: 'Lo-fi / Chill',
    description: 'Relaxed lo-fi with soft vocals and minimal structure.',
    structure: [
      { tag: 'verse', required: true },
      { tag: 'verse', required: true },
      { tag: 'hook', required: true },
      { tag: 'hook', required: true },
      { tag: 'intro', required: false },
      { tag: 'outro', required: false },
    ],
    syllableRange: { min: 4, max: 8 },
    rhymeScheme: 'ABCB',
    notes: 'Laid-back, introspective vibe. Short hooks. Intro and outro optional for atmosphere.',
    defaultSongCount: 8,
  },
  {
    id: 'ambient',
    name: 'Ambient / Instrumental',
    description: 'Atmospheric ambient tracks, minimal or no lyrics.',
    structure: [
      { tag: 'intro', required: false },
      { tag: 'drop', required: false },
      { tag: 'outro', required: false },
    ],
    syllableRange: { min: 0, max: 6 },
    rhymeScheme: 'none',
    notes: 'Focus on atmosphere, texture, and mood. Lyrics optional and minimal.',
    defaultSongCount: 8,
  },
];

export function getPresetById(id: string): GenrePreset | undefined {
  return GENRE_PRESETS.find(p => p.id === id);
}

export function getDefaultSongCount(genreId: string): number {
  const preset = getPresetById(genreId);
  return preset?.defaultSongCount ?? 10;
}
