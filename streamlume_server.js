require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Telegraf, Markup } = require('telegraf');
const { CryptoPay } = require('@foile/crypto-pay-api');
const { db, generateKey, verifyKey, getKeyByTelegramId, hasUsedTrial, getAllTelegramIds, isOrderProcessed, markOrderProcessed } = require('./db');
const { rebuildPlaylist, PLAYLIST_CACHE_FILE } = require('./playlist_manager');
const { startPartisanBot, botStatus, botLogs } = require('./partisan');
const { runAutoblog } = require('./autoblog');
const { runYouTubeBot } = require('./youtube_bot');

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Краш сервера при фатальных ошибках (например, отвал сессии Telegram) для авто-рестарта в Amvera
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION!', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION!', reason);
});

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

// Root route: отдаём TV web-app при ?msx=1 / ?tv=1, иначе лендинг.
// ВАЖНО: этот обработчик должен стоять ВЫШЕ express.static, иначе static
// перехватит / и вернёт лендинг. Это и есть рабочий MSX-механизм:
// MSX выполняет execute:.../?msx=1 и ТВ открывает Expo-приложение целиком.
app.get('/', (req, res, next) => {
  if (req.query.msx === '1' || req.query.tv === '1') {
    return res.sendFile(path.join(__dirname, 'tv', 'index.html'));
  }
  next();
});

// Serve landing page as static files (from root or landing folder)
app.use(express.static(path.join(__dirname, 'landing')));
app.use(express.static(__dirname));

app.use('/tv', express.static(path.join(__dirname, 'tv')));
app.use('/_expo', express.static(path.join(__dirname, 'tv', '_expo')));
app.use('/assets', express.static(path.join(__dirname, 'tv', 'assets')));

// Вспомогательная функция: парсит M3U из кэша в массив объектов каналов
const parseCachedPlaylist = () => {
    const fs = require('fs');
    const { PLAYLIST_CACHE_FILE } = require('./playlist_manager');
    if (!fs.existsSync(PLAYLIST_CACHE_FILE)) return [];
    const text = fs.readFileSync(PLAYLIST_CACHE_FILE, 'utf8');
    const channels = [];
    const lines = text.split('\n');
    let currentInfo = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXTINF:')) {
            const matchName = line.match(/,(.+)$/);
            const name = matchName ? matchName[1].trim() : 'Канал';
            const matchGroup = line.match(/group-title="([^"]+)"/);
            const group = matchGroup ? matchGroup[1].trim() : '📺 Общие';
            const matchLogo = line.match(/tvg-logo="([^"]+)"/);
            const logo = matchLogo ? matchLogo[1].trim() : '';
            currentInfo = { name, group, logo };
        } else if (line.startsWith('http') && currentInfo) {
            channels.push({ ...currentInfo, url: line });
            currentInfo = null;
        }
    }
    return channels;
};

// ============================================================
// MSX integration (рабочий механизм из коммита 7a66f6f, 21 июня).
// MSX грузит статический tv/start.json → tv/menu.json, чей ready.action
// выполняет execute:.../?msx=1 — и ТВ открывает Expo-приложение целиком
// в нативном браузере (интерфейс как в мобильном приложении).
// ============================================================
app.get(['/start.json', '/msx/start.json'], (req, res) => {
  res.sendFile(path.join(__dirname, 'tv', 'start.json'));
});

// Fallback for Root route if static files aren't found
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
      return res.sendFile(p, (err) => {
        if (err && !res.headersSent) res.status(404).send('Not found');
      });
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
app.post('/api/tv-log', (req, res) => {
  console.log('[TV Client]', req.body);
  res.sendStatus(200);
});

