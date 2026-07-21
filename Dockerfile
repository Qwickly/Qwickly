FROM node:22-slim

# Install Chromium and dependencies
RUN apt-get update && apt-get install -y \
    fonts-liberation \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libx11-xcb1 \
    libxss1 \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libwayland-client0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    chromium \
    && rm -rf /var/lib/apt/lists/*

# Set Chromium path and WhatsApp session storage
ENV NODE_ENV=production \
    WHATSAPP_SESSION_DIR=/app/.sessions/whatsapp \
    XDG_RUNTIME_DIR=/tmp \
    DISPLAY= \
    WAYLAND_DISPLAY= \
    XAUTHORITY= \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create session directory (session storage stays on /app)
RUN mkdir -p /app/.sessions/whatsapp

WORKDIR /opt/app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/bookza/package.json ./artifacts/bookza/
COPY artifacts/mockup-sandbox/package.json ./artifacts/mockup-sandbox/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/db/package.json ./lib/db/
COPY scripts/package.json ./scripts/package.json
COPY artifacts/api-server/scripts/patch-whatsapp-fork.cjs ./artifacts/api-server/scripts/patch-whatsapp-fork.cjs

# Install pnpm
RUN npm install -g pnpm

# Install dependencies
RUN pnpm install

# Copy source
COPY . .

# Ensure the Puppeteer test script is included in the image for debugging
COPY scripts/puppeteer-launch-test.mjs ./scripts/puppeteer-launch-test.mjs

# Build frontend bundle
RUN pnpm --filter @workspace/bookza run build

# Expose port
EXPOSE 8080

# Start command
CMD ["sh", "-c", "cd /opt/app/artifacts/bookza && node server.js"]
