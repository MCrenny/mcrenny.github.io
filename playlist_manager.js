const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// List of open sources to aggregate
const OPEN_SOURCES = [
  { name: 'IPTVru (GitHub)', url: 'https://smolnp.github.io/IPTVru//IPTVru.m3u' },
  { name: 'iptv-org (Russian)', url: 'https://iptv-org.github.io/iptv/languages/rus.m3u' },
  { name: 'Free-TV (Russia)', url: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_russia.m3u8' }
];

// File cache path
let PLAYLIST_CACHE_FILE = process.env.PLAYLIST_CACHE_PATH;
if (!PLAYLIST_CACHE_FILE) {
  if (fs.existsSync('/data')) {
    PLAYLIST_CACHE_FILE = '/data/playlist.m3u';
    // Copy local cached file to /data if needed
    const localCache = path.join(__dirname, 'playlist.m3u');
    if (!fs.existsSync(PLAYLIST_CACHE_FILE) && fs.existsSync(localCache)) {
      try {
        fs.copyFileSync(localCache, PLAYLIST_CACHE_FILE);
      } catch (e) {}
    }
  } else {
    PLAYLIST_CACHE_FILE = path.join(__dirname, 'playlist.m3u');
  }
}

// Helpers to get secure HTTPS requests
const fetchText = (url) => {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    try {
      const parsed = new URL(url);
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': 'okhttp/4.9.2',
          'Accept': '*/*'
        },
        timeout: 8000
      };
      const req = client.request(options, (res) => {
        if (res.statusCode >= 400) {
          let errData = '';
          res.on('data', (chunk) => errData += chunk);
          res.on('end', () => {
            const err = new Error(`HTTP Error ${res.statusCode}`);
            err.statusCode = res.statusCode;
            err.responseBody = errData;
            reject(err);
          });
          return;
        }
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve(data));
      });
      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
      req.end();
    } catch (e) {
      reject(e);
    }
  });
};

// Check if a stream URL is responsive (ping health check)
const checkStreamHealth = (url) => {
  return new Promise((resolve) => {
    if (!url || !url.startsWith('http')) return resolve(false);
    
    // Quick ping with 2-second timeout
    try {
      const urlObj = new URL(url);
      const client = url.startsWith('https') ? https : http;
      
      const req = client.request({
        method: 'GET',
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 2000
      }, (res) => {
        // Any 2xx or 3xx response indicates the stream is active
        const active = res.statusCode >= 200 && res.statusCode < 400;
        res.destroy(); // Instantly close the connection
        resolve(active);
      });

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    } catch (e) {
      resolve(false);
    }
  });
};

// Auto-categorize based on channel name
const categorizeChannel = (name) => {
  const n = name.toLowerCase();
  if (n.includes('кино') || n.includes('film') || n.includes('movie') || n.includes('премьера') || n.includes('cinema') || n.includes('tv1000') || n.includes('дом кино')) {
    return '🎬 Кино';
  }
  if (n.includes('спорт') || n.includes('sport') || n.includes('матч') || n.includes('футбол') || n.includes('arena') || n.includes('боец')) {
    return '⚽ Спорт';
  }
  if (n.includes('детск') || n.includes('cartoon') || n.includes('disney') || n.includes('nickelodeon') || n.includes('карусель') || n.includes('мульт')) {
    return '👶 Детские';
  }
  if (n.includes('муз') || n.includes('music') || n.includes('ru.tv') || n.includes('mtv') || n.includes('песня')) {
    return '🎵 Музыка';
  }
  if (n.includes('наук') || n.includes('science') || n.includes('discovery') || n.includes('national') || n.includes('история') || n.includes('планета') || n.includes('познават')) {
    return '🧠 Познавательные';
  }
  if (n.includes('новост') || n.includes('news') || n.includes('сегодня') || n.includes('вести') || n.includes('евроньюс')) {
    return '📰 Новости';
  }
  return '📺 Общие';
};

// Parse raw M3U text into an array of channel objects
const parseM3U = (text) => {
  const channels = [];
  const lines = text.split('\n');
  let currentInfo = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXTINF:')) {
      const matchName = line.match(/,(.+)$/);
      const name = matchName ? matchName[1].trim() : 'Неизвестный канал';
      
      const matchGroup = line.match(/group-title="([^"]+)"/);
      const group = matchGroup ? matchGroup[1].trim() : '📺 Общие';

      const matchLogo = line.match(/tvg-logo="([^"]+)"/);
      const logo = matchLogo ? matchLogo[1].trim() : '';

      currentInfo = { name, group, logo };
    } else if (line.startsWith('http') && currentInfo) {
      channels.push({
        ...currentInfo,
        url: line
      });
      currentInfo = null;
    }
  }
  return channels;
};

