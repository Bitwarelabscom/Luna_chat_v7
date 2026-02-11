FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json tsconfig.production.json ./
COPY src ./src

# SECURITY: Use production build (no source maps)
RUN npm run build:prod

FROM node:20-alpine AS runner

WORKDIR /app

# Add docker-cli for sandbox proxy access (via docker-socket-proxy)
# Add git for Claude CLI (required dependency)
RUN apk add --no-cache wget docker-cli git

# Install Claude CLI and Gemini CLI globally for coding agents
RUN npm install -g @anthropic-ai/claude-code @google/gemini-cli

# Create credential directories for CLI tools (will be mounted)
RUN mkdir -p /home/node/.claude /home/node/.gemini && chown node:node /home/node/.claude /home/node/.gemini

# Create workspace, documents, and images directories with proper ownership
RUN mkdir -p /app/workspace /app/documents /app/images/backgrounds/generated /app/images/backgrounds/uploaded && chown -R node:node /app/workspace /app/documents /app/images

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY --chown=node:node src/db/migrations ./src/db/migrations
COPY --chown=node:node src/config ./src/config

USER node

EXPOSE 3003

CMD ["node", "dist/index.js"]
