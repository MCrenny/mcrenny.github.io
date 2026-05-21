require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Telegraf, Markup } = require('telegraf');
const { CryptoPay } = require('@foile/crypto-pay-api');
const { db, generateKey, verifyKey, getKeyByTelegramId, hasUsedTrial, getAllTelegramIds, isOrderProcessed, markOrderProcessed } = require('./db');
const { rebuildPlaylist, PLAYLIST_CACHE_FILE } = require('./playlist_manager');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 80;
const BOT_TOKEN = process.env.BOT_TOKEN;
const CRYPTO_PAY_TOKEN = process.env.CRYPTO_PAY_TOKEN;

// Диагностика при старте
console.log('[StreamLume] Starting server...');
console.log(`[StreamLume] PORT = ${PORT}`);
console.log(`[StreamLume] BOT_TOKEN = ${BOT_TOKEN ? 'OK (' + BOT_TOKEN.substring(0, 10) + '...)' : 'NOT SET ⚠️'}`);
console.log(`[StreamLume] CRYPTO_PAY_TOKEN = ${CRYPTO_PAY_TOKEN ? 'OK' : 'NOT SET (crypto payments disabled)'}`);
console.log(`[StreamLume] FK_MERCHANT_ID = ${process.env.FK_MERCHANT_ID ? process.env.FK_MERCHANT_ID : 'NOT SET ⚠️'}`);
console.log(`[StreamLume] FK_SECRET_1 = ${process.env.FK_SECRET_1 ? 'LOADED (len: ' + process.env.FK_SECRET_1.length + ', preview: ' + process.env.FK_SECRET_1.substring(0, 2) + '...' + process.env.FK_SECRET_1.slice(-2) + ')' : 'NOT SET ⚠️'}`);
console.log(`[StreamLume] FK_SECRET_2 = ${process.env.FK_SECRET_2 ? 'LOADED (len: ' + process.env.FK_SECRET_2.length + ', preview: ' + process.env.FK_SECRET_2.substring(0, 2) + '...' + process.env.FK_SECRET_2.slice(-2) + ')' : 'NOT SET ⚠️'}`);

// Serve landing page as static files (from root or landing folder)
app.use(express.static(path.join(__dirname, 'landing')));
app.use(express.static(__dirname));

// Root route to serve landing page
app.get('/', (req, res) => {
  const fs = require('fs');
  const possiblePaths = [
    path.join(__dirname, 'landing/index.html'),
    path.join(__dirname, 'index.html'),
    path.resolve('./index.html'),
    path.resolve('./landing/index.html')
  ];
  
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return res.sendFile(p);
    }
  }
  
  res.send('<h1>StreamLume Server is Online</h1><p>Landing page files not found. Please upload index.html to the root directory.</p>');
});

const FK_MERCHANT_ID = process.env.FK_MERCHANT_ID;
const FK_SECRET_1 = process.env.FK_SECRET_1;
const FK_SECRET_2 = process.env.FK_SECRET_2;

const ADMIN_ID = 329742659; // Твой ID
const SERVER_URL = `https://iptvpay-svmorozoww.amvera.io`; // Твой адрес Amvera
const DOWNLOAD_URL = 'https://t.me/StreamLumeApp/1';

// Инициализируем CryptoPay только если токен задан — иначе сервер крашится при старте
let cryptoPay = null;
if (CRYPTO_PAY_TOKEN) {
  try {
    cryptoPay = new CryptoPay(CRYPTO_PAY_TOKEN);
    console.log('[StreamLume] CryptoPay initialized OK');
  } catch (e) {
    console.error('[StreamLume] CryptoPay init error:', e.message);
  }
}

