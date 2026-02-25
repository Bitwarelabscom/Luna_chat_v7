# DJ Luna - AI Music Production Studio

**Version**: 7.x
**Last Updated**: February 2026

---

## Overview

DJ Luna is a dedicated music production workspace that combines AI-assisted lyric writing with direct integration to the Suno AI music generation engine. It opens as a full 1280x800 window with a three-column layout: chat on the left, a live lyrics canvas in the center, and a tabbed panel on the right for managing songs, styles, and the generation factory.

---

## Layout

```
+------------------+----------------------------+------------------+
|                  |                            | [ Songs | Style  |
|   DJ Luna Chat   |    Lyrics Canvas           |   | Factory ]    |
|                  |                            |                  |
|  - Conversation  |  - Monospace editor        |  Songs:          |
|  - Style sync    |  - Section detection       |  - Project tree  |
|  - Send to       |  - Syllable gutter         |  - Load / Save   |
|    Canvas button |  - Section hover toolbar   |                  |
|  - Generate      |  - Suno send button        |  Style:          |
|    confirm       |                            |  - Style textarea|
|                  |                            |  - Preset chips  |
|                  |                            |                  |
|                  |                            |  Factory:        |
|                  |                            |  - Suno batch    |
|                  |                            |  - Generation    |
|                  |                            |    status list   |
+------------------+----------------------------+------------------+
```

---

## Getting Started

When DJ Luna opens, a **Startup Modal** appears with two tabs:

- **New Song** - Choose a style from a grid of genre presets, then name your song
- **Open Song** - Browse existing songs in the project tree and load one

Once inside, use the Chat panel to start writing with DJ Luna, or open an existing lyric file directly.

---

## Chat Panel (left, 30%)

The DJ Luna Chat connects to the `dj_luna` session mode -- a specialized AI persona with expertise in:

- Music theory, song structure, and genre conventions
- Suno AI tag system and style strings
- Lyric writing (rhyme schemes, syllable matching, imagery)
- Beat and arrangement suggestions

### Session Persistence

The DJ Luna session ID is stored in `localStorage['dj-luna-session-id']` and reconnected on mount, so conversations persist across window open/close.

### Active Style Context

Whatever style is set in the Style panel is injected as `[Active Style]` context into every message, so DJ Luna always knows what genre/sound you are working in.

### Send to Canvas

When DJ Luna's response contains a lyrics block (detected by section headers like `[Verse]`, `[Chorus]`, `[Bridge]`, etc.), a **"Send to Canvas"** button appears below the message. Clicking it copies the clean lyrics into the Lyrics Canvas editor.

Style lines (`Style: <string>`) in the response are automatically extracted and synced to the Style panel.

### Generate with Suno

After lyrics are on the canvas, a **"Generate with Suno"** button appears. Clicking it shows a confirmation dialog with the title and style, then triggers the Suno generation pipeline.

---

## Lyrics Canvas (center, 40%)

The canvas is a full-featured monospace lyrics editor designed specifically for Suno AI output.

### Features

| Feature | Description |
|---------|-------------|
| **Section detection** | Recognizes `[Verse]`, `[Chorus]`, `[Bridge]`, `[Intro]`, `[Outro]`, `[Drop]`, `[Hook]`, `[Pre-Chorus]`, `[Post-Chorus]`, `[Breakdown]`, `[Solo]` |
| **Syllable gutter** | Right-hand gutter shows syllable count per line |
| **Outlier highlighting** | Lines with >35% deviation from the section's median syllable count are highlighted in amber |
| **Section hover toolbar** | Hover over any section to get quick action buttons (Regenerate section, etc.) |
| **Regenerate section** | Sends the hovered section name to DJ Luna chat for targeted rewriting |

### Syllable Analysis

Each section is analyzed independently. The median syllable count per line within the section is calculated, and lines that deviate more than 35% from that median are flagged. This helps catch lines that will feel rhythmically off when Suno renders them.

### Toolbar

The canvas toolbar (top of panel) provides:

- **Send to Suno** - Trigger generation with current canvas content and active style
- **Detach** - Detach canvas into a standalone floating window
- **Save** - Save lyrics to the current song file

---

## Right Panel - Songs Tab

A project folder tree that displays saved songs organized by project:

```
dj-luna/
  My Project/
    song-title.md
    another-song.md
  Ambient Sessions/
    forest-rain.md
```

Songs are stored as Markdown files with YAML frontmatter in your Luna workspace under `dj-luna/`.

**Frontmatter fields:**
```yaml
---
title: My Song
style: synthwave, dreamy, female vocal
created: 2026-02-23T14:30:00Z
---
```

### Song Actions

- **Load** - Open song file into canvas and set style
- **Save** - Save current canvas to active song file
- **Save As** - Save as new file in chosen project folder
- **New** - Create blank song

---

## Right Panel - Style Tab

