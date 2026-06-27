const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 80;

// Разрешаем CORS для MSX и корректно обрабатываем preflight OPTIONS-запросы
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    
    // Перехватываем OPTIONS-запрос (CORS preflight) и возвращаем 200 OK
    // Если этого не сделать, express.static выдаст 404, и телевизор оборвет соединение!
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

// Отдача всех статических файлов из текущей папки
app.use(express.static(path.join(__dirname), {
    setHeaders: (res, path) => {
        // Отключаем кэш для конфигураций MSX
        if (path.endsWith('.json')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.setHeader('Surrogate-Control', 'no-store');
        }
    }
}));

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`StreamLume TV static server is running on port ${PORT}`);
});
