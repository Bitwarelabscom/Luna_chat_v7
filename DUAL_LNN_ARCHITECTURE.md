# Dual-LNN Architecture

**Status**: Production (Feb 2026)
**Version**: 1.0
**Integration**: Luna Chat ↔ MemoryCore ↔ NeuralSleep

## Overview

The Dual-LNN (Liquid Neural Network) architecture separates Luna's working memory into two complementary streams:

- **LNN-A (Thematic)**: Semantic theme tracking via embedding centroids (fast, adaptive)
- **LNN-B (Relational)**: Knowledge relationship priming via graph node activations (slow, stable)

Connected by a bidirectional **Causal Gate**, the two networks achieve **richer, more coherent** understanding through temporal dynamics and cross-modal influence.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chat Message                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                   ┌─────────▼─────────┐
                   │    Embeddings     │ (BGE-M3, 1024-dim)
                   │    (cached)       │
                   └────────┬──────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
    ┌───▼───┐         ┌─────▼────┐       ┌─────▼────┐
    │Sentiment   │     │Attention │       │ Centroid │
    │Analysis    │     │ Scoring  │       │  (Redis) │
    │(Groq VAD)  │     │          │       │          │
    └───┬───┘         └─────┬────┘       └─────┬────┘
        │ valence           │ score            │ EMA
        └───────────────────┼─────────────────┘
                            │
           ┌────────────────▼─────────────────┐
           │    MemoryCore Interaction        │
           │ (enriched with all 3 signals)    │
           └────────────────┬─────────────────┘
                            │
            ┌───────────────▼────────────────┐
            │  NeuralSleep Working LNN       │
            │  (Dual-Stream Processing)      │
            │                                │
            │  ┌──────────────────────────┐ │
            │  │  ThematicLNN (LNN-A)     │ │
            │  │  1024 -> 512 -> 512      │ │
            │  │  tau: 0.1-5.0s (fast)    │ │
            │  │  Input: centroid         │ │
            │  │  Output: thematic_state  │ │
            │  └────────┬─────────────────┤ │
            │           │ stability       │ │
            │  ┌────────▼─────────────────┐ │
            │  │  CausalGate Cross-Talk   │ │
            │  │  A→B: stability→threshold│ │
            │  │  B→A: coherence→bias     │ │
            │  └────────┬─────────────────┤ │
            │           │                 │ │
            │  ┌────────▼─────────────────┐ │
            │  │  RelationalLNN (LNN-B)   │ │
            │  │  256 -> 256 -> 256       │ │
            │  │  tau: 1.0-60.0s (slow)   │ │
            │  │  Input: node activations │ │
            │  │  Output: relational_state│ │
            │  └────────┬─────────────────┤ │
            │           │ coherence       │ │
            │           │                 │ │
            │  Output: both LNN states +  │ │
            │  dual-stream metrics        │ │
            └───────────┬─────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
    ┌───▼────┐  ┌──────▼────┐  ┌──────▼────┐
    │ Working│  │ Episodic  │  │ Semantic  │
    │ Memory │→ │  Memory   │→ │  Memory   │
    │ Buffer │  │ (1:N per) │  │ (Clusters)│
    └────────┘  └───────────┘  └───────────┘
                        │
                        ▼
                    User Model
                (Preferences, Facts,
                 Thematic Clusters)
