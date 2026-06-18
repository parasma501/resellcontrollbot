require('dotenv').config({ quiet: true });

const TelegramBot = require('./telegram-client');
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ======== КОНФИГУРАЦИЯ (ДО СОЗДАНИЯ БОТА) ========
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const SESSION_SECRET = process.env.SESSION_SECRET;
const TELEGRAM_POLLING = process.env.DISABLE_TELEGRAM_POLLING !== 'true';
const SUBSCRIPTION_DAYS = 30;
const RENTAL_CHECK_INTERVAL_MS = 60 * 1000;
const CORS_ORIGINS = new Set(
    (process.env.CORS_ORIGINS || 'null')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean)
);

if (!BOT_TOKEN || !ADMIN_ID || !SESSION_SECRET || SESSION_SECRET.length < 32) {
    throw new Error('BOT_TOKEN, ADMIN_ID and SESSION_SECRET (32+ characters) must be set');
}

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const PAYMENT_LINK = 'https://yoomoney.ru/to/4100119530608840';

// ======== ИНИЦИАЛИЗАЦИЯ БОТА (ОДИН РАЗ) ========
const bot = new TelegramBot(BOT_TOKEN, { polling: TELEGRAM_POLLING });
// Удаляем возможный webhook, чтобы избежать конфликта 409
if (TELEGRAM_POLLING) {
    bot.deleteWebHook({ drop_pending_updates: true }).catch(() => {});
}

console.log('🤖 Бот запущен!');

