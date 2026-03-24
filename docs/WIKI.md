# Luna Chat Wiki

**Version**: 7.x
**Last Updated**: March 2026

---

## Table of Contents

1. [Introduction](#introduction)
2. [System Architecture](#system-architecture)
3. [Core Systems](#core-systems)
4. [Memory & Intelligence](#memory--intelligence)
5. [Cognitive Architecture](#cognitive-architecture)
6. [Autonomous Mode](#autonomous-mode)
7. [CEO Luna](#ceo-luna)
8. [DJ Luna](#dj-luna)
9. [Music Pipeline](#music-pipeline)
10. [News Intelligence](#news-intelligence)
11. [Trading System](#trading-system)
12. [Friends System](#friends-system)
13. [VR Luna](#vr-luna)
14. [Luna Streams](#luna-streams)
15. [Integrations](#integrations)
16. [Developer Guide](#developer-guide)
17. [API Reference](#api-reference)
18. [Configuration](#configuration)
19. [Troubleshooting](#troubleshooting)

---

## Introduction

Luna Chat is a local-first, privacy-focused AI companion with advanced memory, autonomous capabilities, and deep system integration. Unlike traditional chatbots, Luna features:

- **Council Architecture**: Multiple AI personas deliberate on complex decisions
- **Dual-LNN Memory**: Biologically-inspired neural networks for working memory
- **Graph-Based Knowledge**: Neo4j and PostgreSQL hybrid memory system
- **Autonomous Intelligence**: Self-directed learning and proactive assistance
- **Full Stack Integration**: Calendar, email, IRC, Telegram, trading, and more

### Design Philosophy

- **Local-First**: Your data stays on your infrastructure
- **Privacy-Focused**: End-to-end encryption, no cloud dependencies
- **Stateful Relationships**: True long-term memory and preference learning
- **Autonomous**: Proactive assistance, not just reactive responses
- **Extensible**: MCP servers, custom tools, plugin architecture

---

## System Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Luna Chat Ecosystem                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   Frontend   │  │   Backend    │  │   Services   │    │
│  │  (Next.js)   │◄─┤  (Express)   │◄─┤  (External)  │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│         │                 │                   │            │
│         │                 │                   │            │
│  ┌──────▼────────┬────────▼────────┬──────────▼────────┐ │
│  │  PostgreSQL   │     Redis       │    Ollama         │ │
│  │  (pgvector)   │   (Sessions)    │   (Local LLM)     │ │
│  └───────────────┴─────────────────┴───────────────────┘ │
│                                                             │
│  ┌──────────────┬────────────────┬────────────────────┐  │
│  │  MemoryCore  │  NeuralSleep   │  Sanhedrin (dep.)  │  │
│  │ (3-tier mem) │  (Dual-LNN)    │  (Agent coord)     │  │
│  └──────────────┴────────────────┴────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Next.js 15, React 19, TypeScript | Desktop & mobile web UI |
| **Backend** | Node.js 20, Express, TypeScript | REST API, WebSocket, SSE |
| **Database** | PostgreSQL 17 + pgvector | Primary data store, embeddings |
| **Cache** | Redis 7 | Sessions, rate limiting, real-time state |
| **Local LLM** | Ollama (BGE-M3, Qwen, Llama) | Embeddings, local processing |
| **Memory** | MemoryCore + NeuralSleep | 3-tier memory consolidation |
| **Trading** | TradeCore (Go) | High-performance trading engine |
| **Cognition** | Luna Streams (Mamba SSM, llama.cpp) | Continuous state-space inference |
| **Coordination** | Sanhedrin (A2A Protocol) | Multi-agent task delegation (deprecated) |

### Data Flow

```
User Input
    │
    ▼
┌─────────────────────┐
│  Input Processing   │  - Sanitization
│                     │  - Intent detection
│                     │  - Feedback signals
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Context Building    │  - Memory retrieval
│                     │  - Graph traversal
│                     │  - Dual-LNN processing
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  LLM Processing     │  - Model selection
│                     │  - Tool execution
│                     │  - Streaming response
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Post-Processing     │  - Memory extraction
│                     │  - Graph updates
│                     │  - Consolidation
└─────────────────────┘
```

---

## Core Systems

### Chat Modes

Luna adapts her behavior based on the selected mode:

#### 1. Assistant Mode
**Purpose**: Task-focused productivity

- Full tool suite enabled
- Structured responses with citations
- Code examples and templates
- Breaks down complex problems
- Optimized for getting things done

#### 2. Companion Mode
**Purpose**: Friendly conversation

- Reduced tool set (focus on connection)
- Empathetic, supportive tone
- Natural conversational flow
- Mood awareness and tracking
- Faster responses (trimmed system prompt)

#### 3. Voice Mode
**Purpose**: Spoken conversation

- WebSocket streaming (< 2s latency)
- Server-side Voice Activity Detection
- Expressive TTS with emotion tags (Orpheus TTS: angle-bracket format, e.g., `<laugh>`, `<sigh>`)
- Short, conversational responses
- Hands-free experience
- Telegram voice note support

#### 4. DJ Luna Mode
**Purpose**: Music production studio

- Specialized for Suno AI music generation
- Music theory, genre expertise, lyric writing
- Style string generation in Suno custom mode format
- Active style context injected automatically from Style panel
- Outputs structured for Suno: lyrics with section tags + style string
- Full workspace tools for saving song files

#### 5. CEO Luna Mode
**Purpose**: Business operations and AI co-founder

- Financial tracking context (P&L, build hours, alerts)
- Slash command parser: `/build`, `/cost`, `/income`
- System log injection for slash command acknowledgment
- `ceo_note_build` tool for saving build progress notes
- Proactive build check-ins every 30 minutes
- Scheduled daily/weekly reports via Telegram

### Tool System

All code paths (processMessage, streamMessage/agent-loop, voice-chat) use a single unified `executeTool()` from `src/agentic/tool-executor.ts`. The **agentic loop** (`src/agentic/agent-loop.ts`) handles LLM calls in a loop, executing tools and feeding results back until the LLM stops requesting tools. It includes context overflow management (rough token estimation, summarization of older tool results when context exceeds 80% capacity), loop breakers for repeated identical tool calls, and consecutive error detection. Default limits: maxSteps=25, maxCostUsd=0.50.

Shared helpers like `convertLocalTimeToUTC` are extracted to `src/agentic/shared-helpers.ts` to avoid duplication across services.

Luna has access to 56+ tools organized by capability:

| Category | Tools | Use Cases |
|----------|-------|-----------|
| **Knowledge** | create, search, tag, pin | Store and retrieve information |
| **Tasks** | create, update, list, recurring | Task management and tracking |
| **Calendar** | events, create, update, search | Schedule management |
| **Email** | inbox, send, search, summarize | Email communication |
| **Code** | execute, workspace, sandbox | Run and manage code |
| **Documents** | upload, search, analyze | Document processing |
| **Web** | search, fetch, browser | Web research and navigation |
| **Media** | local_play, youtube, spotify | Music and video playback |
| **Trading** | portfolio, order, bot, research | Cryptocurrency trading |
| **Canvas** | create, update, preview | Multi-file code artifacts |
| **System** | irc, telegram, reminder | System integration |

### Projects (Execution Graph)

For complex multi-step tasks, Luna uses a DAG-based execution engine:

**Features:**
- Topological sorting for dependency resolution
- Parallel execution of independent steps
- Real-time SSE streaming of progress
- Risk classification and approval gates
- Rollback and error recovery

**Risk Levels:**
- **Low**: Auto-approved, simple operations
- **Medium**: User notification, typically auto-approved
- **High**: Manual approval required
- **Critical**: Structural changes, always requires approval

**Use Cases:**
- Code refactoring projects
- Multi-file system changes
- Complex research tasks
- Infrastructure updates

---

## Memory & Intelligence

### Three-Tier Memory Architecture

Luna integrates with **MemoryCore** for biologically-inspired memory consolidation:

```
Working Memory (Redis)
  ↓ (Session end: 5 min inactivity / browser close / delete)
Episodic Memory (PostgreSQL)
  ↓ (Daily: 2 AM consolidation)
Semantic Memory (PostgreSQL)
  ↓ (Weekly: 3 AM Sunday deep consolidation)
Long-term User Model
```

#### Working Memory
- **Storage**: Redis with 30-minute TTL
- **Purpose**: Real-time session state, attention tracking
- **Processing**: Dual-LNN networks (ThematicLNN + RelationalLNN)
- **Latency**: < 100ms per message
- **Scope**: Current conversation only

#### Episodic Memory
- **Storage**: PostgreSQL time-series
- **Purpose**: Recent experiences, emerging patterns
- **Retention**: 90 days
- **Updates**: Every 10 interactions per user
- **Includes**: Session summaries, interaction sequences, enrichment data

#### Semantic Memory
- **Storage**: PostgreSQL JSONB
- **Purpose**: User proficiency models, learning patterns
- **Retention**: Permanent
- **Updates**: Daily/weekly consolidation
- **Includes**: Preferences, known facts, thematic clusters

### Dual-LNN Architecture

**Innovation**: Separates thematic context tracking (LNN-A) from relational knowledge priming (LNN-B) with bidirectional causal gate.

#### LNN-A: ThematicLNN
- **Input**: 1024-dim embedding centroid (conversation theme)
- **Architecture**: 1024 → 512 → 512 Liquid Time-Constant Network
- **Dynamics**: Fast (tau: 0.1-5.0 seconds)
- **Purpose**: Track semantic trajectory of conversation
- **Output**: Thematic state (512-dim) + stability metric

#### LNN-B: RelationalLNN
- **Input**: 256-dim graph node activations (spreading activation)
- **Architecture**: 256 → 256 → 256 Liquid Time-Constant Network
- **Dynamics**: Slow (tau: 1.0-60.0 seconds)
- **Purpose**: Prime relevant knowledge relationships
- **Output**: Relational state (256-dim) + coherence metric

#### Causal Gate (Cross-Talk)
- **A → B**: High thematic stability lowers B's activation threshold
- **B → A**: High relational coherence biases A's trajectory
- **Result**: Strong themes activate deeper knowledge, strong knowledge pulls conversation toward related themes

#### Input Enrichment Pipeline

Every message is enriched before processing:

| Service | Input | Output | Latency |
|---------|-------|--------|---------|
| **Sentiment** | Message text | Valence, Arousal, Dominance | ~150ms (cached) |
| **Attention** | Length, latency, continuity | Score 0-1 | ~3ms |
| **Centroid** | Embedding + history | Rolling EMA | ~2ms |

### Memory Context Building

Before each LLM call, `memoryService.buildMemoryContext()` runs **16 parallel queries** with a per-query 2-second timeout via `Promise.race`. All sources are independently fault-isolated using `Promise.allSettled()` so no single failure cascades. Mamba stream context fetch is parallelized alongside memory context (no longer sequential). The layered agent also uses this full `buildMemoryContext()` for complete memory retrieval instead of a reduced version.

**16 memory context sources**:
1. `facts` -- extracted user facts
2. `learnings` -- insights/learnings
3. `graphMemory` -- entity graph (PostgreSQL)
4. `localGraphMemory` -- Neo4j graph
5. `consciousness` -- MemoryCore consciousness metrics
6. `consolidatedPatterns` -- MemoryCore behavioral patterns
7. `consolidatedKnowledge` -- MemoryCore semantic knowledge
8. `semanticMemory` -- MemoryCore semantic memory
9. `emotionalMoments` -- resonant emotional captures
10. `behavioralObservations` -- behavioral pattern changes
11. `lunaAffectContext` -- current affect state (valence/arousal/mood)
12. `anticipationContext` -- routines and active focus tracking
13. `relevantHistory` -- relevant past messages
14. `conversationContext` -- recent conversation summary
15. `contradictions` -- active contradiction signals
16. `metaCognition` + `rhythmHint` -- self-awareness and conversation rhythm

A diagnostic log (`Memory context built`) emits per-source character sizes and `sourcesResponded: "N/16"` on each call.

### Graph Memory

**Database**: PostgreSQL (local) + MemoryCore SQL graph tables

**Structure**:
- **Nodes**: Entities, topics, preferences, events, emotions
- **Edges**: Co-occurrence, semantic, causal, temporal, same_as (typed with per-type decay rates)
- **Origin Tracking**: User vs. model-originated (prevents echo chambers)
- **Soft Merging**: Reversible identity resolution via SAME_AS edges

**Semantic Edge Typing** (March 2026):
Edges are now classified into semantic types with different EMA decay rates during NeuralSleep consolidation:

| Edge Type | Tau (days) | Rationale |
|-----------|-----------|-----------|
| `co_occurrence` | 14 | Casual mentions fade in ~2 weeks |
| `semantic` | 90 | Explicit relationships are long-lived |
| `temporal` | 30 | Time-based associations |
| `causal` | 60 | Cause/effect relationships |

**Spreading Activation** (March 2026):
Graph retrieval uses BFS spreading activation instead of static narrative blobs:
- Seed entities matched from message text with fuzzy matching
- Signal decays per hop (configurable decay factor, default 0.65)
- Hop-1 threshold: 0.10, Hop-2 threshold: 0.20
- Hub fan limit: 15 neighbors per seed node
- Session bonus: 1.5x boost for edges with 3+ distinct sessions
- Max 25 results returned

**Consolidation**:
- **Immediate**: Session end - extract nodes, create co-occurrence edges
- **Daily**: 2 AM - EMA weight evolution (per-type tau), weak edge pruning, centrality recalc, provisional node promotion
- **Weekly**: 3 AM Sunday - stale node pruning, noise purge (type-exempt), graduated anti-centrality, merge candidate analysis, auto-merge for high-confidence candidates (cosine > 0.9, same type, activation_count >= 5; lower-confidence still logged for review)

**Key Principles**:
1. Connection density = memory strength (not just storage)
2. Origin tracking prevents hallucination loops
3. Soft merging only (all merges reversible)
4. Anti-centrality pressure prevents gravity wells
5. Causal edges require multi-session reinforcement
6. Spreading activation replaces static retrieval for dynamic context

### Resonant Memory (March 2026)

Captures emotional and behavioral signals for richer memory context:

- **Emotional Moments**: Captured when |valence| > 0.5 or arousal > 0.6, generates 1-sentence moment tag via LLM. Stored in `emotional_moments` table.
- **Behavioral Observations**: 15-min job compares 3-day vs 7-day enrichment stats, generates specific LLM observations. Stored in `behavioral_observations` table.
- **Contradiction Signals**: Emitted from facts service on supersession of well-established facts (mention_count >= 2). User-scoped (not session-scoped) - uses `surfaced_session_ids UUID[]` column for per-session tracking. Marked globally surfaced after 3+ sessions. Stored in `contradiction_signals` table.

### Fact Extraction & Learning

**Automatic Extraction**:
- End of each session (4+ messages)
- LLM-powered extraction (local Ollama)
- Categories: personal, work, preference, hobby, relationship, goal, context
- Confidence scoring: 0.6-1.0
- Mention counting for reinforcement

**Preference Learning**:
- Implicit feedback detection ("shorter please", "explain more")
- Style dimensions: verbosity, technicality, warmth, directness, encouragement
- Adaptive response generation
- Tracked per-user in `response_style_preferences` table

**Autonomous Learning**:
- Session analysis: Review decision quality
- Gap detection: Identify missing knowledge
- Source trust: Credibility scoring for information sources
- Fact verification: Cross-reference across multiple sessions

### Proactive Fact Management

Luna can proactively save and remove facts from chat using two LLM tools:
- `save_fact`: Saves a new fact to the user's fact store mid-conversation
- `remove_fact`: Marks a fact as inactive when it becomes stale or contradicted

---

## Cognitive Architecture

Luna includes a layered cognitive system (enabled via `LUNA_AFFECT_ENABLED=true`) that goes beyond memory retrieval into active self-awareness and adaptive behavior. Migrations 115-117.

### Affect State

Luna maintains a real-time internal affect state updated after each message:

| Dimension | Range | Description |
|-----------|-------|-------------|
| `valence` | -1.0 to 1.0 | Positive/negative emotional tone |
| `arousal` | 0.0 to 1.0 | Activation level (calm vs. excited) |
| `mood` | string | Derived label (e.g., "curious", "reflective") |

The affect state is injected as `lunaAffectContext` into the memory context and influences response tone.

### Meta-Cognition

Luna can introspect on her own reasoning and internal state using the `introspect` LLM tool. This returns a structured self-report covering:
- Current affect state
- Active focus areas
- Recent behavioral observations
- Contradiction signals being tracked

### Routine Learning

Luna observes and learns the user's recurring patterns (time-of-day activity, preferred topics, interaction cadence). Learned routines feed into the `anticipationContext` memory source so Luna can proactively anticipate needs.

### Conversation Rhythm

A `rhythmHint` is derived from interaction timing and conversational pace. It nudges Luna toward matching the user's current communication style (e.g., brief exchanges vs. deep dives).

### Self-Modification

Luna has 6 tunable behavioral parameters with safety limits that can be adjusted based on observed user preferences:

| Parameter | Description | Safety Limit |
|-----------|-------------|-------------|
| `verbosity` | Response length target | 0.1 - 1.0 |
| `technicality` | Technical depth | 0.0 - 1.0 |
| `warmth` | Emotional warmth | 0.0 - 1.0 |
| `directness` | Directness vs. hedging | 0.0 - 1.0 |
| `encouragement` | Positive reinforcement | 0.0 - 1.0 |
| `proactivity` | Unsolicited suggestions | 0.0 - 0.8 |

All changes are gradual (small deltas per session) and fully reversible.

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LUNA_AFFECT_ENABLED` | `false` | Enable all cognitive features (affect, meta-cognition, routines, rhythm) |

---

## Autonomous Mode

### Council System

Four AI personas deliberate on every autonomous decision:

| Persona | Role | Perspective |
|---------|------|-------------|
| **Polaris** | Navigator | Strategic direction, long-term thinking |
| **Aurora** | Empath | Emotional intelligence, user wellbeing |
| **Vega** | Analyst | Logic, reasoning, evidence-based analysis |
| **Sol** | Executor | Practical action, implementation focus |

### Session Lifecycle

```
START
  │
  ▼
┌─────────────┐
│ SENSE Phase │  - Gather context
│             │  - Check pending questions
│             │  - Review mood/goals
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ PLAN Phase  │  - Council deliberates
│             │  - Identify opportunities
│             │  - Consider availability
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  ACT Phase  │  - Sol proposes action
│             │  - Execute action
│             │  - Record results
└──────┬──────┘
       │
       ▼
   LOOP / PAUSE
```

### Action Types

| Prefix | Handler | Description |
|--------|---------|-------------|
| `search:` | Search | Query knowledge base or web |
| `note:` | Note | Record observations or learnings |
| `ask user:` | Question | Queue question for user |
| `schedule:` | Calendar | Create or check events |
| `research:` | Research | Deep dive into a topic |
| `sleep:` | Sleep | Wait for specified duration |
| `reflect:` | Reflect | Internal processing without action |

### Theater Mode

Real-time visibility into autonomous thinking:

**SSE Events**:
- `deliberation`: New council deliberation
- `phase`: Phase transition (sense/plan/act)
- `action`: Action taken by Luna
- `question`: Question queued for user
- `session_paused`: Session paused
- `session_ended`: Session completed

**Frontend**: Real-time streaming view with phase visualization, council insights, and action tracking.

### Circuit Breaker

Prevents infinite loops:
- Detects 3+ identical action types in a row
- Forces pause and escalation when spinning
- Tracks action history per session
- User notification via Theater Mode

### Friends & Gossip System

Luna has AI "friend" personas she discusses topics with, providing diverse perspectives and deeper understanding.

**Gossip Queue**: Topics are managed in `friend_topic_candidates` with:
- **Importance** (1-5 scale): Higher = more urgent to discuss
- **Motivation**: Why Luna wants to discuss this topic
- **Suggested friend**: Which friend persona is best suited

**Auto-Gossip Timer**: Configurable automatic discussion trigger (persisted in localStorage). When fired, picks the highest-importance unprocessed topic and starts a theater discussion.

**Theater Discussions**: Live-streamed deliberations between Luna and a friend persona, visible in the Friends window. Insights are extracted and applied to Luna's knowledge base.

**Frontend**: FriendsWindow (two-panel: 320px gossip queue + Friends tab), GossipQueuePanel with importance stars and motivation text.

*👉 [Full Friends Documentation](AUTONOMOUS.md#friends--gossip-system)*

### News Intelligence System

A full news intelligence platform with multi-source aggregation, LLM-powered classification, and priority-based alerting.

**Architecture**:
- RSS feeds from NYTimes, Guardian, Financial Times, and custom sources
- 3-day rolling window for article retention
- LLM classification via Qwen 2.5 7B on local Ollama (10.0.0.30)
- POST+polling enrichment pattern (replaced SSE for reliability)
- Heartbeat-based staleness detection for enrichment recovery

**4-Tab Layout**: Articles | Queue | Dashboard | Claims

**Classification**:
- **Categories**: Finance, Tech, Conflicts/War, Politics, Science, Health, Good News, Other
- **Priority Grades**: P1 (critical, 6%) | P2 (important, 18%) | P3 (standard, 54%) | P4 (low, 22%)
- Category counts displayed as filter pill badges

**Dashboard**:
- Enrichment control panel with one-click "Classify All"
- 3-day stats: Total / Enriched / Queue counts
- Priority distribution chart
- Category breakdown with bar visualization
- Recent classifications feed with timestamps

**Search**:
- Full-text search across all articles
- Category filter pills
- Priority dropdown filter
- Source attribution and timestamps

**Verification & Claims**:
- Confidence scores (independence, primary evidence, recency, consistency, trust)
- Claim tracking across articles
- Verification statuses: Verified, Likely, Unconfirmed, Conflicted, False/Retraction

**Integration**:
- Autonomous mode can research and summarize breaking news
- P1 articles trigger proactive alerts
- User interest tracking
- Source trust scoring
- Competitor radar consumes news signals

---

## CEO Luna

CEO Luna is a dedicated business operations workspace with an AI co-founder persona. Access it from the Communication menu (Briefcase icon). The window is 1400x860.

### Layout

- **Top (KPI Strip)**: Net P&L, Build Hours, Leads, Alert count - refreshes every 5 minutes
- **Left (File Tree)**: Workspace files under `ceo-luna/` grouped into Documents/Plans/Week folders
- **Right (Tabs)**: Viewer | Chat | Dashboard | Radar | Autopost | Album Creator | Log

### Key Features

#### Build Tracker
Time-track development sessions directly from chat using slash commands:

```
/build start <name>    -- Start a tracked build session
/build pause <#>       -- Pause (accumulates elapsed time)
/build continue <#>    -- Resume a paused build
/build done <#>        -- Complete and log hours
/build list            -- Show active/paused builds with elapsed time
```

Automated check-ins fire every 30 minutes for active builds. CEO Luna saves your replies as progress notes using the `ceo_note_build` tool.

#### Finance Logging

```
/cost <amount> <keyword> [note]    -- Log an expense
/income <amount> <source> [note]   -- Log income
```

Keywords are auto-mapped to expense categories (infrastructure, software, marketing, etc.).

#### Dashboard & Reports

- Monthly P&L chart, transaction history, and owner pay tracking
- Competitor radar (news signals for configured competitors)
- Music trend radar (Billboard, Pitchfork scraping every 2h with LLM analysis via Ollama)
- Album Creator: Autonomous music production pipeline -- genre selection, lyric generation, Suno submission, progress tracking
- Automated social posting to X, LinkedIn, Telegram, Reddit, Blog
- Scheduled reports: daily morning brief, evening review, weekly P&L, biweekly audit

### Proposals & Approval Flow

CEO Luna uses a structured proposal system before executing significant actions. Migrations 101+.

- **Proposal types**: `weekly_plan`, `department_task`, and custom action proposals
- **Priority levels**: P1 (critical), P2 (important), P3 (standard)
- **Workflow**: CEO Luna creates a proposal -> P1/P2 proposals sent to Telegram with Approve/Reject buttons -> approved proposals are executed
- **Batch operations**: Approve/reject multiple proposals at once from the OrgPanel
- **Expiry**: Proposals older than 7 days are automatically expired by the `ceoProposalExpiry` daily job
- **Staff Chat**: Department-level AI staff chat (Economy, Marketing, Development, Research) plus meeting orchestration -- parallel department calls synthesized into a unified output
- **OrgPanel**: "Pending Proposals" section at top with badge count showing unreviewed proposals

**Key tables**: `ceo_proposals`, `ceo_staff_sessions`, `ceo_staff_messages`

**Backend**: `src/ceo/ceo-proposals.service.ts`, `src/ceo/staff-chat.service.ts`

### CEO Modes

| Mode | Description |
|------|-------------|
| `pre_revenue` | Focus on build time and cost control. Alerts on build gaps. |
| `normal` | Full business mode with revenue tracking and growth KPIs. |

*👉 [Full CEO Luna Documentation](CEO_LUNA.md)*

---

## DJ Luna

DJ Luna is a dedicated AI music production studio. Access it from the Communication menu (Headphones icon). The window is 1280x800.

### Layout (3-column)

- **Left (30%)**: DJ Luna Chat - AI lyric writing with `dj_luna` session mode
- **Center (40%)**: Lyrics Canvas - monospace editor with syllable analysis
- **Right (30%)**: Songs / Style / Factory tabs

### Key Features

#### AI Lyric Writing

DJ Luna specializes in music theory, song structure, Suno tag format, and lyric writing. When a response contains a lyrics block, a **Send to Canvas** button appears. Style lines are automatically synced to the Style panel.

#### Lyrics Canvas

| Feature | Description |
|---------|-------------|
| Section detection | Recognizes all Suno section tags (`[Verse]`, `[Chorus]`, etc.) |
| Syllable gutter | Per-line syllable count displayed in right margin |
| Outlier highlighting | Lines >35% off from section median highlighted in amber |
| Section toolbar | Hover any section to get a Regenerate button |

#### 55 Genre Presets

Unified presets across 12 categories (Pop, Rock, Electronic, Hip-Hop, R&B, Chill, Folk/Country, Latin, World, Jazz/Blues, Cinematic, Experimental). Each preset includes lyrics template, Suno style tags, BPM range, energy level, and rhyme scheme. Category filter pills in the UI for quick navigation. Genre registry merges built-in + user-approved proposals (cached 5 minutes).

#### Direct Suno Integration

One-click generation from canvas lyrics via direct Suno API calls (no n8n dependency):

```
Lyrics + Style string
    -> Direct Suno API call (30s stagger for batch)
    -> MP3 saved to /mnt/data/media/Music/
    -> Status tracked in suno_generations table
```

#### Lyric Checker

Automated analysis of syllable counts, rhyme schemes, and structural issues before generation.

#### Ambient Factory

Batch-generate multiple ambient tracks from the Factory tab -- useful for producing background music libraries. Set count (1-10) and style string, then trigger batch.

#### Song Management

Songs saved as Markdown files with YAML frontmatter in `dj-luna/<project>/` workspace directory. Style presets stored in `dj-luna/styles.json`.

*👉 [Full DJ Luna Documentation](DJ_LUNA.md)*

---

## Music Pipeline

The music production pipeline spans DJ Luna and CEO Luna, providing end-to-end music creation capabilities.

### Genre System

**55 unified genre presets** across 12 categories, each containing:
- Lyrics template (song structure with required/optional sections)
- Suno style tags (genre-specific prompt for Suno AI)
- BPM range and energy level
- Rhyme scheme and syllable range

The **genre registry** (`genre-registry.service.ts`) merges built-in presets with user-approved proposals from the `proposed_genre_presets` table. Cached 5 minutes per user.

### Album Production Pipeline

CEO Luna can trigger autonomous multi-album productions:

```
Genre selection (55 presets or proposed)
    |
    v
LLM generates album plan (Ollama / configured model)
    |
    v
Per-song pipeline:
    Write lyrics -> Review (lyric checker) -> Submit to Suno -> Track
    |
    v
Album completion (all songs done)
```

- Productions stored in `album_productions` table with per-song entries in `album_songs`
- 30-second stagger between Suno submissions (rate limiting)
- Background job `runAlbumPipelineStep` processes one step at a time
- MP3s saved to `/mnt/data/media/Music/<title>-<ts>.mp3`

### Music Trend Scraper

The `runMusicTrendScraper` job scrapes music sources every 2 hours:

- **Sources**: Billboard, Pitchfork, custom newsfetcher
- **Analysis**: Ollama (Qwen 2.5) identifies emerging genres, breakout artists, production trends
- **Auto-production**: High-confidence trends can auto-approve a genre preset and queue album productions (3 albums, one per artist)
- **Storage**: `music_trend_raw` table with LLM-generated analysis summaries
- **UI**: CEO Luna Radar panel with "Music Trends" filter tab

### Key Files

| File | Purpose |
|------|---------|
| `src/abilities/genre-presets.ts` | 55 hardcoded genre presets |
| `src/abilities/genre-registry.service.ts` | Preset registry (built-in + proposed) |
| `src/abilities/suno-generator.service.ts` | Direct Suno API integration |
| `src/abilities/lyric-checker.service.ts` | Lyric quality analysis |
| `src/ceo/album-pipeline.service.ts` | Autonomous album production |
| `src/ceo/music-trend-scraper.service.ts` | Trend scraping + LLM analysis |
| `frontend/src/lib/genre-presets.ts` | Frontend genre definitions |

---

## News Intelligence

Luna includes a full news intelligence platform for multi-source aggregation, LLM-powered classification, and priority-based alerting. Accessible from the desktop as the **News** window.

### Architecture

- **Sources**: RSS feeds from NYTimes, Guardian, Financial Times, and custom sources
- **Window**: 3-day rolling window for article retention and enrichment
- **LLM**: Classification via Qwen 2.5 7B on local Ollama (10.0.0.30)
- **Enrichment**: POST+polling pattern with heartbeat-based staleness detection, bounded concurrency (3 parallel via Promise.allSettled instead of sequential 500ms-delayed processing)

### Tabs

| Tab | Purpose |
|-----|---------|
| **Articles** | Browse classified articles with P1-P4 priority badges, category tags, search, and filter pills |
| **Queue** | View pending articles awaiting LLM classification |
| **Dashboard** | Enrichment control, 3-day stats, priority distribution, category breakdown, recent classifications |
| **Claims** | Track claims across articles with verification statuses |

### Priority Grades

| Grade | Meaning | Typical % |
|-------|---------|-----------|
| **P1** | Critical - geopolitical, breaking | ~6% |
| **P2** | Important - significant developments | ~18% |
| **P3** | Standard - general news | ~54% |
| **P4** | Low - lifestyle, opinion | ~22% |

### Categories

Finance, Tech, Conflicts/War, Politics, Science, Health, Good News, Environment, Other. Each article is assigned exactly one category with a color-coded badge.

### Key Files

| File | Purpose |
|------|---------|
| `src/news/news-sync.service.ts` | RSS feed aggregation and article sync |
| `src/news/news-enrichment.service.ts` | LLM classification pipeline |
| `src/news/news.routes.ts` | REST endpoints for articles, enrichment, dashboard |
| `frontend/src/components/os/apps/NewsWindow.tsx` | Main news window |
| `frontend/src/components/news/ArticlesTab.tsx` | Article list with search and filters |
| `frontend/src/components/news/DashboardTab.tsx` | Enrichment dashboard |

---

## Trading System

### Trader Luna

Separate specialized persona focused entirely on cryptocurrency trading:

**Isolation**: No access to personal data, calendar, or email - purely trading-focused.

**Exchanges**:
- Binance (Spot + Margin)
- Crypto.com
- Binance Alpha (new token listings)

**Trading Modes**:
- **Spot**: Direct buy/sell
- **Margin**: Leveraged trading with risk management
- **Paper**: Risk-free strategy testing

### Features

#### Portfolio Management
- Real-time holdings and balances
- Margin metrics (borrowed, interest, maintenance)
- P&L tracking (realized + unrealized)
- Multi-currency support

#### Order Execution
- Market orders (instant execution)
- Limit orders (price targets)
- Take Profit / Stop Loss (TP/SL)
- Order confirmation flow
- Telegram trade notifications

#### Auto Trading
- Signal-based execution (RSI, MACD crossover)
- Rule engine (entry/exit conditions)
- Position sizing (fixed, % of portfolio)
- Risk management (stop-loss, max position)
- Telegram control (start/stop/status)

#### Trading Bots

| Bot Type | Strategy |
|----------|----------|
| **Grid Bot** | Buy/sell at price intervals within a range |
| **DCA Bot** | Dollar-cost averaging at regular intervals |
| **RSI Bot** | Trade based on RSI oversold/overbought signals |

**Configuration**:
- Custom parameters per bot
- Start/stop control
- Performance tracking
- Position management

#### Research Mode

Automated technical analysis:

**Indicators**:
- RSI (Relative Strength Index) - oversold/overbought
- MACD - trend momentum and crossovers
- Bollinger Bands - volatility and price channels
- EMA Cross - moving average crossover signals
- Volume Analysis - volume spike detection

**Signal Generation**:
- Confidence scores
- Entry/exit recommendations
- Risk assessment
- Auto-execute or request confirmation

#### Scalping Mode

High-frequency paper trading for strategy testing:

- Paper mode for risk-free testing
- Live mode for real execution
- Position tracking
- P&L analytics
- Configurable entry/exit rules

### TradeCore Engine

**Language**: Go
**Port**: 9090
**Purpose**: High-performance trading engine

**Features**:
- WebSocket price streaming
- Order book management
- Position tracking
- Risk calculations
- Rate limiting (exchange API)

---

## Friends System

Luna has AI "friend" personas she discusses topics with to build deeper understanding through diverse perspectives.

### Gossip Queue

Topics Luna wants to discuss are managed in the `friend_topic_candidates` table:

| Field | Description |
|-------|-------------|
| `importance` | 1-5 scale (higher = more urgent) |
| `motivation` | Why Luna wants to discuss this |
| `suggested_friend_id` | Which friend persona is best for this topic |
| `status` | `pending`, `in_progress`, `processed` - `in_progress` prevents topic loss on discussion failure |

**Safeguards**:
- **Semantic dedup**: New topic candidates are rejected if cosine similarity > 0.85 with an existing candidate
- **Council escalation**: High-importance topics (> 0.85) or recurring topics (3+ occurrences) are escalated to council deliberation
- **Config extraction**: Topic thresholds (`friends.topicThreshold`, `friends.minEvidence`, `friends.minConfidence`) are centralized in `src/config/index.ts`

### Auto-Gossip Timer

Configurable automatic discussion trigger (persisted in localStorage):
- Toggle enable/disable
- Configurable interval between discussions
- Picks highest-importance unprocessed topic
- Starts theater discussion with suggested friend (or random)

### Theater Discussions

Live-streamed deliberations between Luna and a friend persona:
1. Topic selected from gossip queue
2. Luna and friend exchange perspectives
3. Insights extracted and applied to Luna's knowledge

### Frontend

- **FriendsWindow**: Two-panel layout (320px gossip queue + Friends tab)
- **GossipQueuePanel**: Checklist with importance stars and motivation text
- **FriendsTab**: Friend management with theater discussion launcher

### Backend

| File | Purpose |
|------|---------|
| `src/autonomous/friend.service.ts` | Friend relationship management |
| `src/autonomous/friend-verification.service.ts` | Topic candidates CRUD, personality verification |
| `src/autonomous/autonomous.routes.ts` | POST/PATCH/DELETE `/friends/topics` routes |
| `src/db/migrations/088_gossip_queue_fields.sql` | Gossip queue schema |

*👉 [Full Friends Documentation](AUTONOMOUS.md#friends--gossip-system)*

---

## VR Luna

VR Luna is a separate Unreal Engine 5.5 C++ project (`/opt/vr-luna/`) that brings Luna into virtual reality via Steam Index VR.

### Architecture

- **Codebase**: 46 source files, ~7,900 lines of C++
- **Engine**: Unreal Engine 5.5
- **Target**: Steam Index VR (cross-compiled to Windows)
- **Network**: HTTP REST + SSE + WebSocket to Luna Chat API at 10.0.0.2:3003 over WireGuard

### Three Themed Rooms

| Room | Persona | Purpose |
|------|---------|---------|
| **Music Room** | DJ Luna (`dj_luna`) | Spatial audio music playback and production chat |
| **CEO Office** | CEO Luna (`ceo_luna`) | Business strategy and operations discussions |
| **Relax Room** | Companion | Casual conversation and relaxation |

### Avatar System

- **MetaHuman** avatar with full body rigging
- **Goertzel lip sync**: Audio-driven mouth movements
- **8 emotion states**: Mapped to conversation context
- **Gaze IK tracking**: Eye contact with the player
- **Proactive behavior**: Luna initiates conversation based on context

### Voice Pipeline

```
Microphone -> VAD (Voice Activity Detection)
    -> WebSocket to Luna Chat API
    -> STT (Speech-to-Text)
    -> LLM processing
    -> TTS (Text-to-Speech)
    -> Spatial audio playback
```

### Build

```bash
# Cross-compile to Windows for Steam Index VR
Build/Scripts/build.sh package
```

---

## Luna Streams

Luna Streams is a continuous cognition layer -- a trained Mamba 2.8B model with MLP heads running 24/7 on a dedicated RTX 3080 GPU, processing memory events in real-time. The model maintains persistent hidden states encoding compressed user understanding. No context windows. No batch jobs. Always on.

**Standalone service**: Runs on 10.0.0.30 as a systemd service (NOT Docker). Code at `/media/gpu/claude/luna-streams/`, models symlinked from `/media/gpu/claude1/luna-streams-models`. Python + FastAPI on port 8100.

### Architecture

```
Luna Chat                          Luna Streams
---------                          ------------
chat.service.ts  --POST /api/events-->  [Event Queue]
memory.service.ts                            |
                                    [User Model Stream] --> EMA Buffer --> State (safetensors)
                                    [Knowledge Graph Stream] (planned)
                                    [Conversation Dynamics Stream] (planned)
                                             |
luna.persona.ts  <--GET /api/context--  [Context Injector] (~120 tokens)
```

### Inference

- **Model**: `mamba-2.8b-user-q8_0.gguf` (Mamba 2.8B with trained MLP heads)
- **Hardware**: RTX 3080, ~3GB VRAM
- **Format**: GGUF Q8_0 via llama-cpp-python with CUDA acceleration
- **Performance**: 97ms mean latency, 10.3 events/sec
- **Target**: <150ms mean latency per step -- PASSED
- **URL**: `http://10.0.0.30:8100` (WireGuard VPN)

### Compact Event Encoding

Events are tokenized into ~16 tokens for the Mamba model (critical for <150ms latency):

```
mem_e conv Luna,Henke architecture 0.6 0.8 Working on Mamba integration
```

### EMA Dual-State Buffer

Each stream maintains two exponential moving averages of the hidden state:

- **Fast state**: Current SSM output (replaced each step)
- **Slow state**: EMA with decay 0.999 (tracks long-term trends)
- **Drift signal**: `L2(fast - slow) / norm(slow)` -- spikes on behavioral changes

Both states are persisted via safetensors with 3-snapshot rotation.

### Luna Chat Integration

| File | Purpose |
|------|---------|
| `src/integration/luna-streams.client.ts` | Event emission with retry/circuit breaker + delta-tracked context with cache |
| `src/chat/chat.service.ts` | Emits chat interactions as memory_entry events |
| `src/memory/memory.service.ts` | Emits entity_update events after graph extraction and edge classification |
| `src/persona/luna.persona.ts` | Injects stream context in Tier 2 (stable) |

**Context injection format** (~120 tokens):
```
[Continuous Cognition - Mamba Streams]
[User State] Henke is deep in architecture work...
[Drift] 0.15 (low - business as usual)
```

Delta tracker returns `changed: false` when state delta < 0.01, so context only regenerates on meaningful shifts.

**Resilience** (March 2026):
- **Retry with backoff**: Max 2 retries (500ms, 1000ms delay)
- **Circuit breaker**: 5 consecutive failures stops retrying until reset
- **Context cache**: 5-min TTL, max 100 entries, returns cached value on timeout
- **Timeouts**: Configurable via `lunaStreams.emitTimeoutMs` and `lunaStreams.contextFetchTimeoutMs` in `src/config/index.ts`

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LUNA_STREAMS_URL` | `http://luna-streams:8100` | Luna Streams service URL |
| `LUNA_STREAMS_ENABLED` | `false` | Enable event emission and context injection |

### Status

- [x] Phase 0: Benchmark (97ms mean, PASSED)
- [x] Phase 1: FastAPI app + memory bridge + event ingestion
- [x] Phase 4: Stream 1 deployment with GGUF inference
- [x] Phase 5: Luna Chat integration (client, emission, context injection)
- [ ] Phase 2-3: Training data preparation + LoRA fine-tune
- [ ] Phase 6: Validation gate
- [ ] Phase 7-10: Summary decoder, Streams 2-3, cross-stream, NeuralSleep

---

## Integrations

### Calendar (CalDAV)

**Supported Providers**:
- Google Calendar
- Microsoft Outlook
- Self-hosted Radicale
- Any CalDAV-compliant server

**Features**:
- View upcoming events
- Create events via natural language
- Edit existing events
- Timezone support (default: Europe/Stockholm)
- Smart reminders with natural language parsing

**Implementation**: `src/abilities/calendar.service.ts`

### Email (SMTP/IMAP)

**Mail-Luna Gatekeeper**: 3-step security pipeline for inbound email

**Pipeline**:
1. **Envelope Trust Check**: Verify sender against trusted list
2. **Heuristic Analysis**: 24 weighted prompt injection patterns
3. **LLM Classification**: Local Ollama nano-model (qwen2.5:3b)

**Protection**:
- Quarantine risky emails (risk score > threshold)
- Prevent LLM memory poisoning from email content
- Exclude email content from embeddings and fact extraction
- Support for wildcard trusted senders (`*@domain.com`)

**Features**:
- Read inbox (recent and unread)
- Search email by content
- Send email with HTML support
- Summarize email threads
- Configurable risk threshold (0-1)

**Implementation**: `src/abilities/email.service.ts`, `src/email/email-gatekeeper.service.ts`

### Telegram

**Two-way messaging and notifications**:

**Features**:
- Receive proactive messages and reminders
- Send messages to Luna from anywhere
- Get notifications for important events
- Two-way conversation support
- Web chat integration (Luna can send you Telegram messages during web chats)
- Voice note support ("Calling Luna" via voice)
- Trading notifications (orders, fills, bot activity)

**Setup**:
1. Configure Telegram bot token in Settings > Integrations
2. Generate link code and send to bot
3. Chat with Luna directly from Telegram

**Implementation**: `src/triggers/telegram.service.ts`

### IRC

**Integrated IRC client for real-time chat**:

**Features**:
- Connect to IRC servers
- Join channels
- Send/receive messages
- Real-time message streaming
- Multi-channel support

**Default Server**: luna.bitwarelabs.com:12500

**Implementation**: `src/abilities/irc.service.ts`

### Spotify

**Music playback control and recommendations**:

**Features**:
- Search tracks, albums, artists
- Playback control (play, pause, skip)
- Queue management
- Get recommendations
- Current playback status

**Authentication**: OAuth 2.0 with token encryption (AES-256-GCM)

**Implementation**: `src/abilities/spotify.service.ts`

### Local Media Player

**Direct HTTP streaming (no Jellyfin/VLC required)**:

**Features**:
- Native HTML5 video/audio player
- Smart fuzzy search (filenames, directories, metadata)
- Format support: MP4, MKV, AVI (video) | MP3, FLAC, M4A, OGG (audio)
- YouTube integration (yt-dlp download with cookie auth)
- Unified media window (YouTube iframe + local player)

**Media Structure**:
- Videos: `/mnt/data/media/Videos/`
- Music: `/mnt/data/media/Music/`

**YouTube Download**:
- Cookie-based authentication (bypasses anti-bot)
- Video (MP4) or Audio (MP3) format
- Auto-integration with local library
- Download progress tracking

**Jellyfin Integration**: Luna can search and stream from a Jellyfin media server using the `jellyfin_search` and `jellyfin_play` tools.

**Implementation**: `src/abilities/local-media.service.ts`, `src/media/ytdlp.service.ts`, `src/media/jellyfin.service.ts`

### Web Search (SearXNG)

**Privacy-respecting meta-search engine**:

**Features**:
- Multi-source aggregation
- No tracking or profiling
- Configurable result count
- Category filtering
- Language selection

**Implementation**: `src/search/web-search.service.ts`

### MCP (Model Context Protocol)

**External tool integration via HTTP or stdio transports**:

**Features**:
- HTTP transport for remote MCP servers
- Stdio transport for local processes
- Automatic tool discovery
- Per-tool enable/disable
- Custom headers and authentication
- Environment variable support

**Configuration**: Settings > MCP Servers

**Implementation**: `src/mcp/mcp.service.ts`, `src/mcp/transports.ts`

### Sanhedrin (A2A Protocol) -- DEPRECATED

**Multi-agent task delegation** (deprecated -- no longer active functionality):

**Features** (historical):
- Delegate complex tasks to external agents
- JSON-RPC 2.0 protocol
- Claude Code CLI integration
- Structured task artifacts
- Timeout configuration

**Configuration**: `SANHEDRIN_ENABLED`, `SANHEDRIN_BASE_URL`, `SANHEDRIN_TIMEOUT`

**Implementation**: `src/llm/providers/sanhedrin.provider.ts`

### KDE Desktop Integration (March 2026)

**Desktop notifications and control via WebSocket**:

**Features**:
- Real-time notifications pushed to KDE desktop
- WebSocket-based bidirectional communication
- Native Linux desktop integration
- Notification actions and click handling

**Implementation**: WebSocket service for KDE Plasma desktop bridge

### Files Window (March 2026)

**Full file manager with tree view**:

**Features**:
- Tree view file browser for workspace files
- Rename, mkdir, chmod operations
- File creation and deletion
- Directory navigation with breadcrumbs
- Integration with editor for direct file editing

**Implementation**: `frontend/src/components/os/apps/FilesWindow.tsx`, `src/abilities/workspace.service.ts`

---

## Developer Guide

### Project Structure

```
luna-chat/
├── src/                          # Backend (Node.js/TypeScript)
│   ├── abilities/               # Tools and integrations
│   ├── agentic/                 # Agent loop, unified tool executor, cost tracker, shared helpers
│   ├── autonomous/              # Autonomous mode
│   ├── ceo/                     # CEO Luna backend
│   ├── planner/                 # Projects (Execution Graph)
│   ├── auth/                    # Authentication
│   ├── intents/                 # Intent persistence
│   ├── email/                   # Email security (gatekeeper)
│   ├── chat/                    # Chat processing
│   ├── llm/                     # LLM providers
│   ├── media/                   # Jellyfin + yt-dlp media
│   ├── memory/                  # Memory system
│   ├── graph/                   # Graph memory integration
│   ├── integration/             # External service clients (Luna Streams)
│   ├── persona/                 # Personality
│   ├── search/                  # Web search
│   ├── security/                # Security middleware
│   ├── triggers/                # Proactive triggers
│   ├── mcp/                     # Model Context Protocol
│   ├── trading/                 # Trader Luna
│   ├── canvas/                  # Canvas artifacts
│   ├── activity/                # Activity logging
│   └── db/                      # Database clients
├── frontend/                     # Next.js web UI
│   ├── src/
│   │   ├── components/
│   │   │   ├── ceo-luna/        # CEO Luna panels
│   │   │   ├── dj-luna/         # DJ Luna panels
│   │   │   ├── os/              # Desktop OS shell + windows
│   │   │   └── settings/        # Settings panels
│   │   ├── hooks/               # Custom hooks
│   │   └── lib/                 # Zustand stores, API client
├── android/                      # Native Android app
├── docs/                         # Documentation
├── n8n-workflows/                # n8n workflow JSON exports
├── secrets/                      # Docker secrets
└── workspace/                    # User workspace files
```

### Build Commands

```bash
# Development
npm run dev                       # Backend with hot reload
cd frontend && npm run dev        # Frontend dev server

# Production
npm run build                     # Standard build (with source maps)
npm run build:prod                # Production build (no source maps)
cd frontend && npm run build      # Frontend build

# Testing
npm test                          # Run tests
npm run lint                      # Lint code
npm run format                    # Format code

# Database
npm run migrate                   # Run migrations
npm run migrate:rollback          # Rollback last migration
```

### Deployment Workflow

**Important**: Both backend and frontend run as built Docker images with code baked in at build time (NOT volume-mounted).

```bash
# Backend changes
npm run build:prod
docker compose build luna-api
docker compose up -d luna-api

# Frontend changes
cd frontend && npm run build
cd .. && docker compose build luna-frontend
docker compose up -d luna-frontend

# Full rebuild
npm run build:prod
cd frontend && npm run build && cd ..
docker compose build
docker compose up -d
```

**Note**: `docker restart` does NOT apply code changes - you must rebuild the Docker image with `docker compose build`.

### Database Migrations

**Location**: `src/db/migrations/`

**Naming**: `XXX_descriptive_name.sql` (numbered sequentially)

**Latest**: Migration 117+ (Cognitive architecture -- affect state, meta-cognition, routine learning)

**Create Migration**:
```bash
# Create new migration file
echo "-- Migration 076: Add new feature" > src/db/migrations/076_new_feature.sql

# Add SQL statements
vim src/db/migrations/076_new_feature.sql

# Run migration
npm run migrate
```

**Important Tables**:
- `sessions`: Chat sessions (NOT `chat_sessions`)
- `message_embeddings`: Vectors with emotional_valence, attention_score
- `user_facts`: Extracted facts with confidence
- `response_style_preferences`: Learned communication preferences
- `memory_nodes` / `memory_edges`: Graph memory (if using local graph)
- `suno_generations`: Suno music generation tracking
- `album_productions` / `album_songs`: Album pipeline state
- `ceo_active_builds` / `ceo_build_notes`: Build tracking
- `ceo_configs`: CEO configuration (plural, NOT `ceo_config`)
- `proposed_genre_presets`: User-submitted genre presets
- `music_trend_raw`: Music trend scraping results
- `friend_topic_candidates`: Gossip queue topics
- `emotional_moments`: Resonant memory - emotional captures
- `contradiction_signals`: Resonant memory - fact contradictions (user-scoped)
- `behavioral_observations`: Resonant memory - behavioral pattern changes

### Common Patterns

#### Getting User ID from Request
```typescript
const userId = (req as Request & { user?: { userId: string } }).user?.userId;
if (!userId) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

#### Database Queries
```typescript
import { query } from '../db/postgres.js';

// Wrapper function for type safety
async function getUserFacts(userId: string): Promise<any[]> {
  const result = await query(
    'SELECT * FROM user_facts WHERE user_id = $1 AND is_active = true',
    [userId]
  );
  return result;
}
```

#### Workspace Files
```typescript
import * as workspaceService from '../abilities/workspace.service.js';

// Read user file
const content = await workspaceService.readFile(userId, 'notes.txt');

// Write user file
await workspaceService.writeFile(userId, 'notes.txt', 'New content');
```

#### Project Files (Session-scoped)
```typescript
import * as projectService from '../abilities/project.service.js';

// Read project file
const content = await projectService.readProjectFile(sessionId, 'config.json');

// Write project file
await projectService.writeProjectFile(sessionId, 'config.json', '{}');
```

### Code Style

- **No em dashes**: Use hyphens (-) or double hyphens (--)
- **TypeScript strict mode**: No unused imports/vars
- **ESM imports**: All imports use `.js` extension
- **noUnusedParameters**: Prefix unused params with `_`
- **Function-based API client**: `api<T>(endpoint, options)` not axios-style

### Dead Code Cleanup (March 2026)

The following were removed as part of codebase cleanup:

**Removed functions**: `needsOrchestration()`, `detectAbilityIntentWithCache`, `executeFactCorrection`, some builtin-tools functions, `queryEpisodicMemory`, `formatMemoryWithConsciousness`, `getFullMemoryContext`, `formatFullMemoryContext`

**Removed modules**: `mood-awareness.service.ts`, `backtest-validator.service.ts`, `binance.client.ts`, `test-pdf.ts`, `ApprovalMessage.tsx`

**Removed dependencies**: `rate-limit-redis`, `socket.io`

**Removed emissions**: `emitSessionMeta` (unused). `emitEdgeUpdate` is now wired into edge classification.

### Security Hardening

The project includes comprehensive security measures:

| Feature | Implementation |
|---------|----------------|
| **Docker Secrets** | Credentials in `/secrets/*.txt` (never in code) |
| **Token Encryption** | AES-256-GCM for OAuth tokens at rest |
| **Authentication** | JWT with access/refresh token flow |
| **WebSocket Auth** | Token-based WebSocket authentication |
| **Rate Limiting** | In-memory, per-endpoint limits (rate-limit-redis removed) |
| **Fail2ban** | IP-based login tracking |
| **SSRF Protection** | URL validation on external requests |
| **Input Validation** | Zod schemas on all endpoints |
| **SQL Injection** | Parameterized queries only |
| **Command Injection** | `spawn()` not `exec()`, `execFile()` not `exec()` |
| **XSS Prevention** | Content Security Policy headers (Helmet) |
| **TLS Enforcement** | Production-mode TLS certificate validation |
| **Email Gatekeeper** | 3-step inbound email firewall |
| **Sandbox Isolation** | Docker-based code execution |

---

## API Reference

**Base URL**: `http://localhost:3005/api`

**Authentication**: JWT token in `Authorization: Bearer <token>` header

**Response Format**: JSON

**Error Format**:
```json
{
  "error": "Error message",
  "details": "Optional additional details"
}
```

### Core Endpoints

See [README.md](../README.md#api-reference) for full endpoint listing.

### SSE (Server-Sent Events)

**Chat Streaming**: `POST /api/chat/sessions/:id/send`
- Response type: `text/event-stream`
- Events: `content`, `tool_call`, `tool_result`, `done`

**Theater Mode**: `GET /api/autonomous/deliberations/live`
- Response type: `text/event-stream`
- Events: `deliberation`, `phase`, `action`, `question`, `session_paused`, `session_ended`

**Activity Stream**: `GET /api/activity/stream`
- Response type: `text/event-stream`
- Events: `activity` (real-time activity logs)

### WebSocket

**Voice Chat**: `ws://localhost:3005/ws/voice`
- Protocol: Binary (PCM audio)
- Features: VAD, streaming STT, streaming TTS
- Auth: WebSocket query param `?token=<jwt>`

---

## Configuration

### Environment Variables

**Core**:
- `NODE_ENV`: `production` | `development`
- `PORT`: API port (default: 3005)
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `JWT_SECRET`: JWT signing key (generated on setup)
- `ENCRYPTION_KEY`: Token encryption key (generated on setup)

**LLM Providers**:
- `OPENAI_API_KEY`: OpenAI API key
- `ANTHROPIC_API_KEY`: Anthropic API key
- `GROQ_API_KEY`: Groq API key
- `GOOGLE_API_KEY`: Google AI API key
- `XAI_API_KEY`: xAI API key
- `OPENROUTER_API_KEY`: OpenRouter API key

**Local Services**:
- `OLLAMA_HOST`: Ollama URL (default: http://luna-ollama:11434)
- `SEARXNG_URL`: SearXNG search engine URL
- `ELEVENLABS_API_KEY`: ElevenLabs TTS API key

**Luna Streams**:
- `LUNA_STREAMS_URL`: Luna Streams service URL (default: http://luna-streams:8100)
- `LUNA_STREAMS_ENABLED`: Enable Mamba Streams event emission and context injection (default: false)
- Timeouts and thresholds configured in `src/config/index.ts`: `lunaStreams.emitTimeoutMs`, `lunaStreams.contextFetchTimeoutMs`

**Memory**:
- `MEMORYCORE_URL`: MemoryCore API URL (default: http://memorycore-api:3007)
- `MEMORYCORE_ENABLED`: Enable MemoryCore integration (default: true)
- `MEMORYCORE_CONSCIOUSNESS_ENABLED`: Enable consciousness metrics (default: true)
- `MEMORYCORE_PHI_THRESHOLD`: Phi threshold for consciousness (default: 0.5)
- `NEURALSLEEP_WORKING_URL`: Working LNN service URL
- `NEURALSLEEP_GRAPH_ACTIVATION_ENABLED`: Enable spreading activation (default: true)

**Email**:
- `EMAIL_GATEKEEPER_ENABLED`: Enable email security gatekeeper (default: true)
- `EMAIL_TRUSTED_SENDERS`: Comma-separated trusted senders (supports `*@domain.com`)
- `EMAIL_GATEKEEPER_RISK_THRESHOLD`: Risk score threshold (0-1, default: 0.5)
- `EMAIL_GATEKEEPER_MODEL`: Ollama model for classification (default: qwen2.5:3b)

**Integrations**:
- `TELEGRAM_BOT_TOKEN`: Telegram bot token
- `TELEGRAM_WEBHOOK_URL`: Public URL for Telegram webhook
- `IRC_SERVER`: IRC server address (default: luna.bitwarelabs.com)
- `IRC_PORT`: IRC server port (default: 12500)
- `IRC_NICK`: Luna's IRC nickname (default: Luna)

**Friends** (hardcoded thresholds moved to `src/config/index.ts`):
- `friends.topicThreshold`, `friends.minEvidence`, `friends.minConfidence` - configurable in code config

**Autonomous**:
- `AUTONOMOUS_ENABLED`: Enable autonomous mode (default: true)
- `AUTONOMOUS_INTERVAL`: Minutes between sessions (default: 60)
- `AUTONOMOUS_MAX_DAILY`: Max sessions per day (default: 10)
- `AUTONOMOUS_IDLE_TIMEOUT`: Session idle timeout in minutes (default: 30)
- `SANHEDRIN_ENABLED`: Enable Sanhedrin integration
- `SANHEDRIN_BASE_URL`: Sanhedrin server URL
- `SANHEDRIN_TIMEOUT`: Request timeout in ms (default: 120000)

### Supported LLM Providers

10 providers are supported:

| Provider | Tool/Function Calling | Notes |
|----------|----------------------|-------|
| **anthropic** | Yes | Claude Sonnet 4, Claude Opus 4 |
| **google** | Yes (March 2026) | Full tool/function calling support via `generateContent` API |
| **groq** | Yes | Llama 3.3, fast inference |
| **moonshot** | Yes | Moonshot (Kimi) models |
| **ollama** | Limited | Primary local LLM (BGE-M3, Qwen 2.5, Llama) |
| **ollama-micro** | Limited | Small/fast local model for lightweight tasks |
| **ollama-secondary** | Limited | Fallback local model |
| **ollama-tertiary** | Limited | Analysis tasks (e.g., Qwen 2.5 7B for classification) |
| **openrouter** | Yes | Multi-model gateway |
| **xai** | Yes | Grok models |

### Model Configuration

Configure models per-task in Settings > Models:

```json
{
  "main": {
    "provider": "openai",
    "model": "gpt-5.1"
  },
  "council": {
    "provider": "groq",
    "model": "llama-3.3-70b-versatile"
  },
  "researcher": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514"
  },
  "coder": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514"
  },
  "embeddings": {
    "provider": "ollama",
    "model": "bge-m3"
  },
  "sentiment": {
    "provider": "groq",
    "model": "llama-3.1-8b-instant"
  }
}
```

### User Settings

Per-user configuration in Settings panel:

**Profile**:
- Name, timezone, language preferences
- Communication style preferences
- Topic interests

**Models**:
- Main chat model
- Council/friends model
- Researcher agent model
- Coder agent model
- Embeddings model

**Autonomous**:
- Auto-start on login
- Session interval
- Max daily sessions
- Idle timeout
- Preferred session times

**Triggers**:
- Delivery methods (in-app, Telegram, SSE, push)
- Schedule management
- Telegram connection

**Memory**:
- Fact management
- Learning history
- Trust scores

---

## Troubleshooting

### Common Issues

#### 1. "Connection lost" or WebSocket errors

**Symptoms**: WebSocket disconnections, SSE stream errors, voice chat issues

**Solutions**:
- Check reverse proxy timeout settings (should be > 30s for SSE)
- Verify `withCredentials: true` on EventSource
- Check firewall/network for WebSocket blocking
- Review logs: `docker logs luna-api 2>&1 | grep -i websocket`

#### 2. Memory not persisting

**Symptoms**: Luna doesn't remember facts, preferences not applied

**Solutions**:
- Verify Ollama is running: `docker ps | grep ollama`
- Check embeddings are generated: `SELECT COUNT(*) FROM message_embeddings;`
- Ensure sessions have 4+ messages (required for summary)
- Check MemoryCore connection: `docker logs luna-api | grep -i memorycore`
- Review fact extraction: `SELECT * FROM user_facts ORDER BY created_at DESC LIMIT 10;`

#### 3. Slow responses

**Symptoms**: Long latency for chat responses

**Solutions**:
- Check cache hit rate: Review sentiment service cache logs
- Verify Ollama performance: `docker logs luna-ollama`
- Review database query performance: `EXPLAIN ANALYZE` on slow queries
- Check Redis: `docker exec luna-redis redis-cli -a $REDIS_PASSWORD PING`
- Disable heavy features temporarily (Dual-LNN, graph memory)

#### 4. Session consolidation not working

**Symptoms**: Sessions not consolidating to MemoryCore

**Solutions**:
- Check Redis activity tracking: `docker exec luna-redis redis-cli -a $REDIS_PASSWORD KEYS "session:activity:*"` (session activity uses batch `mget` to avoid N+1 queries)
- Verify consolidation job is running: `docker logs luna-api | grep -i "consolidat"`
- Check MemoryCore logs: `docker logs memorycore-api`
- Review consolidation table: `SELECT * FROM consolidation_logs ORDER BY timestamp DESC LIMIT 5;`

#### 5. Trading errors

**Symptoms**: Orders fail, portfolio not loading, bot errors

**Solutions**:
- Verify API keys: Check Binance/Crypto.com API keys in Settings
- Check TradeCore: `docker logs tradecore`
- Review rate limits: Binance has strict rate limits
- Verify paper mode vs. live mode configuration
- Check Telegram notifications are configured for trade alerts

#### 6. Canvas preview not working

**Symptoms**: Canvas artifacts don't show preview

**Solutions**:
- Check file paths are relative (not absolute)
- Verify image assets are uploaded
- Review browser console for errors
- Check CORS settings for asset loading

#### 7. Email gatekeeper blocking legitimate emails

**Symptoms**: Important emails quarantined

**Solutions**:
- Add sender to `EMAIL_TRUSTED_SENDERS`: `sender@example.com,*@trusted-domain.com`
- Lower risk threshold: `EMAIL_GATEKEEPER_RISK_THRESHOLD=0.7`
- Review quarantined emails: Check email service logs
- Temporarily disable gatekeeper: `EMAIL_GATEKEEPER_ENABLED=false`

### Debug Logging

Enable detailed logging:

```bash
# Environment variable
LOG_LEVEL=debug docker compose up luna-api

# Or in .env
LOG_LEVEL=debug
```

**Log Levels**: `error`, `warn`, `info`, `debug`

### Health Checks

**API Health**:
```bash
curl http://localhost:3005/health
```

**Database**:
```bash
docker exec luna-postgres psql -U postgres -c "SELECT 1;"
```

**Redis**:
```bash
docker exec luna-redis redis-cli -a $REDIS_PASSWORD PING
```

**Ollama**:
```bash
curl http://localhost:11434/api/tags
```

**MemoryCore** (if integrated):
```bash
curl http://localhost:3007/health
```

### Performance Monitoring

**PostgreSQL Query Stats**:
```sql
SELECT query, calls, mean_exec_time, stddev_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

**Redis Memory**:
```bash
docker exec luna-redis redis-cli -a $REDIS_PASSWORD INFO memory
```

**Process Stats**:
```bash
docker stats luna-api luna-frontend luna-postgres luna-redis
```

---

## Additional Resources

- **README.md**: Quick start and feature overview
- **docs/MEMORY.md**: Deep dive into memory system
- **docs/AUTONOMOUS.md**: Autonomous mode and Council system
- **docs/PLANNER.md**: Projects (Execution Graph) documentation
- **docs/AUTONOMOUS_LEARNING.md**: Learning and consolidation
- **docs/CEO_LUNA.md**: CEO Luna workspace documentation
- **docs/DJ_LUNA.md**: DJ Luna music studio documentation
- **docs/musicgen.md**: Suno AI tag reference for music generation
- **DUAL_LNN_ARCHITECTURE.md**: Dual-LNN technical specification
- **graph-memory-architecture.md**: Graph memory technical specification

---

**Document Version**: 1.2
**Last Updated**: March 24, 2026
**Maintained By**: BitwareLabs
