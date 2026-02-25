# Luna Chat - System Flows

**Version**: 7.x
**Last Updated**: February 2026

This document traces how data flows through Luna Chat's internal systems. Use it to understand what happens behind the scenes when a user sends a message, how news is processed, how CEO and DJ Luna operate, and how memory context is built.

---

## Table of Contents

1. [Message Processing Flow](#message-processing-flow)
2. [Memory Context Building](#memory-context-building)
3. [MemoryCore Consolidation](#memorycore-consolidation)
4. [News Flow](#news-flow)
5. [CEO Luna Flow](#ceo-luna-flow)
6. [DJ Luna Flow](#dj-luna-flow)
7. [Music Production Pipeline](#music-production-pipeline)

---

## Message Processing Flow

When a user sends "Hello" to Luna, here is exactly what happens:

### 1. HTTP Entry

```
POST /api/chat/sessions/:id/send
Body: { message: "Hello", stream: true }
```

The route handler in `chat.routes.ts` parses the request, verifies session ownership, and calls either `chatService.streamMessage()` (SSE streaming) or `chatService.processMessage()` (JSON response).

### 2. MemoryCore Session Init

```typescript
await memorycoreClient.ensureSession(sessionId, userId)
```

Maps the chat session to a MemoryCore session for NeuralSleep LNN processing. This only creates the mapping once per session.

### 3. Dual-LNN Enrichment Pipeline

Every message is enriched with three signals before any LLM call:

```
"Hello"
    |
    v
[BGE-M3 Embedding] --> 1024-dim vector (cached 5 min)
    |
    +---> [Sentiment Analysis]  --> valence: 0.3 (mildly positive)
    |     (Groq Llama-3.1-8b)
    |
    +---> [Attention Scoring]   --> score: 0.4 (short message, low engagement)
    |     (length, latency, continuity)
    |
    +---> [Centroid Update]     --> rolling EMA of session topic vector
          (Redis cache)
```

These signals are sent to MemoryCore's NeuralSleep Working LNN for dual-stream processing:
- **ThematicLNN (LNN-A)**: Tracks semantic trajectory of the conversation (fast, tau: 0.1-5.0s)
- **RelationalLNN (LNN-B)**: Primes relevant knowledge relationships (slow, tau: 1.0-60.0s)

### 4. Record Interaction (Async, Non-Blocking)

```typescript
memorycoreClient.recordChatInteraction(sessionId, 'message', "Hello",
  { mode, source }, enrichment).catch(log)
```

Fire-and-forget -- never blocks the chat response.

### 5. Track Session Activity

```typescript
sessionActivityService.recordActivity(sessionId, userId)
// Redis key: session:activity:{sessionId}
// Data: { chatSessionId, userId, lastActivityAt, messageCount }
// TTL: 1 hour
```

Used by the consolidation job to detect idle sessions (5-minute timeout).

### 6. Router Decision

The Router-First architecture classifies the message to pick the right model tier:

```
"Hello" --> Router (Llama-3.1-8b via Groq, ~50ms)
         --> route: "nano" (simple greeting)
         --> model: fast/cheap model for casual chat
```

| Route | When | Model Tier |
|-------|------|------------|
| `nano` | Simple greetings, small talk, quick facts | Fast/cheap (e.g. Haiku, Llama) |
| `pro` | Complex questions, reasoning, analysis | Main model (e.g. Sonnet, GPT-4o) |
| `pro+tools` | Tasks needing tool use (search, code, email) | Main model + tool calling |

Mode overrides: CEO Luna and DJ Luna always use `pro` minimum.

### 7. Load Context in Parallel

Seven context sources are fetched simultaneously:

```typescript
const [modelConfig, user, rawHistory, memoryContext, abilityContext,
       prefGuidelines, intentContext] = await Promise.all([
  getUserModelConfig(userId, 'main_chat'),     // Which LLM to use
  authService.getUserById(userId),              // User profile
  sessionService.getSessionMessages(sessionId), // Last 50 messages
  memoryService.buildMemoryContext(userId, msg), // Full memory (see below)
  abilities.buildAbilityContext(userId, msg),    // Calendar, tasks, email, etc.
  preferencesService.getResponseGuidelines(),    // Style preferences
  intentContextService.getIntentContext(userId),  // Cached intent state
])
```

For small talk like "Hello", memory context is simplified -- only stable facts and learnings are loaded (no expensive semantic search).

### 8. Context Compression

If the conversation is long, context is compressed:

```
Raw history (50 messages)
    |
    v
[Context Compression]
    |-- Keep last N messages verbatim (6-12 exchanges)
    |-- Semantic retrieval of relevant older messages (5-8)
    |-- Rolling summary of everything else
    |
    v
Compressed context (fits token window)
```

### 9. Feedback Signal Detection

```typescript
const signal = preferencesService.detectFeedbackSignals("Hello")
// For "Hello": no signal detected
// For "shorter please": { type: 'shorter_request', confidence: 0.8 }
```

When detected, Luna's style preferences are adjusted:
- "shorter" / "brief" -> decrease verbosity
- "explain more" / "more detail" -> increase verbosity
- "too technical" -> lower technicality
- "perfect" / "exactly" -> reinforce current style

### 10. Build System Prompt (4-Tier Cache)

```
TIER 1 - Static (rarely changes, high cache hit rate)
|-- Base persona prompt (~700 tokens)
|-- Mode-specific additions (companion/assistant/voice/dj/ceo)
|-- MCP tool descriptions (if any)

TIER 2 - User-Stable (changes slowly, good cache hit rate)
|-- User name and profile
|-- Stable memory: extracted facts, active learnings
|-- Ability context: calendar events, active tasks, email count

TIER 3 - Session-Level (changes per session)
|-- Conversation summary (updated every ~10 messages)
|-- Session history context (for first message only)

TIER 4 - Dynamic (changes per message, no caching)
|-- Volatile memory: semantically similar past messages
|-- Similar conversation summaries
|-- Search results, active skill context
|-- DJ Luna style context / CEO Luna system log
|-- Current date/time (rounded to 15-min intervals)
```

Anthropic's prompt caching charges less for cached content. By keeping stable content in early tiers and volatile content later, cache hits are maximized.

### 11. LLM Call

```
System prompt (assembled above)
    + Compressed conversation history
    + User message: "Hello"
    |
    v
[LLM] (model selected by router)
    |
    v
Response: "Hey! How's your day going?"
```

If the LLM decides to use tools (search, email, code execution, etc.), a tool execution loop runs:
1. LLM returns tool call request
2. Tool is executed (e.g. `web_search`, `create_calendar_event`)
3. Tool result is added to messages
4. LLM is called again with the tool result
5. Repeat until LLM returns a text response

### 12. Post-Processing (Async, Non-Blocking)

```
Response: "Hey! How's your day going?"
    |
    +---> [Save to DB] assistant message record
    |
    +---> [Compute enrichment] for response (embedding, sentiment, attention)
    |
    +---> [Record to MemoryCore] response interaction with enrichment
    |
    +---> [Store embedding] in message_embeddings table (for future semantic search)
    |
    +---> [Stream to client] via SSE chunks
```

### 13. Session End (Later)

When the user stops chatting, consolidation is triggered:

| Trigger | Mechanism |
|---------|-----------|
| 5 min inactivity | `memorycoreSessionConsolidator` job (runs every minute) |
| Browser tab close | Frontend `beforeunload` -> POST `/api/chat/sessions/{id}/end` |
| User deletes session | `deleteSession()` calls consolidation first |

Consolidation flow: Working Memory -> Episodic Memory (immediate) -> Semantic Memory (daily/weekly)

---

## Memory Context Building

When `memoryService.buildMemoryContext()` is called, it fetches 9 tiers of knowledge in parallel:

```
buildMemoryContext(userId, "Hello", sessionId)
    |
    v
Promise.all([
    |
    +---> [1] User Facts (30 most relevant)
    |     SQL: user_facts WHERE user_id = $1 AND is_active = true
    |     Sorted by: mention_count DESC, last_mentioned DESC, confidence DESC
    |     Categories: personal, work, preference, hobby, relationship, goal, context
    |
    +---> [2] Similar Messages (5 closest by embedding)
    |     SQL: message_embeddings WHERE 1 - (embedding <=> $2) > 0.75
    |     Excludes current session to avoid echo
    |
    +---> [3] Similar Conversations (3 related summaries)
    |     SQL: conversation_summaries WHERE similarity > 0.6
    |
    +---> [4] Active Learnings (10 insights from autonomous sessions)
    |     SQL: session_learnings WHERE is_active = true
    |
    +---> [5] Consciousness Metrics (from MemoryCore)
    |     GET /api/memory/user/{userId}/metrics
    |     Returns: phi, temporalIntegration, consciousnessLevel
    |
    +---> [6] Consolidated Model (from NeuralSleep)
    |     GET /api/memory/user/{userId}/model
    |     Returns: episodicPatterns, preferences, knownFacts
    |
    +---> [7] Graph Context (from MemoryCore)
    |     Narrative of entity relationships and co-occurrences
    |
    +---> [8] Local Graph Context (Neo4j)
    |     Spreading activation over knowledge graph nodes
    |
    +---> [9] Semantic Memory (from MemoryCore)
    |     High-tier consolidated patterns and knowledge
])
    |
    v
[Score Message Complexity]
    |-- trivial: "Hello", "Thanks", "ok" -> skip LLM curation
    |-- complex: multi-sentence, questions, topics -> run curation
    |
    v
[LLM Curation] (optional, for complex messages only)
    |-- Selects most relevant facts, messages, conversations
    |-- Adds curation reasoning for context
    |
    v
Return {
  stable: { facts, learnings, graphMemory, consciousness, consolidatedPatterns, semanticMemory },
  volatile: { relevantHistory, conversationContext, curationReasoning }
}
```

### Memory Formatting for Cache Optimization

Facts and learnings are formatted deterministically to maximize prompt cache hits:

```
Facts: sorted alphabetically by category, then key
  - context/current_project: Luna Chat v7
  - personal/name: Henke
  - preference/communication_style: casual with dark humor
  - work/role: founder of BitwareLabs

Learnings: sorted by type, then content
  - [pattern] User prefers morning check-ins
  - [preference] Keep responses concise for companion mode
  - [success_factor] Code examples with comments are appreciated
```

---

## MemoryCore Consolidation

### Three-Tier Architecture

```
WORKING MEMORY (Redis, 30-min TTL)
  |
  | Purpose: Real-time session state
  | Processing: Dual-LNN (ThematicLNN + RelationalLNN)
  | Latency: <100ms per message
  |
  | Trigger: Session ends (5 min inactivity / browser close / delete)
  v
EPISODIC MEMORY (PostgreSQL, 90-day retention)
  |
  | Purpose: Recent experiences, emerging patterns
  | Updates: Every 10 interactions per user
  | Includes: Session summaries, interaction sequences, enrichment
  |
  | Trigger: Daily consolidation (2 AM)
  v
SEMANTIC MEMORY (PostgreSQL JSONB, permanent)
  |
  | Purpose: User proficiency models, learning patterns
  | Updates: Daily/weekly consolidation
  | Includes: Preferences, known facts, thematic clusters
  |
  | Trigger: Weekly deep consolidation (3 AM Sunday)
  v
LONG-TERM USER MODEL
```

### Enrichment Data Flow

Every interaction sent to MemoryCore includes:

```typescript
{
  type: 'message' | 'response',
  content: "Hello",
  timestamp: Date,
  embedding: number[1024],        // BGE-M3 vector
  embeddingCentroid: number[1024], // Rolling session theme
  emotionalValence: 0.3,          // -1.0 to 1.0
  attentionScore: 0.4,            // 0.0 to 1.0
  interMessageMs: 5000,           // Time since last message
}
```

NeuralSleep processes this through:
- **ThematicLNN**: Updates semantic trajectory (fast adaptation)
- **RelationalLNN**: Primes knowledge graph nodes (slow, stable)
- **Causal Gate**: Cross-talk between the two streams

### Consciousness Metrics

| Metric | Description | Range |
|--------|-------------|-------|
| Phi | Integrated information -- how interconnected memory representations are | 0.0-1.0 |
| Temporal Integration | How well past experiences shape present processing | 0.0-1.0 |
| Self-Reference Depth | Recursive self-modeling capability | 0.0-1.0 |
| Causal Density | Information flow between memory tiers | 0.0-1.0 |

---

## News Flow

### Ingestion Pipeline

```
[Newsfetcher Service] (external)
    |
    | Trigger: triggerNewsfetcherIngestion job (scheduled)
    v
POST /ingest/run
    |
    v
[Multi-source aggregation]
    |-- Web scraping
    |-- RSS feeds
    |-- API sources
    |
    v
[Article Storage] (newsfetcher DB)
    |
    v
[Enrichment Job] (enrichNewsArticles)
    |
    v
[News Filter] (news-filter.service.ts)
    |
    | Model: Qwen 2.5B via Ollama (local, fast)
    | Prompt: Classify as SIGNAL or BULLSHIT
    v
┌─────────────────────────────────────────────┐
│ SIGNAL Criteria:                            │
│ - New data, original research               │
│ - Actionable insights                       │
│ - Open source announcements                 │
│ - Security disclosures                      │
│ - Infrastructure changes                    │
│                                             │
│ BULLSHIT Criteria:                          │
│ - Outrage bait, recycled opinions           │
│ - SEO sludge, hype articles                 │
│ - PR fluff, gossip                          │
│ - Unverified claims                         │
└─────────────────────────────────────────────┘
    |
    v
[Signal Classification]
    |-- low: Background noise, low relevance
    |-- medium: Worth noting, may be useful
    |-- high: Important, surface to user immediately
    |
    v
[Redis Cache] news:enrichment:{articleId} (TTL: 1h)
    |
    v
[Verification Status]
    |-- Verified (90%+ confidence)
    |-- Likely (70-89%)
    |-- Unconfirmed (50-69%)
    |-- Conflicted (conflicting sources)
    |-- False/Retraction (debunked)
```

### How Luna Uses News

1. **Autonomous Mode**: Council can trigger `research:` or `search:` actions that query news
2. **Proactive Alerts**: High-signal articles matching user interests trigger Telegram notifications
3. **CEO Luna Radar**: Market signals and competitor mentions surfaced in the Radar panel
4. **Music Trends**: Billboard/Pitchfork scraping feeds into the music trend analysis pipeline
5. **Context Injection**: When a user asks about current events, relevant news articles are included in the volatile memory context

---

## CEO Luna Flow

### Slash Command Processing

```
User types: /build start MVP auth flow
    |
    v
[CEOChat.tsx] slash command parser
    |-- Detects /build prefix
    |-- Extracts: action=start, name="MVP auth flow"
    |
    v
[Frontend API call]
    POST /api/ceo/builds/start { name: "MVP auth flow" }
    |
    v
[build-tracker.service.ts]
    |-- INSERT into ceo_active_builds
    |-- Status: active, started_at: now()
    |-- Return: Build #3
    |
    v
[CEOChat state]
    |-- Store systemLog: 'Build #3 "MVP auth flow" started.'
    |-- pendingSystemLog = systemLog
    |
    v
[Next regular message]
    User: "Working on the login screen now"
    |
    v
[streamMessage() with ceoSystemLog parameter]
    |
    v
[luna.persona.ts buildContextualPrompt]
    |-- Injects [SYSTEM LOG] block into system prompt:
    |   "[SYSTEM LOG] Build #3 'MVP auth flow' started."
    |
    v
[CEO Luna response]
    "Great, Build #3 is tracking! The login screen is a solid
     starting point. Want me to note this as your first milestone?"
```

### Automated Build Check-in Flow

```
[ceoBuildCheckin job] runs every 5 minutes
    |
    v
[build-tracker.service.ts processBuildCheckins()]
    |-- Query: active builds WHERE last_checkin_at < NOW() - 30min
    |
    v
[For each stale build]
    |
    v
[enqueueCeoMessage(userId, 'ceo_build_checkin', message, priority=5)]
    |-- Message: "[Build Check-in] Build #3 'MVP auth flow' - 1h 23m elapsed.
    |             How is it going? [build_id=<uuid>]"
    |
    v
[CEO Luna Chat]
    |-- User replies: "Just finished the auth middleware"
    |
    v
[ceo_note_build tool]
    |-- Extracts build_id from context
    |-- INSERT into ceo_build_notes (build_id, note, created_at)
    |-- Updates last_checkin_at on the build
```

### Music Trend -> Auto-Production Flow

```
[runMusicTrendScraper job] every 2 hours
    |
    v
[music-trend-scraper.service.ts]
    |-- Scrape Billboard, Pitchfork, custom sources
    |-- Store raw data in music_trend_raw table
    |
    v
[Ollama LLM Analysis] (Qwen 2.5, feature key: music_trend_analysis)
    |-- Identify: emerging genres, breakout artists, production trends
    |-- Confidence scoring per trend
    |
    v
[High-confidence trend detected]
    |-- e.g., "Lo-fi Jazz Fusion is trending on Pitchfork"
    |
    v
[Auto-approve genre preset]
    |-- Check if genre exists in registry
    |-- If new: create proposed_genre_presets entry, auto-approve
    |
    v
[Queue album productions]
    |-- 3 albums, one per artist variation
    |-- Trigger album-pipeline.service.ts
    |
    v
[Album Pipeline] (see Music Production Pipeline below)
```

---

## DJ Luna Flow

### Lyric Writing Session

```
[User opens DJ Luna window]
    |
    v
[StartupModal.tsx]
    |-- Grid of 55 genre presets (12 categories)
    |-- User selects: "Synthwave"
    |
    v
[dj-luna-store.ts]
    |-- activeStyle = "synthwave, 80s electronic, driving bass, retro"
    |-- Session ID from localStorage['dj-luna-session-id']
    |
    v
[DJLunaChat.tsx]
    User: "Write me a song about driving at night"
    |
    v
[streamMessage() with djStyleContext]
    |-- djStyleContext: "synthwave, 80s electronic, driving bass, retro"
    |
    v
[luna.persona.ts]
    |-- DJ_LUNA_MODE_PROMPT activated
    |-- [Active Style] block injected into system prompt
    |-- Workspace tools enabled (workspace_write/read/list)
    |
    v
[DJ Luna response]
    """
    Style: synthwave, 80s electronic, pulsing bass, neon, female vocal, 120 BPM

    [Intro]
    (Synth pad builds, pulsing bass enters)

    [Verse 1]
    Neon signs reflect on the hood tonight
    Radio hums a forgotten satellite
    ...

    [Chorus]
    Drive, drive into the endless glow
    ...
    """
    |
    v
[Lyrics detection] pattern: /\[(Verse|Chorus|Bridge|...)/i
    |-- Match found -> show "Send to Canvas" button
    |-- Style line extracted -> sync to Style panel
```

### Canvas to Suno Generation

```
[User clicks "Send to Canvas"]
    |
    v
[LyricsCanvas.tsx]
    |-- Monospace editor populated
    |-- Syllable gutter calculated per line
    |-- Outlier detection: lines >35% off section median -> amber highlight
    |
    v
[User reviews, edits, clicks "Generate with Suno"]
    |
    v
[Confirmation dialog]
    |-- Title: "Neon Highway"
    |-- Style: "synthwave, 80s electronic, pulsing bass, neon, female vocal, 120 BPM"
    |
    v
POST /api/suno/generate
    { title, style, lyrics, userId }
    |
    v
[suno-generator.service.ts]
    |-- INSERT into suno_generations (status: 'pending')
    |-- Direct Suno API call (no n8n dependency)
    |-- Poll every 30s, up to 10min
    |
    v
[Suno API completes]
    |
    v
POST /api/webhooks/suno-complete (callback)
    |-- Download MP3
    |-- Save to /mnt/data/media/Music/<title>-<ts>.mp3
    |-- UPDATE suno_generations SET status = 'completed', file_path = ...
    |
    v
[GenerationsPanel.tsx]
    |-- Status auto-refreshes every 30s
    |-- Shows: title, status, elapsed time, file path
    |-- Actions: Play, Download
```

---

## Music Production Pipeline

### Album Production (CEO Luna)

The album pipeline runs autonomously, triggered by CEO Luna or auto-production from music trends.

```
[1. PLANNING]
    |
    Genre: "Synthwave" (from 55 presets or proposed)
    Artist: "Neon Pulse"
    Album count: 3
    |
    v
[LLM generates album plan] (Ollama / configured model)
    |-- Album title, theme, song count
    |-- Per-song: title, direction, mood, style variation
    |-- INSERT into album_productions + album_songs
    |
    v
[2. LYRIC WRITING] (per song)
    |
    v
[LYRIC_PIPELINE_PROMPT] (lightweight system prompt, ~200 tokens)
    |-- Genre-specific structure, syllable range, rhyme scheme
    |-- LLM generates lyrics with section tags
    |
    v
[3. REVIEW] (lyric-checker.service.ts)
    |
    v
[Lyric Checker Analysis]
    |-- Syllable count per line vs genre range
    |-- Rhyme scheme validation (AABB, ABAB, ABCB, loose, none)
    |-- Structural completeness (required sections present?)
    |-- Section balance (too long/short?)
    |
    |-- Issues found? -> revision_count++ -> back to [2]
    |-- Clean? -> proceed to [4]
    |
    v
[4. SUNO SUBMISSION]
    |
    v
[suno-generator.service.ts]
    |-- 30-second stagger between submissions (rate limiting)
    |-- Direct Suno API call
    |-- Poll for completion
    |-- Save MP3 to /mnt/data/media/Music/
    |
    v
[5. TRACKING]
    |
    v
[album_songs table]
    |-- status: writing -> reviewing -> submitted -> completed/failed
    |-- revision_count, analysis_issues, file_path
    |
    v
[album_productions table]
    |-- status: planning -> in_progress -> completed
    |-- Tracks overall progress across all songs
```

### Background Job

The `runAlbumPipelineStep` job (registered in `job-runner.ts`) processes one step at a time:
- Finds the next actionable song (needs writing, review, or submission)
- Executes one step
- Returns control (next step on next job run)
- 30-second minimum between Suno submissions

### Genre Registry

```
[genre-registry.service.ts]
    |
    +---> [Built-in presets] (55 in genre-presets.ts)
    |     |-- 12 categories: Pop, Rock, Electronic, Hip-Hop, R&B,
    |     |   Chill, Folk/Country, Latin, World, Jazz/Blues,
    |     |   Cinematic, Experimental
    |     |-- Each: structure, syllableRange, rhymeScheme,
    |     |   styleTags, bpmRange, energy
    |
    +---> [Proposed presets] (proposed_genre_presets table)
    |     |-- User-submitted or auto-generated from music trends
    |     |-- Status: proposed -> approved -> active
    |
    +---> [Merged registry] (cached 5 min per user)
          |-- Built-in + approved proposals
          |-- Accessed by album pipeline and DJ Luna UI
```