// --- Express API ---
app.post('/api/verify', async (req, res) => {
  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ error: 'Key is required' });
  }

  try {
    const isValid = await verifyKey(key);
    if (isValid) {
      res.json({ valid: true, message: 'Ключ успешно проверен' });
    } else {
      res.json({ valid: false, message: 'Неверный или неактивный ключ' });
    }
  } catch (error) {
    console.error('Error verifying key:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- API Playlist cached retrieval ---
app.get('/api/playlist', async (req, res) => {
  const { key } = req.query;
  if (!key) {
    return res.status(401).send('#EXTM3U\n#EXTINF:-1, Пожалуйста введите Premium-ключ в StreamLume!\nhttp://iptvpay-svmorozoww.amvera.io/auth_needed');
  }

  try {
    const isValid = await verifyKey(key);
    if (!isValid) {
      return res.status(401).send('#EXTM3U\n#EXTINF:-1, Неверный или истекший Premium-ключ!\nhttp://iptvpay-svmorozoww.amvera.io/auth_invalid');
    }

    const fs = require('fs');
    const servePlaylistWithKey = (filePath, response) => {
      const content = fs.readFileSync(filePath, 'utf8');
      response.setHeader('Content-Type', 'audio/x-mpegurl');
      response.setHeader('Content-Disposition', 'attachment; filename="playlist.m3u"');
      return response.send(content);
    };


    if (fs.existsSync(PLAYLIST_CACHE_FILE)) {
      return servePlaylistWithKey(PLAYLIST_CACHE_FILE, res);
    } else {
      // If cache file is missing, trigger rebuild and serve
      await rebuildPlaylist();
      if (fs.existsSync(PLAYLIST_CACHE_FILE)) {
        return servePlaylistWithKey(PLAYLIST_CACHE_FILE, res);
      }
      return res.status(500).send('#EXTM3U\n#EXTINF:-1, Ошибка генерации плейлиста на сервере\nhttp://iptvpay-svmorozoww.amvera.io/error');
    }
  } catch (e) {
    console.error('Playlist API error:', e);
    res.status(500).send('Error');
  }
});

// --- Dynamic IDC Stream redirection (Disabled) ---
app.get(['/api/idc/stream', '/api/idc/stream/video.ts'], (req, res) => {
  res.status(410).send('Интеграция с IDC отключена. Пожалуйста, обновите плейлист в приложении.');
});

// --- Redirects for FreeKassa ---
app.get('/success', (req, res) => {
  res.redirect('https://t.me/StreamLumeApp');
});

app.get('/fail', (req, res) => {
  res.redirect('https://t.me/StreamLumeApp');
});

// --- Free-Kassa Webhook ---
app.all('/api/webhooks/freekassa', async (req, res) => {
  console.log('[FreeKassa Webhook] Received request:', req.method);
  console.log('[FreeKassa Webhook] Headers:', req.headers);
  console.log('[FreeKassa Webhook] Body:', req.body);
  console.log('[FreeKassa Webhook] Query:', req.query);

  const merchantId = req.body?.MERCHANT_ID || req.query?.MERCHANT_ID || req.body?.merchant_id || req.query?.merchant_id;
  const amount = req.body?.AMOUNT || req.query?.AMOUNT || req.body?.amount || req.query?.amount;
  const merchantOrderId = req.body?.MERCHANT_ORDER_ID || req.query?.MERCHANT_ORDER_ID || req.body?.merchant_order_id || req.query?.merchant_order_id;
  const sign = req.body?.SIGN || req.query?.SIGN || req.body?.sign || req.query?.sign;

  if (!merchantId || !merchantOrderId || !sign) {
    console.error('[FreeKassa Webhook] Missing required parameters');
    return res.status(400).send('Bad Request');
  }

  const crypto = require('crypto');
  const checkSign = crypto.createHash('md5')
    .update(`${merchantId}:${amount}:${FK_SECRET_2}:${merchantOrderId}`)
    .digest('hex');

  if (sign.toLowerCase() !== checkSign.toLowerCase()) {
    console.error(`[FreeKassa Webhook] Signature mismatch. Received: ${sign}, Expected: ${checkSign}`);
    return res.status(400).send('Invalid signature');
  }

  try {
    if (await isOrderProcessed(merchantOrderId)) {
      console.log(`[FreeKassa Webhook] Order ${merchantOrderId} already processed.`);
      return res.send('YES');
    }

    const [telegramId, duration] = merchantOrderId.split('_');
    const newKey = await generateKey(telegramId, parseInt(duration));
    await markOrderProcessed(merchantOrderId);

    await bot.telegram.sendMessage(telegramId, `✅ *Оплата подтверждена (Free-Kassa)!*\n\nТвой Premium-доступ активирован.\n\nКлюч: \`${newKey}\``, {
      parse_mode: 'Markdown'
    });

    console.log(`[FreeKassa Webhook] Order ${merchantOrderId} successfully processed. Key generated: ${newKey}`);
    res.send('YES');
  } catch (error) {
    console.error('[FreeKassa Webhook] Error:', error);
    res.status(500).send('Error');
  }
});

// --- Telegram Bot ---
const bot = new Telegraf(BOT_TOKEN);

const mainKeyboard = Markup.keyboard([
  ['💎 Получить доступ', '🎁 Пробный период'],
  ['🔑 Мой ключ', '📖 Инструкция'],
  ['🆘 Поддержка']
]).resize();

bot.start((ctx) => {
  ctx.reply(`Привет, ${ctx.from.first_name}! 👋\n\nДобро пожаловать в StreamLume — премиальное IPTV нового поколения.\n\nИспользуй меню ниже, чтобы получить доступ к сотням каналов в HD качестве.`, mainKeyboard);
  
  if (ctx.from.id === ADMIN_ID) {
    ctx.reply('👑 О, хозяин! Тебе доступна команда /admin');
  }
});

// --- Admin Panel ---
bot.command('admin', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const adminKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔑 Создать VIP-ключ (1 год)', 'admin_gen_key')],
    [Markup.button.callback('📊 Статистика', 'admin_stats')]
  ]);

  ctx.reply('🛡 Админ-панель StreamLume:', adminKeyboard);
});

