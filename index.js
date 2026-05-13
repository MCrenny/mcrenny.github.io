require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');
const { CryptoPay } = require('@foile/crypto-pay-api');
const { db, generateKey, verifyKey, getKeyByTelegramId, hasUsedTrial, getAllTelegramIds, isOrderProcessed, markOrderProcessed } = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN_HERE';
const CRYPTO_PAY_TOKEN = process.env.CRYPTO_PAY_TOKEN || 'YOUR_CRYPTO_PAY_TOKEN_HERE';


const FK_MERCHANT_ID = process.env.FK_MERCHANT_ID;
const FK_SECRET_1 = process.env.FK_SECRET_1;
const FK_SECRET_2 = process.env.FK_SECRET_2;

const ADMIN_ID = 329742659; // Твой ID
const SERVER_URL = `https://iptvpay-svmorozoww.amvera.io`; // Твой адрес Amvera
const DOWNLOAD_URL = 'https://t.me/StreamLumeApp/1';

const cryptoPay = new CryptoPay(CRYPTO_PAY_TOKEN);

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

// --- Redirects for FreeKassa ---
app.get('/success', (req, res) => {
  res.redirect('https://t.me/StreamLumeApp');
});

app.get('/fail', (req, res) => {
  res.redirect('https://t.me/StreamLumeApp');
});


