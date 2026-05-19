const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { db } = require('./db');

// List of open sources to aggregate
const OPEN_SOURCES = [
  { name: 'IPTVru (GitHub)', url: 'https://smolnp.github.io/IPTVru//IPTVru.m3u' }
];

// File cache path
const PLAYLIST_CACHE_FILE = path.join(__dirname, 'playlist.m3u');

// Keep track of the active session ID (sid) and UUID for IDC
let idcSid = null;
let idcUuid = null;

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

// Get or pair the IDC UUID
const getOrRegisterIdcUuid = async () => {
  // Check if we already have it in SQLite
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'idc_uuid'").get();
    if (row) {
      idcUuid = row.value;
      return idcUuid;
    }
  } catch (e) {
    // Table might not exist, we will create it in streamlume_server.js
  }

  // Generate new UUID using IDC's get-uid endpoint
  try {
    const deviceId = 'streamlume_server_' + Math.random().toString(36).substring(2, 10);
    const response = await fetchText(`https://iptvn.idc.md/api/v3/get-uid?id_device=${deviceId}`);
    const resObj = JSON.parse(response);
    if (resObj && resObj.uid) {
      idcUuid = resObj.uid;
      
      // Save to SQLite
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('idc_uuid', ?)").run(idcUuid);
      console.log(`[IDC Integration] Registered new UUID: ${idcUuid}`);
      return idcUuid;
    }
  } catch (err) {
    console.error('[IDC Integration] Failed to register UUID:', err.message);
  }
  return idcUuid;
};

const postMultipart = (url, fields) => {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    const bodyParts = [];
    for (const [k, v] of Object.entries(fields)) {
      bodyParts.push(`--${boundary}`);
      bodyParts.push(`Content-Disposition: form-data; name="${k}"`);
      bodyParts.push('');
      bodyParts.push(v.toString());
    }
    bodyParts.push(`--${boundary}--`);
    bodyParts.push('');
    const bodyData = Buffer.from(bodyParts.join('\r\n'), 'utf-8');

    const parsed = new URL(url);
    const client = url.startsWith('https') ? https : http;
    
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'User-Agent': 'okhttp/4.9.2',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyData.length
      },
      timeout: 10000
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          const err = new Error(`HTTP Error ${res.statusCode}`);
          err.responseBody = data;
          reject(err);
        } else {
          resolve(data);
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });

    req.write(bodyData);
    req.end();
  });
};

// Obtain or refresh fresh Session ID (sid) from IDC
const getOrRefreshIdcSession = async () => {
  try {
    const loginRow = db.prepare("SELECT value FROM settings WHERE key = 'idc_login'").get();
    const passRow = db.prepare("SELECT value FROM settings WHERE key = 'idc_password'").get();
    if (!loginRow || !passRow) {
      console.log('[IDC Integration] No saved credentials found in database.');
      return null;
    }

    const login = loginRow.value;
    const pass = passRow.value;

    const result = await loginIdc(login, pass);
    if (result && result.success) {
      return {
        sid: result.uuid,
        sidName: 'SSID'
      };
    }
  } catch (err) {
    console.error('[IDC Integration] Auto-refresh login failed:', err.message);
  }
  return null;
};

// Obtain fresh Session ID (sid) from IDC (for compatibility)
const updateIdcSession = async () => {
  const session = await getOrRefreshIdcSession();
  return !!session;
};

// Perform in-app login via legacy JSON API
const loginIdc = async (login, password) => {
  const numLogin = parseInt(login, 10);
  const numPassword = parseInt(password, 10);
  if (isNaN(numLogin) || isNaN(numPassword)) {
    throw new Error('Логин (номер договора) и пароль (PIN) должны быть целыми числами!');
  }

  let deviceId = '';
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'idc_device_id'").get();
    if (row) {
      deviceId = row.value;
    } else {
      deviceId = require('crypto').randomBytes(8).toString('hex');
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('idc_device_id', ?)").run(deviceId);
    }
  } catch (e) {
    deviceId = require('crypto').randomBytes(8).toString('hex');
  }

  let softid = '';
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'idc_softid'").get();
    if (row) {
      softid = row.value;
    } else {
      softid = require('crypto').randomUUID();
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('idc_softid', ?)").run(softid);
    }
  } catch (e) {
    softid = require('crypto').randomUUID();
  }

  const url = `https://iptvn.idc.md/api/json/login?settings=all`;
  const fields = {
    login: numLogin,
    pass: numPassword,
    softid: softid,
    cli_serial: deviceId
  };

  try {
    console.log(`[IDC Integration] Logging in via legacy API: account ${numLogin}, device ${deviceId}, softid ${softid}`);
    const response = await postMultipart(url, fields);
    const resObj = JSON.parse(response);

    if (resObj.error) {
      throw new Error(resObj.error.message || 'Ошибка авторизации');
    }

    const sid = resObj.sid;
    const sidName = resObj.sid_name || 'SSID';

    console.log(`[IDC Integration] Login successful! SSID = ${sid}`);

    // Save successful credentials and session to SQLite
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('idc_login', ?)").run(numLogin.toString());
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('idc_password', ?)").run(numPassword.toString());
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('idc_uuid', ?)").run(sid); // keep compatibility
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('idc_sid', ?)").run(sid);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('idc_sid_name', ?)").run(sidName);

    idcSid = sid;
    idcUuid = sid;

    return {
      success: true,
      uuid: sid,
      data: resObj
    };
  } catch (err) {
    console.error(`[IDC Integration] Login failed:`, err.message);
    throw err;
  }
};