app.get('/api/admin/stats', (req, res) => {
  try {
    const dbase = require('./db.js');
    const tempDb = dbase.db;
    
    const keys = tempDb.prepare("SELECT * FROM keys").all();
    const now = Date.now();
    let active = 0;
    let bound = 0;
    keys.forEach(k => {
      if (!k.expiresAt || k.expiresAt > now) active++;
      if (k.userId) bound++;
    });
    
    res.json({ project: 'StreamLume', total_keys: keys.length, active_keys: active, bound_to_device: bound });
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.get('/api/partisan/status', (req, res) => {
  res.json({
    status: botStatus,
    logs: botLogs
  });
});

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
    return res.status(401).send('#EXTM3U\n#EXTINF:-1, Пожалуйста введите VIP-ключ в StreamLume!\nhttp://iptvpay-svmorozoww.amvera.io/auth_needed');
  }

  const cleanKey = key.trim().toUpperCase();
  // Block legacy free-access token — must buy a real key
  if (cleanKey === 'VIP-TEST' || cleanKey.startsWith('VIP-TEST-')) {
    return res.status(401).send('#EXTM3U\n#EXTINF:-1, Взломанный ключ. Пожалуйста купите @StreameLumeBot\nhttp://iptvpay-svmorozoww.amvera.io/auth_needed');
  }

  try {
    const isValid = await verifyKey(key);
    if (!isValid) {
      return res.status(401).send('#EXTM3U\n#EXTINF:-1, Неверный или истекший VIP-ключ!\nhttp://iptvpay-svmorozoww.amvera.io/auth_invalid');
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

  const fk_secret_2 = process.env.FK_SECRET_2 || '$zi52]@9I!U70MH';
  if (!fk_secret_2) {
    console.error('[FreeKassa Webhook] Критическая ошибка: FK_SECRET_2 не задан в .env! Платеж отклонен в целях безопасности.');
    return res.status(500).send('Webhook unconfigured');
  }

  const crypto = require('crypto');
  const checkSign = crypto.createHash('md5')
    .update(`${merchantId}:${amount}:${fk_secret_2}:${merchantOrderId}`)
    .digest('hex');

  if (sign.toLowerCase() !== checkSign.toLowerCase()) {
    console.error(`[FreeKassa Webhook] Signature mismatch. Received: ${sign}, Expected: ${checkSign}`);
    return res.status(400).send('Invalid signature');
  }

  try {
    const [telegramId, duration, expectedAmount] = merchantOrderId.split('_');
    if (expectedAmount && parseFloat(amount) < parseFloat(expectedAmount)) {
       console.error(`[FreeKassa Webhook] Invalid amount. Expected >= ${expectedAmount}, got ${amount}`);
       return res.status(400).send('Invalid amount');
    }

    if (await isOrderProcessed(merchantOrderId)) {
      console.log(`[FreeKassa Webhook] Order ${merchantOrderId} already processed.`);
      return res.send('YES');
    }

    const newKey = await generateKey(telegramId, parseInt(duration));
    await markOrderProcessed(merchantOrderId);

    await bot.telegram.sendMessage(telegramId, `✅ *Оплата подтверждена (Free-Kassa)!*\n\nТвой VIP-доступ активирован.\n\nКлюч: \`${newKey}\``, {
      parse_mode: 'Markdown'
    });

    console.log(`[FreeKassa Webhook] Order ${merchantOrderId} successfully processed. Key generated: ${newKey}`);
    res.send('YES');
  } catch (error) {
    console.error('[FreeKassa Webhook] Error:', error);
    res.status(500).send('Error');
  }
});

// --- YooMoney Webhook ---
const handleYooMoneyWebhook = async (req, res) => {
  console.log('[YooMoney Webhook] Received request:', req.method);
  console.log('[YooMoney Webhook] Body:', req.body);

  const {
    notification_type,
    operation_id,
    amount,
    currency,
    datetime,
    sender,
    codepro,
    label,
    sha1_hash
  } = req.body;

  if (!label || !sha1_hash) {
    console.error('[YooMoney Webhook] Missing required parameters');
    return res.status(400).send('Bad Request');
  }

  const { unaccepted } = req.body;
  if (codepro === 'true' || unaccepted === 'true') {
    console.log('[YooMoney Webhook] Payment is codepro or unaccepted. Ignoring.');
    return res.send('OK');
  }

  const crypto = require('crypto');
  const secret = process.env.YOOMONEY_NOTIFICATION_SECRET || 'F/DyVx3JaokGmWxELRq+fBGY';
  
  if (!secret) {
    console.error('[YooMoney Webhook] Критическая ошибка: YOOMONEY_NOTIFICATION_SECRET не задан в .env! Платеж отклонен в целях безопасности.');
    return res.status(500).send('Webhook unconfigured');
  }

  // Формула подписи: notification_type&operation_id&amount&currency&datetime&sender&codepro&notification_secret&label
  const signatureString = `${notification_type}&${operation_id}&${amount}&${currency}&${datetime}&${sender}&${codepro}&${secret}&${label}`;
  const checkSign = crypto.createHash('sha1').update(signatureString).digest('hex');

  if (sha1_hash.toLowerCase() !== checkSign.toLowerCase()) {
    console.error(`[YooMoney Webhook] Signature mismatch. Received: ${sha1_hash}, Expected: ${checkSign}`);
    return res.status(400).send('Invalid signature');
  }

  try {
    const [telegramId, duration, expectedAmount] = label.split('_');
    if (expectedAmount && parseFloat(amount) < parseFloat(expectedAmount)) {
       console.error(`[YooMoney Webhook] Invalid amount. Expected >= ${expectedAmount}, got ${amount}`);
       return res.status(400).send('Invalid amount');
    }

    if (await isOrderProcessed(label)) {
      console.log(`[YooMoney Webhook] Order ${label} already processed.`);
      return res.send('OK');
    }

    if (!telegramId || !duration) {
      console.error('[YooMoney Webhook] Invalid label format:', label);
      return res.status(400).send('Invalid label');
    }

    const newKey = await generateKey(telegramId, parseInt(duration));
    await markOrderProcessed(label);

    await bot.telegram.sendMessage(telegramId, `✅ *Оплата подтверждена (ЮMoney)!*\n\nТвой VIP-доступ активирован.\n\nКлюч: \`${newKey}\``, {
      parse_mode: 'Markdown'
    });

    console.log(`[YooMoney Webhook] Order ${label} successfully processed. Key generated: ${newKey}`);
    res.send('OK');
  } catch (error) {
    console.error('[YooMoney Webhook] Error:', error);
    res.status(500).send('Error');
  }
};

app.post('/api/webhooks/yoomoney', express.urlencoded({ extended: true }), handleYooMoneyWebhook);

// Резервный POST-обработчик на корне для форвардинга
app.post('/', express.urlencoded({ extended: true }), (req, res, next) => {
  if (req.body && req.body.notification_type) {
    return handleYooMoneyWebhook(req, res);
  }
  next();
});

// --- Telegram Bot ---
const bot = new Telegraf(BOT_TOKEN);

const mainKeyboard = Markup.keyboard([
  ['💎 Получить доступ', '🎁 Бесплатный доступ'],
  ['🔑 Мой ключ', '📖 Инструкция'],
  ['📺 Для Smart TV (Samsung/LG)', '🆘 Поддержка'],
  ['🤝 Пригласить друга']
]).resize();

bot.start(async (ctx) => {
  const payload = ctx.payload;
  
  if (payload && payload.startsWith('ref_')) {
    const referrerId = payload.replace('ref_', '');
    if (referrerId !== String(ctx.from.id)) {
      const alreadyUsed = await hasUsedTrial(String(ctx.from.id));
      if (!alreadyUsed) {
        // Выдаем триал приглашенному
        const freeKey = await generateKey(String(ctx.from.id), 7, true);
        ctx.reply(`✅ Вы перешли по приглашению друга!\n\nВам начислено 7 дней премиум-доступа (вместо 3).\n\nКлюч: \`${freeKey}\``, { parse_mode: 'Markdown' });
        
        // Начисляем бонус пригласившему
        try {
          const referrerKeyRow = db.prepare("SELECT key, expires_at FROM keys WHERE telegram_id = ? AND is_trial = 0 ORDER BY id DESC LIMIT 1").get(referrerId);
          if (referrerKeyRow) {
             const newDate = new Date(new Date(referrerKeyRow.expires_at).getTime() + 7 * 24 * 60 * 60 * 1000);
             db.prepare("UPDATE keys SET expires_at = ? WHERE key = ?").run(newDate.toISOString(), referrerKeyRow.key);
             bot.telegram.sendMessage(referrerId, `🎉 По вашей ссылке зарегистрировался друг!\n\nК вашей основной подписке добавлено +7 дней бесплатно!`);
          } else {
             // Если у друга только триал, продлеваем триал
             const trialKeyRow = db.prepare("SELECT key, expires_at FROM keys WHERE telegram_id = ? AND is_trial = 1 ORDER BY id DESC LIMIT 1").get(referrerId);
             if (trialKeyRow) {
                const newDate = new Date(new Date(trialKeyRow.expires_at).getTime() + 7 * 24 * 60 * 60 * 1000);
                db.prepare("UPDATE keys SET expires_at = ? WHERE key = ?").run(newDate.toISOString(), trialKeyRow.key);
                bot.telegram.sendMessage(referrerId, `🎉 По вашей ссылке зарегистрировался друг!\n\nК вашему тестовому периоду добавлено +7 дней бесплатно!`);
             }
          }
        } catch (e) {
          console.error('[Ref Error]', e);
        }
        return; // Завершаем старт, чтобы не дублировать приветствие
      }
    }
  }

  ctx.reply(`Привет, ${ctx.from.first_name}! 👋\n\nДобро пожаловать в StreamLume — премиальное IPTV нового поколения.\n\nИспользуй меню ниже, чтобы получить доступ к сотням каналов в HD качестве.`, mainKeyboard);
  
  if (ctx.from.id === ADMIN_ID) {
    ctx.reply('👑 О, хозяин! Тебе доступна команда /admin');
  }
});

bot.hears('🤝 Пригласить друга', (ctx) => {
  const refLink = `https://t.me/${ctx.botInfo.username}?start=ref_${ctx.from.id}`;
  ctx.reply(`🤝 *Реферальная программа StreamLume*\n\nОтправь эту ссылку другу:\n\`${refLink}\`\n\nКогда друг впервые запустит бота по твоей ссылке, он получит увеличенный пробный период (7 дней вместо 3), а ты автоматически получишь **+7 дней** к своей подписке!`, { parse_mode: 'Markdown' });
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

bot.hears('🎁 Бесплатный доступ', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  const alreadyUsed = await hasUsedTrial(telegramId);

  if (alreadyUsed) {
    const existingKey = await getKeyByTelegramId(telegramId);
    if (existingKey) {
      ctx.reply(`✅ Вы уже получали бесплатный доступ.\n\nВаш ключ: \`${existingKey}\``, { parse_mode: 'Markdown' });
    } else {
      ctx.reply('❌ Вы уже получали бесплатный доступ.');
    }
    return;
  }

  const freeKey = await generateKey(telegramId, 3, true); // 3 days trial
  ctx.reply(`✅ Ваш бесплатный пробный доступ на 3 дня активирован!\n\nКлюч: \`${freeKey}\`\n\nСрок действия: 3 дня. Введите этот ключ в приложении для доступа. После окончания теста вы сможете продлить подписку всего от 49 рублей в меню "💎 Получить доступ".`, { parse_mode: 'Markdown' });
});

bot.hears('💎 Получить доступ', async (ctx) => {
  const paymentMethods = Markup.inlineKeyboard([
    [Markup.button.callback('💳 СБП / Карты / QIWI (FreeKassa)', 'method_fk')],
    [Markup.button.callback('💳 Картой РФ (ЮMoney)', 'method_ym')],
    [Markup.button.callback('🪙 Криптовалютой (USDT / TON)', 'method_crypto')]
  ]);

  ctx.reply('Выберите удобный способ оплаты:', paymentMethods);
});

bot.action('method_fk', async (ctx) => {
  const tariffs = Markup.inlineKeyboard([
    [Markup.button.callback('🌱 VIP 1 месяц — 49 ₽', 'pay_fk_30_49')],
    [Markup.button.callback('🌟 VIP 3 месяца — 100 ₽', 'pay_fk_90_100')],
    [Markup.button.callback('⚡ VIP 6 месяцев — 300 ₽', 'pay_fk_180_300')],
    [Markup.button.callback('👑 VIP 1 год — 500 ₽', 'pay_fk_365_500')]
  ]);

  ctx.reply('Выберите тарифный план (Оплата через FreeKassa - СБП, карты, QIWI):', tariffs);
  await ctx.answerCbQuery();
});

bot.action(/pay_fk_(\d+)_(\d+)/, async (ctx) => {
  const duration = parseInt(ctx.match[1]);
  const amount = parseInt(ctx.match[2]);
  const telegramId = ctx.from.id;
  const orderId = `${telegramId}_${duration}_${Date.now()}`;

  const merchantId = process.env.FK_MERCHANT_ID || '73074';
  const secret1 = process.env.FK_SECRET_1 || 'U&5fTkA{3%bic_9';

  try {
    const crypto = require('crypto');
    // md5 signature formula: merchant_id:amount:secret_word_1:currency:order_id
    const signatureString = `${merchantId}:${amount}:${secret1}:RUB:${orderId}`;
    const signature = crypto.createHash('md5').update(signatureString).digest('hex');
    const payUrl = `https://pay.freekassa.ru/?m=${merchantId}&oa=${amount}&o=${orderId}&s=${signature}&currency=RUB`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url('💳 Перейти к оплате (FreeKassa)', payUrl)],
      [Markup.button.callback('🔄 Я оплатил', 'check_payment_manual')]
    ]);

    ctx.reply(`Счет на оплату через FreeKassa создан!\n\nСумма: ${amount} ₽\nТариф: ${duration} дней\n\nНажми кнопку ниже для оплаты. Ключ придет автоматически.`, keyboard);
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('FreeKassa creation Error:', error);
    ctx.reply('Ошибка при создании счета FreeKassa.');
  }
});

