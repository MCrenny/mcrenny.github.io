const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

// Initialize DB
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      telegram_id TEXT,
      status TEXT DEFAULT 'active', -- active, inactive, expired
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: add telegram_id if it doesn't exist
  db.run("ALTER TABLE keys ADD COLUMN telegram_id TEXT", (err) => {});
  // Migration: add expires_at if it doesn't exist
  db.run("ALTER TABLE keys ADD COLUMN expires_at DATETIME", (err) => {});
});

// Function to generate a new key linked to a telegram user with duration in days
const generateKey = (telegramId = null, durationDays = 30) => {
  return new Promise((resolve, reject) => {
    const newKey = 'VIP-' + Math.random().toString(36).substring(2, 8).toUpperCase() + '-' + Date.now().toString().slice(-4);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);
    
    db.run(`INSERT INTO keys (key, telegram_id, expires_at) VALUES (?, ?, ?)`, 
      [newKey, telegramId, expiresAt.toISOString()], function(err) {
      if (err) reject(err);
      else resolve(newKey);
    });
  });
};

// Function to get existing key by telegram ID
const getKeyByTelegramId = (telegramId) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT key FROM keys WHERE telegram_id = ? ORDER BY created_at DESC LIMIT 1`, [telegramId], (err, row) => {
      if (err) reject(err);
      else resolve(row ? row.key : null);
    });
  });
};

// Function to verify key with expiration check
const verifyKey = (key) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM keys WHERE key = ?`, [key], (err, row) => {
      if (err) reject(err);
      else if (row) {
        const now = new Date();
        const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
        
        if (row.status === 'active' && (!expiresAt || expiresAt > now)) {
          resolve(true);
        } else {
          resolve(false);
        }
      } else {
        resolve(false);
      }
    });
  });
};

module.exports = {
  db,
  generateKey,
  verifyKey,
  getKeyByTelegramId
};
