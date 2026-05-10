const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new Database(dbPath);

// Initialize DB
db.exec(`
  CREATE TABLE IF NOT EXISTS keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    telegram_id TEXT,
    status TEXT DEFAULT 'active',
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Migration: add columns if they don't exist
try { db.exec("ALTER TABLE keys ADD COLUMN telegram_id TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE keys ADD COLUMN expires_at DATETIME"); } catch (e) {}

const generateKey = (telegramId = null, durationDays = 30) => {
  const newKey = 'VIP-' + Math.random().toString(36).substring(2, 8).toUpperCase() + '-' + Date.now().toString().slice(-4);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + durationDays);
  
  const stmt = db.prepare('INSERT INTO keys (key, telegram_id, expires_at) VALUES (?, ?, ?)');
  stmt.run(newKey, telegramId, expiresAt.toISOString());
  return Promise.resolve(newKey);
};

const getKeyByTelegramId = (telegramId) => {
  const stmt = db.prepare('SELECT key FROM keys WHERE telegram_id = ? ORDER BY created_at DESC LIMIT 1');
  const row = stmt.get(telegramId);
  return Promise.resolve(row ? row.key : null);
};

const verifyKey = (key) => {
  const stmt = db.prepare('SELECT * FROM keys WHERE key = ?');
  const row = stmt.get(key);
  
  if (row) {
    const now = new Date();
    const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
    
    if (row.status === 'active' && (!expiresAt || expiresAt > now)) {
      return Promise.resolve(true);
    }
  }
  return Promise.resolve(false);
};

module.exports = {
  db,
  generateKey,
  verifyKey,
  getKeyByTelegramId
};
