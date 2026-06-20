require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { Telegraf, Markup } = require('telegraf');
const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);
const ADMIN_ID = 329742659;

const mainKeyboard = Markup.keyboard([
  ['💎 Получить доступ', '🎁 Бесплатный доступ'],
  ['🔑 Мой ключ', '📖 Инструкция'],
  ['🆘 Поддержка']
]).resize();

bot.telegram.sendMessage(ADMIN_ID, 'Системное сообщение: Обновление клавиатуры.', mainKeyboard)
  .then(() => {
    console.log('Message sent with new keyboard');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error sending message:', err);
    process.exit(1);
  });