bot.action('admin_gen_key', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const key = await generateKey(null, 365);
  ctx.reply(`✅ Создан админ-ключ на 1 год:\n\n\`${key}\``, { parse_mode: 'Markdown' });
  await ctx.answerCbQuery();
});

bot.action('admin_stats', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const row = db.prepare("SELECT COUNT(*) as count FROM keys").get();
  const trialRow = db.prepare("SELECT COUNT(*) as count FROM keys WHERE is_trial = 1").get();
  ctx.reply(`📊 *Статистика StreamLume:*\n\nВсего ключей: ${row.count}\nИз них пробных: ${trialRow.count}`, { parse_mode: 'Markdown' });
  await ctx.answerCbQuery();
});

bot.hears('🎁 Пробный период', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  const alreadyUsed = await hasUsedTrial(telegramId);

  if (alreadyUsed) {
    ctx.reply('❌ Вы уже использовали пробный период.');
    return;
  }

  const trialKey = await generateKey(telegramId, 3, true);
  ctx.reply(`✅ Ваш пробный доступ на 3 дня активирован!\n\nКлюч: \`${trialKey}\`\n\nВведите этот ключ в приложении для доступа.`, { parse_mode: 'Markdown' });
});

bot.hears('💎 Получить доступ', async (ctx) => {
  const paymentMethods = Markup.inlineKeyboard([
    [Markup.button.callback('💳 Картой РФ (Фрикасса)', 'method_fk')],
    [Markup.button.callback('🪙 Криптовалютой (USDT / TON)', 'method_crypto')]
  ]);

  ctx.reply('Выберите удобный способ оплаты:', paymentMethods);
});

