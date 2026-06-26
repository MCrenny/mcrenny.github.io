export default async function handler(req, res) {
  const { query } = req;
  const path = req.url;

  // Media Station X expects a manifest at the root or a specific path
  // We handle the root request to provide the app manifest
  if (path === '/' || path === '/index') {
    return res.status(200).setHeader('Content-Type', 'application/json').send(JSON.stringify({
      "name": "StreamLume",
      "url": "https://msx-dev1.vercel.app/app",
      "icon": "https://msx-dev1.vercel.app/icon.png",
      "description": "Premium IPTV Service",
      "version": "1.0.9"
    }));
  }

  // Handle the main application entry point
  if (path.startsWith('/app')) {
    return res.status(200).setHeader('Content-Type', 'text/html').send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>StreamLume</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: sans-serif; background: #121212; color: white; text-align: center; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; }
            .btn { display: block; width: 100%; padding: 15px; margin: 10px 0; background: #e50914; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>StreamLume</h1>
            <p>Welcome to the Premium IPTV Experience</p>
            <a href="/api/playlists" class="btn">My Playlists</a>
            <a href="/api/support" class="btn">Support</a>
            <a href="/api/instructions" class="btn">Instructions</a>
          </div>
        </body>
      </html>
    `);
  }

  // Handle specific app routes
  if (path === '/api/playlists') {
    return res.status(200).setHeader('Content-Type', 'application/json').send(JSON.stringify({
      "playlists": [
        { "name": "Sports HD", "url": "http://your-server/sports.m3u8" },
        { "name": "Movies 4K", "url": "http://your-server/movies.m3u8" }
      ]
    }));
  }

  return res.status(404).send('Not Found');
}