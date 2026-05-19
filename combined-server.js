const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ======== КОНФИГУРАЦИЯ ========
const BOT_TOKEN = process.env.BOT_TOKEN || '8597812988:AAHpBTTmWvFPB0drkx01_DlwXLylEqOQIWM';
const ADMIN_ID = process.env.ADMIN_ID || '705565283';
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const PAYMENT_LINK = process.env.PAYMENT_LINK || 'https://yoomoney.ru/to/4100119530608840';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('🤖 Бот запущен!');
console.log(`💳 Сервер на порту ${PORT}`);

// ========== РАБОТА С ДАННЫМИ ==========
function readRentData() {
    try {
        const filePath = path.join(DATA_DIR, 'rent-data.json');
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch(e) { console.error(e); }
    return { rentals: [], lastNotification: {} };
}
function writeRentData(data) {
    try {
        fs.writeFileSync(path.join(DATA_DIR, 'rent-data.json'), JSON.stringify(data, null, 2));
    } catch(e) { console.error(e); }
}
function readPayments() {
    try {
        const filePath = path.join(DATA_DIR, 'payments.json');
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch(e) { console.error(e); }
    return { payments: [] };
}
function writePayments(data) {
    try {
        fs.writeFileSync(path.join(DATA_DIR, 'payments.json'), JSON.stringify(data, null, 2));
    } catch(e) { console.error(e); }
}
function readKeys() {
    try {
        const filePath = path.join(DATA_DIR, 'keys.json');
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (Array.isArray(data)) return data;
            if (data && Array.isArray(data.keys)) return data.keys;
        }
    } catch(e) { console.error(e); }
    return [];
}
function writeKeys(keysArray) {
    try {
        if (!Array.isArray(keysArray)) return;
        fs.writeFileSync(path.join(DATA_DIR, 'keys.json'), JSON.stringify(keysArray, null, 2));
        console.log(`💾 Сохранено ${keysArray.length} ключей`);
    } catch(e) { console.error(e); }
}
function saveUser(chatId) {
    const usersPath = path.join(DATA_DIR, 'users.json');
    let users = [];
    try {
        if (fs.existsSync(usersPath)) users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    } catch(e) {}
    if (!users.includes(chatId)) {
        users.push(chatId);
        fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
        console.log(`➕ Новый пользователь: ${chatId}`);
    }
}
function formatDateTime(isoString) {
    const d = new Date(isoString);
    return d.toLocaleString('ru-RU');
}

// ========== КОМАНДЫ БОТА ==========
bot.onText(/\/start/, (msg) => {
    saveUser(msg.chat.id);
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `
👋 Добро пожаловать в Resell Control Bot!

📌 Доступные команды:
/help - Показать помощь
/status - Статус подписки
/rentals - Активные аренды
/payments - История платежей

💎 Для активации премиум-версии:
1. Нажми /pay
2. Оплати сумму
3. Подписка активируется автоматически!
    `);
});

bot.onText(/\/help/, (msg) => {
    saveUser(msg.chat.id);
    bot.sendMessage(msg.chat.id, `
📖 **Помощь:**

/start - Стартовое сообщение
/help - Показать помощь
/status - Проверить статус подписки
/pay - Оплата подписки
/rentals - Активные аренды
/payments - История платежей
/clue - Порядок действий при оплате

🔧 **Админ-команды:**
/generatekey - Создать ключ
/addpayment - Записать платёж
    `, { parse_mode: 'Markdown' });
});

bot.onText(/\/pay/, (msg) => {
    saveUser(msg.chat.id);
    bot.sendMessage(msg.chat.id, `💎 **Оплата подписки**\n\n[ОПЛАТИТЬ](${PAYMENT_LINK})`, { parse_mode: 'Markdown' });
});

bot.onText(/\/status/, (msg) => {
    saveUser(msg.chat.id);
    bot.sendMessage(msg.chat.id, `**Статус подписки: АКТИВЕН** ✅`, { parse_mode: 'Markdown' });
});

