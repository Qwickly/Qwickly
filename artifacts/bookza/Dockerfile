FROM node:22-slim

WORKDIR /app

# Copy root package files for workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Copy all workspace package.json files
COPY artifacts/bookza/package.json ./artifacts/bookza/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/db/package.json ./lib/db/
COPY lib/api-spec/package.json ./lib/api-spec/

# Install pnpm
RUN npm install -g pnpm

# Install dependencies
RUN pnpm install

# Copy source
COPY artifacts/bookza ./artifacts/bookza
COPY lib ./lib

# Build frontend
RUN cd artifacts/bookza && pnpm run build

# Expose port
EXPOSE 3000

# Start command - serve the built files with custom server
CMD ["sh", "-c", "cd artifacts/bookza && node server.js"]
