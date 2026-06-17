const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions/index.js');
const { NewMessage } = require('telegram/events/index.js');
const { GoogleGenAI } = require('@google/genai');
const dotenv = require('dotenv');
const { 
  isUserContacted, 
  markUserAsContacted, 
  isMessageProcessed, 
  markMessageAsProcessed,
  getDynamicChats,
  saveDynamicChat
} = require('./db');

dotenv.config();

const apiId = process.env.TELEGRAM_API_ID ? parseInt(process.env.TELEGRAM_API_ID) : null;
const apiHash = process.env.TELEGRAM_API_HASH;
const sessionString = process.env.TELEGRAM_SESSION;
const geminiKey = process.env.GEMINI_API_KEY;

// Инициализация Gemini
let ai = null;
if (geminiKey) {
  ai = new GoogleGenAI({ apiKey: geminiKey });
}

// Список чатов для мониторинга (по умолчанию популярные сообщества по IPTV и Smart TV)
const DEFAULT_CHATS = [
  'iptv_smarttv', 
  'smarttv_ru', 
  'tivimate_ru', 
  'televizo_chat', 
  'ottplayer_chat', 
  'android_tv_ru', 
  'iptv_free_m3u', 
  'smarttv_channels'
];

const configChats = process.env.PARTISAN_CHATS 
  ? process.env.PARTISAN_CHATS.split(',').map(s => s.trim()) 
  : DEFAULT_CHATS;

const targetChats = [...new Set([...configChats, ...getDynamicChats()])];

let botLogs = [];
const originalLog = console.log;
const originalError = console.error;

console.log = function(...args) {
  originalLog.apply(console, args);
  const msg = args.join(' ');
  if (msg.includes('[Partisan]')) {
    botLogs.push(`[${new Date().toISOString()}] ${msg}`);
    if (botLogs.length > 100) botLogs.shift();
  }
};

console.error = function(...args) {
  originalError.apply(console, args);
  const msg = args.join(' ');
  if (msg.includes('[Partisan]')) {
    botLogs.push(`[${new Date().toISOString()}] ERROR: ${msg}`);
    if (botLogs.length > 100) botLogs.shift();
  }
};

// Очередь отправки и лимиты
let sendQueue = [];
let lastSentTime = 0;
let messagesSentToday = 0;
let lastResetDate = new Date().toDateString();
const MIN_SEND_INTERVAL = 30 * 60 * 1000; // 30 минут между сообщениями (человеческий фактор)
const MAX_DAILY_MESSAGES = 15; // Максимум 15 ЛС в сутки

// Ключевые слова для поиска проблем/запросов по IPTV
const KEYWORDS = [
  'плейлист', 'playlist', 'm3u', 'm3u8', 'iptv', 'иптв', 
  'телевизор', 'smart tv', 'смарт тв', 'tivimate', 'televizo', 
  'ott navigator', 'ottplayer', 'зависает', 'буферизация', 
  'тормозит', 'подвисает', 'где смотреть', 'тв каналы', 
  'каналы hd', 'смотреть каналы', 'подписка тв', 'телевидение', 
  'эдем тв', 'ilook', 'cbilling'
];

let botStatus = {
  initialized: false,
  connected: false,
  username: null,
  error: null,
  startedAt: null,
  targetChats: [],
  totalMessagesReceived: 0,
  keywordMessagesReceived: 0,
  lastReceivedMessage: null,
  activeChatsInMap: []
};

const chatMap = new Map();

async function populateChatMap(client) {
  try {
    const dialogs = await client.getDialogs({});
    for (const dialog of dialogs) {
      const entity = dialog.entity;
      if (entity) {
        const idStr = entity.id.toString();
        if (entity.username) {
          chatMap.set(idStr, entity.username.toLowerCase());
        }
      }
    }
    botStatus.activeChatsInMap = Array.from(chatMap.entries()).map(([id, username]) => ({ id, username }));
    console.log(`[Partisan] Карта чатов инициализирована. Загружено ${chatMap.size} чатов с юзернеймами.`);
  } catch (err) {
    console.error('[Partisan] Ошибка при заполнении карты чатов:', err.message);
  }
}

