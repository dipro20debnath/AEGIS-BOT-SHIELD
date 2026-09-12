# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package.json and lockfile (if exists)
COPY package*.json ./
# Copy workspace packages package.json
COPY packages/core/package*.json ./packages/core/

# Install dependencies
RUN npm ci

# Copy source files
COPY . .

# Build the project
RUN npm run build

# Stage 2: Production runtime
FROM node:20-alpine AS runtime

WORKDIR /app

# Set NODE_ENV to production
ENV NODE_ENV=production

# Copy built artifacts from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/package*.json ./packages/core/
COPY --from=builder /app/packages/core/dist ./packages/core/dist

# Ensure the core module can be started
CMD ["node", "packages/core/dist/index.js"]
