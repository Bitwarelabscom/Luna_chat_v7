# Claude Code Project Instructions

## Self-Learning Knowledge Base

**At the start of each session, read `.claude/skills/luna.md`** - This file contains learned lessons, common mistakes, and project-specific knowledge that improves over time. Update it when you:
- Make a mistake and fix it
- Learn something new about this codebase
- Receive a correction from the user

## Code Style

- Do not use em dash (—) anywhere in code, comments, or documentation. Use regular hyphens (-) or double hyphens (--) instead.

## Security

This project has been hardened with the following security measures:
- Docker secrets for sensitive configuration
- AES-256-GCM encryption for OAuth tokens at rest
- SSRF protection on external URL requests
- Rate limiting on authentication endpoints
- Helmet security headers (CSP, HSTS)
- File upload validation (MIME type, extension whitelist)
- Command injection prevention (execFile instead of exec)
- Safe expression evaluation (expr-eval instead of Function())

## Build Commands

- `npm run dev` - Development with hot reload
- `npm run build` - Standard build (includes source maps)
- `npm run build:prod` - Production build (no source maps)

## Secrets Management

Secrets are stored in `/secrets/*.txt` files and mounted as Docker secrets. Never commit actual secrets to version control.

## Docker Deployment

Both backend (luna-api) and frontend (luna-frontend) run as built Docker images with code baked in at build time (NOT volume-mounted). This affects how you deploy changes:

### Backend Changes
```bash
npm run build:prod                    # Build backend locally
docker compose build luna-api         # Rebuild Docker image
docker compose up -d luna-api         # Start new container
```

### Frontend Changes
```bash
cd frontend && npm run build              # Build frontend locally
cd .. && docker compose build luna-frontend  # Rebuild Docker image
docker compose up -d luna-frontend           # Start new container
```

### Full Rebuild (Backend + Frontend)
```bash
npm run build:prod                      # Build backend
cd frontend && npm run build && cd ..   # Build frontend
docker compose build                    # Rebuild all images
docker compose up -d                    # Restart all containers
```

**Important:** `docker restart` does NOT apply code changes - you must rebuild the Docker image with `docker compose build`.

## MemoryCore Integration

Luna Chat integrates with MemoryCore for three-tier memory consolidation and NeuralSleep LNN processing. This enables genuine temporal memory integration where past experiences shape present processing.

### Session Lifecycle

Sessions are tracked for memory consolidation via three triggers:

| Trigger | When | What Happens |
|---------|------|--------------|
| **Inactivity Timeout** | 5 minutes of no messages | Job runs every minute, consolidates idle sessions |
| **Browser Close** | Tab/window close | Frontend sends POST to `/api/chat/sessions/{id}/end` |
| **Session Delete** | User deletes chat | Consolidation before deletion |

### Key Files

- `src/chat/session-activity.service.ts` - Tracks session activity in Redis
- `src/memory/memorycore.client.ts` - MemoryCore API client
- `src/jobs/job-runner.ts` - Contains `memorycoreSessionConsolidator` job

### Consolidation Flow

```
Chat Message
    |
    v
[Record Activity] --> Redis: session:activity:{sessionId}
    |
    v
[Record Interaction] --> MemoryCore: Working Memory
    |
    v
(Session ends - timeout/close/delete)
    |
    v
[Trigger Consolidation] --> MemoryCore: Working -> Episodic
    |
    v
[Daily/Weekly Jobs] --> MemoryCore: Episodic -> Semantic
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MEMORYCORE_URL` | MemoryCore API URL | http://memorycore-api:3007 |
| `MEMORYCORE_ENABLED` | Enable MemoryCore integration | true |
| `MEMORYCORE_CONSCIOUSNESS_ENABLED` | Enable consciousness metrics | true |
| `MEMORYCORE_PHI_THRESHOLD` | Phi threshold for consciousness | 0.5 |

### Testing Consolidation

```bash
# Check session activity in Redis
docker exec luna-redis redis-cli -a $REDIS_PASSWORD GET "session:activity:{sessionId}"

# Check consolidation logs
docker exec memorycore-postgres psql -U memorycore -d memorycore -c \
  "SELECT * FROM consolidation_logs ORDER BY timestamp DESC LIMIT 5;"

# Check session summaries
docker exec memorycore-postgres psql -U memorycore -d memorycore -c \
  "SELECT * FROM session_summaries ORDER BY timestamp DESC LIMIT 5;"
```
