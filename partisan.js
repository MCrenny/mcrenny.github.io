import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import { ConnectionTCPObfuscated } from 'telegram/network/connection/index.js';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { 
  isUserContacted, 
  markUserAsContacted, 
  isMessageProcessed, 
  markMessageAsProcessed,
  getDynamicChats,
  saveDynamicChat,
  getScoutRequests,
  isScoutMatchProcessed,
  markScoutMatchProcessed,
  saveBannedChat,
  getBannedChats,
  removeDynamicChat,
  addTesterEmail,
  getTesterEmails
} from './db.js';

dotenv.config({ override: true });

const apiId = process.env.TELEGRAM_API_ID ? parseInt(process.env.TELEGRAM_API_ID) : null;
const apiHash = process.env.TELEGRAM_API_HASH;
const sessionString = process.env.TELEGRAM_SESSION;
const geminiKey = process.env.GEMINI_API_KEY;

// Инициализация Gemini
let ai = null;
if (geminiKey) {
  ai = new GoogleGenAI({ apiKey: geminiKey });
}

// Список чатов для мониторинга (по умолчанию популярные чаты про ТВ, кино и Android приставки)
const DEFAULT_CHATS = ['smarttv_ru', 'androidtvboxru', 'iptv_ru', 'kinoman_chat', 'tvbox_ru'];
const configChats = process.env.PARTISAN_CHATS 
  ? process.env.PARTISAN_CHATS.split(',').map(s => s.trim()) 
  : DEFAULT_CHATS;

function getFilteredTargetChats() {
  const banned = new Set(getBannedChats().map(c => c.toLowerCase()));
  const allChats = [...new Set([...configChats, ...getDynamicChats()])];
  return allChats.filter(c => !banned.has(c.toLowerCase()));
}

export let targetChats = getFilteredTargetChats();

export function refreshTargetChats() {
  targetChats = getFilteredTargetChats();
  botStatus.targetChats = targetChats;
}

export let botLogs = [];
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
export let sendQueue = [];
let lastSentTime = 0;
let messagesSentToday = 0;
let lastResetDate = new Date().toDateString();
const MIN_SEND_INTERVAL = 10 * 60 * 1000; // 10 минут между сообщениями (человеческий фактор)
const MAX_DAILY_MESSAGES = 50; // Максимум 50 ЛС в сутки

// Ключевые слова для поиска проблем (IPTV)
const IPTV_KEYWORDS = [
  'какой плеер', 'плеер для тв', 'где посмотреть', 'зависает iptv', 'тормозит тв', 
  'посоветуйте iptv', 'smart tv', 'смарт тв', 'какое приложение', 'плейлист iptv', 
  'фильмы онлайн', 'тв бокс', 'tv box', 'приставка', 'iptv player'
];