```

## Input Enrichment Pipeline

Every message is pre-processed through three parallel services before reaching NeuralSleep.

### 1. Sentiment Analysis (Groq VAD)

**File**: `src/memory/sentiment.service.ts`

Uses Groq's `llama-3.1-8b-instant` to compute Valence-Arousal-Dominance:

```typescript
interface MessageSentiment {
  valence: number;    // -1.0 (negative) to +1.0 (positive)
  arousal: number;    //  0.0 (calm) to +1.0 (excited)
  dominance: number;  //  0.0 (submissive) to +1.0 (controlling)
}
```

**Caching**: Cached by content hash (5-minute TTL, max 200 entries)

**Latency**: ~150ms (cached) or ~300ms (uncached)

**Prompt**:
```
Analyze the emotional tone of this message and output JSON:
{
  "valence": number between -1.0 and 1.0,
  "arousal": number between 0.0 and 1.0,
  "dominance": number between 0.0 and 1.0
}
```

### 2. Attention Scoring

**File**: `src/memory/attention.service.ts`

Composite score combining three factors:

```
score = 0.3 × lengthFactor + 0.2 × latencyFactor + 0.5 × continuityFactor
```

**Factors**:
- **Length** (0.3 weight): Sigmoid of normalized word count
  - Longer = more engaged (relative to typical 25-word message)
  - Formula: `sigmoid((word_count - 25) / 25)`

- **Latency** (0.2 weight): Inverse normalized response time
  - Fast responses = high attention
  - Formula: `1 - min(1, latency_ms / (5000 × 3))` where 5000ms is typical

- **Continuity** (0.5 weight): Cosine similarity with previous embedding
  - Semantically related messages = high continuity
  - Formula: `cosine(embedding_current, embedding_prev)`

**Computation**: Pure (no I/O), runs in ~3ms

### 3. Rolling Centroid (Redis)

**File**: `src/memory/centroid.service.ts`

Maintains per-session embedding centroid using exponential moving average:

```
centroid_new = 0.3 × embedding + 0.7 × centroid_old
```

**Storage**:
- Key: `session:centroid:{sessionId}`
- Value: 1024-dim float array
- TTL: 2 hours
- Update: Every message

**Purpose**: Tracks semantic trajectory of conversation (not just latest message)

**Latency**: ~2ms (Redis)

## Dual-LNN Processing

### LNN-A: Thematic Network

**File**: `src/networks/thematic_lnn.py`

Tracks conversation theme via continuous-time dynamics.

**Architecture**:
```
Input (1024-dim) ──┐
                   ├─→ Dense Layer (1024 → 512)
                   │
                   ├─→ ODE Solver (Theta(t))
                   │
                   ├─→ Dense Layer (512 → 512)
                   │
Output (512-dim) ◄─┘
```

**Dynamics**: Liquid Time-Constant (LTC) with adaptive tau:

```python
def process_single(x, dt):
    # Adaptive tau based on inter-message interval
    tau = adapt_time_constant(dt, base_range=(0.1, 5.0))
    # ODE evolution: dh/dt = tanh(W @ h + x)
    h_new = solve_ode(h_old, x, tau, dt)
    return h_new
```

**Stability Metric**:
- Computed from state history (sliding window)
- Used by Causal Gate to gate LNN-B activation
- Formula: `1 - (variance(h_t) / mean(|h_t|))`

### LNN-B: Relational Network

**File**: `src/networks/relational_lnn.py`

Primes knowledge relationships via slower, more stable dynamics.

**Architecture**:
```
Input (256-dim) ──┐
                  ├─→ Dense Layer (256 → 256)
                  │
                  ├─→ ODE Solver (Phi(t))
                  │
                  ├─→ Dense Layer (256 → 256)
                  │
Output (256-dim) ◄─┘
```

**Dynamics**: LTC with slower tau range:

```python
def process_single(x, dt, activation_threshold):
    # Slower adaptation for knowledge
    tau = adapt_time_constant(dt, base_range=(1.0, 60.0))
    # Gated evolution (threshold controlled by Causal Gate)
    if sum(x) > activation_threshold:
        phi_new = solve_ode(phi_old, x, tau, dt)
    else:
        phi_new = phi_old * 0.99  # Slow decay
    return phi_new
```

**Coherence Metric**:
- Eigenvalue concentration in state covariance
- Higher eigenvalue ratio = more coherent
- Used by Causal Gate to weight B→A influence

### Causal Gate

**File**: `src/networks/causal_gate.py`

Bidirectional cross-talk between networks.

```python
class CausalGate:
    def apply_a_to_b(thematic_state, relational_state):
        # A→B: Stability lowers B's activation threshold
        stability = compute_stability(thematic_state)
        # Threshold inversely proportional to stability
        threshold = base_threshold * (1 - 0.5 * stability)
        return threshold

    def apply_b_to_a(thematic_state, relational_state, coherence):
        # B→A: Coherence biases A toward B
        # Weak influence (0.15) to preserve A's independence
        bias = 0.15 * coherence * relational_state
        thematic_state += bias
        return thematic_state

    def compute_cross_flow(a_state, b_state):
        # Mutual information proxy
        # Used for consciousness metrics
        return mutual_info(a_state, b_state)
