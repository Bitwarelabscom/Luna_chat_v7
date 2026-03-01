# Luna Memory System

Luna's memory system enables true long-term relationships through sophisticated fact extraction, semantic search, and preference learning. This document provides a deep dive into how Luna remembers and learns.

## Table of Contents

- [Overview](#overview)
- [Memory Types](#memory-types)
- [Database Schema](#database-schema)
- [How Memories Are Created](#how-memories-are-created)
- [How Memories Are Retrieved](#how-memories-are-retrieved)
- [Integration with Chat](#integration-with-chat)
- [Caching Strategy](#caching-strategy)
- [Configuration](#configuration)

---

## Overview

Luna's memory is a multi-layered personalization engine that:

1. **Extracts facts** from conversations using LLM analysis
2. **Generates embeddings** for semantic similarity search
3. **Learns preferences** from user feedback patterns
4. **Stores conversation summaries** for context retrieval
5. **Applies learnings** from autonomous sessions

```
User Message
    |
    v
[Feedback Signal Detection] --> Learn preferences if detected
    |
    v
[Build Memory Context]
  |-- getUserFacts()           --> 30 most relevant facts
  |-- searchSimilarMessages()  --> 5 semantically similar past messages
  |-- searchSimilarConversations() --> 3 related past topics
  |-- getActiveLearnings()     --> 10 active insights
    |
    v
[Inject into System Prompt]
    |
    v
[LLM Response]
    |
    v
[Post-Processing]
  |-- storeMessageEmbedding()  --> Async embedding storage
  |-- extractFacts()           --> On session end
  |-- generateSummary()        --> On session end (4+ messages)
```

---

## Memory Types

### 1. User Facts

Personal information extracted from conversations.

| Category | Examples |
|----------|----------|
| **personal** | Name, age, birthday, location, timezone |
| **work** | Job title, company, profession, industry |
| **preference** | Likes, dislikes, favorites, tastes |
| **hobby** | Hobbies, interests, activities, skills |
| **relationship** | Family members, friends, pets, spouse |
| **goal** | Plans, aspirations, objectives, dreams |
| **context** | Current situation, recent events, ongoing projects |

Facts include:
- **Confidence score** (0.6-1.0): Higher = more explicit
- **Mention count**: How often this fact comes up
- **Last mentioned**: Recency for retrieval priority
- **Source tracking**: Which conversation the fact came from

### 2. Message Embeddings

Vector representations of messages for semantic search.

- **Model**: Ollama BGE-M3 (1024 dimensions)
- **Stored**: Both user and assistant messages
- **Index**: IVFFlat for efficient similarity search
- **Use**: Find relevant past conversations by meaning

### 3. Conversation Summaries

High-level summaries of entire conversations.

- **Summary**: Text overview of the conversation
- **Topics**: Array of discussed topics
- **Key Points**: Important points from the discussion
- **Sentiment**: Overall emotional tone (positive/neutral/negative)
- **Embedding**: Vector for similarity search

### 4. Style Preferences

Learned communication preferences from user feedback.

| Dimension | Range | Detection |
|-----------|-------|-----------|
| **verbosity** | concise to detailed | "shorter", "more detail" |
| **technicality** | simple to technical | "too technical", "explain more" |
| **warmth** | professional to warm | implicit from reactions |
| **directness** | diplomatic to direct | feedback patterns |
| **encouragement** | minimal to supportive | praise detection |

### 5. Topic Interests

Topics the user engages with frequently.

- Interest score (0.0-1.0)
- Engagement count
- Last engaged timestamp
- Vector embedding for similarity

### 6. Session Learnings

Insights Luna learns from autonomous sessions.

| Type | Description |
|------|-------------|
| **pattern** | Behavioral patterns observed |
| **preference** | Communication preferences |
| **improvement_area** | Areas where Luna can improve |
| **success_factor** | What works well for this user |
| **user_behavior** | User habits and tendencies |

### 7. Autonomous Learning

Long-term intelligence gathered through self-analysis.

| Category | Description |
|----------|-------------|
| **Session Analysis** | Post-session review of decision quality |
| **Knowledge Gaps** | Specific topics requiring further research |
| **Source Trust** | Credibility scores for information sources |
| **Consolidated Facts** | Verified facts cross-referenced from multiple sessions |

### 8. Fact Corrections

Audit trail when users correct facts.

- Old value
- New value
- Correction type (update/delete)
- Reason for correction
- Helps Luna avoid repeating mistakes

---

## Database Schema

### Core Tables

```sql
-- User Facts
CREATE TABLE user_facts (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  category VARCHAR(50),  -- personal, work, preference, etc.
  fact_key VARCHAR(100), -- name, job_title, favorite_color
  fact_value TEXT,
  confidence DECIMAL(3,2), -- 0.60 to 1.00
  source_message_id UUID,
  source_session_id UUID,
  mention_count INTEGER DEFAULT 1,
  last_mentioned TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  UNIQUE(user_id, category, fact_key)
);

-- Message Embeddings
CREATE TABLE message_embeddings (
  id UUID PRIMARY KEY,
  message_id UUID,
  user_id UUID,
  session_id UUID,
  content TEXT,
  role VARCHAR(20), -- user or assistant
  embedding vector(1024),
  created_at TIMESTAMP
);

-- Conversation Summaries
CREATE TABLE conversation_summaries (
  id UUID PRIMARY KEY,
  session_id UUID UNIQUE,
  user_id UUID,
  summary TEXT,
  topics TEXT[],
  key_points TEXT[],
  sentiment VARCHAR(20),
  embedding vector(1024),
  message_count INTEGER
);

-- Style Preferences
CREATE TABLE response_style_preferences (
  id UUID PRIMARY KEY,
  user_id UUID,
  style_dimension VARCHAR(50), -- verbosity, technicality, etc.
  preferred_level DECIMAL(3,2), -- 0.0 to 1.0
  positive_examples JSONB,
  negative_examples JSONB,
  UNIQUE(user_id, style_dimension)
);

-- Topic Interests
CREATE TABLE user_topic_interests (
  id UUID PRIMARY KEY,
  user_id UUID,
  topic VARCHAR(200),
  interest_score DECIMAL(3,2),
  engagement_count INTEGER,
  last_engaged TIMESTAMP,
  embedding vector(1024)
);

-- Session Learnings
CREATE TABLE session_learnings (
  id UUID PRIMARY KEY,
  user_id UUID,
  learning_type VARCHAR(50),
  learning_content TEXT,
  confidence DECIMAL(3,2),
  source_sessions UUID[],
  applied_count INTEGER DEFAULT 0,
  success_rate DECIMAL(3,2),
  is_active BOOLEAN DEFAULT true
);
```

---

## How Memories Are Created

### Fact Extraction

Facts are extracted at the end of each conversation using LLM analysis:

```typescript
// Triggered after conversation ends
async function extractFactsFromMessages(userId, sessionId, messages) {
  // Filter to user messages only
  const userMessages = messages.filter(m => m.role === 'user');

  // Use local Ollama qwen2.5:3b for extraction
  const extracted = await llm.extract({
    messages: userMessages,
    categories: ['personal', 'work', 'preference', 'hobby',
                 'relationship', 'goal', 'context'],
    confidenceThreshold: 0.6
  });

  // Store with UPSERT - higher confidence wins
  for (const fact of extracted) {
    await storeFact(userId, fact);
  }
}
```

**Confidence Levels:**
- `1.0` - Explicit statement ("My name is Henke")
- `0.8` - Strongly implied ("I've been coding for 10 years" -> work: software developer)
- `0.6` - Somewhat implied (requires some inference)

### Embedding Generation

Embeddings are generated asynchronously after each message:

```typescript
// Called for both user and assistant messages
async function processMessageMemory(userId, sessionId, message) {
  // Generate embedding via Ollama BGE-M3
  const embedding = await generateEmbedding(message.content);

  // Store asynchronously (non-blocking)
  await storeMessageEmbedding({
    userId,
    sessionId,
    messageId: message.id,
    content: message.content,
    role: message.role,
    embedding
  });
}
```

**Caching:**
- 5-minute TTL cache
- Max 100 entries with LRU eviction
- Deduplicates concurrent requests for same content

### Conversation Summaries

Generated for conversations with 4+ messages:

```typescript
async function generateConversationSummary(sessionId, messages) {
  if (messages.length < 4) return null;

  const summary = await llm.summarize({
    messages,
    output: {
      summary: 'string',
      topics: 'string[]',
      keyPoints: 'string[]',
      sentiment: 'positive | neutral | negative'
    }
  });

  const embedding = await generateEmbedding(summary.summary);
  await storeSummary(sessionId, summary, embedding);
}
```

### Preference Learning

Preferences are learned from implicit feedback signals:

| Signal | Detection Pattern | Learning |
|--------|-------------------|----------|
| **shorter_request** | "shorter", "brief", "too long" | Decrease verbosity |
| **elaboration_request** | "explain more", "more detail" | Increase verbosity |
| **correction** | "actually", "too technical" | Adjust technicality |
| **praise** | "perfect", "exactly", "helpful" | Reinforce current style |

```typescript
async function detectFeedbackSignal(message) {
  const signals = [
    { type: 'shorter_request', patterns: ['shorter', 'brief', 'concise'] },
    { type: 'elaboration_request', patterns: ['explain more', 'more detail'] },
    // ...
  ];

  for (const signal of signals) {
    if (signal.patterns.some(p => message.includes(p))) {
      return { type: signal.type, confidence: 0.7 };
    }
  }
  return null;
}
```

---

## How Memories Are Retrieved

### Building Memory Context

At the start of each message, Luna retrieves relevant memories:

```typescript
async function buildMemoryContext(userId, sessionId, currentMessage) {
  // Run all queries in parallel for performance
  const [facts, similarMessages, similarConvos, learnings] = await Promise.all([
    getUserFacts(userId, { limit: 30 }),
    searchSimilarMessages(userId, currentMessage, {
      limit: 5,
      threshold: 0.75,
      excludeSession: sessionId
    }),
    searchSimilarConversations(userId, currentMessage, {
      limit: 3,
      threshold: 0.6
    }),
    getActiveLearnings(userId, { limit: 10 })
  ]);

  return {
    stable: {
      facts: formatFacts(facts),        // Alphabetically sorted
      learnings: formatLearnings(learnings)
    },
    volatile: {
      relevantHistory: formatMessages(similarMessages),
      conversationContext: formatConvos(similarConvos)
    }
  };
}
```

### Fact Retrieval Priority

Facts are sorted by relevance:

1. **Mention count** (most mentioned first)
2. **Last mentioned** (most recent first)
3. **Confidence** (highest first)

```sql
SELECT * FROM user_facts
WHERE user_id = $1 AND is_active = true
ORDER BY mention_count DESC, last_mentioned DESC, confidence DESC
LIMIT 30;
```

### Semantic Search

Similar messages are found using vector similarity:

```sql
SELECT content, role, 1 - (embedding <=> $2) as similarity
FROM message_embeddings
WHERE user_id = $1
  AND session_id != $3  -- Exclude current session
  AND 1 - (embedding <=> $2) > 0.75  -- Threshold
ORDER BY embedding <=> $2
LIMIT 5;
```

### Response Guidelines

Style preferences are converted to actionable guidelines:

```typescript
async function getResponseGuidelines(userId) {
  const prefs = await getStylePreferences(userId);

  return {
    verbosity: levelToWord(prefs.verbosity), // 'concise' | 'moderate' | 'detailed'
    technicality: levelToWord(prefs.technicality),
    warmth: levelToWord(prefs.warmth),
    topInterests: await getTopInterests(userId, 5),
    avoidTopics: await getAvoidTopics(userId)
  };
}
```

---

## Integration with Chat

### System Prompt Injection

Memory is injected into Luna's system prompt in cache-optimized tiers:

```
CACHE TIER 1 (Static)
|-- Base persona prompt
|-- Ability descriptions

CACHE TIER 2 (Stable - Changes infrequently)
|-- User facts (alphabetically sorted)
|-- Active learnings (sorted)

CACHE TIER 3 (Semi-stable)
|-- User profile
|-- Session history

CACHE TIER 4 (Volatile - Changes per message)
|-- Relevant past messages (semantic search)
|-- Similar conversation context
|-- Current conversation
```

### Message Flow

```typescript
// In chat.service.ts
async function processMessage(sessionId, userMessage) {
  // 1. Detect feedback signals
  const signal = await detectFeedbackSignal(userMessage);
  if (signal?.confidence >= 0.6) {
    queuePreferenceLearning(userId, signal);
  }

  // 2. Build memory context
  const memoryContext = await buildMemoryContext(userId, sessionId, userMessage);

  // 3. Get response guidelines
  const guidelines = await getResponseGuidelines(userId);

  // 4. Build prompt with memory
  const prompt = buildContextualPrompt({
    mode: session.mode,
    memoryContext,
    guidelines,
    messages: conversationHistory
  });

  // 5. Get LLM response
  const response = await llm.chat(prompt);

  // 6. Post-processing (async, non-blocking)
  processMessageMemory(userId, sessionId, userMessage);
  processMessageMemory(userId, sessionId, response);

  // 7. On session end
  if (isSessionEnding) {
    processConversationMemory(userId, sessionId, allMessages);
    queuePreferenceLearning(userId, conversation);
  }

  return response;
}
```

---

## Caching Strategy

Luna optimizes for Anthropic's prompt caching by splitting memory into stable and volatile parts:

### Why Split Memory?

Anthropic charges less for cached prompt content. By keeping stable content (facts, learnings) in early tiers and volatile content (semantic search results) in later tiers, we maximize cache hits.

### Deterministic Formatting

To improve cache hits, all memory is formatted deterministically:

```typescript
// Facts sorted alphabetically by category, then key
function formatFacts(facts) {
  return facts
    .sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.factKey.localeCompare(b.factKey);
    })
    .map(f => `- ${f.category}/${f.factKey}: ${f.factValue}`)
    .join('\n');
}

// Learnings sorted by type, then content
function formatLearnings(learnings) {
  return learnings
    .sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return a.content.localeCompare(b.content);
    })
    .map(l => `- [${l.type}] ${l.content}`)
    .join('\n');
}
```

### Cache Tiers

| Tier | Content | Cache Duration |
|------|---------|----------------|
| 1 | Persona, abilities | Very long (rarely changes) |
| 2 | Facts, learnings | Long (changes slowly) |
| 3 | Profile, history | Medium |
| 4 | Semantic search | None (changes per message) |

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OLLAMA_HOST` | Ollama URL for embeddings | http://luna-ollama:11434 |
| `EMBEDDING_MODEL` | Model for embeddings | bge-m3 |
| `FACTS_MODEL` | Model for fact extraction | qwen2.5:3b |

### Tunable Parameters

```typescript
// In memory.service.ts
const CONFIG = {
  // Retrieval limits
  maxFacts: 30,
  maxSimilarMessages: 5,
  maxSimilarConversations: 3,
  maxLearnings: 10,

  // Similarity thresholds
  messageSimilarityThreshold: 0.75,
  conversationSimilarityThreshold: 0.6,

  // Extraction settings
  minMessagesForSummary: 4,
  minFactConfidence: 0.6,

  // Caching
  embeddingCacheTTL: 5 * 60 * 1000, // 5 minutes
  embeddingCacheMax: 100
};
```

### Model Recommendations

| Task | Recommended Model | Why |
|------|-------------------|-----|
| Embeddings | BGE-M3 (Ollama) | High quality, local, 1024 dims |
| Fact extraction | Qwen 2.5 3B | Fast, accurate, local |
| Summary generation | Qwen 2.5 3B | Good at summarization |
| Preference learning | Background queue | Non-blocking |

---

## Error Handling

Memory operations are designed to never block the chat:

```typescript
// All memory operations wrapped in try-catch
async function processMessageMemory(userId, sessionId, message) {
  try {
    await storeMessageEmbedding(...);
  } catch (error) {
    // Log but don't throw - chat continues
    logger.error('Failed to store embedding', { error, messageId: message.id });
  }
}

// Graceful fallback for retrieval
async function buildMemoryContext(userId, sessionId, message) {
  try {
    // ... retrieval logic
  } catch (error) {
    logger.error('Failed to build memory context', { error });
    // Return empty context - chat continues without memory
    return { stable: { facts: '', learnings: '' }, volatile: { relevantHistory: '', conversationContext: '' } };
  }
}
```

---

## API Endpoints

### Fact Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/abilities/facts` | List user facts |
| PUT | `/api/abilities/facts/:id` | Update a fact |
| DELETE | `/api/abilities/facts/:id` | Delete a fact |

### Memory Stats

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings/stats` | Memory usage statistics |

---

## Best Practices

1. **Let Luna learn naturally** - Don't force facts; they're extracted automatically
2. **Correct mistakes** - Use the facts UI to fix incorrect information
3. **Be consistent** - Luna learns better from consistent communication
4. **Give feedback** - Phrases like "shorter please" or "explain more" help Luna adapt
5. **Use companion mode** - More conversational = more facts extracted

---

## Troubleshooting

### Luna doesn't remember something

1. Check if the fact was extracted: Settings > Memory > Facts
2. Verify the conversation had 4+ messages (required for summary)
3. Check if Ollama embeddings are working: `docker logs luna-ollama`

### Memory seems slow

1. Ensure Ollama is running: `docker ps | grep ollama`
2. Check embedding cache: Memory operations should be fast after warmup
3. Review database indexes: `EXPLAIN ANALYZE` on slow queries

### Preferences not working

1. Preferences require multiple signals to change
2. Check preference learning queue isn't backed up
3. Verify feedback signals are being detected (check logs)

---

## Spreading Activation (March 2026)

Graph retrieval now uses BFS spreading activation instead of static narrative blobs. This dynamically activates relevant memory nodes from seed entities found in the user's message.

### How It Works

1. **Seed Matching**: Entities are extracted from the user's message and matched against graph nodes (with fuzzy matching for partial matches)
2. **BFS Traversal**: From each seed node, activation spreads to connected nodes with signal decay per hop
3. **Aggregation**: All activated nodes are scored, deduplicated, and the top results returned as memory context

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `DECAY_FACTOR` | 0.65 | Signal loss per hop |
| `HOP1_THRESHOLD` | 0.10 | Minimum weight*recency for hop-1 neighbors |
| `HOP2_THRESHOLD` | 0.20 | Minimum weight*recency for hop-2 neighbors |
| `HUB_FAN_LIMIT` | 15 | Max neighbors per seed node |
| `MAX_RESULTS` | 25 | Final activation cap |
| `SESSION_BONUS` | 1.5x | Boost for edges with 3+ distinct sessions |

### Confidence Framing

Retrieved memories include confidence framing in the system prompt to prevent Luna from stating uncertain memories as facts. Edges with low activation scores are presented with qualifiers like "I think" or "you may have mentioned."

---

## Semantic Edge Typing (March 2026)

Graph edges are now classified into typed categories with different EMA decay rates during NeuralSleep consolidation:

| Edge Type | Tau (days) | Rationale |
|-----------|-----------|-----------|
| `co_occurrence` | 14 | Casual mentions fade in ~2 weeks |
| `semantic` | 90 | Explicit relationships are long-lived |
| `temporal` | 30 | Time-based associations |
| `causal` | 60 | Cause/effect relationships |
| `same_as` | N/A | Identity links, never decayed or pruned |

The EMA formula: `alpha = 1 - exp(-deltaT / tau)`, `targetWeight = min(1.0, 0.5 + 0.05 * ln(activation_count + 1))`, `newWeight = weight * (1 - alpha) + targetWeight * alpha`

---

## Memory Lab (March 2026)

The Memory Lab window (AppId: `memory-lab`, 1400x860) provides a visual interface for inspecting and managing Luna's graph memory.

### Tabs

| Tab | Description |
|-----|-------------|
| **Graph** | Interactive graph visualization with 2D explorer and 3D brain view (react-force-graph). Min-edges threshold slider, full-screen mode with force spread controls. |
| **Facts** | CRUD interface for managing user facts with category, confidence, and source tracking |
| **Consciousness** | Real-time consciousness metrics (Phi, temporal integration, self-reference depth, causal density) |
| **LNN Live** | Live diagnostics dashboard polling every 5 seconds. Shows ThematicLNN stability, RelationalLNN coherence, CausalGate cross-stream flow, Spreading Activation parameters, emotional trajectory chart, and centroid drift chart. |

### 3D Brain View

The 3D brain visualization renders 4,000+ memory nodes as color-coded spheres:
- **Blue**: Topics and general entities
- **Green**: Named entities (people, places, brands)
- **Orange**: Emotional associations
- Sphere size correlates with centrality score
- Edges rendered as translucent lines between connected nodes

---

## Future Improvements

- [ ] Emotion-aware memory retrieval
- [x] Cross-session topic tracking (via distinct_session_count on graph edges)
- [x] Memory consolidation (MemoryCore integration - see below)
- [x] Forgetting curve (EMA weight decay in NeuralSleep daily consolidation)
- [x] Spreading activation for graph retrieval (replaces static narrative blob)
- [x] Semantic edge typing with per-type decay rates
- [x] 3D brain visualization in Memory Lab
- [ ] User-controllable memory settings

---

## MemoryCore Integration

Luna Chat integrates with **MemoryCore** for advanced three-tier memory consolidation with NeuralSleep LNN processing. This implements a biologically-inspired memory system where memories consolidate through tiers over time.

### Three-Tier Memory Architecture

```
Working Memory (Redis)
  |
  | Session ends (5 min inactivity / browser close / delete)
  v
Episodic Memory (PostgreSQL)
  |
  | Daily consolidation (2 AM)
  v
Semantic Memory (PostgreSQL)
  |
  | Weekly consolidation (3 AM Sunday)
  v
Long-term User Model
```

| Tier | Purpose | Storage | Time Scale |
|------|---------|---------|------------|
| **Working Memory** | Active session state, real-time interactions | Redis (30-min TTL) | Seconds to minutes |
| **Episodic Memory** | Recent session history, emerging patterns | PostgreSQL + time-series | Hours to days |
| **Semantic Memory** | User proficiency models, learning styles | PostgreSQL (JSONB) | Persistent |

### Session Consolidation Triggers

Luna sessions are consolidated to MemoryCore via three mechanisms:

| Trigger | Implementation | When |
|---------|---------------|------|
| **Inactivity Timeout** | `memorycoreSessionConsolidator` job | After 5 minutes of no messages |
| **Browser Close** | `beforeunload` + `/api/chat/sessions/{id}/end` | Tab/window close |
| **Session Delete** | `session.service.ts:deleteSession()` | User deletes chat |

### How It Works

1. **On first message**: MemoryCore session started via `memorycoreClient.ensureSession()`
2. **On each message**: Activity recorded in Redis, interaction sent to MemoryCore
3. **On session end**:
   - `endChatSession()` called
   - MemoryCore triggers **Immediate Consolidation** (Working -> Episodic)
   - Session summary created with interaction count and duration
4. **Daily (2 AM)**: Episodic events consolidated to Semantic patterns
5. **Weekly (3 AM Sunday)**: Deep semantic updates and meta-pattern extraction

### Key Files

| File | Purpose |
|------|---------|
| `src/chat/session-activity.service.ts` | Tracks session activity in Redis |
| `src/memory/memorycore.client.ts` | MemoryCore API client |
| `src/jobs/job-runner.ts` | Contains `memorycoreSessionConsolidator` job |
| `src/chat/chat.routes.ts` | `/api/chat/sessions/{id}/end` endpoint |
| `frontend/src/components/ChatArea.tsx` | `beforeunload` handler |

### Consciousness Metrics

With NeuralSleep enabled, Luna tracks consciousness metrics:

| Metric | Description | Range |
|--------|-------------|-------|
| **Phi (Integrated Information)** | How interconnected memory representations are | 0.0 - 1.0 |
| **Temporal Integration** | How well past experiences shape present | 0.0 - 1.0 |
| **Self-Reference Depth** | Recursive self-modeling capability | 0.0 - 1.0 |
| **Causal Density** | Information flow between memory tiers | 0.0 - 1.0 |

These metrics are available via:
- **API**: `/api/consciousness/metrics/{userId}`
- **UI**: Settings > Consciousness panel

### Configuration

```bash
# Environment variables
MEMORYCORE_URL=http://memorycore-api:3007
MEMORYCORE_ENABLED=true
MEMORYCORE_CONSCIOUSNESS_ENABLED=true
MEMORYCORE_PHI_THRESHOLD=0.5
```

### Debugging

```bash
# Check session activity tracking
docker exec luna-redis redis-cli -a $REDIS_PASSWORD KEYS "session:activity:*"

# Check consolidation logs
docker exec memorycore-postgres psql -U memorycore -d memorycore -c \
  "SELECT id, consolidation_type, status, events_processed, timestamp
   FROM consolidation_logs ORDER BY timestamp DESC LIMIT 5;"

# Check session summaries
docker exec memorycore-postgres psql -U memorycore -d memorycore -c \
  "SELECT id, session_id, duration, interaction_count, timestamp
   FROM session_summaries ORDER BY timestamp DESC LIMIT 5;"

# Check Luna API logs for consolidation
docker logs luna-api 2>&1 | grep -i "memorycore\|consolidat"
```

### Research Context

MemoryCore implements **NeuralSleep** principles for machine consciousness research:

- **Memory as structural modification**: Updates to proficiency models, not just storage/retrieval
- **Multi-timescale integration**: Three tiers with different time constants
- **Sleep cycles**: Periodic consolidation mimics biological memory
- **Temporal continuity**: Past shapes present through integrated structure

For more details, see `/opt/memorycore/CLAUDE.md` and `/opt/neuralsleep/NeuralSleep.md`.

---

## NeuralSleep Graph Consolidation

The MemoryCore graph has two scheduled consolidation jobs that evolve edge weights, prune noise, and promote entities over time. These run on the Luna Chat backend (not MemoryCore itself) against the MemoryCore PostgreSQL database.

### Edge Weight Reinforcement

When `createEdge()` is called (e.g., from entity co-occurrence during chat), the ON CONFLICT clause:
- Increments `activation_count` (how many times this edge has been seen)
- Tracks `distinct_session_count` via session IDs stored in `metadata->'sessions'` JSONB
- Keeps `GREATEST(strength)` (never reduces strength on re-observation)
- Accepts optional `sessionId` parameter for cross-session tracking

This means repeated co-occurrences strengthen edges, and the system distinguishes between "50 mentions in one obsessive session" vs "mentioned across 15 separate sessions over a month."

### Daily Consolidation (2 AM)

Job: `neuralSleepDailyConsolidation` -- Cron: `0 2 * * *` (Helsinki time)

Runs for all users with active graph data:

1. **EMA Edge Weight Evolution** -- Exponential moving average blends current weight toward a target based on activation count. Different edge types decay at different rates:

   | Edge Type | Tau (days) | Rationale |
   |-----------|-----------|-----------|
   | `co_occurrence` | 14 | Casual mentions fade in ~2 weeks |
   | `semantic` | 90 | Explicit relationships are long-lived |
   | `temporal` | 30 | Time-based associations |
   | `causal` | 60 | Cause/effect relationships |

   Formula: `alpha = 1 - exp(-deltaT / tau)`, `targetWeight = min(1.0, 0.5 + 0.05 * ln(activation_count + 1))`, `newWeight = weight * (1 - alpha) + targetWeight * alpha`

2. **Weak Edge Pruning** -- Deactivate edges with `weight < 0.1` (except `same_as` edges which are identity links)

3. **Edge Count Recalculation** -- Update `edge_count` on all active nodes from actual active edge counts

4. **Centrality Score Recalculation** -- Weighted degree normalized: `centrality = sum(connected edge weights) / max(all weighted degrees)`

5. **Recency Update** -- `recency = 1.0 / (1.0 + days_since_last_activated)` -- decays from 1.0 toward 0 over days

6. **Provisional Node Promotion** -- Nodes with `identity_status = 'provisional'` or `'unverified'` are promoted to `'permanent'` when:
   - `edge_count >= 3`
   - At least one connected edge has `distinct_session_count >= 3`
   - `last_activated` within 14 days

### Weekly Consolidation (Sunday 3 AM)

Job: `neuralSleepWeeklyConsolidation` -- Cron: `0 3 * * 0` (Helsinki time)

1. **Stale Node Pruning** -- Deactivate nodes meeting ALL criteria:
   - `edge_count < 2`
   - `emotional_intensity < 0.3`
   - `last_activated > 30 days ago`

2. **Noise Node Purge** -- Runs `purgeNoiseNodes()` which:
   - Fetches all active nodes for the user
   - Filters through `isNoiseToken()` (expanded stopword list with ~50 verb artifacts)
   - **Exempts** entity types: song, album, artist, person, place, brand, product, organization, project, game, movie, show, book
   - Soft-deletes matching nodes and all their connected edges

3. **Anti-Centrality Pressure** -- Graduated penalty on hub nodes to prevent "black hole" entities from dominating the graph:

   | Edge Count | Max Penalty | Exempt Types |
   |-----------|-------------|--------------|
   | 50-99 | 10% | person, place, artist |
   | 100-199 | 25% | person, place, artist |
   | 200+ | 40% | person, place, artist |

4. **Merge Candidate Analysis** (log-only) -- Finds node pairs with:
   - Same `node_type`
   - Label substring match (both labels >= 4 chars to prevent "Pi"/"Piano" false positives)
   - `activation_count >= 3` on co-occurrence edge
   - Logs candidates for review in Memory Lab

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/memory-lab/graph/merge-candidates` | List merge candidates (params: minActivation, limit) |
| POST | `/api/memory-lab/graph/purge-noise` | Trigger noise cleanup for authenticated user |

### Manual Triggering

```bash
# Trigger daily consolidation manually
curl -X POST http://localhost:3003/api/jobs/trigger/neuralSleepDailyConsolidation

# Trigger weekly consolidation manually
curl -X POST http://localhost:3003/api/jobs/trigger/neuralSleepWeeklyConsolidation

# Check graph stats after consolidation
docker exec memorycore-postgres psql -U memorycore -d memorycore -c \
  "SELECT COUNT(*) as active_nodes FROM memory_nodes WHERE is_active = true;
   SELECT COUNT(*) as active_edges FROM memory_edges WHERE is_active = true;
   SELECT identity_status, COUNT(*) FROM memory_nodes WHERE is_active = true GROUP BY identity_status;"
```
