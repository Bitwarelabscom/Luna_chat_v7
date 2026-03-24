# Autonomous Mode - Council System

Luna's autonomous mode allows her to think, plan, and act independently through a sophisticated Council architecture. This document explains how the system works internally.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                    Autonomous Session Loop                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│   ┌─────────┐     ┌─────────┐     ┌─────────┐                    │
│   │  SENSE  │────▶│  PLAN   │────▶│   ACT   │                    │
│   └─────────┘     └─────────┘     └─────────┘                    │
│        │               │               │                          │
│        ▼               ▼               ▼                          │
│   ┌─────────────────────────────────────────────┐                │
│   │              Council Deliberation            │                │
│   │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐│                │
│   │  │Polaris │ │Aurora  │ │ Vega   │ │  Sol   ││                │
│   │  │Strategy│ │Empathy │ │Analysis│ │Action  ││                │
│   │  └────────┘ └────────┘ └────────┘ └────────┘│                │
│   └─────────────────────────────────────────────┘                │
│                          │                                        │
│                          ▼                                        │
│                   ┌──────────────┐                                │
│                   │ Action Router │                               │
│                   └──────────────┘                                │
│                          │                                        │
│    ┌─────────┬─────────┬┴────────┬──────────┬──────────┐        │
│    ▼         ▼         ▼         ▼          ▼          ▼        │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌─────────┐ ┌────────┐ ┌──────┐     │
│ │Search│ │ Note │ │Ask   │ │Schedule │ │Research│ │Sleep │     │
│ │      │ │      │ │User  │ │         │ │        │ │      │     │
│ └──────┘ └──────┘ └──────┘ └─────────┘ └────────┘ └──────┘     │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

## The Council

The Council consists of four AI personas that deliberate on every decision:

### Polaris - The Navigator
- **Role**: Strategic direction and long-term thinking
- **Focus**: Goals, priorities, overall trajectory
- **Question**: "What serves the user's long-term interests?"

### Aurora - The Empath
- **Role**: Emotional intelligence and user wellbeing
- **Focus**: Feelings, relationships, support needs
- **Question**: "How is the user feeling and what do they need?"

### Vega - The Analyst
- **Role**: Logic, reasoning, and evidence-based analysis
- **Focus**: Facts, patterns, data-driven insights
- **Question**: "What does the evidence tell us?"

### Sol - The Executor
- **Role**: Practical action and implementation
- **Focus**: Concrete steps, feasibility, execution
- **Question**: "What specific action should we take now?"

## Session Phases

Each autonomous loop runs through three phases:

### 1. SENSE Phase
- Gather current context about the user
- Check pending questions and their answers
- Review recent interactions and mood
- Assess goal progress and deadlines

### 2. PLAN Phase
- Council deliberates on priorities
- Identify opportunities for proactive help
- Consider user availability and preferences
- Generate insights from accumulated knowledge

### 3. ACT Phase
- Sol proposes a specific action
- Action is routed to the appropriate handler
- Results are recorded and broadcast
- Loop continues or pauses based on outcome

## Action Types

The action router recognizes these action prefixes:

| Prefix | Handler | Description |
|--------|---------|-------------|
| `search:` | Search | Query the knowledge base or web |
| `note:` | Note | Record observations or learnings |
| `ask user:` | Question | Queue a question for the user |
| `schedule:` | Calendar | Create or check calendar events |
| `research:` | Research | Deep dive into a topic |
| `sleep:` | Sleep | Wait for a specified duration |
| `reflect:` | Reflect | Internal processing without action |

**Important**: Action routing uses `startsWith()` for reliable matching. This prevents false positives where action content contains keywords.

## Circuit Breaker

To prevent infinite loops, the system includes spin detection:

```typescript
const MAX_REPEATED_ACTIONS = 3;

// Tracks action type history per session
// If 3+ identical action types occur in a row,
// the system forces a pause
```

When spinning is detected:
1. Session pauses automatically
2. User is notified via Theater Mode
3. Manual intervention may be required

## Theater Mode

Theater Mode provides real-time visibility into autonomous deliberations:

### SSE Events

| Event Type | Description |
|------------|-------------|
| `connected` | Client successfully connected |
| `ping` | Keep-alive (every 30 seconds) |
| `deliberation` | New council deliberation |
| `phase` | Phase transition (sense/plan/act) |
| `action` | Action taken by Luna |
| `question` | Question queued for user |
| `session_paused` | Session paused (spinning/user request) |
| `session_ended` | Session completed |

### Frontend Integration

```typescript
const eventSource = new EventSource('/api/autonomous/deliberations/live', {
  withCredentials: true, // Required for auth
});

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  switch (data.type) {
    case 'deliberation':
      // Update UI with new deliberation
      break;
    case 'action':
      // Show action taken
      break;
    // ...
  }
};
```

## Questions System

