const { google } = require('googleapis');
const { GoogleGenAI } = require('@google/genai');
const dotenv = require('dotenv');

dotenv.config({ override: true });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Инициализация OAuth2 клиента
const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  'http://localhost:3000/oauth2callback' // редирект для локального скрипта
);

// Если есть refresh token, задаем его
if (process.env.YOUTUBE_REFRESH_TOKEN) {
  oauth2Client.setCredentials({
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
  });
}

const youtube = google.youtube({
  version: 'v3',
  auth: oauth2Client
});

async function runYouTubeBot(appType) {
  console.log(`[YouTubeBot] Запуск комментирования для: ${appType}`);

  if (!process.env.YOUTUBE_REFRESH_TOKEN) {
    console.log('[YouTubeBot] Отмена: YOUTUBE_REFRESH_TOKEN не настроен. Пройдите авторизацию.');
    return;
  }

  let searchQuery = '';
  let botContext = '';

  if (appType === 'iptv') {
    searchQuery = 'бесплатные iptv плейлисты настройка SmartTV фильмы';
    botContext = `Фишки приложения "StreamLume" (премиальный IPTV-плеер, Яндекс Диск: https://disk.yandex.ru/d/PLgFGtCwF8yCjg):
    • Избранное — собираешь свой пакет из 5000+ каналов из 8 разных источников
    • Для ТВ Samsung/LG идеальный запуск без флешек через Media Station X
    • Не нужно париться с настройкой — всё работает сразу
    • Смена соотношения сторон, HD-качество, EPG-программа
    • 3 дня бесплатно — через Telegram-бот @StreameLumeBot`;
  } else {
    return;
  }

  try {
    // 1. Ищем релевантные видео (берем несколько, чтобы найти комментарии)
    const searchRes = await youtube.search.list({
      part: 'snippet',
      q: searchQuery,
      order: 'relevance', // Берем популярные/релевантные, где есть комментарии
      maxResults: 5,
      type: 'video'
    });

    if (!searchRes.data.items || searchRes.data.items.length === 0) {
      console.log('[YouTubeBot] Подходящих видео не найдено.');
      return;
    }

    let targetCommentId = null;
    let targetCommentText = null;
    let targetVideoId = null;

    // 2. Ищем комментарий с вопросом или болью пользователя
    for (const video of searchRes.data.items) {
      const videoId = video.id.videoId;
      try {
        const commentsRes = await youtube.commentThreads.list({
          part: 'snippet',
          videoId: videoId,
          order: 'relevance',
          maxResults: 20
        });

        if (commentsRes.data.items) {
          for (const thread of commentsRes.data.items) {
             const comment = thread.snippet.topLevelComment.snippet;
             const text = comment.textOriginal.toLowerCase();
             // Ищем вопросы или типичные боли
             const triggers = ['как', 'где', 'помогите', 'какой', 'подскажите', 'скачать', 'плеер', 'установить', 'не работает', 'проблема'];
             const hasTrigger = triggers.some(t => text.includes(t));
             
             if (hasTrigger && comment.textOriginal.length > 10 && comment.textOriginal.length < 300) {
                targetCommentId = thread.id;
                targetCommentText = comment.textOriginal;
                targetVideoId = videoId;
                break;
             }
          }
        }
      } catch (err) {
        // Комментарии могут быть отключены для конкретного видео, просто пропускаем
      }
      
      if (targetCommentId) break;
    }

    // 3. Формируем промпт для ИИ
    let promptText = '';
    if (targetCommentId) {
      console.log(`[YouTubeBot] Найден вопрос от пользователя: "${targetCommentText}" (Видео: ${targetVideoId})`);
      promptText = `
        Ты — обычный зритель на YouTube, пишешь как живой человек, коротко и по-русски.

        Контекст о приложении: ${botContext}

        Пользователь написал комментарий: "${targetCommentText}"

        Напиши ему ответ в 3 части (3-5 предложений всего):

        ЧАСТЬ 1 — Отвечаешь конкретно на его вопрос/проблему. По-человечески, без воды.
        ЧАСТЬ 2 — Как бы между прочим упоминаешь приложение через личный опыт. Выбери 1-2 фишки из контекста, которые решают именно его боль. Пример: "Я тоже долго мучился, пока не нашёл..." или "Была такая же история..."
        ЧАСТЬ 3 — Просишь отписаться если попробует. Например: "Если скачаешь — напиши потом работает или нет, самому интересно" или "Хочу знать как у других, у меня норм"

        ВАЖНО: никаких URL в тексте, никакой рекламной интонации, только текст комментария, язык — русский.
      `;
    } else {
      targetVideoId = searchRes.data.items[0].id.videoId;
      console.log(`[YouTubeBot] Вопросов в комментариях не найдено. Оставим общий отзыв под видео ${targetVideoId}`);
      promptText = `
        Ты — обычный зритель на YouTube, пишешь как живой человек, коротко и по-русски.

        Контекст о приложении: ${botContext}

        Напиши один живой комментарий под видео (2-3 предложения). Выгляди как обычный зритель, который делится находкой.
        Упомяни 1-2 конкретные фишки приложения из контекста. В конце — короткий призыв попробовать и отписаться.
        Никаких URL в тексте, только текст комментария, язык — русский.
      `;
    }

    // 4. Генерируем уникальный комментарий
    const aiResponse = await ai.models.generateContent({
      model: 'gemini-flash-lite-latest',
      contents: promptText,
    });
    
    let commentText = aiResponse.text.trim();
    if (commentText.startsWith('"') && commentText.endsWith('"')) {
      commentText = commentText.substring(1, commentText.length - 1);
    }

    console.log(`[YouTubeBot] Сгенерирован ответ: "${commentText}"`);

    // 5. Отправляем комментарий через API
    if (targetCommentId) {
      await youtube.comments.insert({
        part: 'snippet',
        requestBody: {
          snippet: {
            parentId: targetCommentId,
            textOriginal: commentText
          }
        }
      });
      console.log(`[YouTubeBot] ✅ Успешно ответили пользователю!`);
    } else {
      await youtube.commentThreads.insert({
        part: 'snippet',
        requestBody: {
          snippet: {
            videoId: targetVideoId,
            topLevelComment: {
              snippet: {
                textOriginal: commentText
              }
            }
          }
        }
      });
      console.log(`[YouTubeBot] ✅ Успешно оставлен комментарий под видео.`);
    }

  } catch (error) {
    if (error.message && error.message.includes('oauth2.googleapis.com/token failed')) {
      console.log(`[YouTubeBot] Временная ошибка сети при обновлении токена Google API. Запрос отложен.`);
    } else if (error.message && error.message.includes('503')) {
      console.log('[YouTubeBot] ИИ-модель временно недоступна (Gemini 503). Запрос отложен.');
    } else {
      console.error(`[YouTubeBot] ❌ Ошибка:`, error.message);
    }
  }
}

module.exports = { runYouTubeBot };