// --- Free-Kassa Webhook ---
app.post('/api/webhooks/freekassa', async (req, res) => {
  // Фрикасса шлет данные через POST или GET (зависит от настроек), чаще POST
  const { MERCHANT_ID, AMOUNT, MERCHANT_ORDER_ID, SIGN } = req.body;
  
  if (!MERCHANT_ID || !MERCHANT_ORDER_ID || !SIGN) return res.status(400).send('Bad Request');

  const crypto = require('crypto');
  // Проверка подписи: md5(MERCHANT_ID:AMOUNT:SECRET_2:MERCHANT_ORDER_ID)
  const checkSign = crypto.createHash('md5')
    .update(`${MERCHANT_ID}:${AMOUNT}:${FK_SECRET_2}:${MERCHANT_ORDER_ID}`)
    .digest('hex');

  if (SIGN.toLowerCase() !== checkSign.toLowerCase()) {
    console.error('Free-Kassa Sign mismatch');
    return res.status(400).send('Invalid signature');
  }

  try {
    if (await isOrderProcessed(MERCHANT_ORDER_ID)) {
      return res.send('YES'); // Уже обработано
    }

    const [telegramId, duration] = MERCHANT_ORDER_ID.split('_');
    const newKey = await generateKey(telegramId, parseInt(duration));
    await markOrderProcessed(MERCHANT_ORDER_ID);

    await bot.telegram.sendMessage(telegramId, `✅ *Оплата подтверждена (Free-Kassa)!*\n\nТвой Premium-доступ активирован.\n\nКлюч: \`${newKey}\``, {
      parse_mode: 'Markdown'
    });

    res.send('YES'); // Обязательно 'YES' для Фрикассы
  } catch (error) {
    console.error('Webhook error:', error);
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
  const { db } = require('./db');
  db.get("SELECT COUNT(*) as count FROM keys", (err, row) => {
    ctx.reply(`📊 Всего выдано ключей: ${row ? row.count : 0}`);
  });
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

// Обработка тарифов через Free-Kassa
bot.action(/pay_fk_(\d+)_(\d+)/, async (ctx) => {
  const duration = parseInt(ctx.match[1]);
  const amount = parseInt(ctx.match[2]);
  const telegramId = ctx.from.id;
  const orderId = `${telegramId}_${duration}_${Date.now()}`;

  if (!FK_MERCHANT_ID || !FK_SECRET_1) {
    ctx.reply('❌ Оплата через Free-Kassa временно не настроена (проверь ключи в .env).');
    return;
  }

  try {
    const crypto = require('crypto');
    const currency = 'RUB';
    const sign = crypto.createHash('md5')
      .update(`${FK_MERCHANT_ID}:${amount}:${FK_SECRET_1}:${currency}:${orderId}`)
      .digest('hex');

    const payUrl = `https://pay.freekassa.ru/?m=${FK_MERCHANT_ID}&oa=${amount}&currency=${currency}&o=${orderId}&s=${sign}&us_login=${telegramId}`;

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
  ctx.reply('⏳ Проверка обычно занимает от 1 до 5 минут. Ключ придет в этот чат автоматически, как только платежная система подтвердит оплату. Пожалуйста, подождите.');
  ctx.answerCbQuery();
});

// Создание счета в крипте
bot.action(/pay_(\d+)_(\d+)/, async (ctx) => {
  const duration = parseInt(ctx.match[1]);
  const amount = parseInt(ctx.match[2]);
  const telegramId = ctx.from.id;

  try {
    await ctx.answerCbQuery();
    
    // Создаем инвойс в CryptoPay
    const invoice = await cryptoPay.createInvoice('USDT', amount, {
      description: `StreamLume Premium: ${duration} дней`,
      payload: JSON.stringify({ telegramId, duration })
    });

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url('💳 Оплатить в CryptoBot', invoice.pay_url)],
      [Markup.button.callback('✅ Проверить оплату', `check_${invoice.invoice_id}`)]
    ]);

    ctx.reply(`Счет на оплату создан!\n\nСумма: ${amount} USDT\nТариф: ${duration} дней\n\nНажми кнопку ниже, чтобы перейти к оплате в CryptoBot. После оплаты нажми «Проверить оплату».`, keyboard);

  } catch (error) {
    console.error('CryptoPay error:', error);
    ctx.reply('Ошибка при создании счета. Убедись, что CRYPTO_PAY_TOKEN указан верно.');
  }
});

// Проверка оплаты
bot.action(/check_(\d+)/, async (ctx) => {
  const invoiceId = parseInt(ctx.match[1]);

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
      await ctx.editMessageText(`✅ *Оплата прошла успешно!*\n\nТвой Premium-доступ активирован.\n\nКлюч: \`${newKey}\``, {
        parse_mode: 'Markdown'
      });
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

bot.hears('📖 Инструкция', (ctx) => {
  ctx.reply('🚀 *Как начать смотреть StreamLume:*\n\n' +
    `1. Скачай приложение по ссылке: ${DOWNLOAD_URL}\n` +
    '2. Установи APK-файл на свой Android-телефон или ТВ.\n' +
    '3. Запусти приложение и введи свой Premium-ключ.\n\n' +
    '📺 Приятного просмотра!', { parse_mode: 'Markdown' });
});

bot.hears('🆘 Поддержка', (ctx) => {
  ctx.reply('По всем вопросам пишите нашему администратору: @admin_streamlume');
});

// Start servers
app.listen(PORT, () => {
  console.log(`Express server is running on port ${PORT}`);
});

if (BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
  // Admin Broadcast Command
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
      } catch (e) {
        console.error(`Failed to send message to ${userId}`);
      }
    }
    
    ctx.reply(`Рассылка завершена. Успешно отправлено: ${successCount} из ${users.length}`);
  });

  // Automatic reminders for expiring subscriptions
  const checkExpirations = async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    
    // Find users whose keys expire tomorrow
    const expiringKeys = db.prepare("SELECT DISTINCT telegram_id FROM keys WHERE expires_at LIKE ? AND telegram_id IS NOT NULL").all(`${tomorrowStr}%`);
    
    for (const key of expiringKeys) {
      try {
        await bot.telegram.sendMessage(key.telegram_id, "⚠️ *Ваша подписка StreamLume заканчивается завтра!*\n\nНе забудьте продлить её в меню оплаты, чтобы не потерять доступ к каналам.", { parse_mode: 'Markdown' });
      } catch (e) {
        console.error(`Reminder failed for ${key.telegram_id}`);
      }
    }
  };

  // Check for expirations once a day at 12:00
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 12 && now.getMinutes() === 0) {
      checkExpirations();
    }
  }, 60000);

  bot.launch().then(() => {
    console.log('Telegram bot is running');
  }).catch(err => {
    console.error('Error starting telegram bot (maybe invalid token?):', err.message);
  });
} else {
  console.log('BOT_TOKEN is not set. Telegram bot will not start. Please update .env file.');
}

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