export let botStatus = {
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
    chatMap.clear();

    for (const dialog of dialogs) {
      const entity = dialog.entity;
      if (entity) {
        const idStr = entity.id.toString();

        // 1. Проверяем, если это канал вещания (только для чтения)
        if (entity.broadcast) {
          const chatName = entity.username || idStr;
          console.log(`[Partisan] Обнаружен broadcast-канал @${chatName}. Выходим...`);
          try {
            await client.invoke(
              new Api.channels.LeaveChannel({
                channel: entity
              })
            );
            if (entity.username) saveBannedChat(entity.username);
            saveBannedChat(idStr);
            refreshTargetChats();
          } catch (leaveErr) {
            console.error(`[Partisan] Ошибка выхода из канала @${chatName}:`, leaveErr.message);
          }
          continue;
        }

        // 2. Проверяем, если писать запрещено для всех участников по умолчанию
        if (entity.defaultBannedRights && entity.defaultBannedRights.sendMessages) {
          const chatName = entity.username || idStr;
          console.log(`[Partisan] В группе @${chatName} запрещено отправлять сообщения. Выходим...`);
          try {
            await client.invoke(
              new Api.channels.LeaveChannel({
                channel: entity
              })
            );
            if (entity.username) saveBannedChat(entity.username);
            saveBannedChat(idStr);
            refreshTargetChats();
          } catch (leaveErr) {
            console.error(`[Partisan] Ошибка выхода из группы @${chatName}:`, leaveErr.message);
          }
          continue;
        }

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

export async function startPartisanBot(retryCount = 0) {
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
    useWSS: true,
    connectionRetries: 5,
  });
  client.setLogLevel("error");

  try {
    await client.connect();
    const me = await client.getMe();
    botStatus.connected = true;
    botStatus.username = me.username || me.firstName;
    console.log(`[Partisan] Авторизация успешна! Бот запущен от имени: @${me.username || me.firstName}`);

    // Подписка на новые сообщения (регистрируем сразу, чтобы не пропускать сообщения во время инициализации)
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
        
        const sender = await message.getSender();
        const senderIdStr = sender && sender.id ? sender.id.toString() : null;

        // Check if this is a PM from a user we contacted
        let isPrivateReply = false;
        if (message.peerId && message.peerId.userId && senderIdStr && senderIdStr !== me.id.toString()) {
            if (isUserContacted(senderIdStr)) {
                isPrivateReply = true;
            }
        }

        // Проверяем, наш ли это чат
        const isTargetChat = targetChats.some(target => 
          target.toLowerCase() === chatUsername.toLowerCase() || 
          target === chatId
        );

        if (!isTargetChat && !isPrivateReply) return;

        // Убрана логика набора тестировщиков

        botStatus.totalMessagesReceived++;
        botStatus.lastReceivedMessage = {
          chat: chatUsername || chatId,
          sender: message.senderId ? message.senderId.toString() : 'unknown',
          text: message.message.substring(0, 150),
          timestamp: new Date().toISOString()
        };

        const msgText = message.message.toLowerCase();

        // Исключаем откровенный спам и рекламу
        const spamTriggers = [
          'продам', 'продаю', 'заработок', 'крипта', 'инвестиции',
          'ставки', 'казино', 'выигрыш', 'ссылка в профиле'
        ];
        const isSpamMessage = spamTriggers.some(t => msgText.includes(t));

        if (!isSpamMessage) {
          let detectedDomain = null;
          if (IPTV_KEYWORDS.some(k => msgText.includes(k))) detectedDomain = 'iptv';

          if (detectedDomain) {
            botStatus.keywordMessagesReceived++;

            const sender = await message.getSender();
            if (sender && sender.id) {
              const senderId = sender.id.toString();
              
              // Не пишем самому себе и другим ботам
              if (senderId !== me.id.toString() && !sender.bot) {
                // Проверяем уникальность
                if (!isMessageProcessed(chatId, message.id) && !isUserContacted(senderId)) {
                  // Помечаем сообщение как обработанное
                  markMessageAsProcessed(chatId, message.id);

                  console.log(`[Partisan] Найдена цель (${detectedDomain}) в @${chatUsername || chatId} от ${sender.username || senderId}: "${message.message.substring(0, 60)}..."`);

                  // Обработка сообщения
                  handleTargetMessage(client, sender, message.message, chatUsername || chatId, detectedDomain);
                }
              }
            }
          }
        }
      } catch (err) {
        console.error('[Partisan] Ошибка при обработке входящего сообщения:', err.message);
      }
    }, new NewMessage({}));

    // Запускаем фоновые задачи инициализации (не блокируют старт)
    setTimeout(async () => {
      await populateChatMap(client);
      await joinTargetChats(client, targetChats);
      // После вступлений обновляем карту еще раз, чтобы подтянуть новые группы
      await populateChatMap(client);
    }, 1000);

    // Запускаем фоновый поиск новых групп (первый поиск через 30 секунд, затем каждые 24 часа)
    setTimeout(() => {
      setTimeout(() => findAndJoinNewChats(client, 'iptv').catch(err => console.error('[Partisan] Ошибка автопоиска (iptv):', err)), 60000);
      setTimeout(() => postToAdBoards(client).catch(err => console.error('[Partisan] Ошибка автодосок:', err)), 120000);
    }, 30000);

    setInterval(() => {
      setTimeout(() => findAndJoinNewChats(client, 'iptv').catch(err => console.error('[Partisan] Ошибка автопоиска (iptv):', err)), 60000);
    }, 24 * 60 * 60 * 1000);
    
    // Публикация на досках объявлений каждые 12 часов
    setInterval(() => {
      postToAdBoards(client).catch(err => console.error('[Partisan] Ошибка автодосок:', err));
    }, 12 * 60 * 60 * 1000);

    // Запускаем периодический обработчик очереди отправки сообщений (каждую минуту)
    setInterval(async () => {
      await processSendQueue();
    }, 60000);

  } catch (err) {
    console.error(`[Partisan] Ошибка при инициализации юзербота (попытка ${retryCount + 1}):`, err);
    botStatus.error = err.message;
    
    try {
      await client.disconnect();
    } catch (discErr) {
      // Игнорируем ошибки при закрытии неактивного соединения
    }
    
    const maxRetries = 10;
    if (retryCount < maxRetries) {
      console.log(`[Partisan] Перезапуск юзербота через 30 секунд (осталось попыток: ${maxRetries - retryCount})...`);
      setTimeout(() => {
        startPartisanBot(retryCount + 1);
      }, 30000);
    }
  }

  return client;
}

