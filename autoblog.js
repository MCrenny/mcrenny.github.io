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

    const iptvRoles = [
    'заядлый киноман, советующий как идеально обустроить домашний кинотеатр на выходных',
    'строгий техноблогер, делающий честный обзор и сравнивающий плеер с конкурентами',
    'обычный пользователь, который делится своей болью о вечных зависаниях старого ТВ-бокса и радостью от новой находки',
    'глава семьи, рассказывающий как они теперь смотрят сериалы и мультики без тормозов в 4K'
  ];

  if (appType === 'iptv') {
    channelId = process.env.IPTV_CHANNEL_ID;
    const role = iptvRoles[Math.floor(Math.random() * iptvRoles.length)];
    prompt = `
      Ты — ${role}. Твоя задача - создать увлекательный и уникальный пост про премиальный IPTV-плеер "StreamLume".
      
      ВАЖНО: НИКОГДА не начинай пост со слов "Привет, друзья" или "Привет всем". Каждый раз используй уникальный, цепляющий заголовок или нестандартное начало истории.
      Каждый раз придумывай новый сюжет для картинки (например: телевизор в темноте, пустой диван перед экраном, крупный план логотипа на смарт-тв и т.д.). Не используй людей в кадре.

      Ответ ОБЯЗАТЕЛЬНО должен быть в таком формате:
      IMAGE_PROMPT: [Короткое описание на английском языке для генератора картинок. СТРОГОЕ ПРАВИЛО: НИКАКИХ ЛЮДЕЙ, ЛИЦ ИЛИ РУК В КАДРЕ! Только телевизоры, пустые интерьеры гостиной, экраны крупным планом. В конец добавь слова: photorealistic, amateur photo, taken on mobile phone, real life, empty room, no people, no hands, no text]
      TEXT:
      [Сам текст поста]

      Требования к тексту поста (строго до 900 символов):
      Нативно и через призму своей роли расскажи про преимущества:
      1. Идеально подходит для просмотра фильмов, сериалов и ТВ в качестве 4K без зависаний.
      2. Премиальный, современный и очень удобный интерфейс.
      3. Легко настраивается на любом Smart TV или Android-приставке.
      Стиль: Живой, искренний, без лишней воды, с форматированием (используй эмодзи и простые HTML теги <b> и <i>). Категорически запрещено использовать Markdown (звездочки **).
      В конце поста ОБЯЗАТЕЛЬНО:
      1. Добавь призыв установить плеер "StreamLume" (доступно в Google Play, RuStore, Яндекс Диск: https://disk.yandex.ru/d/IXCgzWsHyWbdpg или Google Drive: https://drive.google.com/file/d/1tUthdGdyw8JX9_EKf0mcVmLiQjxztiuL/view?usp=drive_link).
      2. Добавь ссылку на наш Telegram-канал: t.me/streamlume_movies (для тех, кто будет читать это в Дзене).
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
