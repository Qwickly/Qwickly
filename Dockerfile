FROM node:22-slim

# Install Chromium and dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-driver \
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
    && rm -rf /var/lib/apt/lists/*

# Set Chromium path and WhatsApp session storage
ENV NODE_ENV=production \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    WHATSAPP_BROWSER_PATH=/usr/bin/chromium \
    CHROME_BIN=/usr/bin/chromium \
    WHATSAPP_SESSION_DIR=/app/.sessions/whatsapp \
    XDG_RUNTIME_DIR=/tmp \
    DISPLAY= \
    WAYLAND_DISPLAY= \
    XAUTHORITY=

# Create session directory
RUN mkdir -p /app/.sessions/whatsapp

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY artifacts/api-server/package.json ./artifacts/api-server/

# Install pnpm
RUN npm install -g pnpm

# Install dependencies
RUN pnpm install

# Copy source
COPY . .

# Ensure the Puppeteer test script is included in the image for debugging
COPY scripts/puppeteer-launch-test.mjs ./scripts/puppeteer-launch-test.mjs

# Build
RUN pnpm --filter api-server run build

# Expose port
EXPOSE 3000

# Start command
CMD ["node", "artifacts/api-server/dist/index.mjs"]