bot.action('method_ym', async (ctx) => {
  const tariffs = Markup.inlineKeyboard([
    [Markup.button.callback('🌱 VIP 1 месяц — 49 ₽', 'pay_ym_30_49')],
    [Markup.button.callback('🌟 VIP 3 месяца — 100 ₽', 'pay_ym_90_100')],
    [Markup.button.callback('⚡ VIP 6 месяцев — 300 ₽', 'pay_ym_180_300')],
    [Markup.button.callback('👑 VIP 1 год — 500 ₽', 'pay_ym_365_500')]
  ]);

  ctx.reply('Выберите тарифный план (Оплата через ЮMoney):', tariffs);
  await ctx.answerCbQuery();
});

bot.action(/pay_ym_(\d+)_(\d+)/, async (ctx) => {
  const duration = parseInt(ctx.match[1]);
  const amount = parseInt(ctx.match[2]);
  const telegramId = ctx.from.id;
  const orderId = `${telegramId}_${duration}_${Date.now()}`;

  const wallet = process.env.YOOMONEY_WALLET || '4100118248894113';

  try {
    console.log(`[YooMoney Link] Creating payment url for ${orderId}. Wallet: ${wallet}`);

    const payUrl = `https://yoomoney.ru/quickpay/confirm.xml?receiver=${wallet}&quickpay-form=shop&targets=Оплата%20VIP%20StreamLume&sum=${amount}&label=${orderId}`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url('💳 Перейти к оплате (ЮMoney)', payUrl)],
      [Markup.button.callback('🔄 Я оплатил', 'check_payment_manual')]
    ]);

    ctx.reply(`Счет на оплату через ЮMoney создан!\n\nСумма: ${amount} ₽\nТариф: ${duration} дней\n\nНажми кнопку ниже для оплаты. Ключ придет автоматически.`, keyboard);
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('YooMoney creation Error:', error);
    ctx.reply('Ошибка при создании счета ЮMoney.');
  }
});

