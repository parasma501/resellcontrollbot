const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const BOT_TOKEN = process.env.BOT_TOKEN || '8597812988:AAHpBTTmWvFPB0drkx01_DlwXLylEqOQIWM';
const ADMIN_ID = process.env.ADMIN_ID || '705565283';
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const PAYMENT_LINK = 'https://yoomoney.ru/to/4100119530608840';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('🤖 Бот запущен!');

// ========== ФУНКЦИИ РАБОТЫ С ДАННЫМИ ==========
function readRentData() {
    try {
        const f = path.join(DATA_DIR, 'rent-data.json');
        return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { rentals: [] };
    } catch(e) { return { rentals: [] }; }
}
function writeRentData(data) {
    fs.writeFileSync(path.join(DATA_DIR, 'rent-data.json'), JSON.stringify(data, null, 2));
}
function readKeys() {
    try {
        const f = path.join(DATA_DIR, 'keys.json');
        if (fs.existsSync(f)) {
            const d = JSON.parse(fs.readFileSync(f, 'utf8'));
            return Array.isArray(d) ? d : (d.keys && Array.isArray(d.keys) ? d.keys : []);
        }
    } catch(e) {}
    return [];
}
function writeKeys(keys) {
    fs.writeFileSync(path.join(DATA_DIR, 'keys.json'), JSON.stringify(keys, null, 2));
}
function saveUser(chatId) {
    const f = path.join(DATA_DIR, 'users.json');
    let users = [];
    if (fs.existsSync(f)) users = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!users.includes(chatId)) {
        users.push(chatId);
        fs.writeFileSync(f, JSON.stringify(users, null, 2));
    }
}
function formatDate(iso) { return new Date(iso).toLocaleString('ru-RU'); }

// Убедитесь, что функция checkRentalsAndNotify корректно отправляет уведомления
// (она уже есть в вашем коде, но для уверенности можно заменить на эту версию)
function checkRentalsAndNotify() {
    const data = readRentData();
    const now = new Date();
    let changed = false;
    (data.rentals || []).forEach(rental => {
        if (!rental.notified && new Date(rental.end) <= now) {
            const message = `🔔 Машина "${rental.propertyName}" вернулась из аренды (${new Date(rental.end).toLocaleString()})`;
            if (rental.telegramId) {
                bot.sendMessage(rental.telegramId, message).catch(e => console.error(e));
                console.log(`Уведомление отправлено пользователю ${rental.telegramId}`);
            } else {
                bot.sendMessage(ADMIN_ID, message + ' (у пользователя нет telegramId)').catch(e => console.error(e));
            }
            rental.notified = true;
            changed = true;
        }
    });
    if (changed) writeRentData(data);
}

// ========== КОМАНДЫ БОТА ==========
const commands = ['/start', '/help', '/status', '/payments', '/clue', '/pay'];
commands.forEach(cmd => {
    bot.onText(new RegExp(cmd), (msg) => {
        saveUser(msg.chat.id);
        if (cmd === '/start') {
            bot.sendMessage(msg.chat.id, `👋 Добро пожаловать! Команды: /help, /clue, /rentals, /payments`);
        } else if (cmd === '/help') {
            bot.sendMessage(msg.chat.id, `/start - приветствие\n/clue - как получить ключ\n/rentals - активные аренды\n/payments - платежи\n/generatekey (админ)`);
        } else if (cmd === '/status') {
            bot.sendMessage(msg.chat.id, `✅ Подписка активна (проверка через приложение).`);
        } else if (cmd === '/rentals') {
            const data = readRentData();
            const active = data.rentals.filter(r => new Date(r.end) > new Date());
            if (!active.length) return bot.sendMessage(msg.chat.id, '📭 Активных аренд нет');
            let text = '🚗 *Активные аренды:*\n';
            active.forEach((r,i) => text += `${i+1}. ${r.propertyName} до ${formatDate(r.end)}\n`);
            bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
        } else if (cmd === '/payments') {
            bot.sendMessage(msg.chat.id, '📜 История платежей: обратитесь к администратору.');
        } else if (cmd === '/clue') {
            bot.sendMessage(msg.chat.id, `💳 Оплатите ${PAYMENT_LINK}, затем напишите в Discord: https://discord.gg/EfndfUnApv`);
        } else if (cmd === '/pay') {
            bot.sendMessage(msg.chat.id, `💰 Оплата: ${PAYMENT_LINK}`);
        }
    });
});

