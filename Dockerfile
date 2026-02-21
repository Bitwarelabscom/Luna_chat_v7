FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json tsconfig.production.json ./
COPY src ./src

# SECURITY: Use production build (no source maps)
RUN npm run build:prod

FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Add system dependencies for tooling, media, and Playwright runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget git ffmpeg vlc python3 python3-pip ca-certificates curl gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install docker-cli for sandbox proxy access (via docker-socket-proxy)
RUN curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" \
    > /etc/apt/sources.list.d/docker.list && \
    apt-get update && apt-get install -y --no-install-recommends docker-ce-cli && \
    rm -rf /var/lib/apt/lists/*

# Install yt-dlp
RUN pip3 install --break-system-packages yt-dlp

# Ensure Playwright browsers are installed where the runtime user expects them.
ENV PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright
RUN mkdir -p /home/node/.cache/ms-playwright

# Install Playwright Chromium + OS dependencies
RUN npx -y playwright@latest install chromium --with-deps
RUN chown -R node:node /home/node/.cache/ms-playwright

# Install Claude CLI and Gemini CLI globally for coding agents
RUN npm install -g @anthropic-ai/claude-code @google/gemini-cli

# Create credential directories for CLI tools (will be mounted)
RUN mkdir -p /home/node/.claude /home/node/.gemini && chown node:node /home/node/.claude /home/node/.gemini

# Create workspace, browser profile, documents, images, and media directories with proper ownership
RUN mkdir -p /app/workspace /app/browser-profiles /app/documents /app/images/backgrounds/generated /app/images/backgrounds/uploaded /mnt/data/media/Videos /mnt/data/media/Music && chown -R node:node /app/workspace /app/browser-profiles /app/documents /app/images /mnt/data/media

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY --chown=node:node src/db/migrations ./src/db/migrations
COPY --chown=node:node src/config ./src/config

USER node

EXPOSE 3003

CMD ["node", "dist/index.js"]
