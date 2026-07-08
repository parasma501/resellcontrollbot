require('dotenv').config({ quiet: true });

const TelegramBot = require('./telegram-client');
const express = require('express');
const crypto = require('crypto');
const { closeDatabase, initializeDatabase, query } = require('./db');
const keysRepository = require('./repositories/keys');
const rentalsRepository = require('./repositories/rentals');
const usersRepository = require('./repositories/users');

// ======== КОНФИГУРАЦИЯ (ДО СОЗДАНИЯ БОТА) ========
const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
const ADMIN_ID = process.env.ADMIN_ID;
const SESSION_SECRET = process.env.SESSION_SECRET;
const TELEGRAM_POLLING = process.env.DISABLE_TELEGRAM_POLLING !== 'true';
const SUBSCRIPTION_DAYS = 30;
const RENTAL_CHECK_INTERVAL_MS = 60 * 1000;
const DELETE_CONFIRM_TTL_MS = 5 * 60 * 1000;
const CORS_ORIGINS = new Set(
    (process.env.CORS_ORIGINS || 'null')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean)
);

if (!BOT_TOKEN || !ADMIN_ID || !SESSION_SECRET || SESSION_SECRET.length < 32 || !process.env.DATABASE_URL) {
    throw new Error('BOT_TOKEN, ADMIN_ID, DATABASE_URL and SESSION_SECRET (32+ characters) must be set');
}

const PAYMENT_LINK = 'https://yoomoney.ru/to/4100119530608840';

// ======== ИНИЦИАЛИЗАЦИЯ БОТА (ОДИН РАЗ) ========
const bot = new TelegramBot(BOT_TOKEN, { polling: false });
const pendingKeyDeletes = new Map();

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
async function requireSession(req, res, next) {
    const authorization = req.get('Authorization') || '';
    const payload = verifySession(authorization.startsWith('Bearer ') ? authorization.slice(7) : '');
    if (!payload) return res.status(401).json({ error: 'Valid session required' });
    const record = await keysRepository.findByHashHex(payload.sub);
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
function formatDate(iso) { return new Date(iso).toLocaleString('ru-RU'); }
function parseRestoreExpiry(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const expiry = new Date(`${value}T23:59:59.999+03:00`);
    if (!Number.isFinite(expiry.getTime())) return null;
    const [year, month, day] = value.split('-').map(Number);
    return expiry.getUTCFullYear() === year &&
        expiry.getUTCMonth() + 1 === month &&
        expiry.getUTCDate() === day
        ? expiry
        : null;
}
async function sendLongMessage(chatId, lines) {
    let chunk = '';
    for (const line of lines) {
        if (chunk && chunk.length + line.length + 1 > 3500) {
            await bot.sendMessage(chatId, chunk);
            chunk = '';
        }
        chunk += `${chunk ? '\n' : ''}${line}`;
    }
    if (chunk) await bot.sendMessage(chatId, chunk);
}
function pruneExpiredPendingKeyDeletes() {
    const now = Date.now();
    for (const [token, pending] of pendingKeyDeletes) {
        if (pending.expiresAt <= now) pendingKeyDeletes.delete(token);
    }
}
async function clearCallbackButtons(query) {
    const chatId = query.message?.chat?.id;
    const messageId = query.message?.message_id;
    if (!chatId || !messageId) return;
    await bot.editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] }).catch(error => {
        console.error('Failed to clear Telegram inline keyboard:', error.message);
    });
}

// ========== ПРОВЕРКА АРЕНД (если нужна) ==========
async function checkRentalsAndNotify() {
    const rentals = await rentalsRepository.listPendingNotifications();
    for (const rental of rentals) {
        const message = `🔔 Машина "${rental.propertyName}" вернулась из аренды (${new Date(rental.end).toLocaleString()})`;
        try {
            await bot.sendMessage(rental.telegramId, message);
            await rentalsRepository.markNotified(rental.id);
            console.log(`Уведомление отправлено пользователю ${rental.telegramId}`);
        } catch (error) {
            console.error(`Не удалось отправить уведомление пользователю ${rental.telegramId}:`, error.message);
        }
    }
}

