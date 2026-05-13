const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);

const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(express.json());

// --- CORS ---
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

if (FRONTEND_URL === '*') {
  app.use(cors());
} else {
  app.use(cors({
    origin: FRONTEND_URL.split(',').map(u => u.trim()),
    methods: ['GET']
  }));
}

// --- PORT ---
const PORT = process.env.PORT || 3001;

// --- ./yt-dlp/yt-dlp binary path (fallback to PATH) ---
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';

// --- YouTube Cookie file path ---
// Set COOKIES_FILE env var to the path of your exported YouTube cookies.txt
// Export from browser using "Get cookies.txt LOCALLY" Chrome extension (Netscape format)
// On Railway: upload cookies.txt to your repo or set content as env var, then point here
const COOKIES_FILE = process.env.COOKIES_FILE || '';

// Build cookie args for yt-dlp — injected into every call
const cookieArgs = COOKIES_FILE ? ['--cookies', COOKIES_FILE] : [];

// Extra args to help bypass YouTube bot detection even without cookies
const ytArgs = [
  '--extractor-args', 'youtube:player_client=android,web_embedded',
  '--force-ipv4',
  ...cookieArgs
];

// --- Top Songs Cache ---
let topSongsCache = { data: null, timestamp: 0 };
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Root endpoint
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Nadify Server Running' });
});

// ========== TOP SONGS ENDPOINT ==========
app.get('/top-songs', async (req, res) => {
  // Return cached data if fresh
  if (topSongsCache.data && Date.now() - topSongsCache.timestamp < CACHE_TTL) {
    return res.json(topSongsCache.data);
  }

  try {
    const url = "https://kworb.net/spotify/country/in_daily.html";

    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      timeout: 15000
    });

    const $ = cheerio.load(data);
    const songNames = [];

    $("table tbody tr").each((i, el) => {
      if (songNames.length >= 8) return false;
      const cols = $(el).find("td");
      if (cols.length < 3) return;
      const titleWithArtist = $(cols[2]).text().trim();
      if (titleWithArtist) songNames.push(titleWithArtist);
    });

    if (songNames.length === 0) {
      return res.json({ status: false, songs: [], error: 'No songs found' });
    }

    // Fetch all song details in parallel using execFile (safe from injection)
    const songPromises = songNames.map(async (name, index) => {
      try {
        const { stdout } = await execFilePromise(YTDLP, [
          `ytsearch1:${name}`,
          '--dump-json',
          '--flat-playlist',
          '--no-warnings',
          '--quiet',
          ...ytArgs
        ], { maxBuffer: 5 * 1024 * 1024, timeout: 20000 });

        const lines = stdout.trim().split('\n').filter(line => line);
        if (lines.length === 0) return null;

        const data = JSON.parse(lines[0]);
        return {
          rank: index + 1,
          name: data.title || 'Unknown',
          artist: data.channel || data.uploader || 'Unknown',
          image: data.thumbnails?.[data.thumbnails.length - 1]?.url || data.thumbnail || '',
          url: `https://www.youtube.com/watch?v=${data.id}`,
          duration: data.duration
        };
      } catch (e) {
        console.error(`Failed to fetch: ${name}`, e.message);
        return null;
      }
    });

    const songs = (await Promise.all(songPromises)).filter(s => s !== null);
    const response = { status: true, songs };

    // Cache the result
    topSongsCache = { data: response, timestamp: Date.now() };

    res.json(response);
  } catch (err) {
    console.error("Error fetching top songs:", err.message);
    res.json({ status: false, songs: [], error: err.message });
  }
});

// ========== SEARCH ENDPOINT ==========
app.get('/search', async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.json({ results: [] });
  }

  try {
    const { stdout } = await execFilePromise(YTDLP, [
      `ytsearch10:${query}`,
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
      '--quiet',
      ...ytArgs
    ], { maxBuffer: 10 * 1024 * 1024, timeout: 30000 });

    const results = stdout
      .trim()
      .split('\n')
      .filter(line => line)
      .map(line => {
        try {
          const data = JSON.parse(line);
          return {
            name: data.title || 'Unknown',
            artist: data.channel || data.uploader || 'Unknown',
            image: data.thumbnails?.[data.thumbnails.length - 1]?.url || data.thumbnail || '',
            url: `https://www.youtube.com/watch?v=${data.id}`,
            duration: data.duration
          };
        } catch (e) {
          return null;
        }
      })
      .filter(item => item !== null);

    res.json({ results });
  } catch (error) {
    console.error('Search error:', error.message);
    res.json({ results: [], error: error.message });
  }
});

// ========== STREAM ENDPOINT ==========
app.get('/stream', async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.json({ status: false, error: 'No URL provided' });
  }

  // Basic URL validation
  if (!url.startsWith('https://www.youtube.com/watch?v=') && !url.startsWith('https://youtu.be/')) {
    return res.json({ status: false, error: 'Invalid URL' });
  }

  try {
    const { stdout: streamUrl } = await execFilePromise(YTDLP, [
      '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
      '-g',
      '--no-warnings',
      '--no-playlist',
      ...ytArgs,
      url
    ], { timeout: 30000 });

    const { stdout: metaJson } = await execFilePromise(YTDLP, [
      '--dump-json',
      '--no-warnings',
      '--no-playlist',
      ...ytArgs,
      url
    ], { timeout: 30000 });

    const meta = JSON.parse(metaJson);

    res.json({
      status: true,
      stream_url: streamUrl.trim().split('\n')[0],
      title: meta.title || 'Unknown',
      artist: meta.channel || meta.uploader || 'Unknown',
      image: meta.thumbnail || meta.thumbnails?.[meta.thumbnails.length - 1]?.url || '',
      duration: meta.duration
    });

  } catch (error) {
    console.error('Stream error:', error.message);

    try {
      const { stdout: fallbackUrl } = await execFilePromise(YTDLP, [
        '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
        '-g',
        '--no-warnings',
        ...ytArgs,
        url
      ], { timeout: 30000 });

      res.json({
        status: true,
        stream_url: fallbackUrl.trim(),
        title: 'Unknown',
        artist: 'Unknown',
        image: ''
      });
    } catch (fallbackError) {
      res.json({
        status: false,
        error: 'Failed to get stream. Try updating ./yt-dlp/yt-dlp.'
      });
    }
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Nadify Server running on port ${PORT}`);
});
