# Graph-Based Memory Architecture for LunaOS

## Executive Summary

This document specifies a biologically-inspired memory system where **memory strength is determined by connection density, not storage**. Nodes represent concepts (entities, topics, preferences, emotions). Edges represent relationships. Memory persists through reinforcement, fades through isolation.

**Core principle:** "Neurons that fire together, wire together" - Hebbian learning applied to conversational AI.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Why This Design](#why-this-design)
3. [Database Schema](#database-schema)
4. [Origin Tracking System](#origin-tracking-system)
5. [Identity Resolution Pipeline](#identity-resolution-pipeline)
6. [Trust Calculation](#trust-calculation)
7. [Edge Dynamics](#edge-dynamics)
8. [Consolidation Flows](#consolidation-flows)
9. [Anti-Patterns to Avoid](#anti-patterns-to-avoid)
10. [Research Findings](#research-findings)
11. [Implementation Phases](#implementation-phases)

---

## Architecture Overview

### The Memory Graph Model

```
CONVERSATION INPUT
        │
        ▼
┌───────────────────┐
│ FastCoref         │  Fast pronoun resolution (80% of cases)
│ (Syntactic Layer) │  ~25ms latency
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Node Extraction   │  LLM extracts: entities, topics, preferences, events, emotions
│ (With Origin)     │  Tags each as 'user' or 'model' originated
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Identity Check    │  Compare against existing nodes
│ (Soft Matching)   │  Creates SAME_AS edges, not destructive merges
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Memory Graph      │  Nodes + Edges in PostgreSQL
│ (With pgvector)   │  Bi-temporal validity
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ NeuralSleep       │  Decay edges, prune weak nodes, create semantic links
│ (Consolidation)   │  Runs on schedule (immediate/daily/weekly)
└───────────────────┘
```

### Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Connection density = memory strength | Mimics biological memory; isolated facts fade naturally |
| Origin tracking on everything | Prevents model echo chambers from creating false "memories" |
| Soft merging only | Hard merges are irreversible; can't un-merge "actually that's two dogs" |
| Bi-temporal validity | Handles "old dog Max" vs "new dog Max" - same name, different time periods |
| Ambiguity as first-class state | Don't force premature certainty; human memory holds "maybe same thing" |
| Separated weight axes | Strength/recency/trust are different things; don't collapse into one float |
| Causal edges gated | Prevents one bad Tuesday from encoding "work → hate life" permanently |

---

## Why This Design

### What's Wrong With Traditional Approaches

**Static Vector RAG:**
- Vectors lose structure; "he agreed to it" without context is useless
- No temporal logic; 2-year-old fact retrieved with same weight as yesterday
- Fragments conversation into disconnected chunks

**Explicit Fact Storage (user_facts.json):**
- Brittle; requires explicit programming of what to store
- No graceful degradation; facts exist or don't
- No concept of confidence or temporal validity

**Percentage-Based Forgetting:**
- "Forget 90% of low-importance things" is backwards
- Human memory doesn't work on percentages
- One-mention emotional events ("dad died") get pruned incorrectly

### What We're Building Instead

**Graph with Decay/Strengthen Dynamics:**
- Memories with no connections decay naturally
- Repeated concepts gain edges, survive longer
- Emotional intensity protects against pruning
- Connection graph = retrieval paths

**Biological Parallel:**
- Hippocampus = fast encoding (origin tracking, immediate extraction)
- Cortex = semantic networks (embeddings, graph relationships)
- Sleep = consolidation (NeuralSleep merging signals, pruning orphans)

---

## Database Schema

```sql
-- Migration 004_graph_memory_schema.sql
-- Graph-based memory with origin tracking, soft merging, bi-temporal validity

-- ============================================
-- MEMORY NODES
-- ============================================
CREATE TABLE memory_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    
    -- Core identity
    node_type VARCHAR(50) NOT NULL,  -- entity, topic, preference, event, emotion
    node_label VARCHAR(255) NOT NULL,
    canonical_name VARCHAR(255),
    
    -- Embedding for semantic edges
    embedding vector(1024),
    
    -- Origin tracking (CRITICAL)
    origin VARCHAR(20) DEFAULT 'model',  -- 'user' | 'model' | 'mixed'
    origin_confidence DECIMAL DEFAULT 0.5,
    user_mention_count INTEGER DEFAULT 0,
    model_mention_count INTEGER DEFAULT 0,
    
    -- Identity status (ambiguity as first-class state)
    identity_status VARCHAR(20) DEFAULT 'provisional',  -- 'distinct' | 'provisional' | 'ambiguous' | 'merged'
    canonical_node_id UUID REFERENCES memory_nodes(id),
    
    -- Bi-temporal validity
    valid_from TIMESTAMPTZ DEFAULT NOW(),
    valid_until TIMESTAMPTZ DEFAULT 'infinity',
    transaction_time TIMESTAMPTZ DEFAULT NOW(),
    
    -- Activation dynamics
    activation_strength DECIMAL DEFAULT 0.5,
    edge_count INTEGER DEFAULT 0,
    centrality_score DECIMAL DEFAULT 0.0,
    
    -- Emotional weight (override for pruning)
    emotional_intensity DECIMAL DEFAULT 0.0,
    
    -- State
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_activated TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, canonical_name)
);

-- ============================================
-- MEMORY EDGES
-- ============================================
CREATE TABLE memory_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    source_node_id UUID NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
    target_node_id UUID NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
    
    -- Edge classification
    edge_type VARCHAR(50) NOT NULL,  -- 'co_occurrence' | 'semantic' | 'causal' | 'temporal' | 'same_as' | 'contradicts'
    merge_type VARCHAR(20),  -- 'same_as' | 'supersedes' | NULL
    
    -- Origin tracking
    origin VARCHAR(20) DEFAULT 'inferred',  -- 'explicit' | 'inferred' | 'cooccurrence'
    evidence TEXT,  -- Why this edge exists
    
    -- Weight dynamics (SEPARATED - do not collapse)
    weight DECIMAL DEFAULT 0.5,       -- legacy/computed aggregate
    strength DECIMAL DEFAULT 0.5,     -- reinforcement count normalized
    recency DECIMAL DEFAULT 1.0,      -- decays over time
    trust DECIMAL DEFAULT 0.5,        -- post-hoc confidence
    
    -- Reinforcement tracking
    user_reinforcement_count INTEGER DEFAULT 0,
    model_reinforcement_count INTEGER DEFAULT 0,
    activation_count INTEGER DEFAULT 1,
    
    -- Causal edge gating (IMPORTANT)
    is_active BOOLEAN DEFAULT TRUE,
    requires_activation INTEGER DEFAULT 0,  -- causal edges start at 3, decrement on reinforcement
    distinct_session_count INTEGER DEFAULT 1,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_activated TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, source_node_id, target_node_id, edge_type)
);

-- ============================================
-- NODE MENTIONS (Event log / audit trail)
-- ============================================
CREATE TABLE node_mentions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id UUID NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    session_id UUID,
    message_id UUID,
    
    -- Origin tracking per mention
    origin VARCHAR(20) NOT NULL,  -- 'user' | 'model'
    source_span TEXT,  -- The exact text that triggered this
    mention_context TEXT,
    
    -- Emotional state at mention time
    emotional_valence DECIMAL,  -- -1 to 1
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- MERGE LEDGER (Reversibility - CRITICAL)
-- ============================================
CREATE TABLE merge_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    
    -- The merge event
    source_node_id UUID NOT NULL REFERENCES memory_nodes(id),
    target_node_id UUID NOT NULL REFERENCES memory_nodes(id),
    merge_confidence DECIMAL NOT NULL,
    merge_reason TEXT,
    
    -- Reversibility
    is_active BOOLEAN DEFAULT TRUE,
    unmerged_at TIMESTAMPTZ,
    unmerge_reason TEXT,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by VARCHAR(50) DEFAULT 'system'  -- 'system' | 'user_correction'
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_nodes_user_active ON memory_nodes(user_id, is_active);
CREATE INDEX idx_nodes_user_type ON memory_nodes(user_id, node_type);
CREATE INDEX idx_nodes_user_activated ON memory_nodes(user_id, last_activated DESC);
CREATE INDEX idx_nodes_user_status ON memory_nodes(user_id, identity_status);
CREATE INDEX idx_nodes_canonical ON memory_nodes(canonical_node_id) WHERE canonical_node_id IS NOT NULL;

CREATE INDEX idx_edges_user_active ON memory_edges(user_id, is_active);
CREATE INDEX idx_edges_source ON memory_edges(source_node_id);
CREATE INDEX idx_edges_target ON memory_edges(target_node_id);
CREATE INDEX idx_edges_type ON memory_edges(user_id, edge_type);

CREATE INDEX idx_mentions_node ON node_mentions(node_id);
CREATE INDEX idx_mentions_session ON node_mentions(session_id);
CREATE INDEX idx_mentions_created ON node_mentions(created_at DESC);

CREATE INDEX idx_merge_ledger_user ON merge_ledger(user_id, is_active);

-- ============================================
-- VECTOR INDEX (for semantic edge creation)
-- ============================================
CREATE INDEX idx_nodes_embedding ON memory_nodes 
USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);
```

---

## Origin Tracking System

### Why Origin Tracking is Critical

Without origin tracking:
- Model mentions itself → reinforcement count increases → "trusted" memory
- This is **model echo chamber** - the system hallucinates itself into believing something
- Example: LLM invents "Project Phoenix" → mentions it while summarizing → 2 sessions → now "trusted"

With origin tracking:
- Only **user-originated mentions** count toward trust promotion
- Model echoes tracked separately, weighted at 0.1x
- Can detect when a "memory" is mostly model-generated vs user-confirmed

### Origin Values

**For Nodes:**
- `'user'` - Directly from user's message text
- `'model'` - LLM extracted/inferred (not in user's actual words)
- `'mixed'` - User-originated, model-enriched over time

**For Edges:**
- `'explicit'` - User stated the relationship directly ("Max is my dog")
- `'inferred'` - LLM connected them ("user seems stressed about work")
- `'cooccurrence'` - Appeared together in same session, no stated relationship

### Implementation Rule

**Simple test:** Is this exact concept in the user's actual message text?
- Yes → `origin: 'user'`
- No → `origin: 'model'`

LLM enrichments like "user seems stressed" when user said "work is rough" = model origin.

---

## Identity Resolution Pipeline

### Three-Tier Resolution

```
User message: "The puppy chewed my shoe again"
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│ TIER 1: FastCoref (Fast Path)                               │
│ - Resolves pronouns: "he", "she", "it", "they"              │
│ - ~25ms latency on CPU                                      │
│ - Handles 80% of cases                                      │
│ - Output: "The puppy chewed my shoe again" (no pronouns)    │
└─────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│ TIER 2: Existing Node Matching                              │
│                                                             │
│ Query existing nodes:                                       │
│ - Top 10 by recent activation                               │
│ - Top 5 by semantic proximity to message                    │
│ - NEVER inject global high-centrality (causes gravity well) │
│                                                             │
│ Check: Is "puppy" same as existing "Max" node?              │
│ - Embedding similarity: 0.72                                │
│ - Same type (entity:pet): YES                               │
│ - Temporal overlap: YES                                     │
│ - Decision: identity_status = 'ambiguous', create SAME_AS   │
│   edge with confidence 0.72                                 │
└─────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│ TIER 3: LLM Resolution (Slow Path - only if needed)         │
│                                                             │
│ Triggered when:                                             │
│ - FastCoref confidence < 0.6                                │
│ - Bridging anaphora ("the door" referring to "house")       │
│ - Ambiguous temporal reference                              │
│                                                             │
│ LLM asked to output:                                        │
│ {                                                           │
│   linked_node_id: "uuid-of-max" | null,                     │
│   link_confidence: 0.85,                                    │
│   link_rationale: "User previously called Max 'the puppy'", │
│   origin: 'user'                                            │
│ }                                                           │
└─────────────────────────────────────────────────────────────┘
```

### Node Injection Rules (IMPORTANT)

**DO NOT** inject top N by global centrality. This causes **salience poisoning** where high-centrality nodes become gravity wells that attract incorrect links.

**DO inject:**
- Top 10 by `last_activated` (recent context)
- Top 5 by embedding similarity to current message
- Filtered by matching `node_type` when possible

**Require LLM to output:**
```typescript
interface NodeLinkResult {
  linked_node_id: string | null;
  link_confidence: number;      // We validate this, don't trust blindly
  link_rationale: string;       // Evidence for the link (auditable)
  origin: 'user' | 'model';     // Was this in user's actual words?
}
```

### Soft Merging Protocol

**Never delete nodes.** When two nodes appear to be the same entity:

1. Create `SAME_AS` edge between them with confidence score
2. Record in `merge_ledger` with `merge_reason`
3. Set `canonical_node_id` on the secondary node pointing to primary
4. Set secondary's `identity_status = 'merged'`

**To unmerge:**

1. Set `merge_ledger.is_active = false`
2. Set `merge_ledger.unmerge_reason`
3. Clear `canonical_node_id` on secondary
4. Set secondary's `identity_status = 'distinct'`
5. Remove or deactivate `SAME_AS` edge

All original data preserved. No information loss.

---

## Trust Calculation

### The Formula

```typescript
function calculateNodeTrust(node: MemoryNode): number {
  // User mentions worth 10x model mentions
  const userWeight = node.user_mention_count * 1.0;
  const modelWeight = node.model_mention_count * 0.1;
  
  // Penalize model echo chambers
  const echoRatio = node.model_mention_count / (node.user_mention_count + 1);
  const echoPenalty = echoRatio > 3 ? 0.5 : 1.0;
  
  // Emotional intensity protects important memories
  const emotionalBoost = 1 + (node.emotional_intensity * 0.5);
  
  // Connection density (the core insight)
  const connectionFactor = Math.min(node.edge_count / 10, 1.0);
  
  return (userWeight + modelWeight) * echoPenalty * emotionalBoost * connectionFactor;
}
```

### Trust Promotion Rules

**Provisional → Distinct:**
- `user_mention_count >= 2` across different sessions
- OR `emotional_intensity > 0.7`
- OR `edge_count >= 5`

**Causal Edge Activation:**
- Causal edges start with `is_active = false`
- `requires_activation` starts at 3
- Each reinforcement from **different session** decrements by 1
- When `requires_activation` hits 0, set `is_active = true`
- Requires **emotional variance** (not same mood repeated)

This prevents one bad week from encoding "work causes misery" permanently.

---

## Edge Dynamics

### Edge Types

| Type | Created When | Default Weight | Decay Tau | Notes |
|------|--------------|----------------|-----------|-------|
| `co_occurrence` | Nodes in same session | 0.3 | 14 days | Session-level, not message-level |
| `semantic` | Embedding similarity > 0.85 AND co-occurred at least once | similarity * 0.5 | 90 days | Never from similarity alone |
| `temporal` | Events in sequence | 0.4 | 30 days | |
| `causal` | LLM infers causation | 0.6 | 60 days | Starts inactive, needs 3 sessions |
| `same_as` | Identity resolution | confidence | Never | Soft merge link |
| `contradicts` | Conflicting information | 0.5 | 30 days | Negative edge |

### Weight Update Formula (EMA)

```typescript
// NeuralSleep-compatible Exponential Moving Average
function updateEdgeWeight(edge: MemoryEdge, targetWeight: number, deltaT: number): number {
  const tau = getDecayTau(edge.edge_type);
  const alpha = 1 - Math.exp(-deltaT / tau);
  return edge.weight * (1 - alpha) + targetWeight * alpha;
}
```

### Semantic Edge Creation Rules (IMPORTANT)

Embedding similarity alone causes **synonym drift** where "my boss" merges with "that asshole at work" even if they're different people.

**Requirements for semantic edge:**
1. Embedding similarity > 0.85
2. AND nodes have co-occurred at least once
3. AND same `node_type`
4. OR explicit user confirmation

**Cap semantic edges:** Max 5 semantic edges per node to prevent hairball graphs.

---

## Consolidation Flows

### Immediate (Session End)

1. Extract nodes from all user messages (with origin tracking)
2. Upsert nodes (create or reinforce existing)
3. Create co-occurrence edges between session nodes
4. Record mentions in `node_mentions` for audit trail
5. Update `last_activated` timestamps

### Daily (2 AM)

1. Apply edge decay using EMA formula
2. Create semantic edges where criteria met
3. Update node centrality scores
4. Deactivate edges below 0.1 weight
5. Update `edge_count` on nodes
6. Check for contradiction patterns

### Weekly (3 AM Sunday)

1. Run soft merge analysis on `ambiguous` nodes
2. Prune nodes meeting ALL criteria:
   - `edge_count < 2`
   - `user_mention_count < 2`
   - `emotional_intensity < 0.3`
   - `last_activated > 30 days ago`
3. Archive old mentions (> 90 days)
4. Calculate cluster communities
5. Apply anti-centrality pressure to high-degree nodes

### Anti-Centrality Pressure

High-degree nodes attract more links → get recalled more → strengthen further. This is **belief crystallization**, not memory.

**Countermeasure:**
```typescript
function applyAntiCentralityDecay(node: MemoryNode): void {
  if (node.edge_count > 20) {
    // Diminishing returns on reinforcement
    const penalty = Math.log(node.edge_count) / 10;
    node.centrality_score *= (1 - penalty);
  }
}
```

---

## Anti-Patterns to Avoid

### 1. Greedy Clustering (Black Hole Effect)

**What happens:** Link mention to first antecedent above threshold. Transitive error propagation creates mega-clusters where everything connects.

**Symptom:** One "User" entity with 10,000 edges containing unrelated data.

**Prevention:** Use sieve approach - high-precision rules first (exact match), low-precision later (embedding similarity).

### 2. Injecting Top-N by Global Centrality

**What happens:** High-centrality nodes appear in every extraction prompt. LLM over-links to them. They become gravity wells.

**Symptom:** "work" node connects to everything including weekend hobbies.

**Prevention:** Inject by recency and semantic proximity, never by centrality.

### 3. Trusting LLM Confidence Scores

**What happens:** LLM outputs high confidence on hallucinated entities. "Smooth lies, not noisy doubt."

**Symptom:** Invented entities become "trusted" because LLM said confidence: 0.95.

**Prevention:** Post-hoc confidence only. Calculate trust from user mentions, reinforcement patterns, connection density.

### 4. Hard Merging

**What happens:** Records merged destructively. User corrects you. Can't split them.

**Symptom:** "Actually Max is my old dog, Luna is the new puppy" but they're merged forever.

**Prevention:** Soft merge via SAME_AS edges. Merge ledger for reversibility.

### 5. Embedding Similarity = Merge

**What happens:** "my boss" and "my manager" merge. User has both a boss and a manager (different people).

**Symptom:** Attributes from two people combined into one entity.

**Prevention:** Similarity necessary but not sufficient. Require co-occurrence AND same type AND temporal consistency.

### 6. Single Weight Float

**What happens:** Strength, recency, trust collapsed into one number. Can't tell why edge is weighted 0.7.

**Symptom:** Debugging weight decay is impossible. Old strong edges look same as new weak edges.

**Prevention:** Separate fields for `strength`, `recency`, `trust`. Combine at query time.

### 7. Model Echo Reinforcement

**What happens:** Model mentions entity in summary → counted as reinforcement → trust increases → model mentions more.

**Symptom:** Hallucinated entity becomes "core memory" through self-reference.

**Prevention:** Track `user_mention_count` vs `model_mention_count` separately. Only user mentions promote trust.

---

## Research Findings

### From Gemini Deep Research

#### Coreference Resolution State of Art

**FastCoref:** 
- 29x faster than AllenNLP baseline
- 78.5% F1 on CoNLL-2012
- Good enough for real-time "fast path"
- Use for pronoun resolution before LLM sees message

**LLM Resolution:**
- Superior for bridging anaphora ("the house... the door")
- Superior for Winograd schemas (reasoning-heavy)
- 0.6-2.0 second latency - too slow for every message
- Use only for ambiguous cases

**Hybrid approach:** FastCoref handles 80%, LLM handles complex 20%.

#### Production Systems

**Google Knowledge Graph:**
- Machine IDs (MIDs) separate from surface forms
- Clustering, not merging - can split clusters later
- Multi-signal resolution (text similarity + relationships + attributes)

**Neo4j Graphiti:**
- Bi-temporal modeling (valid_time + transaction_time)
- "I actually moved in 2011 not 2010" → update valid_time, preserve history
- Incremental updates, not batch recomputation
- Hybrid retrieval (embeddings + graph traversal)

**LinkedIn:**
- Late-binding resolution - delay resolution to query time when more context available
- Blocking strategies to avoid O(N²) comparisons

#### Reversible Merging Patterns

**Soft Merge (SAME_AS edges):**
```
Node A ←--SAME_AS--→ Node B
```
Entity = connected component at query time. Unmerge = delete edge.

**Event Sourcing:**
- Don't store mutable state
- Store event log: `EntityCreated`, `AttributeUpdated`, `IdentityLinked`
- Wrong link? Append `IdentityUnlinked` event
- Replay log to reconstruct correct state

**Bi-Temporal Facts:**
```typescript
interface MemoryFact {
  subject: string;
  predicate: string;
  object: string;
  valid_from: Date;      // When true in real world
  valid_until: Date;     // When stopped being true
  transaction_time: Date; // When system learned this
}
```

#### Documented Failures

**Greedy clustering:** Transitive error propagation → black hole entities

**Static vector RAG:** Loses structure, no temporal logic, fragments context

**Hard-coded heuristics:** "If name similarity > 0.9, merge" fails on "Zinc" (mineral) vs "Zinc" (company)

**Single-signal resolution:** Must use multiple signals (text + relationships + type + temporal)

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Run migration `004_graph_memory_schema.sql`
- [ ] Implement `NodeExtractor.ts` with origin tracking
- [ ] Implement basic `EdgeManager.ts` for co-occurrence
- [ ] Implement `node_mentions` logging
- [ ] Unit tests for origin classification

### Phase 2: Identity Resolution (Week 2-3)
- [ ] Integrate FastCoref for fast path
- [ ] Implement existing node matching
- [ ] Implement soft merge via SAME_AS edges
- [ ] Implement merge ledger
- [ ] Implement identity_status state machine

### Phase 3: Dynamics (Week 3-4)
- [ ] Implement edge decay (EMA)
- [ ] Implement trust calculation
- [ ] Implement causal edge gating
- [ ] Implement anti-centrality pressure
- [ ] Implement contradiction detection

### Phase 4: Consolidation (Week 4-5)
- [ ] Implement immediate consolidation
- [ ] Implement daily consolidation
- [ ] Implement weekly consolidation
- [ ] Implement pruning with emotional override

### Phase 5: Integration (Week 5-6)
- [ ] Luna Chat graph client
- [ ] Context building with graph memory
- [ ] Prompt injection (narrative format, not node dumps)
- [ ] Testing with real conversations

---

## Success Criteria

1. **Nodes extract correctly** - Entities, topics, preferences identified with correct origin
2. **Origin tracking works** - Can distinguish user-stated from model-inferred
3. **Edges form naturally** - Co-occurrence and semantic edges created appropriately
4. **Memory strengthens** - Repeated user-mentioned concepts gain trust
5. **Memory forgets** - Isolated, low-trust nodes get pruned
6. **Merges are reversible** - Can unmerge incorrectly linked entities
7. **Causal edges are gated** - Require multi-session reinforcement
8. **No black holes** - Anti-centrality prevents gravity wells
9. **Strong memories emerge** - High-connectivity, high-trust nodes become "facts"

---

## File Structure

```
/opt/memorycore/src/
├── graph/
│   ├── index.ts
│   ├── types.ts
│   ├── NodeExtractor.ts          # LLM extraction with origin tracking
│   ├── NodeMatcher.ts            # Existing node matching
│   ├── EdgeManager.ts            # Create/decay/gate edges
│   ├── SoftMerger.ts             # SAME_AS edge management
│   ├── MergeLedger.ts            # Reversibility tracking
│   ├── TrustCalculator.ts        # Post-hoc confidence
│   └── GraphQuery.ts             # Subgraph retrieval
├── graph/consolidation/
│   ├── ImmediateConsolidation.ts
│   ├── DailyConsolidation.ts
│   └── WeeklyConsolidation.ts
├── graph/dynamics/
│   ├── EdgeDynamics.ts           # Decay, strengthen, gate
│   ├── NodeDynamics.ts           # Activation, pruning protection
│   ├── AntiCentrality.ts         # Prevent gravity wells
│   └── ContradictionDetector.ts  # Negative edges
├── resolution/
│   ├── FastCorefResolver.ts      # Fast path
│   └── LLMResolver.ts            # Slow path
└── migrations/
    └── 004_graph_memory_schema.sql
```

---

## Questions? Edge Cases?

This document is the source of truth. If you hit an ambiguous case:

1. Check anti-patterns section first
2. Default to preserving data (soft operations)
3. Default to skepticism (don't trust LLM confidence)
4. Default to user origin over model origin
5. When in doubt, flag as `ambiguous` and let consolidation sort it out

---

*Document version: 1.0*
*Last updated: Architecture review with Claude Opus, GPT-5.2 (Luna), Gemini 3 Pro, Grok 4.1*
