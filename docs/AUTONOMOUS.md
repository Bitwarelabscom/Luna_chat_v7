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

## Sanhedrin Integration

For complex tasks, Luna can delegate to external agents via the A2A Protocol:

### Provider: sanhedrin.provider.ts

Connects to Sanhedrin server (luna-sanhedrin container) which wraps Claude Code CLI.

### Request Format
```json
{
  "jsonrpc": "2.0",
  "id": "uuid",
  "method": "message/send",
  "params": {
    "message": {
      "role": "user",
      "parts": [{ "text": "prompt" }]
    }
  }
}
```

### Response Format
```json
{
  "jsonrpc": "2.0",
  "id": "uuid",
  "result": {
    "taskId": "uuid",
    "status": { "state": "completed" },
    "artifacts": [
      { "parts": [{ "text": "response" }] }
    ]
  }
}
```

## Future Enhancements

- [ ] Multi-agent task decomposition
- [ ] Persistent learning across sessions
- [ ] Proactive goal reminders
- [ ] Context-aware action suggestions
- [ ] External trigger integration
