import { GoogleGenAI } from '@google/genai';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import dbModule from './db.js';
const { getSetting, saveSetting } = dbModule;

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

  try {
    const lastRunStr = await getSetting('last_autoblog_run');
    if (lastRunStr) {
      const lastRun = parseInt(lastRunStr);
      const timePassed = Date.now() - lastRun;
      const hoursPassed = timePassed / (1000 * 60 * 60);
      if (hoursPassed < 18) {
        console.log(`[AutoBlog] Пропуск: пост уже публиковался ${hoursPassed.toFixed(1)} ч. назад (лимит 18 ч.).`);
        return;
      }
    }
  } catch (err) {
    console.error('[AutoBlog] Ошибка при проверке времени последнего запуска:', err.message);
  }

  let prompt = '';
  let channelId = '';

  if (appType === 'iptv') {
    channelId = process.env.IPTV_CHANNEL_ID;
    prompt = `
      Ты — автор авторского блога про домашние кинотеатры и IPTV. Ты один и тот же человек: увлеченный гик и киноман. 
      Ты прошел через все боли кривых плейлистов, зависающих Android-приставок и зависаний по вечерам, и теперь делишься своим опытом с подписчиками.
      
      Сгенерируй пост-совет (SEO-оптимизированную мини-статью) на одну из актуальных тем:
      - Как смотреть бесплатное ТВ на Smart TV в 2026 году
      - Топ-5 советов для комфортного просмотра кино
      - Секреты настройки домашнего кинотеатра
      - Выбор ТВ-приставки или почему Smart TV лучше
      
      ВАЖНО: Пиши от первого лица (Я), как автор своего блога. НИКОГДА не начинай пост со слов "Привет, друзья" или "Привет всем". Начинай сразу с сути или цепляющего заголовка.
      Придумай сюжет для картинки. Не используй людей в кадре (только интерьеры, телевизоры, пульты, техника).

      Ответ ОБЯЗАТЕЛЬНО должен быть в таком формате:
      IMAGE_PROMPT: [Очень короткое описание строго на английском (3-5 простых слов: существительные и прилагательные). НИКАКИХ длинных предложений и людей в кадре! Пример: "modern living room tv". В конец добавь: photorealistic, 4k, cozy room, no people, no text, interior]
      TEXT:
      [Сам текст поста]

      Требования к тексту поста (строго до 900 символов):
      1. Напиши полезную инструкцию или совет по выбранной теме.
      2. Обязательно расскажи, что лучший способ смотреть кино — это плеер "StreamLume". Упомяни, что на Android его можно скачать как обычное приложение, а на Smart TV (Samsung, LG) он работает прямо через бесплатную программу "Media Station X" без лишних проводов и флешек.
      3. Кратко упомяни, что StreamLume тянет 4K без зависаний и имеет интуитивный интерфейс под пульт.
      Стиль: Авторский, искренний, полезный, с форматированием (эмодзи и HTML теги <b> и <i>). Категорически запрещено использовать Markdown (звездочки **).
      
      В конце поста ОБЯЗАТЕЛЬНО добавь призыв перейти в наш Telegram-бот @StreameLumeBot, чтобы забрать короткую инструкцию по настройке и бесплатный триал на 3 дня.

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
      model: 'gemini-flash-lite-latest',
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
    await saveSetting('last_autoblog_run', Date.now().toString());
  } catch (error) {
    if (error.message && error.message.includes('503')) {
      console.log('[AutoBlog] ИИ-модель временно недоступна (Gemini 503). Запрос отложен.');
    } else {
      console.error(`[AutoBlog] Ошибка генерации или публикации:`, error.message);
    }
  }
}