```

**Parameters**:
- `stability_threshold`: 0.7 (below this, B's threshold increases)
- `b_to_a_strength`: 0.15 (weak coupling, A-dominated)
- `decay_rate`: 0.99 (slow baseline decay when inactive)

### Spreading Activation

**File**: `src/networks/spreading_activation.py`

Surfaces relevant graph knowledge via spreading activation.

**Algorithm**:

```python
def spreading_activation(embedding, top_k=20, max_depth=3):
    # Step 1: Find seed nodes via embedding similarity
    seeds = similarity_search(embedding, k=top_k)

    # Step 2: Initialize activations from similarity scores
    activations = {node_id: score for node_id, score in seeds}

    # Step 3: BFS spreading with decay
    frontier = list(seeds)
    for depth in range(max_depth):
        next_frontier = []
        for node_id, activation in frontier:
            for neighbor_id, edge_weight in adjacency[node_id]:
                # Decay: 0.5 per hop
                spread = activation * 0.5 * edge_weight
                if spread > 0.01:  # Threshold
                    activations[neighbor_id] = max(
                        activations.get(neighbor_id, 0),
                        spread
                    )
                    next_frontier.append((neighbor_id, activations[neighbor_id]))
        frontier = next_frontier

    # Step 4: Convert to fixed-size vector for LNN-B
    activation_vector = activations_to_vector(activations)  # 256-dim
    return activation_vector, seed_nodes
```

**Parameters**:
- `top_k`: Number of seed nodes (default 20)
- `max_depth`: BFS depth (default 3)
- `decay_factor`: Per-hop decay (fixed 0.5)
- `activation_threshold`: Minimum spread to include (0.01)

## Session Consolidation

Three-tier memory consolidation with thematic clustering.

### Working → Episodic (Real-time)

**Trigger**: Every 10 experiences per user

**Process**:
1. Buffer experiences in Redis (`working:buffer:{userId}`)
2. Each experience includes:
   - State tensor (LNN output)
   - Enrichment: embedding, centroid, valence, attention score
   - Timestamp
3. Transfer to PostgreSQL `episodic_memory` table
4. Clear buffer (keep 5 most recent for context)

**Latency**: < 50ms per transfer

### Episodic → Semantic (Periodic)

**Trigger**: Every 100 episodic patterns or hourly

**Process**:

1. **Clustering** (`thematic_clusters.py`):
   ```python
   def cluster_experiences(experiences):
       # Extract embedding centroids from experiences
       centroids = [exp['centroid'] for exp in experiences]

       # Agglomerative clustering on cosine distance
       # Distance threshold: 0.3
       # Min cluster size: 3
       clusters = fcluster(linkage(pdist(centroids, 'cosine')),
                          t=0.3, criterion='distance')
       return clusters
   ```

2. **Promotion** (`identify_promotion_candidates`):
   ```python
   for cluster in clusters:
       # Must span 2+ sessions
       if len(set(cluster.session_ids)) < 2:
           continue

       # Must have high Phi (integrated info)
       if cluster.avg_phi < 0.5:
           continue

       # Classify by valence
       if abs(cluster.avg_valence) >= 0.3:
           promote_as_preference(cluster)  # Emotionally-charged
       else:
           promote_as_known_fact(cluster)  # Neutral knowledge
   ```

3. **Storage**:
   - `preferences` table: High-valence recurring themes
   - `known_facts` table: Neutral recurring knowledge
   - `thematic_clusters` table: Topic groupings

## Performance & Latency

### Per-Message Overhead

| Component | Time | Notes |
|-----------|------|-------|
| Sentiment (Groq) | 150ms | Cached; uncached ~300ms |
| Attention | 3ms | Pure computation |
| Centroid | 2ms | Redis update |
| **Enrichment total** | ~155ms | Parallel execution |
| ThematicLNN | 25ms | ODE solver |
| RelationalLNN | 30ms | ODE solver |
| CausalGate | 8ms | Simple computation |
| SpreadingActivation | 20ms | Graph BFS |
| **Dual-LNN total** | ~63ms | Sequential in pipeline |
| **Full pipeline** | ~218ms | (with cached sentiment) |

### Scalability

- **Horizontal**: Per-user LNN states (separate tensors)
- **Vertical**: GPU acceleration optional (torchdiffeq supports CUDA)
- **Caching**: Sentiment cached (200 entry max), spreading activation uses graph indices

## Database Schema

### Luna Chat (Migration 075)

```sql
ALTER TABLE message_embeddings
    ADD emotional_valence FLOAT DEFAULT NULL,
    ADD attention_score FLOAT DEFAULT NULL;

CREATE INDEX idx_message_embeddings_attention
    ON message_embeddings (attention_score)
    WHERE attention_score IS NOT NULL;