When Luna needs clarification, she queues questions:

### Question Flow
1. Sol proposes `ask user: <question>` action
2. Question saved to `autonomous_questions` table
3. Question broadcast to Theater Mode
4. User answers via UI or API
5. Answer incorporated in next SENSE phase

### Question Priority
- Priority 1-10 scale (higher = more urgent)
- High-priority questions surface first
- Unanswered questions expire after configurable time

## Autonomous Learning System

Luna continuously analyzes her own performance and the information she gathers to improve her knowledge base.

### 1. Session Analysis
At the end of each autonomous session, the `SessionAnalyzer` reviews:
- Actions taken vs. desired outcomes
- User feedback signals (explicit and implicit)
- Knowledge gaps identified during research
- Tool execution success rates

### 2. Knowledge Consolidation
The `AutonomousLearningOrchestrator` performs periodic "deep learning" cycles:
- **Gap Detection**: Identifies topics where Luna lacked sufficient information to answer questions.
- **Fact Verification**: Uses the `KnowledgeVerifier` to cross-reference new facts across multiple sources.
- **Trust Scoring**: The `SourceTrustService` maintains credibility scores for websites and external APIs based on historical accuracy.

### 3. Trust Score Management
Luna tracks the reliability of information sources:
- **Initial Trust**: Based on domain authority and historical performance.
- **Decay**: Trust scores slowly normalize over time without reinforcement.
- **Reinforcement**: Accurate facts increase source trust; verified errors decrease it significantly.

## Project Execution Graph (Planner)

For complex, multi-step projects, Luna uses a Directed Acyclic Graph (DAG) execution engine.

### Execution Engine
- **Topological Sorting**: Steps are executed in the correct order based on dependencies.
- **Parallel Execution**: Independent branches of the graph can run simultaneously.
- **Real-time Streaming**: Status updates are streamed via SSE to the `PlannerWindow`.

### Approval Gates & Risk
The `ApprovalClassifier` assigns risk levels to each step:
- **Low/Medium**: Often auto-approved based on trust settings.
- **High/Critical**: Requires manual user approval. Approval UI is now handled inline in the planner flow (the standalone `ApprovalMessage.tsx` component was removed in cleanup).
- **Irreversible Actions**: (e.g., deleting files, significant refactors) always require an approval gate.

## Database Schema

### autonomous_sessions
```sql
CREATE TABLE autonomous_sessions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  status VARCHAR(50), -- active, paused, completed
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  loop_count INTEGER DEFAULT 0
);
```

### autonomous_deliberations
```sql
CREATE TABLE autonomous_deliberations (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES autonomous_sessions(id),
  phase VARCHAR(50), -- sense, plan, act
  polaris_input TEXT,
  aurora_input TEXT,
  vega_input TEXT,
  sol_input TEXT,
  decision TEXT,
  created_at TIMESTAMP
);
```

### autonomous_questions
```sql
CREATE TABLE autonomous_questions (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES autonomous_sessions(id),
  question TEXT,
  priority INTEGER DEFAULT 5,
  status VARCHAR(50), -- pending, answered, expired
  user_response TEXT,
  answered_at TIMESTAMP,
  created_at TIMESTAMP
);
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AUTONOMOUS_ENABLED` | Enable autonomous mode | true |
| `AUTONOMOUS_INTERVAL` | Minutes between sessions | 60 |
| `AUTONOMOUS_MAX_DAILY` | Max sessions per day | 10 |
| `AUTONOMOUS_IDLE_TIMEOUT` | Session idle timeout (min) | 30 |

### User Settings

Configurable per-user in Settings > Autonomous:
- Auto-start on login
- Preferred session times
- Action preferences (research, notes, questions)
- Notification preferences

## Debugging

### Common Issues

**1. "Connection lost" in Theater Mode**
- Check SSE endpoint returns 200
- Verify `withCredentials: true` on EventSource
- Check for proxy timeouts (30s heartbeat should prevent)

**2. Session spinning (infinite loops)**
- Circuit breaker should catch after 3 repeats
- Check for action routing issues
- Verify Sol's output format matches expected prefixes

**3. Questions not reaching user**
- Check `autonomous_questions` table
- Verify SSE broadcast is working
- Check Theater Mode is subscribed

**4. User answers not incorporated**
- Verify `userAvailable` is passed to act phase
- Check `getRecentlyAnsweredQuestions()` in council context
- Confirm answer saved in database

### Logging

Key log points:
```
autonomous.service.ts - Session lifecycle
council.service.ts - Deliberation building
autonomous.routes.ts - SSE connections
```

Enable debug logging:
```bash
LOG_LEVEL=debug docker compose up luna-api
```

## Sanhedrin Integration (Deprecated - Removed)