bot.action('method_fk', async (ctx) => {
  const tariffs = Markup.inlineKeyboard([
    [Markup.button.callback('🌙 1 месяц — 300 ₽', 'pay_fk_30_300')],
    [Markup.button.callback('🌟 3 месяца — 800 ₽', 'pay_fk_90_800')],
    [Markup.button.callback('👑 1 год — 2500 ₽', 'pay_fk_365_2500')]
  ]);

  ctx.reply('Выберите тарифный план (Оплата через Free-Kassa):', tariffs);
  await ctx.answerCbQuery();
});

bot.action(/pay_fk_(\d+)_(\d+)/, async (ctx) => {
  const duration = parseInt(ctx.match[1]);
  const amount = parseInt(ctx.match[2]);
  const telegramId = ctx.from.id;
  const orderId = `${telegramId}_${duration}_${Date.now()}`;

  if (!FK_MERCHANT_ID || !FK_SECRET_1) {
    ctx.reply('❌ Оплата через Free-Kassa временно не настроена.');
    return;
  }

  try {
    const crypto = require('crypto');
    const currency = 'RUB';
    const rawSignString = `${FK_MERCHANT_ID}:${amount}:${FK_SECRET_1}:${currency}:${orderId}`;
    
    // Mask secret for secure logging
    const maskedSecret = FK_SECRET_1.substring(0, 2) + '...' + FK_SECRET_1.slice(-2);
    const maskedSignString = `${FK_MERCHANT_ID}:${amount}:${maskedSecret}:${currency}:${orderId}`;
    
    console.log(`[FreeKassa Link] Creating payment url for ${orderId}. Hashing string pattern: "${maskedSignString}"`);
    
    const sign = crypto.createHash('md5')
      .update(rawSignString)
      .digest('hex');

    const payUrl = `https://pay.freekassa.net/?m=${FK_MERCHANT_ID}&oa=${amount}&currency=${currency}&o=${orderId}&s=${sign}&us_login=${telegramId}`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url('💳 Перейти к оплате (Free-Kassa)', payUrl)],
      [Markup.button.callback('🔄 Я оплатил', 'check_payment_manual')]
    ]);

    ctx.reply(`Счет на оплату через Free-Kassa создан!\n\nСумма: ${amount} ₽\nТариф: ${duration} дней\n\nНажми кнопку ниже для оплаты. Ключ придет автоматически.`, keyboard);
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Free-Kassa Error:', error);
    ctx.reply('Ошибка при создании счета Free-Kassa.');
  }
});

bot.action('method_crypto', async (ctx) => {
  const tariffs = Markup.inlineKeyboard([
    [Markup.button.callback('🌙 1 месяц — 3 USDT', 'pay_30_3')],
    [Markup.button.callback('🌟 3 месяца — 8 USDT', 'pay_90_8')],
    [Markup.button.callback('👑 1 год — 25 USDT', 'pay_365_25')]
  ]);

  ctx.reply('Выберите тарифный план для оплаты в USDT:', tariffs);
  await ctx.answerCbQuery();
});

bot.action('check_payment_manual', (ctx) => {
  ctx.reply('⏳ Проверка обычно занимает от 1 до 5 минут. Ключ придет в этот чат автоматически.');
  ctx.answerCbQuery();
});

bot.action(/pay_(\d+)_(\d+)/, async (ctx) => {
  const duration = parseInt(ctx.match[1]);
  const amount = parseInt(ctx.match[2]);
  const telegramId = ctx.from.id;

  if (!cryptoPay) {
    ctx.reply('❌ Оплата криптовалютой временно недоступна. Попробуйте оплатить картой через Free-Kassa.');
    await ctx.answerCbQuery();
    return;
  }
  try {
    await ctx.answerCbQuery();
    const invoice = await cryptoPay.createInvoice('USDT', amount, {
      description: `StreamLume Premium: ${duration} дней`,
      payload: JSON.stringify({ telegramId, duration })
    });

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url('💳 Оплатить в CryptoBot', invoice.pay_url)],
      [Markup.button.callback('✅ Проверить оплату', `check_${invoice.invoice_id}`)]
    ]);

    ctx.reply(`Счет на оплату создан!\n\nСумма: ${amount} USDT\nТариф: ${duration} дней`, keyboard);
  } catch (error) {
    console.error('CryptoPay error:', error);
    ctx.reply('Ошибка при создании счета.');
  }
});

