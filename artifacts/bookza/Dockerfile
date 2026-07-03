FROM node:22-slim

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY artifacts/bookza/package.json ./artifacts/bookza/

# Install pnpm
RUN npm install -g pnpm

# Install dependencies
RUN pnpm install

# Copy source
COPY . .

# Build frontend
RUN cd artifacts/bookza && pnpm run build

# Expose port
EXPOSE 3000

# Start command - serve the built files
CMD ["sh", "-c", "cd artifacts/bookza && npx serve -s dist/public -p $PORT"]
