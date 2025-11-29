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
RUN apk add --no-cache wget docker-cli

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist

USER node

EXPOSE 3003

CMD ["node", "dist/index.js"]
