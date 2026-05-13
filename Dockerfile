FROM node:20-slim

# Install ffmpeg, python3 and curl
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install latest yt-dlp nightly build
RUN curl -L https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && yt-dlp --version

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node dependencies
RUN npm install

# Copy all project files
COPY . .

# Set Railway port
ENV PORT=8080

# Expose port
EXPOSE 8080

# Start the server
CMD ["npm", "start"]