async function startPartisanBot() {
  botStatus.startedAt = new Date().toISOString();
  botStatus.initialized = true;
  botStatus.targetChats = targetChats;

  if (!apiId || !apiHash || !sessionString) {
    const errMsg = 'в .env отсутствуют TELEGRAM_API_ID, TELEGRAM_API_HASH или TELEGRAM_SESSION';
    console.log(`[Partisan] Юзербот не запущен: ${errMsg}`);
    botStatus.error = errMsg;
    return null;
  }
  if (!ai) {
    const errMsg = 'отсутствует GEMINI_API_KEY';
    console.log(`[Partisan] Юзербот не запущен: ${errMsg}`);
    botStatus.error = errMsg;
    return null;
  }

  console.log('[Partisan] Запуск партизанского отряда...');
  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 5,
  });

  try {
    await client.connect();
    const me = await client.getMe();
    botStatus.connected = true;
    botStatus.username = me.username || me.firstName;
    console.log(`[Partisan] Авторизация успешна! Бот запущен от имени: @${me.username || me.firstName}`);

    // Подписка на новые сообщения
    client.addEventHandler(async (event) => {
      try {
        const message = event.message;
        if (!message || !message.message) return;

        let chatId = '';
        if (message.peerId) {
          const peer = message.peerId;
          if (peer.channelId) chatId = peer.channelId.toString();
          else if (peer.chatId) chatId = peer.chatId.toString();
          else if (peer.userId) chatId = peer.userId.toString();
        }
        if (!chatId && message.chatId) {
          chatId = message.chatId.toString().replace(/^-100/, '').replace(/^-/, '');
        }

        const chatUsername = chatMap.get(chatId) || '';

        // Проверяем, наш ли это чат
        const isTargetChat = targetChats.some(target => 
          target.toLowerCase() === chatUsername.toLowerCase() || 
          target === chatId
        );

        if (!isTargetChat) return;

        botStatus.totalMessagesReceived++;
        botStatus.lastReceivedMessage = {
          chat: chatUsername || chatId,
          sender: message.senderId ? message.senderId.toString() : 'unknown',
          text: message.message.substring(0, 150),
          timestamp: new Date().toISOString()
        };

        const msgText = message.message.toLowerCase();

        // Исключаем откровенную коммерческую рекламу других IPTV сервисов
        const promoTriggers = ['купить подписку', 'продам плейлист', 'акция', 'скидки', 'официальный реселлер', 'подключаем каналы'];
        const isPromoMessage = promoTriggers.some(t => msgText.includes(t));

        if (!isPromoMessage) {
          const hasKeyword = KEYWORDS.some(keyword => msgText.includes(keyword));
          if (hasKeyword) {
            botStatus.keywordMessagesReceived++;

            const sender = await message.getSender();
            if (sender && sender.id) {
              const senderId = sender.id.toString();
              
              // Не пишем самому себе и другим ботам
              if (senderId !== me.id.toString() && !sender.bot) {
                // Проверяем уникальность
                if (!(await isMessageProcessed(chatId, message.id)) && !(await isUserContacted(senderId))) {
                  // Помечаем сообщение как обработанное
                  await markMessageAsProcessed(chatId, message.id);

                  console.log(`[Partisan] Найдена цель по ключевым словам в @${chatUsername || chatId} от ${sender.username || senderId}: "${message.message.substring(0, 60)}..."`);

                  // Обработка сообщения
                  await handleTargetMessage(client, sender, message.message, chatUsername || chatId);
                }
              }
            }
          }
        }
      } catch (err) {
        console.error('[Partisan] Ошибка при обработке входящего сообщения:', err.message);
      }
    }, new NewMessage({}));

    // Запускаем фоновые задачи инициализации
    setTimeout(async () => {
      await populateChatMap(client);
      await joinTargetChats(client, targetChats);
      await populateChatMap(client);
    }, 1000);

    // Запускаем фоновый поиск новых групп (первый через 30 секунд, затем раз в 24 часа)
    setTimeout(() => {
      findAndJoinNewChats(client).catch(err => console.error('[Partisan] Ошибка автопоиска:', err));
    }, 30000);

    setInterval(() => {
      findAndJoinNewChats(client).catch(err => console.error('[Partisan] Ошибка автопоиска:', err));
    }, 24 * 60 * 60 * 1000);

    // Периодический обработчик очереди отправки сообщений (каждую минуту)
    setInterval(async () => {
      await processSendQueue();
    }, 60000);

  } catch (err) {
    console.error('[Partisan] Ошибка при инициализации юзербота:', err);
    botStatus.error = err.message;
  }

  return client;
}

