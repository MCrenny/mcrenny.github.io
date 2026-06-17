const Database = require('better-sqlite3');
const path = require('path');

const fs = require('fs');

let dbPath = process.env.DB_PATH;
if (!dbPath) {
  if (fs.existsSync('/data')) {
    dbPath = '/data/database.sqlite';
    // Migration: Copy database from current directory if it exists and /data doesn't have it
    const localDbPath = path.resolve(process.cwd(), 'database.sqlite');
    if (!fs.existsSync(dbPath) && fs.existsSync(localDbPath)) {
      try {
        fs.copyFileSync(localDbPath, dbPath);
        console.log('[DB Migration] Copied database from local workspace to persistent volume.');
      } catch (err) {
        console.error('[DB Migration] Failed to copy database:', err.message);
      }
    }
  } else {
    dbPath = path.resolve(process.cwd(), 'database.sqlite');
  }
}

console.log('[DB] Database path:', dbPath);
const db = new Database(dbPath);

// Initialize DB
db.exec(`
  CREATE TABLE IF NOT EXISTS keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    telegram_id TEXT,
    status TEXT DEFAULT 'active',
    expires_at DATETIME,
    is_trial INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS processed_orders (
    order_id TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS contacted_users (
    telegram_user_id TEXT PRIMARY KEY,
    username TEXT,
    contacted_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS processed_messages (
    chat_id TEXT,
    message_id INTEGER,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (chat_id, message_id)
  );

  CREATE TABLE IF NOT EXISTS dynamic_chats (
    username TEXT PRIMARY KEY,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration: add columns if they don't exist
try { db.exec("ALTER TABLE keys ADD COLUMN telegram_id TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE keys ADD COLUMN expires_at DATETIME"); } catch (e) {}
try { db.exec("ALTER TABLE keys ADD COLUMN is_trial INTEGER DEFAULT 0"); } catch (e) {}

const generateKey = (telegramId = null, durationDays = 30, isTrial = false) => {
  const prefix = isTrial ? 'TRIAL-' : 'VIP-';
  const newKey = prefix + Math.random().toString(36).substring(2, 8).toUpperCase() + '-' + Date.now().toString().slice(-4);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + durationDays);
  
  const stmt = db.prepare('INSERT INTO keys (key, telegram_id, expires_at, is_trial) VALUES (?, ?, ?, ?)');
  stmt.run(newKey, telegramId, expiresAt.toISOString(), isTrial ? 1 : 0);
  return Promise.resolve(newKey);
};

const hasUsedTrial = (telegramId) => {
  const stmt = db.prepare('SELECT id FROM keys WHERE telegram_id = ? AND is_trial = 1');
  const row = stmt.get(telegramId);
  return Promise.resolve(!!row);
};

const getKeyByTelegramId = (telegramId) => {
  const stmt = db.prepare('SELECT key FROM keys WHERE telegram_id = ? ORDER BY created_at DESC LIMIT 1');
  const row = stmt.get(telegramId);
  return Promise.resolve(row ? row.key : null);
};

const verifyKey = (key) => {
  if (!key) return Promise.resolve(false);
  const cleanKey = key.trim().toUpperCase();
  
  // Safe entry bypass for moderators or testing
  if (
    cleanKey === 'VIP-VR406Z-3589' || 
    cleanKey.startsWith('TEST-') || 
    cleanKey.startsWith('VIP-TEST-') ||
    cleanKey === 'VIP-TEST'
  ) {
    console.log(`[DB] Special bypass entry granted for key: ${key}`);
    return Promise.resolve(true);
  }

  const stmt = db.prepare('SELECT * FROM keys WHERE key = ?');
  const row = stmt.get(key.trim());
  
  if (row) {
    const now = new Date();
    const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
    
    if (row.status === 'active' && (!expiresAt || expiresAt > now)) {
      return Promise.resolve(true);
    }
  }
  return Promise.resolve(false);
};

const getAllTelegramIds = () => {
  const stmt = db.prepare('SELECT DISTINCT telegram_id FROM keys WHERE telegram_id IS NOT NULL');
  const rows = stmt.all();
  return Promise.resolve(rows.map(row => row.telegram_id));
};

const isOrderProcessed = (orderId) => {
  const stmt = db.prepare('SELECT order_id FROM processed_orders WHERE order_id = ?');
  return Promise.resolve(!!stmt.get(orderId.toString()));
};

const markOrderProcessed = (orderId) => {
  const stmt = db.prepare('INSERT INTO processed_orders (order_id) VALUES (?)');
  stmt.run(orderId.toString());
  return Promise.resolve();
};

const isUserContacted = (telegramUserId) => {
  const stmt = db.prepare('SELECT telegram_user_id FROM contacted_users WHERE telegram_user_id = ?');
  return Promise.resolve(!!stmt.get(telegramUserId.toString()));
};

const markUserAsContacted = (telegramUserId, username) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO contacted_users (telegram_user_id, username) VALUES (?, ?)');
  stmt.run(telegramUserId.toString(), username || null);
  return Promise.resolve();
};

const isMessageProcessed = (chatId, messageId) => {
  const stmt = db.prepare('SELECT chat_id FROM processed_messages WHERE chat_id = ? AND message_id = ?');
  return Promise.resolve(!!stmt.get(chatId.toString(), parseInt(messageId)));
};

const markMessageAsProcessed = (chatId, messageId) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO processed_messages (chat_id, message_id) VALUES (?, ?)');
  stmt.run(chatId.toString(), parseInt(messageId));
  return Promise.resolve();
};

const getDynamicChats = () => {
  const stmt = db.prepare('SELECT username FROM dynamic_chats');
  const rows = stmt.all();
  return rows.map(r => r.username);
};

const saveDynamicChat = (username) => {
  const stmt = db.prepare('INSERT OR IGNORE INTO dynamic_chats (username) VALUES (?)');
  stmt.run(username.toLowerCase());
  return Promise.resolve();
};

module.exports = {
  db,
  generateKey,
  verifyKey,
  getKeyByTelegramId,
  hasUsedTrial,
  getAllTelegramIds,
  isOrderProcessed,
  markOrderProcessed,
  isUserContacted,
  markUserAsContacted,
  isMessageProcessed,
  markMessageAsProcessed,
  getDynamicChats,
  saveDynamicChat
};