// ========== КОМАНДЫ БОТА ==========
const commands = ['/start', '/help', '/status', '/payments', '/clue', '/pay'];
commands.forEach(cmd => {
    bot.onText(new RegExp(`^${cmd}(?:@\\w+)?$`), async (msg) => {
        await usersRepository.saveUser(msg.chat.id);
        if (cmd === '/start') {
            await bot.sendMessage(msg.chat.id, `👋 Добро пожаловать! Команды: /help, /clue, /payments`);
        } else if (cmd === '/help') {
            await bot.sendMessage(msg.chat.id, `/start - приветствие\n/clue - как получить ключ\n/payments - платежи\n/generatekey (админ)`);
        } else if (cmd === '/status') {
            await bot.sendMessage(msg.chat.id, `✅ Подписка активна (проверка через приложение).`);
        } else if (cmd === '/payments') {
            await bot.sendMessage(msg.chat.id, '📜 История платежей: обратитесь к администратору.');
        } else if (cmd === '/clue') {
            await bot.sendMessage(msg.chat.id, `💳 Оплатите ${PAYMENT_LINK}, затем напишите в Discord: https://discord.gg/EfndfUnApv`);
        } else if (cmd === '/pay') {
            await bot.sendMessage(msg.chat.id, `💰 Оплата: ${PAYMENT_LINK}`);
        }
    });
});

// Админ команды
bot.onText(/^\/generatekey(?:@\w+)?$/, async (msg) => {
    if (String(msg.chat.id) !== ADMIN_ID) return;
    let key;
    let result;
    do {
        key = `RES-${crypto.randomBytes(12).toString('base64url').toUpperCase()}`;
        result = await keysRepository.addUnusedKey(key);
    } while (result.status === 'exists');
    await bot.sendMessage(msg.chat.id, `✅ Новый ключ: ${key}`);
});
bot.onText(/^\/showallkeys(?:@\w+)?$/, async (msg) => {
    if (String(msg.chat.id) !== ADMIN_ID) return;
    const keys = await keysRepository.listKeys();
    if (!keys.length) return bot.sendMessage(msg.chat.id, 'Нет ключей');
    await sendLongMessage(msg.chat.id, keys.map(k =>
        `...${k.keyHint} — used:${k.used}, истекает:${k.expiryDate ? new Date(k.expiryDate).toLocaleDateString('ru-RU') : 'после активации'}, tgId:${k.telegramId || 'нет'}`
    ));
});
bot.onText(/^\/addkey\s+(.+)$/, async (msg, match) => {
    if (String(msg.chat.id) !== ADMIN_ID) return;
    const key = match[1].trim();
    const result = await keysRepository.addUnusedKey(key);
    if (result.status === 'invalid') {
        return bot.sendMessage(msg.chat.id, '❌ Ключ должен содержать от 8 до 128 символов.');
    }
    if (result.status === 'exists') {
        return bot.sendMessage(msg.chat.id, '❌ Такой ключ уже существует.');
    }
    await bot.sendMessage(msg.chat.id, `✅ Ключ ${key} добавлен в базу.`);
});

bot.onText(/^\/restorekey\s+(\S+)\s+(\d+)\s+(\d{4}-\d{2}-\d{2})$/, async (msg, match) => {
    if (String(msg.chat.id) !== ADMIN_ID) return;
    const [, key, telegramId, expiryText] = match;
    const expiry = parseRestoreExpiry(expiryText);
    if (!isValidTelegramId(telegramId)) {
        return bot.sendMessage(msg.chat.id, '❌ Некорректный Telegram ID.');
    }
    if (!expiry || expiry <= new Date()) {
        return bot.sendMessage(msg.chat.id, '❌ Укажите будущую дату в формате ГГГГ-ММ-ДД.');
    }
    const result = await keysRepository.restoreKey(key, telegramId, expiry);
    if (result.status === 'invalid') {
        return bot.sendMessage(msg.chat.id, '❌ Ключ должен содержать от 8 до 128 символов без пробелов.');
    }
    await bot.sendMessage(
        msg.chat.id,
        `✅ Ключ ...${result.record.keyHint} восстановлен для Telegram ID ${telegramId} до ${expiryText} включительно.`
    );
});

bot.onText(/^\/clearoldrentals(?:@\w+)?$/, async (msg) => {
    if (String(msg.chat.id) !== ADMIN_ID) return;
    const removed = await rentalsRepository.clearFinishedRentals();
    await bot.sendMessage(msg.chat.id, `🧹 Очищено завершённых аренд: ${removed}.`);
});
bot.onText(/^\/clearallrentals(?:@\w+)?$/, async (msg) => {
    if (String(msg.chat.id) !== ADMIN_ID) return;
    const removed = await rentalsRepository.clearAllRentals();
    await bot.sendMessage(msg.chat.id, `✅ Все аренды удалены (${removed}).`);
});

