FROM node:22-slim

# Install CUPS client tools so the container can talk to the host Mac's CUPS daemon via socket
RUN apt-get update && apt-get install -y cups-client && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Install dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install

# Copy source
COPY . .

# Build the Vite frontend into dist/
RUN pnpm run build

# The server reads env vars from process.env (injected by docker-compose)
CMD ["node", "--experimental-strip-types", "src/server.ts"]