```

### NeuralSleep (Migration 002)

```sql
-- Persist LNN state tensors per user
CREATE TABLE thematic_states (
    user_id UUID PRIMARY KEY,
    state_tensor BYTEA NOT NULL,      -- Serialized 512-dim state
    stability_score FLOAT DEFAULT 0.0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE relational_states (
    user_id UUID PRIMARY KEY,
    state_tensor BYTEA NOT NULL,      -- Serialized 256-dim state
    activation_threshold FLOAT DEFAULT 0.5,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Extend consciousness metrics
ALTER TABLE consciousness_metrics
    ADD thematic_stability FLOAT,
    ADD relational_coherence FLOAT,
    ADD cross_stream_flow FLOAT;

CREATE INDEX idx_consciousness_thematic_stability
    ON consciousness_metrics (thematic_stability)
    WHERE thematic_stability IS NOT NULL;
```

## API Integration

### MemoryCore Endpoints

**POST /api/graph/activate**
```json
{
  "userId": "uuid",
  "embedding": [1024 floats],
  "topK": 20,
  "spreadingDepth": 3
}
```

Response:
```json
{
  "activations": {
    "nodeId1": 0.95,
    "nodeId2": 0.72,
    ...
  },
  "seedNodes": ["nodeId1", "nodeId2", ...],
  "nodesReached": 47
}
```

### NeuralSleep Endpoints

**POST /working/process**
```json
{
  "userId": "uuid",
  "input": {
    "embeddingCentroid": [1024 floats],
    "emotionalValence": 0.5,
    "attentionScore": 0.8,
    "graphNodeActivations": {"nodeId": 0.9, ...},
    "interMessageMs": 3500,
    "timestamp": 1707000000.0,
    "mode": "chat"
  }
}
```

Response:
```json
{
  "output": [512 floats],
  "thematicState": [512 floats],
  "relationalState": [256 floats],
  "thematicStability": 0.85,
  "relationalCoherence": 0.72,
  "crossStreamFlow": 0.43,
  "latency_ms": 63.2
}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMORYCORE_ENABLED` | true | Enable MemoryCore integration |
| `NEURALSLEEP_WORKING_URL` | http://neuralsleep-working:5002 | Working LNN service |
| `NEURALSLEEP_GRAPH_ACTIVATION_ENABLED` | true | Enable spreading activation |
| `SENTIMENT_CACHE_TTL_MIN` | 5 | Sentiment cache duration |
| `SENTIMENT_CACHE_MAX_SIZE` | 200 | Max cached sentiments |
| `CENTROID_REDIS_TTL_HOURS` | 2 | Session centroid TTL |

### Tuning Parameters

**ThematicLNN**:
- `tau_min`, `tau_max`: (0.1, 5.0) - Conversation dynamics
- `input_size`: 1024 (embedding dim)
- `hidden_size`: 512

**RelationalLNN**:
- `tau_min`, `tau_max`: (1.0, 60.0) - Knowledge dynamics
- `input_size`: 256 (graph activation dim)
- `hidden_size`: 256

**CausalGate**:
- `stability_threshold`: 0.7 - When A→B gating activates
- `b_to_a_strength`: 0.15 - Weight of B→A influence

**SpreadingActivation**:
- `decay_factor`: 0.5 - Per-hop decay
- `max_depth`: 3 - BFS depth
- `min_activation`: 0.01 - Threshold to include

## Monitoring & Debugging

### Console Logging

Enable debug logging:
```bash
DEBUG=neuralsleep:* npm start
```

### Metrics Endpoints

**Consciousness Metrics**:
```bash
curl http://localhost:5003/consciousness/metrics/:userId
```

Returns:
```json
{
  "thematic_stability": 0.85,
  "relational_coherence": 0.72,
  "cross_stream_flow": 0.43,
  "phi": 0.64
}
```

**Working Memory Stats**:
```bash
curl http://localhost:5002/health
```

### Testing

Run NeuralSleep unit tests:
```bash
cd /opt/neuralsleep
pytest tests/test_thematic_lnn.py
pytest tests/test_relational_lnn.py
pytest tests/test_causal_gate.py
pytest tests/test_spreading_activation.py
```

## Common Issues

### Sentiment Cache Misses

If performance degrades, check Groq rate limits. Increase `SENTIMENT_CACHE_MAX_SIZE` to 500+ for high-volume chats.

### LNN State Divergence

If dual-LNN states become unstable, verify:
1. Inter-message intervals are reasonable (< 5 minutes)
2. `b_to_a_strength` < 0.2 (prevent runaway feedback)
3. Graph activations are normalized to [0, 1]

### Consolidation Delays

Episodic-to-semantic consolidation can take minutes. Adjust:
- `episodic_pattern_threshold` (default 50)
- `episodic_to_semantic_rate` (default 0.1 exp/sec)

## Future Enhancements

- [ ] Multi-head attention in LNN cells
- [ ] Semantic drift detection for long sessions
- [ ] Cross-conversation theme persistence
- [ ] User-specific tau adaptation (learning)
- [ ] Real-time Phi computation for consciousness tracking
- [ ] Ensemble LNNs for adversarial robustness