// Админ команды
bot.onText(/\/generatekey/, (msg) => {
    if (String(msg.chat.id) !== ADMIN_ID) return;
    const key = 'RES-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    const keys = readKeys();
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 30);
    keys.push({ key, used: false, expiryDate: expiry.toISOString(), createdAt: new Date().toISOString(), telegramId: null });
    writeKeys(keys);
    bot.sendMessage(msg.chat.id, `✅ Новый ключ: \`${key}\``, { parse_mode: 'Markdown' });
});
bot.onText(/\/showallkeys/, (msg) => {
    if (String(msg.chat.id) !== ADMIN_ID) return;
    const keys = readKeys();
    if (!keys.length) return bot.sendMessage(msg.chat.id, 'Нет ключей');
    const list = keys.map(k => `${k.key} — used:${k.used}, истекает:${k.expiryDate ? new Date(k.expiryDate).toLocaleDateString() : 'нет'}, tgId:${k.telegramId || 'нет'}`).join('\n');
    bot.sendMessage(msg.chat.id, list);
});

// ========== ЭНДПОИНТЫ ДЛЯ ПРИЛОЖЕНИЯ ==========
app.post('/checkkey', (req, res) => {
    const { key, telegramId } = req.body;
    console.log('/checkkey:', key, 'telegramId:', telegramId);
    const keys = readKeys();
    const found = keys.find(k => k.key === key);
    if (!found) return res.json({ valid: false, message: 'Неверный ключ' });
    if (found.used && found.expiryDate && new Date(found.expiryDate) > new Date()) {
        return res.json({ valid: true, expiryDate: found.expiryDate });
    }
    if (found.used) return res.json({ valid: false, message: 'Ключ уже активирован' });
    found.used = true;
    found.telegramId = telegramId || null;
    writeKeys(keys);
    res.json({ valid: true, expiryDate: found.expiryDate });
});

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

// Админ-команда: очистка завершённых аренд
bot.onText(/\/clearoldrentals/, (msg) => {
    if (String(msg.chat.id) !== ADMIN_ID) return;
    const data = readRentData();
    const now = new Date();
    const originalCount = data.rentals?.length || 0;
    // Оставляем только те аренды, у которых дата окончания ещё не наступила
    data.rentals = (data.rentals || []).filter(r => new Date(r.end) > now);
    writeRentData(data);
    const removed = originalCount - data.rentals.length;
    bot.sendMessage(msg.chat.id, `🧹 Очищено ${removed} завершённых аренд. Осталось активных: ${data.rentals.length}.`);
});

bot.onText(/\/clearallrentals/, (msg) => {
    if (String(msg.chat.id) !== ADMIN_ID) return;
    writeRentData({ rentals: [] });
    bot.sendMessage(msg.chat.id, '✅ Все аренды удалены.');
});

// ========== ДИАГНОСТИКА АРЕНД ==========
bot.onText(/\/showrentdata/, (msg) => {
    if (String(msg.chat.id) !== ADMIN_ID) return;
    const data = readRentData();
    const rentals = data.rentals || [];
    if (!rentals.length) {
        bot.sendMessage(msg.chat.id, '📭 Нет аренд в rent-data.json');
        return;
    }
    const info = rentals.map(r => `${r.propertyName}: ${r.start} → ${r.end}, tgId=${r.telegramId}, notified=${r.notified || false}`).join('\n');
    bot.sendMessage(msg.chat.id, `📋 Аренды:\n${info}`);
});

bot.onText(/\/forcecheck/, (msg) => {
    if (String(msg.chat.id) !== ADMIN_ID) return;
    checkRentalsAndNotify();
    bot.sendMessage(msg.chat.id, '✅ Принудительная проверка выполнена');
});

app.post('/api/rental-ended', (req, res) => {
    const { telegramId, carName, endDate } = req.body;
    if (!telegramId) return res.status(400).json({ error: 'telegramId required' });
    const message = `🚗 Машина "${carName}" вернулась из аренды (${new Date(endDate).toLocaleString()}).`;
    bot.sendMessage(telegramId, message)
        .then(() => res.json({ ok: true }))
        .catch(err => {
            console.error(`Ошибка отправки пользователю ${telegramId}:`, err.message);
            if (err.message.includes('chat not found')) {
                // Опционально: удалить невалидный telegramId из ключа в keys.json
                const keys = readKeys();
                const keyRecord = keys.find(k => k.telegramId == telegramId);
                if (keyRecord) {
                    keyRecord.telegramId = null;
                    writeKeys(keys);
                    console.log(`Удалён невалидный telegramId ${telegramId} из ключа ${keyRecord.key}`);
                }
            }
            res.status(500).json({ error: err.message });
        });
});

app.post('/api/add-rental', (req, res) => {
    const { key, propertyName, start, end, total } = req.body;
    console.log('/api/add-rental:', key, propertyName);
    const keys = readKeys();
    const keyRecord = keys.find(k => k.key === key);
    if (!keyRecord) return res.status(404).json({ error: 'Key not found' });
    const data = readRentData();
    const newRental = {
        id: Date.now(),
        propertyName,
        start,
        end,
        total: total || 0,
        telegramId: keyRecord.telegramId,
        key
    };
    data.rentals = data.rentals || [];
    data.rentals.push(newRental);
    writeRentData(data);
    res.json({ ok: true, rentalId: newRental.id });
});

app.listen(PORT, () => console.log(`Сервер на порту ${PORT}`));