bot.onText(/\/rentals/, (msg) => {
    saveUser(msg.chat.id);
    const data = readRentData();
    if (!data.rentals || data.rentals.length === 0) {
        bot.sendMessage(msg.chat.id, '📭 Активных аренд нет');
        return;
    }
    const activeRentals = data.rentals.filter(r => new Date(r.end) > new Date());
    if (activeRentals.length === 0) {
        bot.sendMessage(msg.chat.id, '📭 Активных аренд нет');
        return;
    }
    let message = '🚗 **Активные аренды:**\n\n';
    activeRentals.forEach((rental, index) => {
        const endDate = new Date(rental.end);
        const diffHours = Math.ceil((endDate - new Date()) / (1000 * 60 * 60));
        message += `${index+1}. *${rental.propertyName}*\n   🕐 Окончание: ${formatDateTime(rental.end)} (${diffHours}ч)\n\n`;
    });
    bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/payments/, (msg) => {
    saveUser(msg.chat.id);
    const data = readPayments();
    if (!data.payments || data.payments.length === 0) {
        bot.sendMessage(msg.chat.id, '📭 История платежей пуста');
        return;
    }
    let message = '💳 **История платежей:**\n\n';
    data.payments.slice(-10).reverse().forEach((p, i) => {
        message += `${i+1}. 💵 ${p.amount}$ - ${p.status}\n   📅 ${formatDateTime(p.timestamp)}\n\n`;
    });
    bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/clue/, (msg) => {
    saveUser(msg.chat.id);
    const discordLink = 'https://discord.gg/EfndfUnApv';
    bot.sendMessage(msg.chat.id, 
        `💳 **Чтобы получить ключ активации:**\n\n1. Оплатите подписку по ссылке: ${PAYMENT_LINK}\n2. После оплаты напишите **мне в Discord**: ${discordLink}\n3. Я проверю оплату и выдам вам ключ.\n\nСумма: 150 руб. Срок: 1 месяц.`,
        { parse_mode: 'Markdown' });
});

// Админские команды
bot.onText(/\/generatekey/, (msg) => {
    if (String(msg.chat.id) !== String(ADMIN_ID)) return;
    const key = 'RES-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    const keys = readKeys();
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);
    keys.push({
        key, used: false, activatedBy: null,
        expiryDate: expiryDate.toISOString(),
        createdAt: new Date().toISOString()
    });
    writeKeys(keys);
    bot.sendMessage(msg.chat.id, `✅ Новый ключ: \`${key}\``, { parse_mode: 'Markdown' });
});

// Временная команда для добавления существующих ключей (только админ)
bot.onText(/\/addkey (.+)/, (msg, match) => {
    if (String(msg.chat.id) !== String(ADMIN_ID)) return;
    const key = match[1].trim();
    const keys = readKeys();
    
    if (keys.find(k => k.key === key)) {
        bot.sendMessage(msg.chat.id, '❌ Такой ключ уже существует');
        return;
    }
    
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30); // срок 30 дней от сегодня
    keys.push({
        key: key,
        used: false,
        activatedBy: null,
        expiryDate: expiryDate.toISOString(),
        createdAt: new Date().toISOString(),
        telegramId: null
    });
    writeKeys(keys);
    bot.sendMessage(msg.chat.id, `✅ Ключ \`${key}\` добавлен в базу.`);
});

bot.onText(/\/addpayment/, (msg) => {
    if (String(msg.chat.id) !== String(ADMIN_ID)) return;
    const data = readPayments();
    data.payments.push({
        order_id: 'manual-' + Date.now(),
        amount: 1000,
        status: 'completed',
        timestamp: new Date().toISOString(),
        user_id: msg.chat.id
    });
    writePayments(data);
    bot.sendMessage(msg.chat.id, '✅ Платеж записан в историю!');
});

