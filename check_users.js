const Database = require('better-sqlite3');
const fs = require('fs');

function checkDb(dbPath, name) {
  if (!fs.existsSync(dbPath)) return;
  try {
    const db = new Database(dbPath, { readonly: true });
    console.log(`\n=== [${name}] ===`);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    console.log('Tables:', tables);
    
    if (tables.includes('keys')) {
      const keys = db.prepare("SELECT * FROM keys").all();
      console.log(`Total keys: ${keys.length}`);
      
      const now = Date.now();
      let active = 0;
      keys.forEach(k => {
        if (!k.expiresAt || k.expiresAt > now) {
          active++;
        }
      });
      console.log(`Active keys: ${active}`);
      // Try to find users
      let totalUsers = 0;
      keys.forEach(k => { if(k.userId) totalUsers++; });
      console.log(`Keys with bound user/device: ${totalUsers}`);
    }
    
  } catch (e) {
    console.log(`Error reading ${name}:`, e.message);
  }
}

try { console.log('AutoSputnik Root:', fs.readdirSync('e:/Мой Автокалендарь').filter(f => f.includes('sqlite'))); } catch(e){}
try { console.log('AutoSputnik Server:', fs.readdirSync('e:/Мой Автокалендарь/server').filter(f => f.includes('sqlite'))); } catch(e){}

checkDb('e:/Мой Автокалендарь/server/database.sqlite', 'AutoSputnik Server DB');
checkDb('e:/app.new_backup/server/database.sqlite', 'StreamLume Server DB');