The style panel manages the Suno style string (the "custom mode" prompt passed to Suno AI).

### Style Textarea

Free-form text describing the musical style. This is passed as the `tags` field to Suno. Examples:

```
lo-fi hip hop, rainy day, mellow, vinyl crackle, piano, 75 BPM
```

```
synthwave, 80s, female vocal, neon, driving bassline, reverb
```

### Genre Presets

55 built-in genre presets organized across 12 categories, plus custom presets you can save and community-proposed presets via the genre registry.

**Categories:**

| Category | Example Presets |
|----------|----------------|
| Pop | Pop, Indie Pop, Dance Pop, Electro Pop, K-Pop, Bedroom Pop |
| Rock | Rock, Alt Rock, Post-Punk, Punk Pop, Grunge |
| Electronic | EDM, Synthwave, House, Techno, DnB |
| Hip-Hop | Hip-Hop, Trap, Boom Bap, Phonk, Lo-fi Hip-Hop |
| R&B | R&B, Neo-Soul, Afrobeats |
| Chill | Lo-fi, Ambient, Chillwave, Downtempo |
| Folk/Country | Folk, Country, Bluegrass, Singer-Songwriter |
| Latin | Reggaeton, Latin Pop, Cumbia, Bossa Nova |
| World | Afrobeats, K-Pop (fusion), J-Pop |
| Jazz/Blues | Jazz, Blues, Swing |
| Cinematic | Cinematic, Orchestral, Trailer Epic |
| Experimental | Art Pop, Glitch, Noise, Shoegaze |

Each preset includes:
- **Lyrics template**: Song structure sections with required/optional tags
- **Suno style tags**: Genre-specific style string for Suno AI
- **BPM range**: Tempo guidance (min/max)
- **Energy level**: Low, medium, or high
- **Rhyme scheme**: AABB, ABAB, ABCB, loose, or none
- **Syllable range**: Target syllables per line

**Category filter pills** appear above the presets for quick filtering. Click **Save as preset** to add the current style as a custom chip. The **genre registry** merges built-in presets with user-approved proposals (cached 5 minutes).

---

## Right Panel - Factory Tab

The Factory tab is the Suno generation engine control panel.

### From Canvas

Generate a track from the current canvas lyrics:

1. Enter or confirm the song title
2. Confirm or edit the style string
3. Click **Generate from Canvas**
4. Generation enters the queue and appears in the status list below

### Ambient Batch Generator

Generate multiple ambient/instrumental tracks in one click -- useful for creating background music libraries:

1. Set the **Count** (1-10 tracks)
2. Enter a **Style** string (e.g., "ambient rain, piano, 60 BPM")
3. Click **Trigger Ambient Batch**
4. Tracks are queued and appear in the status list

The batch generator calls the Suno API directly (no external workflow dependency) with a 30-second stagger between submissions to respect Suno's rate limits. Completed MP3s are saved to `/mnt/data/media/Music/<title>-<timestamp>.mp3`.

### Generation Status List

The status list shows all recent generations with:

| Column | Description |
|--------|-------------|
| Title | Song title |
| Status | pending / processing / completed / failed |
| Elapsed | Time since generation was queued |
| File | MP3 filename when completed |
| Actions | Play, download |

Status filters: All / Pending / Processing / Completed / Failed

Status auto-refreshes every 30 seconds. Click **Refresh** to force an update.

---

## Suno Tag Reference

DJ Luna is familiar with the full Suno tag system. A quick reference is available in `docs/musicgen.md`.

### Key tag categories:

**Structure**: `[Intro]` `[Verse]` `[Chorus]` `[Bridge]` `[Breakdown]` `[Drop]` `[Outro]` `[End]`

**Style**: `[Synthwave]` `[Lo-fi]` `[EDM]` `[Jazz]` `[Pop]` `[Metal]` `[R&B]`

**Mood**: `[Melancholic]` `[Uplifting]` `[Dark]` `[Atmospheric]` `[Chill]`

**Vocal**: `[Female Vocal]` `[Male Vocal]` `[Rap Verse]` `[Whispered]` `[Belting]`

**Combo example**: `[Chorus | 80s Synthpop | Female Vocal | Anthemic]`

---

## Suno Pipeline (Backend)

The pipeline uses direct Suno API calls (no n8n dependency).

```
DJ Luna Chat (lyrics + style)
    |
    v
"Generate with Suno" confirm
    |
    v
POST /api/suno/generate
    |
    v
suno-generator.service.ts
    |
    v
Direct Suno API call (30s stagger for batch)
    |
    v  (poll every 30s, up to 10min)
Suno completes generation
    |
    v
POST /api/webhooks/suno-complete (callback)
    |
    v
MP3 saved to /mnt/data/media/Music/<title>-<ts>.mp3
    |
    v
Generation row updated (status: completed, file_path)
```

### Album Production Pipeline

CEO Luna can trigger full album productions autonomously:

