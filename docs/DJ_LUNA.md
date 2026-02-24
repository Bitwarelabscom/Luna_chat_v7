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

### Preset Chips

8 built-in genre presets plus any custom presets you save:

| Preset | Style string |
|--------|-------------|
| Lo-fi | lo-fi hip hop, mellow, vinyl crackle, piano |
| Synthwave | synthwave, 80s electronic, driving bass, retro |
| Ambient | ambient, atmospheric, slow evolving, cinematic |
| Pop | pop, upbeat, catchy, modern production |
| Rock | indie rock, guitar driven, energetic |
| Jazz | jazz, swing, upright bass, saxophone |
| EDM | edm, drop, high energy, 128 BPM, bass synth |
| R&B | r&b, soul, warm, groove, smooth |

Click **Save as preset** to add the current style as a custom chip.

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

The batch generator uses the n8n workflow (`suno-ambience-generator.json`) which:
1. Calls Qwen 2.5 to generate a suitable title and style variation
2. Sends to the Suno API
3. Polls for completion
4. Saves MP3 to `/mnt/data/media/Music/<title>-<timestamp>.mp3`
5. Triggers the MemoryCore callback to update Luna's knowledge

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
n8n webhook: suno-generate
    |
    v
Qwen 2.5 (title/style variation) @ 10.0.0.30
    |
    v
Suno API @ 10.0.0.10:3000
    |
    v  (poll every 30s, up to 10min)
Suno completes generation
    |
    v
POST /api/webhooks/suno-complete
    |
    v
MP3 saved to /mnt/data/media/Music/<title>-<ts>.mp3
    |
    v
Generation row updated (status: completed, file_path)
```

---

## Backend Files

| File | Purpose |
|------|---------|
| `src/abilities/suno-generator.service.ts` | Suno generation CRUD, polling, stale cleanup |
| `src/chat/suno.routes.ts` | REST endpoints for generation management |
| `src/db/migrations/087_suno_generations.sql` | suno_generations table |
| `n8n-workflows/suno-ambience-generator.json` | n8n workflow for ambient batch generation |

## Frontend Files

| File | Purpose |
|------|---------|
| `frontend/src/components/os/apps/DJLunaWindow.tsx` | Main window container |
| `frontend/src/components/dj-luna/DJLunaChat.tsx` | AI chat panel |
| `frontend/src/components/dj-luna/LyricsCanvas.tsx` | Lyrics editor with syllable gutter |
| `frontend/src/components/dj-luna/SongList.tsx` | Project file tree |
| `frontend/src/components/dj-luna/StylePanel.tsx` | Style manager with presets |
| `frontend/src/components/dj-luna/GenerationsPanel.tsx` | Suno factory + status list |
| `frontend/src/components/dj-luna/StartupModal.tsx` | New/Open song modal |
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
