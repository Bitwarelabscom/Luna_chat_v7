FROM node:20-alpine AS deps
ARG ALPINE_REPO_BASE=http://ftp.halifax.rwth-aachen.de/alpine
RUN set -eux; \
    sed -i \
      -e "s|https://dl-cdn.alpinelinux.org/alpine|${ALPINE_REPO_BASE}|g" \
      -e "s|http://dl-cdn.alpinelinux.org/alpine|${ALPINE_REPO_BASE}|g" \
      /etc/apk/repositories; \
    apk add --no-cache libc6-compat
WORKDIR /app

COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Force clean build
RUN rm -rf .next node_modules/.cache && npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

RUN mkdir .next
RUN chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

CMD ["node", "server.js"]