```
Genre selection (from 55 presets or proposed)
    |
    v
LLM generates album plan (title, themes, song directions)
    |
    v
For each song:
    Write lyrics (Ollama / configured LLM)
        |
        v
    Review & analyze (lyric-checker.service.ts)
        |
        v
    Submit to Suno (30s stagger between tracks)
        |
        v
    Track completion
    |
    v
Album marked complete
```

Album productions are tracked in the `album_productions` table with per-song status (writing / reviewing / submitted / completed / failed).

---

## Lyric Checker

The lyric checker (`lyric-checker.service.ts`) analyzes lyrics before generation for quality issues:

- **Syllable analysis**: Checks per-line syllable counts against the genre's expected range
- **Rhyme scheme validation**: Verifies the lyrics follow the preset's rhyme pattern (AABB, ABAB, etc.)
- **Structural completeness**: Ensures required sections (verse, chorus, etc.) are present
- **Section balance**: Flags sections that are too long or too short relative to the song structure

The lyric checker tab is accessible in the DJ Luna right panel alongside Songs, Style, and Factory tabs.

---

## Genre Registry

The genre registry (`genre-registry.service.ts`) provides a unified interface for accessing genre presets:

- **Built-in presets**: 55 hardcoded presets in `genre-presets.ts`
- **User-proposed presets**: Stored in `proposed_genre_presets` table, pending approval
- **Merged output**: Registry merges built-in + approved proposals per user
- **Cache**: 5-minute TTL per user for fast access
- **API**: `/api/ceo/genres/proposed` for listing and managing proposed presets

---

## Backend Files

| File | Purpose |
|------|---------|
| `src/abilities/suno-generator.service.ts` | Suno generation CRUD, direct API calls, stale cleanup |
| `src/abilities/genre-registry.service.ts` | Genre preset registry (built-in + proposed, cached) |
| `src/abilities/genre-presets.ts` | 55 hardcoded genre presets with full metadata |
| `src/abilities/lyric-checker.service.ts` | Lyric quality analysis (syllables, rhyme, structure) |
| `src/ceo/album-pipeline.service.ts` | Autonomous album production pipeline |
| `src/chat/suno.routes.ts` | REST endpoints for generation management |
| `src/chat/dj-luna.routes.ts` | Rhyme suggestions endpoint |
| `src/db/migrations/087_suno_generations.sql` | suno_generations table |
| `src/db/migrations/090_album_productions.sql` | album_productions + album_songs tables |
| `src/db/migrations/091_music_trends_and_proposed_genres.sql` | proposed_genre_presets + music_trend_raw tables |

## Frontend Files

| File | Purpose |
|------|---------|
| `frontend/src/components/os/apps/DJLunaWindow.tsx` | Main window container |
| `frontend/src/components/dj-luna/DJLunaChat.tsx` | AI chat panel |
| `frontend/src/components/dj-luna/LyricsCanvas.tsx` | Lyrics editor with syllable gutter |
| `frontend/src/components/dj-luna/SongList.tsx` | Project file tree |
| `frontend/src/components/dj-luna/StylePanel.tsx` | Style manager with presets |
| `frontend/src/components/dj-luna/GenerationsPanel.tsx` | Suno factory + status list |
| `frontend/src/components/dj-luna/LyricCheckerTab.tsx` | Lyric quality analysis tab |
| `frontend/src/components/dj-luna/StartupModal.tsx` | New/Open song modal |
| `frontend/src/lib/genre-presets.ts` | 55 genre presets + category definitions |
| `frontend/src/lib/dj-luna-store.ts` | Zustand store |
| `frontend/src/lib/syllable-counter.ts` | Syllable counting and outlier detection |
| `frontend/src/lib/api/suno.ts` | Suno API client |

---

## API Endpoints

**Base**: `/api/suno/...` -- requires JWT auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/suno/generate` | Trigger single generation |
| POST | `/api/suno/batch` | Trigger ambient batch |
| GET | `/api/suno/generations` | List generations (with status filter) |
| GET | `/api/suno/generations/:id` | Get single generation |
| POST | `/api/webhooks/suno-complete` | Webhook for n8n callback |

---

## Opening DJ Luna

From the desktop, click the **Communication** menu in the system bar and select **DJ Luna** (Headphones icon). The window opens at 1280x800.

---

## Tips for Best Results

1. **Tell DJ Luna the vibe first** - start with "I want a melancholic lo-fi track about late nights coding" before asking for lyrics
2. **Use the syllable gutter** - amber highlights show lines that may feel off-beat; ask DJ Luna to rewrite those sections
3. **Iterate with Regenerate Section** - hover over a section you don't like and click regenerate to target just that part
4. **Save style presets** - build up a library of working style strings so you can reproduce a sound quickly
5. **Ambient batch for backgrounds** - use the Factory batch generator to produce multiple variations of a style and pick the best one