bot.onText(/\/showallkeys/, (msg) => {
    if (String(msg.chat.id) !== String(ADMIN_ID)) return;
    const keys = readKeys();
    if (!keys.length) return bot.sendMessage(msg.chat.id, '📭 Ключей нет');
    const list = keys.map(k => `${k.key} — used: ${k.used}${k.expiryDate ? `, истекает: ${new Date(k.expiryDate).toLocaleString()}` : ''}`).join('\n');
    bot.sendMessage(msg.chat.id, `📋 Список ключей:\n${list}`);
});

// ========== WEBHOOK ДЛЯ ПЛАТЕЖЕЙ ==========
app.post('/success', (req, res) => {
    const { order_id, amount, status, user_id } = req.body;
    console.log('✅ Успешный платеж:', { order_id, amount, status });
    const data = readPayments();
    data.payments.push({ order_id, amount, status, timestamp: new Date().toISOString(), user_id });
    writePayments(data);
    bot.sendMessage(ADMIN_ID, `💰 **Платеж успешен!**\n📋 Order ID: ${order_id}\n💵 ${amount}\n📅 ${new Date().toLocaleString()}`);
    if (user_id) {
        bot.sendMessage(user_id, `✅ **Оплата прошла успешно!**\n💎 Подписка активирована!`);
    }
    res.status(200).send('OK');
});

app.post('/fail', (req, res) => {
    const { order_id, error, user_id } = req.body;
    console.log('❌ Неудачный платеж:', order_id, error);
    bot.sendMessage(ADMIN_ID, `💔 **Платеж не удался!**\n📋 ${order_id}\n❌ ${error || 'Неизвестная ошибка'}`);
    res.status(200).send('OK');
});

// ========== ЭНДПОИНТ ДЛЯ ПРИЛОЖЕНИЯ ==========
app.post('/checkkey', (req, res) => {
    const { key, telegramId } = req.body;
    console.log('🔍 /checkkey получен ключ:', key);
    const keys = readKeys();
    const found = keys.find(k => k.key === key);
    if (!found) return res.json({ valid: false, message: 'Неверный ключ' });
    if (found.used === true) {
        if (found.expiryDate && new Date(found.expiryDate) > new Date()) {
            return res.json({ valid: true, expiryDate: found.expiryDate });
        } else {
            return res.json({ valid: false, message: 'Срок подписки истёк' });
        }
    }
    found.used = true;
    found.activatedBy = telegramId || 'electron-client';
    found.telegramId = telegramId;
    writeKeys(keys);
    res.json({ valid: true, expiryDate: found.expiryDate, message: 'Подписка активирована' });
});

bot.onText(/\/showrawkeys/, (msg) => {
    if (String(msg.chat.id) !== String(ADMIN_ID)) return;
    const filePath = path.join(DATA_DIR, 'keys.json');
    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        bot.sendMessage(msg.chat.id, `\`\`\`json\n${content}\n\`\`\``, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(msg.chat.id, 'Файл не найден');
    }
});

// Миграция keys.json из { keys: [] } в []
bot.onText(/\/migratekeys/, (msg) => {
    if (String(msg.chat.id) !== String(ADMIN_ID)) return;
    const filePath = path.join(DATA_DIR, 'keys.json');
    try {
        if (fs.existsSync(filePath)) {
            let data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (data && !Array.isArray(data) && Array.isArray(data.keys)) {
                const oldKeys = data.keys;
                fs.writeFileSync(filePath, JSON.stringify(oldKeys, null, 2));
                bot.sendMessage(msg.chat.id, `✅ Миграция выполнена! Перенесено ${oldKeys.length} ключей.`);
            } else {
                bot.sendMessage(msg.chat.id, `❌ Файл уже в нужном формате или повреждён.`);
            }
        } else {
            bot.sendMessage(msg.chat.id, `❌ Файл не найден.`);
        }
    } catch (err) {
        bot.sendMessage(msg.chat.id, `❌ Ошибка: ${err.message}`);
    }
});