// Normalize channel name for strict deduplication
const normalizeChannelName = (name) => {
  if (!name) return '';
  return name.toLowerCase()
    .replace(/ё/g, 'е')
    // Remove HD, FHD, UHD, SD, T2, 50fps, etc. as standalone words or in bounds
    .replace(/\b(hd|fhd|uhd|sd|mp4|ru|рф|снг|cis|t2|\+2|\+4|\+6|50fps|резерв|premium)\b/gi, '')
    // Remove parenthesized or bracketed suffixes, e.g., (резерв), [SD], {HD}
    .replace(/[\(\[\{].*?[\)\]\}]/g, '')
    // Remove all non-alphanumeric characters to avoid space/punctuation mismatch
    .replace(/[^a-zа-я0-9]/g, '')
    .trim();
};

// Core Playlist Aggregator and Scanner
const rebuildPlaylist = async () => {
  console.log('[Playlist Manager] Starting playlist rebuild...');
  
  const channelsMap = new Map();

  // 1. Fetch Open sources and group them by normalized name
  for (const source of OPEN_SOURCES) {
    try {
      console.log(`[Playlist Manager] Fetching source: ${source.name}`);
      const text = await fetchText(source.url);
      const parsed = parseM3U(text);
      console.log(`[Playlist Manager] Parsed ${parsed.length} channels from ${source.name}`);
      
      for (const c of parsed) {
        const normName = normalizeChannelName(c.name);
        if (!normName) continue;
        
        if (!channelsMap.has(normName)) {
          channelsMap.set(normName, []);
        }
        
        channelsMap.get(normName).push({
          name: c.name,
          group: c.group || categorizeChannel(c.name),
          logo: c.logo,
          url: c.url
        });
      }
    } catch (err) {
      console.error(`[Playlist Manager] Failed to process ${source.name}:`, err.message);
    }
  }

  console.log(`[Playlist Manager] Grouped into ${channelsMap.size} unique channels. Sorting alternatives...`);

  // Sort alternatives for each channel (HD first)
  const channelStates = [];
  for (const [normName, alternatives] of channelsMap.entries()) {
    alternatives.sort((a, b) => {
      const aHd = /hd|fhd|uhd/i.test(a.name);
      const bHd = /hd|fhd|uhd/i.test(b.name);
      if (aHd && !bHd) return -1;
      if (!aHd && bHd) return 1;
      return 0;
    });
    
    channelStates.push({
      normName,
      alternatives,
      currentIdx: 0,
      resolved: false
    });
  }

  const activeChannels = [];
  const batchSize = 15;

  console.log('[Playlist Manager] Performing intelligent batch health checks...');

  let iteration = 1;
  while (true) {
    // Gather all streams that need to be checked in this pass
    const checkQueue = [];
    for (const state of channelStates) {
      if (!state.resolved && state.currentIdx < state.alternatives.length) {
        checkQueue.push({
          state,
          channel: state.alternatives[state.currentIdx]
        });
      }
    }

    if (checkQueue.length === 0) {
      break; // No more channels/alternatives to check
    }

    console.log(`[Playlist Manager] Iteration ${iteration}: Checking ${checkQueue.length} streams...`);

    // Process in batches
    for (let i = 0; i < checkQueue.length; i += batchSize) {
      const batch = checkQueue.slice(i, i + batchSize);
      
      const results = await Promise.all(batch.map(async (item) => {
        const isAlive = await checkStreamHealth(item.channel.url);
        return { item, isAlive };
      }));

      for (const res of results) {
        const { item, isAlive } = res;
        if (isAlive) {
          item.state.resolved = true;
          activeChannels.push({
            name: item.channel.name,
            group: categorizeChannel(item.channel.name), // Recategorize to keep groups clean
            logo: item.channel.logo,
            url: item.channel.url
          });
        } else {
          item.state.currentIdx++; // Move to next alternative for subsequent iterations
        }
      }
    }

    iteration++;
  }

  // 3. Generate structured M3U file
  let m3uText = '#EXTM3U\n';
  for (const c of activeChannels) {
    m3uText += `#EXTINF:-1 tvg-logo="${c.logo}" group-title="${c.group}",${c.name}\n${c.url}\n`;
  }

  fs.writeFileSync(PLAYLIST_CACHE_FILE, m3uText, 'utf8');
  console.log(`[Playlist Manager] Rebuilt playlist successfully. Active: ${activeChannels.length} / Unique: ${channelsMap.size}`);
  return activeChannels.length;
};

module.exports = {
  rebuildPlaylist,
  PLAYLIST_CACHE_FILE
};