bot.action(/check_(\d+)/, async (ctx) => {
  const invoiceId = parseInt(ctx.match[1]);
  if (!cryptoPay) {
    return await ctx.answerCbQuery('Криптоплатежи не настроены.', { show_alert: true });
  }
  try {
    const invoices = await cryptoPay.getInvoices({ invoice_ids: invoiceId });
    const invoice = invoices[0];

    if (invoice && invoice.status === 'paid') {
      const orderId = `crypto_${invoiceId}`;
      if (await isOrderProcessed(orderId)) {
        return await ctx.answerCbQuery('Оплата уже была зачислена!', { show_alert: true });
      }

      const { telegramId, duration } = JSON.parse(invoice.payload);
      const newKey = await generateKey(telegramId, duration);
      await markOrderProcessed(orderId);

      await ctx.answerCbQuery('Оплата подтверждена!');
      await ctx.editMessageText(`✅ *Оплата прошла успешно!*\n\nТвой Premium-доступ активирован.\n\nКлюч: \`${newKey}\``, { parse_mode: 'Markdown' });
    } else {
      await ctx.answerCbQuery('Оплата пока не поступила...', { show_alert: true });
    }
  } catch (error) {
    console.error('Check payment error:', error);
    ctx.reply('Ошибка при проверке оплаты.');
  }
});

bot.hears('🔑 Мой ключ', async (ctx) => {
  const key = await getKeyByTelegramId(ctx.from.id);
  if (key) {
    ctx.reply(`Твой действующий ключ: \`${key}\``, { parse_mode: 'Markdown' });
  } else {
    ctx.reply('У тебя пока нет активного ключа. Нажми «Получить доступ».');
  }
});

bot.hears('📖 Инструкция', async (ctx) => {
  const path = require('path');
  const fs = require('fs');
  const apkPath = path.join(__dirname, 'landing/StreamLume.apk');

  await ctx.reply('🚀 *Как начать смотреть StreamLume:*\n\n' +
    '1. Установи APK-файл ниже на свой Android-телефон или ТВ.\n' +
    '2. Запусти приложение и введи свой Premium-ключ.\n\n' +
    '📺 Приятного просмотра!', { parse_mode: 'Markdown' });

  if (fs.existsSync(apkPath)) {
    try {
      await ctx.replyWithDocument({ source: apkPath, filename: 'StreamLume.apk' });
    } catch (e) {
      console.error('Failed to send APK:', e);
      ctx.reply(`🚀 Скачайте приложение по ссылкам:\n\n1. [Google Drive](https://drive.google.com/file/d/1M4YMuoXpXHAn-Sb1ATIwPXoK6i4rSYSR/view?usp=sharing)\n2. [Cloud Mail.ru](https://cloud.mail.ru/public/CEQD/4MGv46WnS)`, { parse_mode: 'Markdown' });
    }
  } else {
    try {
      await ctx.reply(`🚀 Скачайте приложение прямо здесь или по ссылкам:\n\n1. [Google Drive](https://drive.google.com/file/d/1tUthdGdyw8JX9_EKf0mcVmLiQjxztiuL/view?usp=sharing)\n2. [Cloud Mail.ru](https://cloud.mail.ru/public/3T7q/GcniohxwC)`, { parse_mode: 'Markdown' });
      
      // Отправка APK файла напрямую через Telegram
      await ctx.replyWithDocument('BQACAgIAAxkBAA07agijg_t85kEjqw6OYQER0BJlnhcAAi6bAAK0-khIfr9HSAFiTAo7BA', {
        caption: '📱 Установочный файл StreamLume (v1.0.0)'
      });
    } catch (err) {
      console.error('Error sending document:', err.message);
      ctx.reply('Не удалось отправить файл напрямую, используйте ссылки выше.');
    }
  }
});