// Fetch official channels from IDC
const fetchIdcChannels = async () => {
  const session = await getOrRefreshIdcSession();
  if (!session) {
    console.log('[IDC Integration] Skipping IDC aggregation: No active paired account.');
    return [];
  }

  try {
    const { sid, sidName } = session;
    console.log(`[IDC Integration] Fetching channel list using ${sidName}=${sid}`);
    
    const passRow = db.prepare("SELECT value FROM settings WHERE key = 'idc_password'").get();
    const pin = passRow ? passRow.value : '';

    const url = `https://iptvn.idc.md/api/json/channel_list?${sidName}=${sid}&icon=png&show=all&protect_code=${pin}`;
    const response = await fetchText(url);
    const resObj = JSON.parse(response);

    if (resObj.error) {
      console.error('[IDC Integration] Channel list API error:', resObj.error.message);
      return [];
    }

    const groups = resObj.groups || [];
    console.log(`[IDC Integration] Loaded ${groups.length} channel categories from IDC.`);
    
    const aggregated = [];
    const seenIds = new Set();

    for (const group of groups) {
      const categoryName = group.name;
      const channels = group.channels || [];
      
      for (const c of channels) {
        if (c.is_video === 0) continue; // Skip radio channels
        
        const cId = c.id;
        if (!seenIds.has(cId)) {
          seenIds.add(cId);
          
          const visibleGroup = `📺 IDC: ${categoryName}`;
          
          aggregated.push({
            id: cId,
            name: c.name,
            group: visibleGroup,
            logo: c.icon ? `https://iptv.idc.md${c.icon}` : '',
            url: `https://iptvpay-svmorozoww.amvera.io/api/idc/stream?channel=${cId}`,
            originalUrl: ''
          });
        }
      }
    }

    console.log(`[IDC Integration] Extracted ${aggregated.length} unique video channels from categories.`);
    return aggregated;
  } catch (err) {
    console.error('[IDC Integration] Failed to fetch IDC channels:', err.message);
  }
  return [];
};

// Core Playlist Aggregator and Scanner
const rebuildPlaylist = async () => {
  console.log('[Playlist Manager] Starting playlist rebuild...');
  
  let aggregatedChannels = [];

  // 1. Fetch IDC Premium Channels (Separate folder)
  const idcChannels = await fetchIdcChannels();
  aggregatedChannels = [...aggregatedChannels, ...idcChannels];

  // 2. Fetch Open sources and check health in parallel batches
  for (const source of OPEN_SOURCES) {
    try {
      console.log(`[Playlist Manager] Fetching source: ${source.name}`);
      const text = await fetchText(source.url);
      const parsed = parseM3U(text);
      console.log(`[Playlist Manager] Parsed ${parsed.length} channels. Performing health check...`);
      
      // Batch Health Check (concurrency: 15 to stay extremely lightweight on our ранимый server!)
      const batchSize = 15;
      for (let i = 0; i < parsed.length; i += batchSize) {
        const batch = parsed.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(async (c) => {
          const isAlive = await checkStreamHealth(c.url);
          return isAlive ? c : null;
        }));

        // Add responsive channels
        results.forEach(c => {
          if (c) {
            aggregatedChannels.push({
              name: c.name,
              group: categorizeChannel(c.name),
              logo: c.logo,
              url: c.url
            });
          }
        });
      }
    } catch (err) {
      console.error(`[Playlist Manager] Failed to process ${source.name}:`, err.message);
    }
  }

  // 3. Generate structured M3U file
  let m3uText = '#EXTM3U\n';
  for (const c of aggregatedChannels) {
    m3uText += `#EXTINF:-1 tvg-logo="${c.logo}" group-title="${c.group}",${c.name}\n${c.url}\n`;
  }

  fs.writeFileSync(PLAYLIST_CACHE_FILE, m3uText, 'utf8');
  console.log(`[Playlist Manager] Successfully rebuilt playlist. Total active channels: ${aggregatedChannels.length}`);
  return aggregatedChannels.length;
};

module.exports = {
  rebuildPlaylist,
  getOrRegisterIdcUuid,
  fetchIdcChannels,
  updateIdcSession,
  loginIdc,
  getOrRefreshIdcSession,
  PLAYLIST_CACHE_FILE
};
