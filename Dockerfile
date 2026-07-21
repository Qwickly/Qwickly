FROM node:22-slim

# Only install what's needed to run the frontend server
# (no Chromium/Puppeteer — those are only needed by the API service)
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

WORKDIR /opt/app

# Copy workspace manifest files first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Copy all package.json files that the workspace resolver needs
COPY artifacts/bookza/package.json ./artifacts/bookza/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/mockup-sandbox/package.json ./artifacts/mockup-sandbox/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/db/package.json ./lib/db/
COPY scripts/package.json ./scripts/package.json
# The api-server postinstall hook needs this script to exist before pnpm install runs
COPY artifacts/api-server/scripts/patch-whatsapp-fork.cjs ./artifacts/api-server/scripts/patch-whatsapp-fork.cjs

# Install pnpm
RUN npm install -g pnpm

# Install all workspace dependencies (needed for workspace: protocol resolution)
RUN pnpm install --frozen-lockfile

# Copy full source
COPY . .

# Build only the frontend bundle
RUN pnpm --filter @workspace/bookza run build

# Expose the port Railway will route traffic to
EXPOSE 8080

# Start the frontend Express SPA server.
# Railway sets PORT automatically; server.js falls back to 3000 if unset.
CMD ["sh", "-c", "cd /opt/app/artifacts/bookza && node server.js"]
