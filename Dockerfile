# syntax=docker/dockerfile:1

# ---------- deps: resolve node_modules from the lockfile only ----------
FROM node:20-alpine AS deps
WORKDIR /app
# Next.js' SWC binary occasionally wants glibc shims on musl.
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

# ---------- builder: produce .next/standalone ----------
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No build-time secrets: every route is `force-dynamic`, so Supabase is only
# ever read at request time from the runtime environment.
RUN npm run build

# ---------- runner: slim runtime ----------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs \
 && adduser -u 1001 -S nextjs -G nodejs

# standalone/ already contains server.js plus the pruned node_modules; static/
# is not bundled into it and has to be copied alongside.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# This project has no public/ directory. If one is added, also:
#   COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
