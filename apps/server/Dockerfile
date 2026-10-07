# Build context is the repository root (see docker-compose*.yml), because the
# server is one workspace of an npm workspaces monorepo and its lockfile lives
# at the root. `.dockerignore` keeps everything but the server out of it.
#
# Node 24 LTS, matching CI, `.nvmrc` and Render. The server compiles to
# CommonJS but imports the ESM-only `nanoid@5`, which needs unflagged
# `require(esm)` (Node >= 22.12).
FROM node:24-alpine AS builder

WORKDIR /app

# Manifests first, so the dependency layer is cached until one of them changes.
# Every workspace manifest is copied because `npm ci` checks the lockfile
# against all of them, even when installing one workspace.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/frontend/package.json apps/frontend/

# `--ignore-scripts`: the root postinstall only repairs esbuild for local
# Windows machines, and nothing the server builds or runs needs install
# scripts. Dev dependencies are included because the build needs tsc.
RUN npm ci --workspace=apps/server --include-workspace-root --ignore-scripts --no-fund --no-audit

COPY apps/server/ apps/server/

WORKDIR /app/apps/server
RUN npm run build

# ---------------------------------------------------------------------------

FROM node:24-alpine

# `production` makes `readConfig` refuse to start on the development
# credentials committed to this repository, and stops Express serving stack
# traces to clients.
ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/frontend/package.json apps/frontend/

# Runtime dependencies only, from the same lockfile as the build.
RUN npm ci --workspace=apps/server --include-workspace-root --omit=dev --ignore-scripts --no-fund --no-audit \
 && npm cache clean --force

COPY --from=builder /app/apps/server/dist ./apps/server/dist
# The typeface share cards are set in. Read at runtime from `dist/../assets`.
COPY --from=builder /app/apps/server/assets ./apps/server/assets

# `node` is a non-root user the base image provides.
USER node

EXPOSE 3000

# Liveness only: whether the process answers, not whether the database is up.
# `/readyz` is the readiness question.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/apps/server
CMD ["node", "dist/index.js"]