async function joinTargetChats(client, chats) {
  // Получаем список уже вступивших групп из chatMap
  const joinedUsernames = new Set(Array.from(chatMap.values()).map(v => v.toLowerCase()));
  const joinedIds = new Set(Array.from(chatMap.keys()));

  for (const chat of chats) {
    if (chat.startsWith('-') || /^\d+$/.test(chat)) {
      continue;
    }

    const lowerChat = chat.toLowerCase();
    // Если мы уже состоим в этой группе, пропускаем JoinChannel
    if (joinedUsernames.has(lowerChat) || joinedIds.has(chat)) {
      console.log(`[Partisan] Уже состоим в группе: @${chat} (пропуск вступления)`);
      continue;
    }

    try {
      console.log(`[Partisan] Вступление в группу: @${chat}`);
      await client.invoke(
        new Api.channels.JoinChannel({
          channel: chat
        })
      );
      // Задержка 15 секунд, чтобы избежать спам-фильтра Telegram
      await new Promise(resolve => setTimeout(resolve, 15000));
    } catch (err) {
      const errMsg = err.message || '';
      console.log(`[Partisan] Ошибка при вступлении в группу @${chat}: ${errMsg}`);
      
      const permanentErrors = [
        'USER_BANNED_IN_CHANNEL',
        'CHANNEL_PRIVATE',
        'INVITE_HASH_EXPIRED',
        'USERNAME_INVALID',
        'USERNAME_NOT_OCCUPIED',
        'CHANNEL_INVALID',
        'CHAT_INVALID'
      ];
      
      const isPermanent = permanentErrors.some(pe => errMsg.includes(pe));
      if (isPermanent) {
        console.log(`[Partisan] Группа @${chat} недоступна перманентно (${errMsg}). Добавляем в черный список.`);
        saveBannedChat(chat);
        refreshTargetChats();
      }

      if (errMsg.includes('wait of') || errMsg.includes('FLOOD_WAIT')) {
        console.log('[Partisan] Достигнут лимит Telegram на вступление (FloodWait). Прерываем стартовый цикл вступлений.');
        break;
      }
    }
  }
}