// Сброс статуса всех ключей на used: false (только для миграции)
bot.onText(/\/resetkeys/, (msg) => {
    if (String(msg.chat.id) !== String(ADMIN_ID)) return;
    const keys = readKeys();
    let changed = 0;
    for (const k of keys) {
        if (k.used === true) {
            k.used = false;
            changed++;
        }
    }
    writeKeys(keys);
    bot.sendMessage(msg.chat.id, `✅ Сброшено ${changed} ключей. Теперь их можно активировать заново с Telegram ID.`);
});

app.post('/api/rental-ended', (req, res) => {
    const { telegramId, carName, endDate } = req.body;
    if (!telegramId) return res.status(400).json({ error: 'telegramId required' });
    bot.sendMessage(telegramId, `🚗 Машина "${carName}" вернулась из аренды (${new Date(endDate).toLocaleDateString()}).`)
        .then(() => res.json({ ok: true }))
        .catch(err => res.status(500).json({ error: err.message }));
});

// ========== ПРОВЕРКА ЗАВЕРШЁННЫХ АРЕНД ==========
function checkRentalsAndNotify() {
    const data = readRentData();
    const now = new Date();
    const notificationsSent = data.lastNotification || {};
    let hasChanges = false;
    data.rentals.forEach(rental => {
        const endDate = new Date(rental.end);
        const rentalId = rental.id;
        if (endDate <= now && !notificationsSent[rentalId]) {
            const message = `🔔 **Аренда завершена!**\n🚗 Машина: *${rental.propertyName}*\n📅 Начало: ${formatDateTime(rental.start)}\n📅 Конец: ${formatDateTime(rental.end)}\n💰 Сумма: ${rental.total.toLocaleString('ru-RU')}$\n\nМашина вернулась с аренды!`;
            if (rental.telegramId) {
                bot.sendMessage(rental.telegramId, message, { parse_mode: 'Markdown' }).catch(e => console.error(e));
            } else {
                bot.sendMessage(ADMIN_ID, message, { parse_mode: 'Markdown' });
            }
            notificationsSent[rentalId] = true;
            hasChanges = true;
        }
    });
    if (hasChanges) {
        data.lastNotification = notificationsSent;
        writeRentData(data);
    }
}
setInterval(checkRentalsAndNotify, 5 * 60 * 1000);
checkRentalsAndNotify();

// Добавление новой аренды (из приложения)
app.post('/api/add-rental', (req, res) => {
    const { key, propertyName, start, end, total } = req.body;
    if (!key || !propertyName || !start || !end) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    // Находим ключ, чтобы получить telegramId
    const keys = readKeys();
    const keyRecord = keys.find(k => k.key === key);
    if (!keyRecord) {
        return res.status(404).json({ error: 'Key not found' });
    }
    const telegramId = keyRecord.telegramId || null; // может быть null, если не сохранили

    const data = readRentData();
    const newRental = {
        id: Date.now(),
        propertyName,
        start,
        end,
        total: total || 0,
        telegramId,      // привязываем к пользователю
        key              // также сохраняем ключ для истории
    };
    if (!data.rentals) data.rentals = [];
    data.rentals.push(newRental);
    writeRentData(data);
    console.log(`➕ Добавлена аренда: ${propertyName}, telegramId=${telegramId}`);
    res.json({ ok: true, rentalId: newRental.id });
});

// ========== ТЕСТОВЫЕ МАРШРУТЫ ==========
app.get('/ping', (req, res) => res.send('pong'));
app.get('/', (req, res) => res.send('🤖 Resell Control Bot is alive!'));

// ========== ЗАПУСК ==========
app.listen(PORT, () => console.log(`💳 Payment server running on port ${PORT}`));