bot.action('method_crypto', async (ctx) => {
  const tariffs = Markup.inlineKeyboard([
    [Markup.button.callback('🌟 VIP 3 месяца — 1 USDT', 'pay_90_1')],
    [Markup.button.callback('⚡ VIP 6 месяцев — 3 USDT', 'pay_180_3')],
    [Markup.button.callback('👑 VIP 1 год — 5 USDT', 'pay_365_5')]
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
      description: `StreamLume VIP: ${duration} дней`,
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
      await ctx.editMessageText(`✅ *Оплата прошла успешно!*\n\nТвой VIP-доступ активирован.\n\nКлюч: \`${newKey}\``, { parse_mode: 'Markdown' });
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
    '1. Установите приложение с сайта или из официальных магазинов, либо скачайте APK-файл ниже.\n' +
    '2. Запустите приложение и введите свой Premium-ключ.\n\n' +
    '📺 *Где скачать:*\n' +
    '• 🌐 [Официальный сайт](https://iptvpay-svmorozoww.amvera.io)\n' +
    '• [Google Play](https://play.google.com/store/apps/details?id=com.sergey.streamlume)\n' +
    '• [RuStore](https://apps.rustore.ru/app/com.sergey.streamlume)\n\n' +
    '📺 Приятного просмотра!', { parse_mode: 'Markdown', disable_web_page_preview: true });

  if (fs.existsSync(apkPath)) {
    try {
      await ctx.replyWithDocument({ source: apkPath, filename: 'StreamLume.apk' });
    } catch (e) {
      console.error('Failed to send APK:', e);
      ctx.reply(`🚀 Скачайте приложение по ссылкам:\n\n• 🌐 [Официальный сайт](https://iptvpay-svmorozoww.amvera.io)\n• [Google Play](https://play.google.com/store/apps/details?id=com.sergey.streamlume)\n• [RuStore](https://apps.rustore.ru/app/com.sergey.streamlume)`, { parse_mode: 'Markdown', disable_web_page_preview: true });
    }
  } else {
    try {
      await ctx.reply(`🚀 Скачайте приложение по ссылкам:\n\n• 🌐 [Официальный сайт](https://iptvpay-svmorozoww.amvera.io)\n• [Google Play](https://play.google.com/store/apps/details?id=com.sergey.streamlume)\n• [RuStore](https://apps.rustore.ru/app/com.sergey.streamlume)`, { parse_mode: 'Markdown', disable_web_page_preview: true });
      
      // Отправка APK файла напрямую через Telegram
      await ctx.replyWithDocument('BQACAgIAAxkBAA07agijg_t85kEjqw6OYQER0BJlnhcAAi6bAAK0-khIfr9HSAFiTAo7BA', {
        caption: '📱 Установочный файл StreamLume (v1.0.9)'
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

bot.hears('📺 Для Smart TV (Samsung/LG)', (ctx) => {
  ctx.reply('📺 *Как смотреть на Samsung (Tizen) и LG (webOS):*\n\n' +
    '1. Откройте магазин приложений на вашем телевизоре (Smart Hub / Content Store).\n' +
    '2. Найдите и установите бесплатное приложение *Media Station X*.\n' +
    '3. Запустите его, зайдите в *Settings* (Настройки) ➡️ *Start Parameter* (Стартовый параметр) ➡️ *Setup*.\n' +
    '4. Включите *Security Lock* (замочек должен быть закрыт) для работы по защищенному протоколу HTTPS.\n' +
    '5. Введите адрес нашего сервера: `iptvpay-svmorozoww.amvera.io` и сохраните.\n' +
    '6. Нажмите "Yes" (Да) для подтверждения перезапуска.\n\n' +
    '✅ *Готово!* StreamLume TV запустится автоматически. Теперь интерфейс полностью поддерживает управление вашим пультом!', { parse_mode: 'Markdown' });
});

// Временный обработчик для получения file_id (скинь боту APK, чтобы получить код)
// Handler moved inside the block below

// Start servers
app.listen(PORT, () => {
  console.log(`Express server is running on port ${PORT}`);
  console.log(`--- DEPLOYMENT VERIFICATION: Version 1.0.8 ACTIVE ---`);

  // Background initialization to prevent blocking the thread
  setTimeout(async () => {
    try {
      console.log('[StreamLume Startup] Rebuilding master playlist in background...');
      await rebuildPlaylist();
    } catch (e) {
      console.error('[StreamLume Startup] Background init error:', e.message);
    }
  }, 1000);

  // Инициализация партизанского юзербота в фоне отключена на этом сервере,
  // так как сессия уже используется на сервере АвтоСпутник (во избежание AUTH_KEY_DUPLICATED).
  /*
  setTimeout(() => {
    startPartisanBot().catch(err => {
      console.error('[StreamLume Startup] Failed to start Partisan bot:', err.message);
    });
  }, 5000);
  */

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



// --- Фоновые задачи продвижения (StreamLume) ---
setTimeout(() => {
  console.log('[Scheduler] Запуск задач для StreamLume...');
  runAutoblog('iptv');
  runYouTubeBot('iptv');
}, 5 * 60 * 1000);

// --- Фоновая задача "Дожим" (Follow-up) ---
setInterval(() => {
  console.log('[Follow-Up] Проверка истекших триалов...');
  try {
    const expiredTrials = db.prepare(`
      SELECT key, telegram_id FROM keys 
      WHERE is_trial = 1 
        AND followup_sent = 0 
        AND expires_at < datetime('now') 
        AND expires_at > datetime('now', '-2 days')
        AND telegram_id IS NOT NULL
    `).all();

    for (const trial of expiredTrials) {
      if (trial.telegram_id) {
        bot.telegram.sendMessage(trial.telegram_id, "Привет! Твой бесплатный период в StreamLume закончился. Надеюсь, тебе понравилось качество трансляций! 🍿 Если хочешь продолжить смотреть 5000+ каналов в HD, лови подписку всего от 49 рублей в месяц. Нажми '💎 Получить доступ' в меню.")
          .then(() => {
            db.prepare('UPDATE keys SET followup_sent = 1 WHERE key = ?').run(trial.key);
            console.log(`[Follow-Up] Сообщение отправлено пользователю ${trial.telegram_id}`);
          })
          .catch(err => console.error(`[Follow-Up] Ошибка отправки ${trial.telegram_id}:`, err.message));
      }
    }
  } catch (err) {
    console.error('[Follow-Up] Ошибка базы данных:', err.message);
  }
}, 60 * 60 * 1000); // Раз в час


setInterval(() => {
  runAutoblog('iptv');
}, 24 * 60 * 60 * 1000);

setInterval(() => {
  runYouTubeBot('iptv');
}, 4 * 60 * 60 * 1000);
