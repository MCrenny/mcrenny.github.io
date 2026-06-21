require('dotenv').config({ path: './.env', override: true });
const { google } = require('googleapis');

async function test() {
  console.log("CLIENT_ID:", process.env.YOUTUBE_CLIENT_ID);
  
  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    'http://localhost:3000/oauth2callback'
  );

  if (process.env.YOUTUBE_REFRESH_TOKEN) {
    oauth2Client.setCredentials({
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
    });
  } else {
    console.log("NO REFRESH TOKEN");
    return;
  }

  const youtube = google.youtube({
    version: 'v3',
    auth: oauth2Client
  });

  try {
    const searchRes = await youtube.search.list({
      part: 'snippet',
      q: 'test',
      maxResults: 1,
      type: 'video'
    });
    console.log("SUCCESS!", searchRes.data.items.length);
  } catch (err) {
    console.error("ERROR:", err.message);
  }
}

test();
