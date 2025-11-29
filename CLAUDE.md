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
