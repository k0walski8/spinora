# syntax=docker/dockerfile:1

FROM node:22-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json ./
RUN npm install

FROM base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=postgresql://spinora:spinora@localhost:5432/spinora
ENV BETTER_AUTH_SECRET=build-secret
ENV REDIS_URL=redis://localhost:6379
ENV UPSTASH_REDIS_REST_URL=http://localhost:6379
ENV UPSTASH_REDIS_REST_TOKEN=build-token
ENV EXA_API_KEY=build-key
ENV CRON_SECRET=build-secret
ENV BLOB_READ_WRITE_TOKEN=build-token
ENV QSTASH_TOKEN=build-token
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
LABEL org.opencontainers.image.name="spinora"
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
