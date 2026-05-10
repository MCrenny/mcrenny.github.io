require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');
const { CryptoPay } = require('@foile/crypto-pay-api');
const { generateKey, verifyKey, getKeyByTelegramId } = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN_HERE';
const CRYPTO_PAY_TOKEN = process.env.CRYPTO_PAY_TOKEN || 'YOUR_CRYPTO_PAY_TOKEN_HERE';
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

// --- Telegram Bot ---
const bot = new Telegraf(BOT_TOKEN);

const mainKeyboard = Markup.keyboard([
  ['💎 Получить доступ', '🔑 Мой ключ'],
  ['📖 Инструкция', '🆘 Поддержка']
]).resize();

bot.start((ctx) => {
  ctx.reply(`Привет, ${ctx.from.first_name}! 👋\n\nДобро пожаловать в StreamLume — премиальное IPTV нового поколения.\n\nИспользуй меню ниже, чтобы получить доступ к сотням каналов в HD качестве.`, mainKeyboard);
});

bot.hears('💎 Получить доступ', async (ctx) => {
  const tariffs = Markup.inlineKeyboard([
    [Markup.button.callback('🌙 1 месяц — 3 USDT', 'pay_30_3')],
    [Markup.button.callback('🌟 3 месяца — 8 USDT', 'pay_90_8')],
    [Markup.button.callback('👑 1 год — 25 USDT', 'pay_365_25')]
  ]);

  ctx.reply('Выберите тарифный план для оплаты в USDT:', tariffs);
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
      const { telegramId, duration } = JSON.parse(invoice.payload);
      const newKey = await generateKey(telegramId, duration);

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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Express server is running on port ${PORT}`);
});

if (BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
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
