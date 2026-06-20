import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import input from 'input';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const apiId = 2040;
  const apiHash = "b18441a1ff607e10a989891a5462e627";

  const stringSession = new StringSession('');

  console.log('Инициализация клиента...');
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
    deviceModel: 'Desktop',
    systemVersion: 'Windows 10',
    appVersion: '4.6.3',
    langCode: 'en',
    systemLangCode: 'en-US',
    langPack: 'tdesktop',
  });

  await client.start({
    phoneNumber: async () => await input.text('Введите номер телефона (с кодом страны, например +7...): '),
    password: async () => await input.text('Введите пароль двухфакторной аутентификации (если есть): '),
    phoneCode: async () => await input.text('Введите код подтверждения из Telegram: '),
    onError: (err) => console.log(err),
  });

  console.log('Успешный вход!');
  const sessionString = client.session.save();
  console.log('\n----------------------------------------');
  console.log('ВАША СТРОКА СЕССИИ (TELEGRAM_SESSION):');
  console.log(sessionString);
  console.log('----------------------------------------\n');
  console.log('Скопируйте эту строку и добавьте её в ваш файл .env в формате:');
  console.log(`TELEGRAM_SESSION="${sessionString}"`);
  console.log(`TELEGRAM_API_ID="${apiId}"`);
  console.log(`TELEGRAM_API_HASH="${apiHash}"`);
  console.log('\nВы можете закрыть этот скрипт (Ctrl+C).');
  await client.disconnect();
}

run().catch(console.error);
