# Luna Chat - Claude Code Instructions

Luna is a personal AI system built by Henke (BitwareLabs). Express.js + TypeScript backend, Next.js + Zustand frontend, PostgreSQL + Redis + Neo4j data layer. Docker-deployed on a dedicated server behind WireGuard VPN.

## Global Rules

- **No em dashes** (---) anywhere in code, comments, docs, or output. Use hyphens (-) or double hyphens (--)
- **ESM imports**: Always use `.js` extension (e.g., `import { query } from '../db/postgres.js'`)
- **TypeScript strict**: `noUnusedParameters: true` -- prefix unused params with `_`
- **WireGuard-only**: Nothing exposed to public internet except `/api/triggers/telegram/webhook`
- **Map iteration**: Use `Array.from(map.entries()).forEach(...)` not `for...of`
- **Sessions table**: Named `sessions` (NOT `chat_sessions`)
- **CEO table**: Named `ceo_configs` (plural)
- **Database**: `luna_chat` (NOT `luna`)

## Self-Learning

Read `.claude/skills/luna.md` at session start. Update it when you make a mistake, receive a correction, or learn something new about this codebase.

## Build & Deploy

```bash
# Backend
npm run build:prod && docker compose build luna-api && docker compose up -d luna-api

# Frontend
cd frontend && npm run build && cd .. && docker compose build luna-frontend && docker compose up -d luna-frontend

# Full rebuild
npm run build:prod && cd frontend && npm run build && cd .. && docker compose build && docker compose up -d
```

`docker restart` does NOT apply code changes -- you must `docker compose build`.

## Domain Skills

Claude Code auto-invokes these based on task context. Each contains file maps, code patterns, and runbooks.

| Skill | Scope |
|-------|-------|
| `luna-backend` | Routes, services, LLM tools, streaming, jobs, webhooks (`src/`) |
| `luna-frontend` | UI components, Zustand stores, app registry, API layer (`frontend/`) |
| `luna-data` | PostgreSQL, Redis, Neo4j, MemoryCore pool, migrations |
| `luna-memory` | MemoryCore, NeuralSleep, entity/knowledge graphs, Memory Lab |
| `luna-music` | Suno pipeline, genre registry, album production, DJ Luna, trends |
| `luna-trading` | Exchange clients, strategies, auto-trading, bots, trading terminal |

## Security

- Docker secrets for sensitive config (`/secrets/*.txt`)
- AES-256-GCM encryption for OAuth tokens and exchange credentials at rest
- SSRF protection, rate limiting, Helmet headers, MIME validation
- Command injection prevention (execFile, expr-eval)
- Never commit secrets to version control

## Key Integration Points

### MemoryCore (3-tier memory consolidation)
- Client: `src/memory/memorycore.client.ts`
- Consolidation triggers: 5min inactivity timeout, browser close, session delete
- Flow: Working Memory -> Episodic (on session end) -> Semantic (daily/weekly jobs)
- Memory context: 16 sources (facts, graphs, consciousness, emotions, affect, meta-cognition, rhythm, etc.)
- Env: `MEMORYCORE_URL=http://memorycore-api:3007`, `MEMORYCORE_ENABLED=true`

### Cognitive Architecture (March 2026)
- Affect state: `src/memory/luna-affect.service.ts` - valence/arousal/mood tracking
- Meta-cognition: `src/memory/meta-cognition.service.ts` - self-awareness reporting via `introspect` tool
- Self-modification: `src/memory/self-modification.service.ts` - 6 tunable parameters with safety guardrails
- Behavioral upgrades: routine learning, active focus tracking, conversation rhythm
- Config: `LUNA_AFFECT_ENABLED=true` enables all cognitive features
- Migrations: 115 (affect state), 116 (self-modification), 117 (behavioral upgrades)

### Agentic Loop (unified tool execution)
- `src/agentic/`: types.ts, agent-loop.ts, tool-executor.ts, cost-tracker.ts, shared-helpers.ts
- `executeTool()` is the single source of truth for all 56+ tool handlers
- ALL code paths use it: streamMessage (agent loop), processMessage, voice-chat
- Context overflow management: token estimation, summarize at 80%, loop breakers
- Default limits: maxSteps=25, maxCostUsd=0.50

### Luna Streams (Mamba SSM continuous cognition)
- Client: `src/integration/luna-streams.client.ts`
- Runs on 10.0.0.30 as systemd service (NOT Docker), RTX 3080, Mamba 2.8B
- Fire-and-forget event emission with retry (max 2, circuit breaker after 5 failures)
- Context fetch parallelized with `buildMemoryContext()`, delta-tracked (> 0.01), 5min cache
- Env: `LUNA_STREAMS_URL=http://10.0.0.30:8100`, `LUNA_STREAMS_ENABLED=false`

### Docker Internal Traffic
Backend HTTPS redirect must allow Docker IPs (172.x.x.x) alongside WireGuard (10.0.0.x). Without this, container-to-container requests get 301 redirected and fail with SSL errors.
