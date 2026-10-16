# syntax=docker/dockerfile:1.7
# Targets: "web" (the app, default for compose) and "migrate" (database migrations + operator CLI).

ARG NODE_VERSION=22

# ---------- build: install, generate the Prisma client, build Next.js (standalone output)
FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV CI=1 NEXT_TELEMETRY_DISABLED=1 PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
# dependency layer: only manifests, so code changes do not reinstall everything
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @dienstplan/db generate && pnpm --filter @dienstplan/web build

# ---------- migrate: applies migrations; also used for `admin` commands (bootstrap, create-user, ...)
FROM build AS migrate
WORKDIR /app/packages/db
ENV NODE_ENV=production
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# ---------- web: small runtime image with only the standalone server
FROM node:${NODE_VERSION}-bookworm-slim AS web
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