async function joinTargetChats(client, chats) {
  for (const chat of chats) {
    if (chat.startsWith('-') || /^\d+$/.test(chat)) {
      continue;
    }
    try {
      console.log(`[Partisan] Проверка вступления в группу: @${chat}`);
      await client.invoke(
        new Api.channels.JoinChannel({
          channel: chat
        })
      );
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (err) {
      if (!err.message.includes('CHANNELS_ADMIN_PUBLIC_LIMIT_EXCEEDED')) {
        console.log(`[Partisan] Статус группы @${chat}: ${err.message}`);
      }
    }
  }
}

async function handleTargetMessage(client, sender, userMsg, chatUsername) {
  const senderId = sender.id.toString();
  const username = sender.username ? `@${sender.username}` : `ID ${senderId}`;

  try {
    // Генерируем ответ с помощью Gemini
    const prompt = `
      Ты — опытный, вежливый технический специалист и эксперт по настройке Smart TV и IPTV, участник форума.
      В чате @${chatUsername} пользователь задал вопрос или описал проблему: "${userMsg}".
      
      Твоя задача:
      1. Напиши ему лично очень краткий (2-3 предложения), практический и дружелюбный совет или ответ на его вопрос.
      2. Ненавязчиво порекомендуй установить полностью бесплатное IPTV-приложение "StreamLume" на Android (телефон, приставка или Smart TV). Расскажи, что приложение имеет премиальный, очень красивый интерфейс (в стиле Dark Mode и Glassmorphism), работает невероятно быстро, не зависает и уже имеет встроенный готовый плейлист с сотнями каналов в высоком качестве (HD/FullHD), а также бесплатный тестовый период.
      3. ВАЖНО: Не вставляй никаких прямых ссылок (URL-адресов, например, https://...) на скачивание (это приводит к блокировке за спам). Вместо этого напиши текстом: "просто найди телеграм-канал StreamLumeApp и скачай оттуда APK" или "найди бота StreamLumeBot в телеграме, он выдаст бесплатный ключ и ссылку".
      4. Пиши живым человеческим языком, без официоза и приветствий типа "Я виртуальный ассистент". Напиши просто как человек, который увидел сообщение в группе и решил подсказать решение в ЛС.
      
      Ответь строго на русском языке.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const replyText = response.text.trim();

    // Добавляем задачу в очередь отправки
    sendQueue.push({
      client,
      peerId: sender.id,
      senderId,
      username: sender.username,
      text: replyText
    });
    console.log(`[Partisan] Задача добавлена в очередь отправки для ${username}. Очередь: ${sendQueue.length}`);

  } catch (err) {
    console.error(`[Partisan] Не удалось обработать ответ для ${username}:`, err.message);
  }
}

async function processSendQueue() {
  if (sendQueue.length === 0) return;

  const now = Date.now();
  const todayStr = new Date().toDateString();
  if (todayStr !== lastResetDate) {
    lastResetDate = todayStr;
    messagesSentToday = 0;
  }

  if (messagesSentToday >= MAX_DAILY_MESSAGES) {
    console.log(`[Partisan] Лимит отправки на сегодня исчерпан (${MAX_DAILY_MESSAGES}). Ожидание до завтра.`);
    return;
  }

  if (now - lastSentTime < MIN_SEND_INTERVAL) {
    return; // Еще не прошел интервал между сообщениями
  }

  const task = sendQueue.shift();
  if (!task) return;

  try {
    console.log(`[Partisan] Отправка сообщения из очереди пользователю ${task.username || task.senderId}`);

    // Имитируем набор текста
    try {
      await task.client.invoke(
        new Api.messages.SetTyping({
          peer: task.peerId,
          action: new Api.SendMessageTypingAction(),
        })
      );
      await new Promise(resolve => setTimeout(resolve, 4000));
    } catch (e) {
      // Игнорируем ошибки статуса печати
    }

    await task.client.sendMessage(task.peerId, { message: task.text });
    
    lastSentTime = Date.now();
    messagesSentToday++;

    await markUserAsContacted(task.senderId, task.username);

    console.log(`[Partisan] Сообщение успешно отправлено. Дневной лимит: ${messagesSentToday}/${MAX_DAILY_MESSAGES}`);
  } catch (err) {
    console.error(`[Partisan] Не удалось отправить сообщение из очереди для ${task.username || task.senderId}:`, err.message);
  }
}

async function findAndJoinNewChats(client) {
  console.log('[Partisan] ИИ-разведка: запуск поиска новых IPTV/SmartTV групп...');
  const searchQueries = [
    'iptv чат', 'iptv рус', 'smart tv чат', 'android tv чат', 
    'tivimate рус', 'televizo чат', 'ottplayer рус', 'iptv бесплатно',
    'плейлисты m3u'
  ];
  const foundCandidates = new Map();

  for (const query of searchQueries) {
    try {
      console.log(`[Partisan] Разведка: поиск по запросу "${query}"...`);
      const searchResult = await client.invoke(
        new Api.contacts.Search({
          q: query,
          limit: 30
        })
      );

      if (searchResult && searchResult.chats) {
        for (const chat of searchResult.chats) {
          if (chat.username && chat.megagroup) {
            const username = chat.username.toLowerCase();
            if (targetChats.includes(username)) continue;

            foundCandidates.set(username, {
              username: chat.username,
              title: chat.title || '',
              about: chat.about || ''
            });
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (err) {
      console.error(`[Partisan] Ошибка при поиске по запросу "${query}":`, err.message);
    }
  }

  if (foundCandidates.size === 0) {
    console.log('[Partisan] ИИ-разведка: новых публичных групп не найдено.');
    return;
  }

  const candidateList = Array.from(foundCandidates.values());
  console.log(`[Partisan] Разведка нашла ${candidateList.length} потенциальных групп. Передаем на анализ Gemini...`);

  let approvedUsernames = [];
  try {
    const prompt = `
      Ты — интеллектуальный фильтр для Telegram-юзербота.
      Перед тобой список найденных в глобальном поиске Telegram групп (чатов):
      ${JSON.stringify(candidateList, null, 2)}
      
      Твоя задача — отобрать только те группы, которые удовлетворяют критериям:
      1. Тематика группы: IPTV, Smart TV, Android TV, медиаплееры, плейлисты, просмотр каналов.
      2. Язык общения: русский. Исключи англоязычные или другие зарубежные чаты.
      
      Верни строго JSON-массив строк с юзернеймами подходящих групп (например: ["iptv_chat", "tivimate_group", "smart_tv_ru"]). 
      Если ни одна группа не подходит, верни пустой массив [].
      Не пиши никаких пояснений и лишнего текста, только валидный JSON-массив.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const cleanText = response.text.trim().replace(/```json/g, '').replace(/```/g, '').trim();
    approvedUsernames = JSON.parse(cleanText);
  } catch (err) {
    console.error('[Partisan] Ошибка при ИИ-фильтрации групп через Gemini:', err.message);
    return;
  }

  console.log(`[Partisan] Gemini одобрил ${approvedUsernames.length} групп: ${approvedUsernames.join(', ')}`);

  for (const username of approvedUsernames) {
    const lowerUsername = username.toLowerCase();
    if (targetChats.includes(lowerUsername)) continue;

    let shouldBreak = false;
    try {
      console.log(`[Partisan] ИИ-разведка вступает в группу: @${username}`);
      await client.invoke(
        new Api.channels.JoinChannel({
          channel: username
        })
      );

      await saveDynamicChat(lowerUsername);
      targetChats.push(lowerUsername);
      botStatus.targetChats = targetChats;
      console.log(`[Partisan] Успешно вступили и начали отслеживать: @${username}`);
    } catch (err) {
      console.error(`[Partisan] Не удалось вступить в группу @${username}:`, err.message);
      if (err.message.includes('wait of') || err.message.includes('FLOOD_WAIT')) {
        console.log('[Partisan] Достигнут лимит Telegram на вступление (FloodWait). Прерываем вступления в этом цикле.');
        shouldBreak = true;
      }
    }

    if (shouldBreak) break;

    // Ждем 15 секунд перед следующей попыткой
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
}

module.exports = {
  startPartisanBot,
  botStatus,
  botLogs
};
