// Пинг для предотвращения засыпания
const https = require('https');

const YOUR_RENDER_URL = process.env.RENDER_EXTERNAL_URL; // Автоматически от Render

function ping() {
    if (!YOUR_RENDER_URL) {
        console.log('Render URL не настроен');
        return;
    }
    
    https.get(YOUR_RENDER_URL, (res) => {
        console.log('✅ Ping успешен:', res.statusCode);
    }).on('error', (err) => {
        console.error('❌ Ping ошибка:', err.message);
    });
}

// Пинг каждые 10 минут (до 15 мин лимита Render)
setInterval(ping, 10 * 60 * 1000);
ping();