async function handleTargetMessage(client, sender, userMsg, chatUsername, domain) {
  const senderId = sender.id.toString();
  const username = sender.username ? `@${sender.username}` : `ID ${senderId}`;

  try {
    let prompt = '';
    
    if (domain === 'iptv') {
      prompt = `
        Ты — живой человек, киноман, активный участник чатов про Smart TV и кино.
        Ты пишешь неформально, как обычный пользователь — коротко, по-русски, без пафоса.

        В чате @${chatUsername} человек написал: "${userMsg}"

        Твоя задача — написать ответ в 3 части (всё вместе — 4-6 предложений, не больше):

        ЧАСТЬ 1 — Живой совет:
        Дай конкретный совет по его вопросу. Без воды.

        ЧАСТЬ 2 — Упомяни приложение через личный опыт:
        Скажи, что сам давно пользуешься плеером "StreamLume" и горя не знаешь.
        Упомяни 1-2 фишки:
        • Идеально тянет 4K без зависаний
        • Избранное — собираешь свой пакет каналов из разных источников
        • Легко настраивается на любом Smart TV или Android-приставке
        • Можно бесплатно взять триал на 3 дня через их бота

        ЧАСТЬ 3 — Просьба об обратной связи:
        В конце попроси отписаться: "Отпишись потом, зашло или нет"

        ВАЖНО: Никаких ссылок/URL. Пиши как живой человек. Ответ строго на русском.
      `;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const replyText = response.text.trim();

    // Добавляем задачу в очередь отправки
    sendQueue.push({
      type: 'partisan',
      client,
      peerId: sender.id,
      senderId,
      username: sender.username,
      text: replyText
    });
    console.log(`[Partisan] Задача (партизан) добавлена в очередь отправки для ${username}. Очередь: ${sendQueue.length}`);

  } catch (err) {
    console.error(`[Partisan] Не удалось обработать ответ для ${username}:`, err.message);
  }
}

async function handleScoutMatch(client, message, query) {
  try {
    const sender = await message.getSender();
    if (!sender || !sender.id) return;
    const senderId = sender.id.toString();

    // Не пишем самому себе и другим ботам
    const me = await client.getMe();
    if (senderId === me.id.toString() || sender.bot) return;

    const username = sender.username ? `@${sender.username}` : `ID ${senderId}`;
    console.log(`[Partisan] [Scout] Анализ совпадения для ${query.make} ${query.model} от ${username}...`);

    const prompt = `
      Ты — интеллектуальный помощник автоскаута.
      Пользователь ищет автомобиль:
      Марка: ${query.make}
      Модель: ${query.model}
      Год: от ${query.yearFrom || 'любого'} до ${query.yearTo || 'любого'}
      Ключевые слова пользователя: ${query.keywords || 'нет'}
      
      Сообщение в авто-чате: "${message.message}"
      
      Твоя задача:
      1. Проверь, действительно ли в этом сообщении продается именно этот автомобиль (а не запчасти, услуги ремонта или вопрос).
      2. Если год машины указан в объявлении, проверь, подходит ли он под диапазон.
      3. Если объявление подходит, напиши краткий, вежливый и естественный первый вопрос продавцу от имени потенциального покупателя (1-2 предложения, например: "Здравствуйте! Увидел ваше объявление о продаже ${query.make} ${query.model}. Подскажите, машина ещё продается?").
      
      Верни ответ в формате JSON:
      {
        "isMatch": true или false,
        "replyText": "Текст сообщения для отправки продавцу (если matches=true, иначе пустая строка)"
      }
      Не пиши никаких пояснений, только валидный JSON.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    const result = JSON.parse(response.text.trim());
    if (result.isMatch && result.replyText) {
      console.log(`[Partisan] [Scout] ИИ подтвердил продажу авто! Текст ответа: "${result.replyText}"`);
      
      sendQueue.push({
        type: 'scout',
        client,
        peerId: sender.id,
        senderId,
        username: sender.username,
        text: result.replyText.trim(),
        deviceId: query.deviceId,
        make: query.make,
        model: query.model,
        messageId: message.id
      });
      console.log(`[Partisan] [Scout] Задача (скаут) добавлена в очередь отправки для ${username}. Очередь: ${sendQueue.length}`);
    } else {
      console.log(`[Partisan] [Scout] ИИ отклонил сообщение: не совпадает или не является продажей.`);
    }

  } catch (err) {
    console.error(`[Partisan] [Scout] Ошибка при обработке объявления:`, err.message);
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
    console.log(`[Partisan] Отправка сообщения из очереди (${task.type}) пользователю ${task.username || task.senderId}`);

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

    if (task.type === 'scout') {
      markScoutMatchProcessed(task.deviceId, task.make, task.model, task.messageId);
    } else {
      markUserAsContacted(task.senderId, task.username);
    }

    console.log(`[Partisan] Сообщение успешно отправлено. Дневной лимит: ${messagesSentToday}/${MAX_DAILY_MESSAGES}`);
  } catch (err) {
    console.error(`[Partisan] Не удалось отправить сообщение из очереди для ${task.username || task.senderId}:`, err.message);
  }
}

async function findAndJoinNewChats(client, domain) {
  console.log(`[Partisan] ИИ-разведка: запуск поиска новых групп для: ${domain}...`);
  let searchQueries = [];
  if (domain === 'iptv') {
    searchQueries = [
      'smart tv чат', 'кино онлайн чат', 'тв приставки', 
      'android tv box', 'фильмы сериалы чат', 'iptv плейлисты'
    ];
  }
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
      1. Тематика группы: Smart TV, Android приставки (TV Box), IPTV, кино, сериалы, обсуждение телевизоров.
      2. География: Русскоязычные чаты (Россия, СНГ). Если группа явно иностранная или не по теме (например, автомобили, политика), исключи её.
      
      Верни строго JSON-массив строк с юзернеймами подходящих групп (например: ["smarttv_ru", "tvbox_chat", "kino_zal"]). 
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
    if (err.message && err.message.includes('503')) {
      console.log('[Partisan] ИИ-фильтрация временно недоступна (Gemini 503: высокая нагрузка). Повторим в следующий раз.');
    } else {
      console.error('[Partisan] Ошибка при ИИ-фильтрации групп через Gemini:', err.message);
    }
    return;
  }

  console.log(`[Partisan] Gemini одобрил ${approvedUsernames.length} групп: ${approvedUsernames.join(', ')}`);

  // Лимит: вступление в 5-10 групп за один цикл (сутки), чтобы повысить охват
  const MAX_JOINS_PER_DAY = 5;
  if (approvedUsernames.length > MAX_JOINS_PER_DAY) {
    approvedUsernames = approvedUsernames.slice(0, MAX_JOINS_PER_DAY);
    console.log(`[Partisan] В целях безопасности оставляем для вступления только ${MAX_JOINS_PER_DAY} группы: ${approvedUsernames.join(', ')}`);
  }

  const banned = new Set(getBannedChats().map(c => c.toLowerCase()));

  for (const username of approvedUsernames) {
    const lowerUsername = username.toLowerCase();
    if (targetChats.includes(lowerUsername)) continue;
    if (banned.has(lowerUsername)) {
      console.log(`[Partisan] ИИ-разведка: группа @${username} находится в черном списке (пропуск)`);
      continue;
    }

    let shouldBreak = false;
    try {
      console.log(`[Partisan] ИИ-разведка вступает в группу: @${username}`);
      await client.invoke(
        new Api.channels.JoinChannel({
          channel: username
        })
      );

      // Проверяем, является ли это каналом только для чтения
      const entity = await client.getEntity(username);
      let isReadOnly = false;
      let reason = '';

      if (entity) {
        if (entity.broadcast) {
          isReadOnly = true;
          reason = 'это информационный канал (broadcast)';
        } else if (entity.defaultBannedRights && entity.defaultBannedRights.sendMessages) {
          isReadOnly = true;
          reason = 'запрещена отправка сообщений по умолчанию';
        }
      }

      if (isReadOnly) {
        console.log(`[Partisan] Группа @${username} бесполезна (${reason}). Выходим и добавляем в черный список.`);
        await client.invoke(
          new Api.channels.LeaveChannel({
            channel: entity || username
          })
        );
        saveBannedChat(username);
        removeDynamicChat(username);
        refreshTargetChats();
      } else {
        saveDynamicChat(lowerUsername);
        targetChats.push(lowerUsername);
        botStatus.targetChats = targetChats;
        console.log(`[Partisan] Успешно вступили и начали отслеживать: @${username}`);
      }
    } catch (err) {
      const errMsg = err.message || '';
      
      if (errMsg.includes('INVITE_REQUEST_SENT')) {
        console.log(`[Partisan] Запрос на вступление в группу @${username} отправлен (ожидает одобрения администратора).`);
      } else {
        console.error(`[Partisan] Не удалось вступить в группу @${username}:`, errMsg);
      }
      
      const permanentErrors = [
        'USER_BANNED_IN_CHANNEL',
        'CHANNEL_PRIVATE',
        'INVITE_HASH_EXPIRED',
        'USERNAME_INVALID',
        'USERNAME_NOT_OCCUPIED',
        'CHANNEL_INVALID',
        'CHAT_INVALID'
      ];
      
      const isPermanent = permanentErrors.some(pe => errMsg.includes(pe));
      if (isPermanent) {
        console.log(`[Partisan] Группа @${username} недоступна перманентно. Добавляем в черный список.`);
        saveBannedChat(username);
        refreshTargetChats();
      }

      if (errMsg.includes('wait of') || errMsg.includes('FLOOD_WAIT')) {
        console.log('[Partisan] Достигнут лимит Telegram на вступление (FloodWait). Прерываем вступления в этом цикле.');
        shouldBreak = true;
      }
    }

    if (shouldBreak) break;

    // Ждем 15 секунд перед следующей попыткой
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
}

export async function postToAdBoards(client) {
  console.log('[Partisan] Доски объявлений: запуск рассылки...');
  
  // Ищем группы барахолок
  const searchQueries = ['барахолка', 'доска объявлений', 'объявления', 'купи продай'];
  const foundCandidates = new Map();
  
  for (const query of searchQueries) {
    try {
      const searchResult = await client.invoke(
        new Api.contacts.Search({ q: query, limit: 10 })
      );
      if (searchResult && searchResult.chats) {
        for (const chat of searchResult.chats) {
          if (chat.username && chat.megagroup) {
            foundCandidates.set(chat.username.toLowerCase(), chat.username);
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err) {
      console.error(`[Partisan] Ошибка поиска досок по запросу "${query}":`, err.message);
    }
  }

  const candidateList = Array.from(foundCandidates.values()).slice(0, 3); // Берем 3 группы за раз
  if (candidateList.length === 0) return;

  // Выбираем, что рекламировать
  const domain = 'iptv';
  
  let adText = '';
  if (domain === 'iptv') {
    adText = `📺 Для тех, кто любит качественное кино!\nРекомендую отличный плеер "StreamLume" для Smart TV и Android приставок.\n\n🔥 Идеально тянет фильмы в 4K.\n🔥 Крутой интерфейс, никаких зависаний.\n🔥 Собираете свои каналы в удобное Избранное.\n\nКто искал хороший IPTV-плеер — обязательно зацените! Бесплатный триал на 3 дня можно взять через их Telegram-бота: @StreameLumeBot`;
  }

  for (const username of candidateList) {
    try {
      console.log(`[Partisan] Доски: вступление в @${username}...`);
      await client.invoke(new Api.channels.JoinChannel({ channel: username }));
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      console.log(`[Partisan] Доски: отправка объявления в @${username}...`);
      await client.sendMessage(username, { message: adText });
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      await client.invoke(new Api.channels.LeaveChannel({ channel: username }));
      console.log(`[Partisan] Доски: успешно опубликовано и осуществлен выход из @${username}.`);
    } catch (err) {
      console.error(`[Partisan] Доски: не удалось запостить в @${username}:`, err.message);
    }
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
}
