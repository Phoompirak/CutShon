FROM node:22-slim

# Install ffmpeg and ffprobe
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install dependencies (production clean install)
RUN npm ci --omit=dev

# Copy application files
COPY . .

# Expose server port
EXPOSE 3000

# Environment variable for port defaults to 3000
ENV PORT=3000

# Start server
CMD ["node", "server.js"]