// ======== EXPRESS ========
const app = express();
app.use((req, res, next) => {
    const origin = req.get('Origin');
    if (origin && CORS_ORIGINS.has(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Vary', 'Origin');
    }
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('X-Frame-Options', 'DENY');
    res.header('Referrer-Policy', 'no-referrer');
    res.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (origin && !CORS_ORIGINS.has(origin)) {
        return res.status(403).json({ error: 'Origin not allowed' });
    }
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

function createRateLimiter({ windowMs, max }) {
    const clients = new Map();
    return (req, res, next) => {
        const now = Date.now();
        if (clients.size > 10000) {
            for (const [client, record] of clients) {
                if (record.resetAt <= now) clients.delete(client);
            }
        }
        const key = req.ip;
        const record = clients.get(key);
        if (!record || record.resetAt <= now) {
            clients.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }
        record.count += 1;
        if (record.count > max) {
            res.set('Retry-After', Math.ceil((record.resetAt - now) / 1000));
            return res.status(429).json({ error: 'Too many requests' });
        }
        next();
    };
}

app.use('/api', createRateLimiter({ windowMs: 15 * 60 * 1000, max: 120 }));
const activationLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

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
function hashKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
}
function findKeyRecord(keys, key) {
    if (typeof key !== 'string' || key.length < 8 || key.length > 128) return null;
    const candidateHash = hashKey(key);
    return keys.find(record => {
        if (record.keyHash) {
            const stored = Buffer.from(record.keyHash, 'hex');
            const candidate = Buffer.from(candidateHash, 'hex');
            return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
        }
        return record.key === key;
    }) || null;
}
function migrateKeyRecord(record) {
    if (record.key && !record.keyHash) {
        record.keyHash = hashKey(record.key);
        delete record.key;
    }
    return record;
}
function encodeBase64Url(value) {
    return Buffer.from(value).toString('base64url');
}
function issueSession(record) {
    const payload = {
        sub: record.keyHash,
        telegramId: String(record.telegramId),
        exp: Math.floor(new Date(record.expiryDate).getTime() / 1000)
    };
    const encoded = encodeBase64Url(JSON.stringify(payload));
    const signature = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
}
function verifySession(token) {
    if (typeof token !== 'string') return null;
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) return null;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest();
    let supplied;
    try {
        supplied = Buffer.from(signature, 'base64url');
    } catch {
        return null;
    }
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
    try {
        const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        if (!payload.sub || !payload.telegramId || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) {
            return null;
        }
        return payload;
    } catch {
        return null;
    }
}
function requireSession(req, res, next) {
    const authorization = req.get('Authorization') || '';
    const payload = verifySession(authorization.startsWith('Bearer ') ? authorization.slice(7) : '');
    if (!payload) return res.status(401).json({ error: 'Valid session required' });
    const record = readKeys().find(key => key.keyHash === payload.sub);
    if (!record || !record.used || String(record.telegramId) !== payload.telegramId ||
        !record.expiryDate || new Date(record.expiryDate) <= new Date()) {
        return res.status(401).json({ error: 'Session expired or revoked' });
    }
    req.subscription = { payload, record };
    next();
}
function isValidTelegramId(value) {
    return typeof value === 'string' && /^[1-9]\d{4,14}$/.test(value);
}
function isValidDate(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function cleanText(value, maxLength) {
    if (typeof value !== 'string') return null;
    const cleaned = value.trim();
    return cleaned && cleaned.length <= maxLength ? cleaned : null;
}
function getSubscriptionExpiry() {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + SUBSCRIPTION_DAYS);
    return expiry.toISOString();
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

// ========== ПРОВЕРКА АРЕНД (если нужна) ==========
async function checkRentalsAndNotify() {
    const data = readRentData();
    const now = new Date();
    let changed = false;
    for (const rental of data.rentals || []) {
        if (!rental.notified && new Date(rental.end) <= now) {
            const message = `🔔 Машина "${rental.propertyName}" вернулась из аренды (${new Date(rental.end).toLocaleString()})`;
            const chatId = rental.telegramId || ADMIN_ID;
            const finalMessage = rental.telegramId ? message : `${message} (у пользователя нет telegramId)`;
            try {
                await bot.sendMessage(chatId, finalMessage);
                rental.notified = true;
                changed = true;
                console.log(`Уведомление отправлено пользователю ${chatId}`);
            } catch (error) {
                console.error(`Не удалось отправить уведомление пользователю ${chatId}:`, error.message);
            }
        }
    }
    if (changed) writeRentData(data);
}

// ========== КОМАНДЫ БОТА ==========
const commands = ['/start', '/help', '/status', '/payments', '/clue', '/pay'];
commands.forEach(cmd => {
    bot.onText(new RegExp(cmd), (msg) => {
        saveUser(msg.chat.id);
        if (cmd === '/start') {
            bot.sendMessage(msg.chat.id, `👋 Добро пожаловать! Команды: /help, /clue, /payments`);
        } else if (cmd === '/help') {
            bot.sendMessage(msg.chat.id, `/start - приветствие\n/clue - как получить ключ\n/payments - платежи\n/generatekey (админ)`);
        } else if (cmd === '/status') {
            bot.sendMessage(msg.chat.id, `✅ Подписка активна (проверка через приложение).`);
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
    const key = `RES-${crypto.randomBytes(12).toString('base64url').toUpperCase()}`;
    const keys = readKeys();
    keys.push({
        keyHash: hashKey(key),
        keyHint: key.slice(-6),
        used: false,
        expiryDate: null,
        createdAt: new Date().toISOString(),
        telegramId: null
    });
    writeKeys(keys);
    bot.sendMessage(msg.chat.id, `✅ Новый ключ: \`${key}\``, { parse_mode: 'Markdown' });
});
bot.onText(/\/showallkeys/, (msg) => {
    if (String(msg.chat.id) !== ADMIN_ID) return;
    const keys = readKeys();
    if (!keys.length) return bot.sendMessage(msg.chat.id, 'Нет ключей');
    const list = keys.map(k => `...${k.keyHint || 'legacy'} — used:${k.used}, истекает:${k.expiryDate ? new Date(k.expiryDate).toLocaleDateString() : 'после активации'}, tgId:${k.telegramId || 'нет'}`).join('\n');
    bot.sendMessage(msg.chat.id, list);
});
bot.onText(/\/addkey (.+)/, (msg, match) => {
    if (String(msg.chat.id) !== ADMIN_ID) return;
    const key = match[1].trim();
    const keys = readKeys();
    if (findKeyRecord(keys, key)) {
        bot.sendMessage(msg.chat.id, '❌ Такой ключ уже существует');
        return;
    }
    keys.push({
        keyHash: hashKey(key),
        keyHint: key.slice(-6),
        used: false,
        activatedBy: null,
        expiryDate: null,
        createdAt: new Date().toISOString(),
        telegramId: null
    });
    writeKeys(keys);
    bot.sendMessage(msg.chat.id, `✅ Ключ \`${key}\` добавлен в базу.`);
});
bot.onText(/\/clearoldrentals/, (msg) => {
    if (String(msg.chat.id) !== ADMIN_ID) return;
    const data = readRentData();
    const now = new Date();
    const originalCount = data.rentals?.length || 0;
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

// Команда для сброса ключа (только для админа)
bot.onText(/\/resetkey (.+)/, (msg, match) => {
    if (String(msg.chat.id) !== ADMIN_ID) return;
    const key = match[1].trim();
    const keys = readKeys();
    const found = findKeyRecord(keys, key);
    if (!found) return bot.sendMessage(msg.chat.id, '❌ Ключ не найден.');
    migrateKeyRecord(found);
    found.used = false;
    found.telegramId = null;
    found.expiryDate = null;
    delete found.activatedAt;
    delete found.invalidTelegramId;
    writeKeys(keys);
    bot.sendMessage(msg.chat.id, `✅ Ключ \`${key}\` сброшен. Теперь его можно использовать повторно.`);
});

bot.onText(/\/webhookinfo/, async (msg) => {
    if (msg.chat.id.toString() !== ADMIN_ID) return;
    try {
        const webhookInfo = await bot.getWebHookInfo();
        const infoText = `
📡 *Информация о Webhook:*
• URL: \`${webhookInfo.url || 'Не установлен'}\`
• Используется polling: \`${webhookInfo.url ? 'Нет' : 'Да'}\`
• Ожидающие обновления: \`${webhookInfo.pending_update_count || 0}\`
• Последняя ошибка: \`${webhookInfo.last_error_message || 'Нет'}\`
        `;
        bot.sendMessage(msg.chat.id, infoText, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Ошибка получения информации о webhook:', error);
        bot.sendMessage(msg.chat.id, '❌ Не удалось получить информацию о webhook.');
    }
});
bot.onText(/\/delwebhook/, async (msg) => {
    if (msg.chat.id.toString() !== ADMIN_ID) return;
    try {
        await bot.deleteWebHook({ drop_pending_updates: true });
        bot.sendMessage(msg.chat.id, '✅ Webhook успешно удалён. Бот переключён на polling.');
    } catch (error) {
        console.error('Ошибка удаления webhook:', error);
        bot.sendMessage(msg.chat.id, '❌ Не удалось удалить webhook.');
    }
});
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
bot.onText(/\/forcecheck/, async (msg) => {
    if (String(msg.chat.id) !== ADMIN_ID) return;
    await checkRentalsAndNotify();
    bot.sendMessage(msg.chat.id, '✅ Принудительная проверка выполнена');
});

// ========== ЭНДПОИНТЫ ДЛЯ ПРИЛОЖЕНИЯ ==========
app.get('/status', (req, res) => {
    res.json({ status: 'OK', service: 'Resell Control Bot' });
});

function activateKey(req, res) {
    const { key, telegramId } = req.body;
    if (!isValidTelegramId(String(telegramId || ''))) {
        return res.status(400).json({ valid: false, message: 'Invalid Telegram ID' });
    }
    const keys = readKeys();
    const found = findKeyRecord(keys, key);
    if (!found) return res.json({ valid: false, message: 'Неверный ключ' });
    migrateKeyRecord(found);
    if (found.used && (!found.expiryDate || new Date(found.expiryDate) <= new Date())) {
        return res.json({ valid: false, message: 'Срок действия ключа истёк' });
    }
    if (found.used && String(found.telegramId) !== String(telegramId)) {
        return res.json({ valid: false, message: 'Ключ уже привязан к другому Telegram ID' });
    }
    if (!found.used) found.expiryDate = getSubscriptionExpiry();
    found.used = true;
    found.telegramId = String(telegramId);
    found.activatedAt = found.activatedAt || new Date().toISOString();
    writeKeys(keys);
    res.json({ valid: true, expiryDate: found.expiryDate, sessionToken: issueSession(found) });
}

app.post('/activate', activationLimiter, activateKey);
app.post('/checkkey', activationLimiter, activateKey);

app.get('/api/session', requireSession, (req, res) => {
    res.json({
        valid: true,
        expiryDate: req.subscription.record.expiryDate,
        telegramId: req.subscription.payload.telegramId
    });
});

app.post('/api/rental-ended', requireSession, async (req, res) => {
    const { carName, endDate, rentalId } = req.body;
    const safeCarName = cleanText(carName, 100);
    if (!safeCarName || !isValidDate(endDate)) {
        return res.status(400).json({ error: 'Valid carName and endDate are required' });
    }
    const telegramId = req.subscription.payload.telegramId;
    const message = `🚗 Машина "${safeCarName}" вернулась из аренды (${new Date(endDate).toLocaleString()}).`;
    try {
        await bot.sendMessage(telegramId, message);
        if (typeof rentalId === 'string' && rentalId) {
            const data = readRentData();
            const rental = (data.rentals || []).find(item =>
                item.id === rentalId && item.subscriptionId === req.subscription.payload.sub
            );
            if (rental) {
                rental.end = new Date(endDate).toISOString();
                rental.notified = true;
                rental.endedEarly = true;
                writeRentData(data);
            }
        }
        res.json({ ok: true });
    } catch (err) {
        console.error(`Ошибка отправки пользователю ${telegramId}:`, err.message);
        if (err.message.includes('chat not found')) {
            const keys = readKeys();
            const keyRecord = keys.find(k => k.keyHash === req.subscription.payload.sub);
            if (keyRecord) {
                keyRecord.used = false;
                keyRecord.telegramId = null;
                keyRecord.expiryDate = null;
                keyRecord.invalidTelegramId = telegramId;
                delete keyRecord.activatedAt;
                writeKeys(keys);
                console.log(`Сброшена подписка с невалидным Telegram ID`);
            }
        }
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/update-telegram-id', requireSession, (req, res) => {
    const { telegramId } = req.body;
    if (!isValidTelegramId(String(telegramId || ''))) {
        return res.status(400).json({ error: 'Invalid Telegram ID' });
    }
    const keys = readKeys();
    const found = keys.find(k => k.keyHash === req.subscription.payload.sub);
    if (!found) return res.status(404).json({ error: 'Key not found' });
    found.telegramId = String(telegramId);
    writeKeys(keys);
    res.json({ ok: true, sessionToken: issueSession(found) });
});

app.post('/api/add-rental', requireSession, (req, res) => {
    const { propertyName, start, end, total } = req.body;
    const safePropertyName = cleanText(propertyName, 100);
    const numericTotal = Number(total);
    if (!safePropertyName || !isValidDate(start) || !isValidDate(end) ||
        new Date(end) <= new Date(start) || !Number.isFinite(numericTotal) ||
        numericTotal < 0 || numericTotal > 1000000000) {
        return res.status(400).json({ error: 'Invalid rental data' });
    }
    const data = readRentData();
    const newRental = {
        id: crypto.randomUUID(),
        propertyName: safePropertyName,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        originalEnd: new Date(end).toISOString(),
        total: numericTotal,
        telegramId: req.subscription.payload.telegramId,
        subscriptionId: req.subscription.payload.sub
    };
    data.rentals = data.rentals || [];
    data.rentals.push(newRental);
    writeRentData(data);
    res.json({ ok: true, rentalId: newRental.id });
});

app.get('/healthz', (req, res) => res.sendStatus(200));

const PORT = process.env.PORT || 3000;
if (require.main === module) app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    setInterval(() => {
        checkRentalsAndNotify().catch(error => {
            console.error('Ошибка автоматической проверки аренд:', error);
        });
    }, RENTAL_CHECK_INTERVAL_MS);
    checkRentalsAndNotify().catch(error => {
        console.error('Ошибка первичной проверки аренд:', error);
    });
});

module.exports = app;