// Команда для сброса ключа (только для админа)
bot.onText(/^\/resetkey\s+(.+)$/, async (msg, match) => {
    if (String(msg.chat.id) !== ADMIN_ID) return;
    const key = match[1].trim();
    if (!await keysRepository.resetKey(key)) {
        return bot.sendMessage(msg.chat.id, '❌ Ключ не найден.');
    }
    await bot.sendMessage(msg.chat.id, `✅ Ключ ${key} сброшен. Теперь его можно использовать повторно.`);
});

bot.onText(/^\/deletekey\s+(.+)$/, async (msg, match) => {
    if (String(msg.chat.id) !== ADMIN_ID) return;
    pruneExpiredPendingKeyDeletes();

    const key = match[1].trim();
    const found = await keysRepository.findByPlainKey(key);
    if (!found) return bot.sendMessage(msg.chat.id, '❌ Ключ не найден.');

    const token = crypto.randomBytes(9).toString('base64url');
    const keyHint = found.keyHint || key.slice(-6);
    pendingKeyDeletes.set(token, {
        keyHash: found.keyHash,
        keyHint,
        requestedBy: String(msg.chat.id),
        expiresAt: Date.now() + DELETE_CONFIRM_TTL_MS
    });

    await bot.sendMessage(msg.chat.id, `⚠️ Удалить ключ ...${keyHint} полностью? Связанные аренды тоже будут удалены. Это действие нельзя отменить.`, {
        reply_markup: {
            inline_keyboard: [[
                { text: 'Подтвердить', callback_data: `deletekey:confirm:${token}` },
                { text: 'Отмена', callback_data: `deletekey:cancel:${token}` }
            ]]
        }
    });
});

bot.onCallbackQuery(async (query) => {
    const data = String(query.data || '');
    if (!data.startsWith('deletekey:')) return;

    if (String(query.from?.id || '') !== ADMIN_ID) {
        await bot.answerCallbackQuery(query.id, {
            text: 'Недоступно.',
            show_alert: true
        }).catch(() => {});
        return;
    }

    pruneExpiredPendingKeyDeletes();
    const [, action, token] = data.split(':');
    const pending = pendingKeyDeletes.get(token);
    if (!pending || pending.requestedBy !== String(query.message?.chat?.id || '')) {
        await bot.answerCallbackQuery(query.id, { text: 'Запрос уже истёк.' }).catch(() => {});
        await clearCallbackButtons(query);
        return;
    }

    if (action === 'cancel') {
        pendingKeyDeletes.delete(token);
        await bot.answerCallbackQuery(query.id, { text: 'Удаление отменено.' }).catch(() => {});
        await clearCallbackButtons(query);
        await bot.sendMessage(query.message.chat.id, `↩️ Удаление ключа ...${pending.keyHint} отменено.`);
        return;
    }

    if (action !== 'confirm') {
        await bot.answerCallbackQuery(query.id, { text: 'Неизвестное действие.' }).catch(() => {});
        return;
    }

    pendingKeyDeletes.delete(token);
    await clearCallbackButtons(query);
    const deleted = await keysRepository.deleteByHash(pending.keyHash);
    if (!deleted) {
        await bot.answerCallbackQuery(query.id, { text: 'Ключ уже удалён или не найден.' }).catch(() => {});
        await bot.sendMessage(query.message.chat.id, `ℹ️ Ключ ...${pending.keyHint} уже удалён или не найден.`);
        return;
    }

    await bot.answerCallbackQuery(query.id, { text: 'Ключ удалён.' }).catch(() => {});
    await bot.sendMessage(query.message.chat.id, `✅ Ключ ...${pending.keyHint} полностью удалён.`);
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
bot.onText(/^\/showrentdata(?:@\w+)?$/, async (msg) => {
    if (String(msg.chat.id) !== ADMIN_ID) return;
    const rentals = await rentalsRepository.listRentals();
    if (!rentals.length) {
        await bot.sendMessage(msg.chat.id, '📭 В базе нет аренд.');
        return;
    }
    await sendLongMessage(msg.chat.id, [
        '📋 Аренды:',
        ...rentals.map(r =>
            `${r.propertyName}: ${r.start} → ${r.end}, tgId=${r.telegramId}, notified=${r.notified}`
        )
    ]);
});
bot.onText(/^\/forcecheck(?:@\w+)?$/, async (msg) => {
    if (String(msg.chat.id) !== ADMIN_ID) return;
    await checkRentalsAndNotify();
    await bot.sendMessage(msg.chat.id, '✅ Принудительная проверка выполнена');
});

// ========== ЭНДПОИНТЫ ДЛЯ ПРИЛОЖЕНИЯ ==========
app.get('/status', (req, res) => {
    res.json({ status: 'OK', service: 'Resell Control Bot' });
});

async function activateKey(req, res) {
    const { key, telegramId } = req.body;
    if (!isValidTelegramId(String(telegramId || ''))) {
        return res.status(400).json({ valid: false, message: 'Invalid Telegram ID' });
    }
    const result = await keysRepository.activateKey(key, String(telegramId), SUBSCRIPTION_DAYS);
    if (result.status === 'not_found') {
        return res.json({ valid: false, message: 'Неверный ключ' });
    }
    if (result.status === 'expired') {
        return res.json({ valid: false, message: 'Срок действия ключа истёк' });
    }
    if (result.status === 'bound_to_another_user') {
        return res.json({ valid: false, message: 'Ключ уже привязан к другому Telegram ID' });
    }
    const found = result.record;
    res.json({
        valid: true,
        expiryDate: found.expiryDate,
        sessionToken: issueSession(found)
    });
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
            await rentalsRepository.endRentalEarly(
                rentalId,
                req.subscription.record.id,
                new Date(endDate)
            );
        }
        res.json({ ok: true });
    } catch (err) {
        console.error(`Ошибка отправки пользователю ${telegramId}:`, err.message);
        if (err.message.includes('chat not found')) {
            await keysRepository.invalidateTelegramId(
                req.subscription.payload.sub,
                telegramId
            );
            console.log('Сброшена подписка с невалидным Telegram ID');
        }
        res.status(500).json({ error: 'Failed to process rental notification' });
    }
});

