import { saveSetting } from './db.js';
import { runAutoblog } from './autoblog.js';

async function main() {
  console.log('Сброс таймера автоблога...');
  await saveSetting('last_autoblog_run', '0');
  console.log('Запуск генерации...');
  await runAutoblog('iptv');
  console.log('Готово!');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
