# ==============================================================================
# Multi-Stage Dockerfile for PulseGuard Ping Worker
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Dependency Installation
# ------------------------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Install build dependencies if needed, then copy package manifests
COPY package.json ./

# Install production dependencies only
RUN npm install --omit=dev --no-audit --no-fund

# ------------------------------------------------------------------------------
# Stage 2: Production Runtime
# ------------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Security: Create non-root user execution environment
RUN mkdir -p /app /tmp/pulseguard && \
    chown -R node:node /app /tmp/pulseguard

# Copy production node_modules from deps stage
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node worker.js ./

# Switch to non-root user
USER node

# Container healthcheck: verify worker heartbeat within last 30s
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const fs = require('fs'); try { const ts = parseInt(fs.readFileSync('/tmp/pulseguard/heartbeat', 'utf8').trim(), 10); if (Date.now() - ts > 30000) process.exit(1); } catch (e) { process.exit(1); }"

CMD ["node", "worker.js"]