bot.hears('🆘 Поддержка', (ctx) => {
  ctx.reply('По всем вопросам пишите нашему администратору: @ZDedMorozZ');
});

// Временный обработчик для получения file_id (скинь боту APK, чтобы получить код)
// Handler moved inside the block below

// Start servers
app.listen(PORT, () => {
  console.log(`Express server is running on port ${PORT}`);
  console.log(`--- DEPLOYMENT VERIFICATION: Version 1.0.7 ACTIVE ---`);

  // Background initialization to prevent blocking the thread
  setTimeout(async () => {
    try {
      console.log('[StreamLume Startup] Rebuilding master playlist in background...');
      await rebuildPlaylist();
    } catch (e) {
      console.error('[StreamLume Startup] Background init error:', e.message);
    }
  }, 1000);

  // Auto-rebuild playlist every 6 hours
  setInterval(async () => {
    try {
      console.log('[Playlist Scheduler] Rebuilding master playlist...');
      await rebuildPlaylist();
    } catch (e) {
      console.error('[Playlist Scheduler] Periodic rebuild error:', e.message);
    }
  }, 6 * 60 * 60 * 1000);
});

if (BOT_TOKEN) {
  // Команды плейлиста и IDC
  bot.command('update_playlist', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.reply('⏳ Запускаю пересборку и проверку плейлиста... Это может занять до 1-2 минут.');
    try {
      const count = await rebuildPlaylist();
      ctx.reply(`✅ Плейлист успешно обновлен! Всего активных каналов: ${count}`);
    } catch (e) {
      console.error(e);
      ctx.reply(`❌ Ошибка обновления плейлиста: ${e.message}`);
    }
  });

  // Интеграция с IDC отключена

  // Команды бота
  bot.command('broadcast', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const message = ctx.message.text.split(' ').slice(1).join(' ');
    if (!message) return ctx.reply('Использование: /broadcast [ваш текст]');
    const users = await getAllTelegramIds();
    let successCount = 0;
    for (const userId of users) {
      try {
        await bot.telegram.sendMessage(userId, `📢 *Уведомление от StreamLume:*\n\n${message}`, { parse_mode: 'Markdown' });
        successCount++;
      } catch (e) { console.error(`Failed to send message to ${userId}`); }
    }
    ctx.reply(`Рассылка завершена. Успешно отправлено: ${successCount} из ${users.length}`);
  });

  bot.command('id', (ctx) => {
    ctx.reply(`Твой Telegram ID: \`${ctx.from.id}\``, { parse_mode: 'Markdown' });
  });

  bot.command('check', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('Использование: /check [Telegram ID]');
    
    const targetId = args[1];
    const key = await getKeyByTelegramId(targetId);
    if (key) {
      ctx.reply(`Найден ключ для ID ${targetId}:\n\n\`${key}\``, { parse_mode: 'Markdown' });
    } else {
      ctx.reply(`Пользователь с ID ${targetId} не найден в базе или у него нет ключа.`);
    }
  });

  const launchBot = (retries = 10, delay = 8000) => {
    bot.launch().then(() => {
      console.log('Telegram bot is running');
    }).catch(err => {
      console.error('Error starting telegram bot:', err.message);
      if (retries > 0) {
        console.log(`[Telegram Bot] Retrying launch in ${delay/1000}s... (${retries} retries left)`);
        setTimeout(() => launchBot(retries - 1, delay), delay);
      } else {
        console.error('[Telegram Bot] Maximum launch retries reached. Bot is offline.');
      }
    });
  };
  launchBot();
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
