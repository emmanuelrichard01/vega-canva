FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package.json package-lock.json ./
# Copy workspace files
COPY apps/server/package.json apps/server/

# Install dependencies (only for server and root)
RUN npm install --no-fund --no-audit

# Copy source
COPY apps/server/ apps/server/

# Build TypeScript
WORKDIR /app/apps/server
RUN npm run build

# Runtime stage
FROM node:20-alpine

WORKDIR /app

# Copy only what we need from builder
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/server/package.json ./apps/server/
COPY --from=builder /app/apps/server/dist ./apps/server/dist

# Expose port
EXPOSE 3000

# Run the server
WORKDIR /app/apps/server
CMD ["node", "dist/index.js"]
