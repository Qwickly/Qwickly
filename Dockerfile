FROM node:22-slim

# Only install what's needed to run the frontend server
# (no Chromium/Puppeteer — those are only needed by the API service)
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

# --- Network patience -------------------------------------------------------
# Railway's builders regularly hit slow/flaky registry reads. pnpm's defaults
# (60s timeout, 2 retries) turn a slow tarball into a build that appears to
# hang and then dies. Give each fetch 10 minutes and 5 retries with backoff,
# and cap parallel connections so we don't self-DoS the builder's network.
ENV NPM_CONFIG_FETCH_TIMEOUT=600000
ENV NPM_CONFIG_FETCH_RETRIES=5
ENV NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000
ENV NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000
ENV NPM_CONFIG_NETWORK_CONCURRENCY=8

# This image never runs a browser. Puppeteer's postinstall otherwise downloads
# ~170MB of Chrome-for-Testing from Google on every build — pure waste here,
# and one of the slowest/least reliable things in the build.
# NOTE: puppeteer >= 20 reads PUPPETEER_SKIP_DOWNLOAD. The older
# PUPPETEER_SKIP_CHROMIUM_DOWNLOAD name is ignored by v24 — keep both only
# because the legacy one is harmless.
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

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

# Install pnpm — pinned to the version in the root package.json "packageManager"
# field. Installing latest was a silent lockfile-drift risk: a newer pnpm can
# reject a lockfile written by an older one under --frozen-lockfile.
RUN npm install -g pnpm@11.6.0

# Install only what the frontend bundle actually needs. The trailing "..." pulls
# in @workspace/bookza's workspace dependencies too, so workspace: protocol
# resolution still works — but it skips api-server's tree entirely
# (puppeteer, whatsapp-web.js, their postinstall hooks), which is the bulk of
# the install time in this image.
# If a build ever fails on a missing package, revert this one line to the
# unfiltered `pnpm install --frozen-lockfile`.
RUN pnpm install --frozen-lockfile --filter @workspace/bookza...

# Copy full source
COPY . .

# Build only the frontend bundle
RUN pnpm --filter @workspace/bookza run build

# Expose the port Railway will route traffic to
EXPOSE 8080

# Switch into the bookza directory so server.js can resolve dist/public correctly
# via its __dirname-relative path, and so the CMD needs no shell 'cd'.
WORKDIR /opt/app/artifacts/bookza

# Start the frontend Express SPA server (exec-form — no shell required).
# Railway sets PORT automatically; server.js binds to that port.
ENV PORT=8080
CMD ["node", "server.js"]