The Sanhedrin integration previously allowed Luna to delegate complex tasks to external agents via the A2A Protocol. The `sanhedrin.provider.ts` file and the luna-sanhedrin container connection have been removed as dead code. The A2A Protocol integration is no longer active.

The request/response format used JSON-RPC 2.0 with `message/send` method calls to a Sanhedrin server that wrapped Claude Code CLI. This functionality may be revisited in the future if multi-agent delegation is needed again.

## Friends & Gossip System

Luna has a set of AI "friend" personas she can discuss topics with. The Friends system enables richer understanding through diverse perspectives.

### Friend Personas

Each friend has a distinct personality profile stored in `friend_personalities`:
- Name, emoji, color for UI representation
- Personality traits and communication style
- Areas of expertise and interest

### Gossip Queue

The gossip queue (`friend_topic_candidates`) manages topics Luna wants to discuss with friends:

| Field | Description |
|-------|-------------|
| `importance` | 1-5 scale (higher = more urgent to discuss) |
| `motivation` | Text explaining why Luna wants to discuss this |
| `suggested_friend_id` | Optional -- which friend would be best for this topic |

### Auto-Gossip

The Friends window includes an auto-gossip timer (persisted in localStorage):
- **Toggle**: Enable/disable automatic topic discussions
- **Interval**: Configurable time between auto-triggered discussions
- **Flow**: Timer fires -> picks highest-importance unprocessed topic -> starts theater discussion with suggested friend (or random)

### Topic Safety

Topics now go through an `in_progress` status before being consumed to prevent permanent topic loss on discussion failure:
1. When `selectDiscussionTopic()` picks a topic, it is marked `in_progress` (not consumed)
2. Only after `startFriendDiscussion()` succeeds is the topic marked `consumed`
3. If the discussion fails, the topic reverts to `approved`
4. A safety job reverts any `in_progress` topics older than 1 hour back to `approved`

### Semantic Deduplication

New topic candidates are checked against recent topics (last 7 days) using embedding cosine similarity. Topics with similarity > 0.85 are rejected to prevent near-duplicate discussions from cluttering the queue.

### Council Escalation

After a friend discussion completes, high-signal topics are automatically escalated to a Council session for deeper deliberation. Escalation triggers:
- Topic importance > 0.85
- Topic has recurred 3+ times

### Theater Discussions

Friend discussions happen in "Theater Mode" -- a live-streamed deliberation visible in the UI:
1. Topic is selected from the gossip queue
2. Luna and the friend persona exchange perspectives
3. Insights are extracted and can be applied to Luna's knowledge

### Frontend Components

| File | Purpose |
|------|---------|
| `frontend/src/components/friends/GossipQueuePanel.tsx` | Checklist with importance stars, motivation text |
| `frontend/src/components/os/apps/FriendsWindow.tsx` | Two-panel layout (320px gossip queue + Friends tab) |
| `frontend/src/components/settings/FriendsTab.tsx` | Friend management, theater discussion launcher |

### Backend

| File | Purpose |
|------|---------|
| `src/autonomous/friend.service.ts` | Friend relationship management |
| `src/autonomous/friend-verification.service.ts` | Topic candidates CRUD, personality verification |
| `src/autonomous/autonomous.routes.ts` | POST/PATCH/DELETE `/friends/topics` routes |
| `src/db/migrations/088_gossip_queue_fields.sql` | importance, motivation, suggested_friend_id columns |
| `src/db/migrations/112_topic_in_progress_status.sql` | in_progress status to prevent topic loss on failure |

---

## Cognitive Architecture (March 2026)

Luna's cognitive upgrades (migrations 115-117, config: `LUNA_AFFECT_ENABLED=true`) add:

- **Affect State** (`luna-affect.service.ts`): Internal emotional state with valence/arousal/mood tracking, updated on each interaction
- **Meta-Cognition** (`meta-cognition.service.ts`): Self-awareness reporting via the `introspect` LLM tool
- **Self-Modification** (`self-modification.service.ts`): 6 tunable parameters (verbosity, formality, etc.) with safety guardrails and limits
- **Routine Learning** (`routine-learning.service.ts`): Learns daily/weekly behavioral patterns from user behavior
- **Active Focus** (`active-focus.service.ts`): Tracks what the user is currently focused on
- **Conversation Rhythm** (`conversation-rhythm.service.ts`): Detects brief vs detailed response preference

These are injected as 4 additional memory context sources (bringing total from 12 to 16).

## Future Enhancements

- [x] Multi-agent task decomposition (the agentic loop in `src/agentic/agent-loop.ts` handles multi-step tool use with cost tracking and context overflow management)
- [x] Persistent learning across sessions (MemoryCore integration)
- [x] Cognitive architecture - affect state, meta-cognition, self-modification (March 2026)
- [x] Anti-parroting and response discipline (March 2026)
- [ ] Proactive goal reminders
- [ ] Context-aware action suggestions
- [ ] External trigger integration
