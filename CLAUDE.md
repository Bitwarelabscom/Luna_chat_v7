# Claude Code Project Instructions

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
