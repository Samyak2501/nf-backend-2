FROM node:20-slim

RUN apt-get update && apt-get install -y ffmpeg python3 curl \
    && curl -L https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp \
       -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && yt-dlp --version
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV PORT=8080

EXPOSE 8080

CMD ["npm", "start"]
