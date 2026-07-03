FROM node:22-slim

WORKDIR /app

# Set environment variables for build
ENV PORT=8080
ENV BASE_PATH=/

# Copy frontend package files
COPY artifacts/bookza/package.json ./artifacts/bookza/
COPY package.json pnpm-lock.yaml ./

# Install pnpm
RUN npm install -g pnpm

# Install dependencies
RUN pnpm install

# Copy source
COPY . .

# Build frontend
RUN cd artifacts/bookza && pnpm run build

# Expose port
EXPOSE 8080

# Start command - serve the built frontend
WORKDIR /app/artifacts/bookza
CMD ["sh", "./start.sh"]
