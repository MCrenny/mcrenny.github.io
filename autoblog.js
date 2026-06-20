import { GoogleGenAI } from '@google/genai';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';

dotenv.config({ override: true });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Обертка для Telegraf, чтобы не падал, если токен не задан
let bot = null;
if (process.env.BLOG_BOT_TOKEN) {
  bot = new Telegraf(process.env.BLOG_BOT_TOKEN);
} else {
  console.log('[AutoBlog] Внимание: BLOG_BOT_TOKEN не задан. Публикация в Telegram не будет работать.');
}

export async function runAutoblog(appType) {
  console.log(`[AutoBlog] Запуск генерации контента для: ${appType}`);
  
  if (!bot) {
    console.log('[AutoBlog] Ошибка: Бот не настроен (нет BLOG_BOT_TOKEN)');
    return;
  }

  let prompt = '';
  let channelId = '';

    const iptvTopics = [
      'рассказ о боли: вечная буферизация по вечерам, поиск рабочих плейлистов и как это бесит',
      'жизненная история (можно выдуманную, но реалистичную): как знакомый купил дорогущий телевизор, но смотрел мыльное ТВ из-за плохого плеера',
      'новости и новшества: будущее IPTV, новые форматы и почему важно иметь современный плеер',
      'лайфхак: как правильно организовать список каналов (Избранное), чтобы не листать 1000 каналов мусора',
      'уютная история: как стабильно работающий плеер спас семейный вечер просмотра долгожданного фильма в 4K'
    ];

  if (appType === 'iptv') {
    channelId = process.env.IPTV_CHANNEL_ID;
    const topic = iptvTopics[Math.floor(Math.random() * iptvTopics.length)];
    prompt = `
      Ты — автор авторского блога про домашние кинотеатры и IPTV. Ты один и тот же человек: увлеченный гик и киноман. 
      Ты прошел через все боли кривых плейлистов, зависающих Android-приставок и зависаний по вечерам, и теперь делишься своим опытом с подписчиками.
      
      Твоя тема на сегодня: ${topic}.
      
      ВАЖНО: Пиши от первого лица (Я), как автор своего блога. НИКОГДА не начинай пост со слов "Привет, друзья" или "Привет всем". Начинай сразу с сути, интересной мысли или истории.
      Каждый раз придумывай новый сюжет для картинки (например: телевизор в темноте, пустой диван перед экраном, крупный план смарт-тв и т.д.). Не используй людей в кадре.

      Ответ ОБЯЗАТЕЛЬНО должен быть в таком формате:
      IMAGE_PROMPT: [Очень короткое описание строго на английском (3-5 простых слов: существительные и прилагательные). НИКАКИХ длинных и сложных предложений! Пример: "modern living room tv" или "dark room glowing tv". СТРОГОЕ ПРАВИЛО: НИКАКИХ ЛЮДЕЙ, ЛИЦ ИЛИ РУК В КАДРЕ! Только интерьеры, телевизоры, техника. В конец добавь: photorealistic, 4k, cozy room, no people, no text]
      TEXT:
      [Сам текст поста]

      Требования к тексту поста (строго до 900 символов):
      1. Развей выбранную тему, расскажи историю или поделись болью/советом.
      2. Нативно подведи к тому, что для себя ты нашел идеальное решение — плеер "StreamLume".
      3. Кратко упомяни, что он тянет 4K без зависаний, имеет современный интерфейс и легко ставится на Smart TV или приставку.
      Стиль: Авторский, искренний, без лишней воды, с форматированием (эмодзи и HTML теги <b> и <i>). Категорически запрещено использовать Markdown (звездочки **).
      
      В конце поста ОБЯЗАТЕЛЬНО:
      1. Добавь призыв скачать "StreamLume" (доступен в Google Play, RuStore, Яндекс Диск: https://disk.yandex.ru/d/PLgFGtCwF8yCjg или Google Drive: https://drive.google.com/file/d/1tUthdGdyw8JX9_EKf0mcVmLiQjxztiuL/view?usp=drive_link).
      2. Оставь ссылку на наш Telegram: @streamlume_movies. Ни в коем случае не подставляй ссылки на dzen.ru!

      ОЧЕНЬ ВАЖНО: Весь текст должен быть строго до 800 символов, чтобы поместиться в подпись к фото в Telegram! Пиши коротко и ёмко.
    `;
  } else {
    return;
  }

  if (!channelId) {
    console.log(`[AutoBlog] Ошибка: Не задан ID канала для ${appType}`);
    return;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const rawText = response.text.trim();
    
    let imagePrompt = '';
    let articleText = rawText;
    
    // Пытаемся выпарсить промпт для картинки
    const match = rawText.match(/^IMAGE_PROMPT:\s*(.+)\n+TEXT:\s*([\s\S]+)$/i);
    if (match) {
      imagePrompt = match[1].trim();
      articleText = match[2].trim();
    }

    let imageUrl = null;
    if (imagePrompt) {
      // Генерируем ссылку на Pollinations.ai
      imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt)}?width=800&height=450&nologo=true`;
      console.log(`[AutoBlog] Сгенерирована картинка: ${imagePrompt}`);
    }

    console.log(`[AutoBlog] Сгенерирована статья (${articleText.length} симв.). Отправка в канал ${channelId}...`);

    if (imageUrl) {
      if (articleText.length <= 1024) {
        // Если текст влезает в лимит подписи Telegram, отправляем одним постом
        await bot.telegram.sendPhoto(channelId, { url: imageUrl }, { caption: articleText, parse_mode: 'HTML' });
      } else {
        // Если текст слишком длинный, отправляем картинку, а затем текст отдельным постом
        await bot.telegram.sendPhoto(channelId, { url: imageUrl });
        await bot.telegram.sendMessage(channelId, articleText, { parse_mode: 'HTML' });
      }
    } else {
      await bot.telegram.sendMessage(channelId, articleText, { parse_mode: 'HTML' });
    }
    
    console.log(`[AutoBlog] Успех! Статья для ${appType} опубликована.`);
  } catch (error) {
    if (error.message && error.message.includes('503')) {
      console.log('[AutoBlog] ИИ-модель временно недоступна (Gemini 503). Запрос отложен.');
    } else {
      console.error(`[AutoBlog] Ошибка генерации или публикации:`, error.message);
    }
  }
}
