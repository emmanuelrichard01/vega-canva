FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package.json package-lock.json ./
# Copy workspace files
COPY apps/server/package.json apps/server/

# The full tree, including dev dependencies, because the build needs tsc.
RUN npm install --no-fund --no-audit

# Copy source
COPY apps/server/ apps/server/

# Build TypeScript
WORKDIR /app/apps/server
RUN npm run build

# ---------------------------------------------------------------------------

FROM node:20-alpine

# `production` is not decoration. It is what makes `readConfig` refuse to start
# on the development credentials committed to this repository, and what stops
# Express serving stack traces to clients.
ENV NODE_ENV=production

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
COPY --from=builder /app/apps/server/package.json ./apps/server/
COPY --from=builder /app/apps/server/dist ./apps/server/dist

# Runtime dependencies only. The builder's tree carries typescript, tsx and
# vitest, none of which should exist on a running server: every one of them is
# code that does not need to be there, which is the whole of the argument.
RUN npm install --omit=dev --no-fund --no-audit \
 && npm cache clean --force

# Drop root.
#
# The image ran as root, so a process compromised through any of the parsing
# this server does -- multipart uploads, Yjs updates, image metadata -- had the
# run of the container. `node` is a non-root user the base image already
# provides, so this costs nothing.
USER node

EXPOSE 3000

# Liveness only: this asks whether the process is answering, not whether the
# database is up. See the note on `/readyz` in index.ts for why those are
# different questions with different consequences.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/apps/server
CMD ["node", "dist/index.js"]
