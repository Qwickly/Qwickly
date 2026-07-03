FROM node:22-slim

WORKDIR /app

# Copy root package files for workspace
COPY package.json pnpm-lock.yaml ./

# Copy bookza package.json
COPY artifacts/bookza/package.json ./artifacts/bookza/

# Install pnpm
RUN npm install -g pnpm

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY artifacts/bookza ./artifacts/bookza
COPY lib ./lib

# Build frontend
RUN cd artifacts/bookza && pnpm run build

# Expose port
EXPOSE 3000

# Start command - serve the built files
CMD ["sh", "-c", "cd artifacts/bookza && npx serve -s dist/public -p $PORT"]