app.post('/api/update-telegram-id', requireSession, async (req, res) => {
    const { telegramId } = req.body;
    if (!isValidTelegramId(String(telegramId || ''))) {
        return res.status(400).json({ error: 'Invalid Telegram ID' });
    }
    const found = await keysRepository.updateTelegramId(
        req.subscription.payload.sub,
        String(telegramId)
    );
    if (!found) return res.status(404).json({ error: 'Key not found' });
    res.json({ ok: true, sessionToken: issueSession(found) });
});

app.post('/api/add-rental', requireSession, async (req, res) => {
    const { propertyName, start, end, total } = req.body;
    const safePropertyName = cleanText(propertyName, 100);
    const numericTotal = Number(total);
    if (!safePropertyName || !isValidDate(start) || !isValidDate(end) ||
        new Date(end) <= new Date(start) || !Number.isFinite(numericTotal) ||
        numericTotal < 0 || numericTotal > 1000000000) {
        return res.status(400).json({ error: 'Invalid rental data' });
    }
    const newRental = {
        id: crypto.randomUUID(),
        subscriptionKeyId: req.subscription.record.id,
        propertyName: safePropertyName,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        originalEnd: new Date(end).toISOString(),
        total: numericTotal,
        telegramId: req.subscription.payload.telegramId
    };
    await rentalsRepository.addRental(newRental);
    res.json({ ok: true, rentalId: newRental.id });
});

app.get('/healthz', async (req, res) => {
    try {
        await query('SELECT 1');
        res.sendStatus(200);
    } catch {
        res.sendStatus(503);
    }
});

app.use((error, req, res, next) => {
    console.error('Server request failed:', error);
    if (res.headersSent) return next(error);
    res.status(503).json({ error: 'Database temporarily unavailable' });
});

const PORT = process.env.PORT || 3000;
async function startServer() {
    await initializeDatabase();
    if (TELEGRAM_POLLING) {
        await bot.deleteWebHook({ drop_pending_updates: true }).catch(error => {
            console.error('Не удалось удалить Telegram webhook:', error.message);
        });
        bot.startPolling();
    }

    const server = app.listen(PORT, () => {
        console.log(`Сервер запущен на порту ${PORT}`);
        console.log('🤖 Бот запущен!');
    });
    const rentalTimer = setInterval(() => {
        checkRentalsAndNotify().catch(error => {
            console.error('Ошибка автоматической проверки аренд:', error);
        });
    }, RENTAL_CHECK_INTERVAL_MS);
    checkRentalsAndNotify().catch(error => {
        console.error('Ошибка первичной проверки аренд:', error);
    });

    async function shutdown() {
        clearInterval(rentalTimer);
        bot.stopPolling();
        await new Promise(resolve => server.close(resolve));
        await closeDatabase();
    }
    process.once('SIGTERM', () => shutdown().catch(console.error));
    process.once('SIGINT', () => shutdown().catch(console.error));
    return server;
}

app.locals.bot = bot;
app.locals.initializeDatabase = initializeDatabase;

if (require.main === module) {
    startServer().catch(error => {
        console.error('Не удалось запустить сервер:', error);
        process.exitCode = 1;
    });
}

module.exports = app;
