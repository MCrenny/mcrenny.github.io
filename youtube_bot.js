const { google } = require('googleapis');
const { GoogleGenAI } = require('@google/genai');
const dotenv = require('dotenv');
const { isYoutubeCommentProcessed, markYoutubeCommentProcessed, getSetting, saveSetting } = require('./db.js');

dotenv.config({ override: true });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const proxyManager = require('./proxy_manager.js');

async function runYouTubeBot(appType) {
  console.log(`[YouTubeBot] Запуск комментирования для: ${appType}`);

  try {
    const lastRunStr = await getSetting('last_youtubebot_run');
    if (lastRunStr) {
      const lastRun = parseInt(lastRunStr);
      const timePassed = Date.now() - lastRun;
      const hoursPassed = timePassed / (1000 * 60 * 60);
      if (hoursPassed < 3) {
        console.log(`[YouTubeBot] Пропуск: комментарии проверялись ${hoursPassed.toFixed(1)} ч. назад (лимит 3 ч.).`);
        return;
      }
    }
  } catch (err) {
    console.error('[YouTubeBot] Ошибка при проверке времени последнего запуска:', err.message);
  }

  const clientId = (process.env.YOUTUBE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.YOUTUBE_CLIENT_SECRET || '').trim();
  const refreshToken = (process.env.YOUTUBE_REFRESH_TOKEN || '').trim();

  if (!clientId || !clientSecret || !refreshToken) {
    console.log('[YouTubeBot] Отмена: Не настроены учетные данные YouTube API (CLIENT_ID, CLIENT_SECRET или REFRESH_TOKEN). Проверьте переменные среды в Amvera.');
    return;
  }

  let botContext = '';
  let searchQueries = [];

  if (appType === 'iptv') {
    searchQueries = [
      'бесплатные iptv плейлисты настройка SmartTV фильмы',
      'как настроить iptv на телевизоре lg',
      'как смотреть фильмы бесплатно на смарт тв',
      'лучший iptv плеер для телевизора',
      'iptv samsung smart tv настройка',
      'где взять рабочие iptv плейлисты',
      'как установить media station x',
      'media station x настройка iptv',
      'что посмотреть вечером фильм',
      'топ сериалов 2026',
      'как обойти блокировку youtube на тв',
      'какую приставку купить для тв',
      'обзор android tv box',
      'настройка тв бокса с нуля'
    ];
    botContext = `Фишки приложения "StreamLume" (премиальный IPTV-плеер, Яндекс Диск: https://disk.yandex.ru/d/PLgFGtCwF8yCjg):
    • Избранное — собираешь свой пакет из 5000+ каналов из 8 разных источников
    • Теперь наш плеер нативно работает на любых Smart TV (Samsung, LG) через бесплатное приложение Media Station X
    • Не нужно париться с настройкой — все подробные инструкции по установке есть в Telegram-боте @StreameLumeBot
    • Смена соотношения сторон, HD-качество, EPG-программа
    • 3 дня бесплатно — также забирать через Telegram-бот @StreameLumeBot`;
  } else {
    return;
  }

  const searchQuery = searchQueries[Math.floor(Math.random() * searchQueries.length)];
  console.log(`[YouTubeBot] Выбран поисковый запрос: "${searchQuery}"`);

  let attempts = 100;
  while (attempts > 0) {
    try {
      // 0. Подготавливаем прокси
      const agent = await proxyManager.getWorkingProxy();
      if (agent) {
        google.options({
          httpAgent: agent,
          httpsAgent: agent
        });
      } else {
        console.log('[YouTubeBot] Не удалось найти рабочий прокси. Запрос отменен.');
        return;
      }

      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:3000/oauth2callback');
      oauth2Client.setCredentials({ refresh_token: refreshToken });

      const youtube = google.youtube({
        version: 'v3',
        auth: oauth2Client
      });

      // 1. Ищем релевантные видео (берем максимум 50 видео для максимального охвата)
      const searchRes = await youtube.search.list({
        part: 'snippet',
        q: searchQuery,
        order: 'relevance', 
        maxResults: 50,
        type: 'video'
      });

      if (!searchRes.data.items || searchRes.data.items.length === 0) {
        console.log('[YouTubeBot] Подходящих видео не найдено.');
        break;
      }

      let commentsPosted = 0;

      // 2. Идем по всем найденным видео и проверяем комментарии
      for (const video of searchRes.data.items) {
        const videoId = video.id.videoId;
        try {
          const commentsRes = await youtube.commentThreads.list({
            part: 'snippet',
            videoId: videoId,
            order: 'relevance',
            maxResults: 50
          });

          if (commentsRes.data.items) {
            for (const thread of commentsRes.data.items) {
               const commentId = thread.id;
               
               // Проверяем, отвечали ли мы уже на этот комментарий
               const isProcessed = await isYoutubeCommentProcessed(commentId);
               if (isProcessed) continue;

               const comment = thread.snippet.topLevelComment.snippet;
               const text = comment.textOriginal.toLowerCase();
               
               // Ищем вопросы или типичные боли
               const triggers = ['как', 'где', 'помогите', 'какой', 'подскажите', 'скачать', 'плеер', 'установить', 'не работает', 'проблема', 'что делать', 'ошибка', 'бесплатно'];
               const hasTrigger = triggers.some(t => text.includes(t));
               
               if (hasTrigger && comment.textOriginal.length > 10 && comment.textOriginal.length < 500) {
                  const targetCommentText = comment.textOriginal;
                  console.log(`[YouTubeBot] Найден вопрос от пользователя: "${targetCommentText.substring(0, 50)}..." (Видео: ${videoId})`);
                  
                  // 3. Формируем промпт для ИИ
                  const promptText = `
                    Ты — обычный зритель на YouTube, пишешь как живой человек, коротко и по-русски.

                    Контекст о приложении: ${botContext}

                    Пользователь написал комментарий: "${targetCommentText}"

                    Напиши ему ответ в 3 части (3-5 предложений всего):

                    ЧАСТЬ 1 — Отвечаешь конкретно на его вопрос/проблему. По-человечески, без воды.
                    ЧАСТЬ 2 — Как бы между прочим упоминаешь приложение через личный опыт. Выбери 1-2 фишки из контекста, которые решают именно его боль. Пример: "Я тоже долго мучился, пока не нашёл..." или "Была такая же история..."
                    ЧАСТЬ 3 — Просишь отписаться если попробует. Например: "Если скачаешь — напиши потом работает или нет, самому интересно" или "Хочу знать как у других, у меня норм"

                    ВАЖНО: никаких URL в тексте, никакой рекламной интонации, только текст комментария, язык — русский.
                  `;

                  // 4. Генерируем уникальный комментарий
                  const aiResponse = await ai.models.generateContent({
                    model: 'gemini-flash-lite-latest',
                    contents: promptText,
                  });
                  
                  let commentText = aiResponse.text.trim();
                  if (commentText.startsWith('"') && commentText.endsWith('"')) {
                    commentText = commentText.substring(1, commentText.length - 1);
                  }

                  // 5. Отправляем комментарий через API
                  await youtube.comments.insert({
                    part: 'snippet',
                    requestBody: {
                      snippet: {
                        parentId: commentId,
                        textOriginal: commentText
                      }
                    }
                  });
                  
                  // Сохраняем в базу, чтобы больше не отвечать на этот же коммент
                  await markYoutubeCommentProcessed(commentId);
                  commentsPosted++;
                  console.log(`[YouTubeBot] ✅ Ответили! Всего в этой сессии: ${commentsPosted}`);
               }
            }
          }
        } catch (err) {
          // Комментарии могут быть отключены для конкретного видео, или другие мелкие ошибки. Пропускаем.
        }
      }

      console.log(`[YouTubeBot] Цикл комментирования завершен. Ответов оставлено: ${commentsPosted}`);
      await saveSetting('last_youtubebot_run', Date.now().toString());
      break;

    } catch (error) {
      const isNetworkError = error.message && (
        error.message.includes('oauth2.googleapis.com/token failed') || 
        error.message.includes('ETIMEDOUT') || 
        error.message.includes('ECONNRESET') ||
        error.message.includes('socket hang up')
      );

      if (isNetworkError) {
        console.log(`[YouTubeBot] ⚠️ Сетевая ошибка (вероятно прокси умер):`, error.message);
        proxyManager.clearCache();
        attempts--;
        if (attempts > 0) {
          console.log(`[YouTubeBot] Пробуем еще раз (осталось попыток: ${attempts})...`);
        } else {
          console.log(`[YouTubeBot] ❌ Все попытки исчерпаны. Отмена задачи.`);
        }
      } else if (error.message && error.message.includes('503')) {
        console.log('[YouTubeBot] ИИ-модель временно недоступна (Gemini 503). Запрос отложен.');
        break;
      } else if (error.message && error.message.includes('invalid_client')) {
        console.error('[YouTubeBot] ❌ Ошибка авторизации (invalid_client): Проверьте YOUTUBE_CLIENT_ID и YOUTUBE_CLIENT_SECRET в панели Amvera.');
        break;
      } else if (error.message && error.message.includes('invalid_grant')) {
        console.error('[YouTubeBot] ❌ Ошибка авторизации (invalid_grant): Ваш REFRESH_TOKEN устарел или был отозван.');
        break;
      } else if (error.message && error.message.includes('quotaExceeded')) {
        console.error('[YouTubeBot] ❌ Квота YouTube API исчерпана (ограничение токенов Google).');
        break;
      } else {
        console.error(`[YouTubeBot] ❌ Ошибка:`, error.message);
        break;
      }
    }
  }
}

module.exports = { runYouTubeBot };
