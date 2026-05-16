const sqlite = require('better-sqlite3');
const db = new sqlite('database.sqlite');
const keys = db.prepare('SELECT * FROM keys').all();
console.log('--- KEYS ---');
console.table(keys);
process.exit(0);
