require('dotenv').config({ quiet: true });

const express = require('express');
const TelegramBot = require('./telegram-client');
const crypto = require('crypto');
const { closeDatabase, initializeDatabase, query } = require('./db');
const paymentsRepository = require('./repositories/payments');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.PAYMENT_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET;

if (!BOT_TOKEN || !ADMIN_ID || !PAYMENT_WEBHOOK_SECRET ||
    PAYMENT_WEBHOOK_SECRET.length < 32 || !process.env.DATABASE_URL) {
    throw new Error('PAYMENT_BOT_TOKEN, ADMIN_ID, DATABASE_URL and PAYMENT_WEBHOOK_SECRET (32+ characters) must be set');
}

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

app.use(express.json({
    limit: '32kb',
    verify: (req, res, buffer) => {
        req.rawBody = Buffer.from(buffer);
    }
}));
app.use(express.urlencoded({
    extended: false,
    limit: '32kb',
    verify: (req, res, buffer) => {
        req.rawBody = Buffer.from(buffer);
    }
}));

function verifyWebhook(req, res, next) {
    const suppliedHeader = req.get('X-Webhook-Signature') || '';
    const suppliedHex = suppliedHeader.replace(/^sha256=/i, '');
    const expected = crypto.createHmac('sha256', PAYMENT_WEBHOOK_SECRET)
        .update(req.rawBody || Buffer.alloc(0))
        .digest();
    let supplied;
    try {
        supplied = Buffer.from(suppliedHex, 'hex');
    } catch {
        return res.status(401).send('Invalid signature');
    }
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
        return res.status(401).send('Invalid signature');
    }
    next();
}

async function notifyAdmin(message, options = {}) {
    try {
        await bot.sendMessage(ADMIN_ID, message, options);
    } catch (error) {
        console.error('Ошибка отправки Telegram-уведомления:', error.message);
    }
}

function cleanField(value, maxLength = 200) {
    if (typeof value !== 'string') return null;
    const cleaned = value.trim();
    return cleaned && cleaned.length <= maxLength ? cleaned : null;
}

function cleanAmount(value) {
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 && amount <= 1000000000 ? amount : null;
}

// ✅ SUCCESS URL
app.post('/success', verifyWebhook, async (req, res) => {
    const { order_id, amount, status } = req.body;
    const orderId = cleanField(order_id, 100);
    const paymentAmount = cleanAmount(amount);
    const paymentStatus = cleanField(status, 50);
    if (!orderId || paymentAmount === null || !paymentStatus) {
        return res.status(400).send('Invalid payment data');
    }

    console.log('✅ Успешный платеж:', { order_id, amount, status });

    const stored = await paymentsRepository.recordSuccessfulPayment({
        orderId,
        amount: paymentAmount,
        status: paymentStatus
    });
    if (stored.duplicate) {
        return res.status(200).send('OK');
    }

    await notifyAdmin(`
💰 **Платеж успешно завершен!**
📋 Order ID: ${orderId}
💵 Сумма: ${paymentAmount}
📅 Время: ${new Date().toLocaleString('ru-RU')}
    `, { parse_mode: 'Markdown' });

    res.status(200).send('OK');
});

// ❌ FAIL URL
app.post('/fail', verifyWebhook, async (req, res) => {
    const { order_id, amount, error } = req.body;

    console.log('❌ Неудачный платеж:', { order_id, error });

    await notifyAdmin(`
💔 **Платеж не удался!**
📋 Order ID: ${order_id}
❌ Ошибка: ${error || 'Неизвестная ошибка'}
    `, { parse_mode: 'Markdown' });

    res.status(200).send('OK');
});

// 🔁 RESULT URL (обработка ответа)
app.post('/result', verifyWebhook, async (req, res) => {
    const { order_id, status, transaction_id } = req.body;
    const orderId = cleanField(order_id, 100);
    const paymentStatus = cleanField(status, 50);
    const transactionId = cleanField(transaction_id, 100);
    if (!orderId || !paymentStatus || !transactionId) {
        return res.status(400).send('Invalid payment result');
    }

    console.log('🔁 Результат платежа:', { order_id, status, transaction_id });

    await paymentsRepository.updatePaymentResult({
        orderId,
        status: paymentStatus,
        transactionId
    });

    res.status(200).send('OK');
});

// 💸 REFUND URL (возврат)
app.post('/refund', verifyWebhook, async (req, res) => {
    const { order_id, amount, reason } = req.body;

    console.log('💸 Возврат:', { order_id, amount, reason });

    await notifyAdmin(`
💸 **Возврат платежа!**
📋 Order ID: ${order_id}
💵 Сумма: ${amount}
📝 Причина: ${reason || 'Не указана'}
    `, { parse_mode: 'Markdown' });

    res.status(200).send('OK');
});

// ⚡ CHARGEBACK URL
app.post('/chargeback', verifyWebhook, async (req, res) => {
    const { order_id, amount, reason } = req.body;

    console.log('⚡ Чарджбэк:', { order_id, amount, reason });

    await notifyAdmin(`
⚡ **ЧАРДЖБЭК ПОЛУЧЕН!**
📋 Order ID: ${order_id}
💵 Сумма: ${amount}
📝 Причина: ${reason || 'Не указана'}
    `, { parse_mode: 'Markdown' });

    res.status(200).send('OK');
});

// Проверка статуса (для тестов)
app.get('/status', (req, res) => {
    res.json({ status: 'OK', service: 'Payment Webhook Server' });
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
    console.error('Payment request failed:', error);
    if (res.headersSent) return next(error);
    res.status(503).send('Database temporarily unavailable');
});

async function startServer() {
    await initializeDatabase();
    const server = app.listen(PORT, () => {
        console.log(`💳 Платежный сервер запущен на порту ${PORT}`);
    });

    async function shutdown() {
        await new Promise(resolve => server.close(resolve));
        await closeDatabase();
    }
    process.once('SIGTERM', () => shutdown().catch(console.error));
    process.once('SIGINT', () => shutdown().catch(console.error));
    return server;
}

app.locals.initializeDatabase = initializeDatabase;

if (require.main === module) {
    startServer().catch(error => {
        console.error('Не удалось запустить платёжный сервер:', error);
        process.exitCode = 1;
    });
}

module.exports = app;
