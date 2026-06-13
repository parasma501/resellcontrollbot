require('dotenv').config({ quiet: true });

const express = require('express');
const TelegramBot = require('./telegram-client');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.PAYMENT_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET;

if (!BOT_TOKEN || !ADMIN_ID || !PAYMENT_WEBHOOK_SECRET || PAYMENT_WEBHOOK_SECRET.length < 32) {
    throw new Error('PAYMENT_BOT_TOKEN, ADMIN_ID and PAYMENT_WEBHOOK_SECRET (32+ characters) must be set');
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

// Путь к файлу платежей (в папке data как и остальные)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const PAYMENT_FILE = path.join(DATA_DIR, 'payments.json');

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

function readPayments() {
    try {
        if (fs.existsSync(PAYMENT_FILE)) {
            return JSON.parse(fs.readFileSync(PAYMENT_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('Ошибка чтения payments.json:', error);
    }
    return { payments: [] };
}

function writePayments(data) {
    try {
        fs.writeFileSync(PAYMENT_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Ошибка записи payments.json:', error);
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
app.post('/success', verifyWebhook, (req, res) => {
    const { order_id, amount, status } = req.body;
    const orderId = cleanField(order_id, 100);
    const paymentAmount = cleanAmount(amount);
    const paymentStatus = cleanField(status, 50);
    if (!orderId || paymentAmount === null || !paymentStatus) {
        return res.status(400).send('Invalid payment data');
    }
    
    console.log('✅ Успешный платеж:', { order_id, amount, status });
    
    const data = readPayments();
    if (data.payments.some(payment => payment.order_id === orderId && payment.status === paymentStatus)) {
        return res.status(200).send('OK');
    }
    data.payments.push({
        order_id: orderId,
        amount: paymentAmount,
        status: paymentStatus,
        timestamp: new Date().toISOString()
    });
    writePayments(data);
    
    bot.sendMessage(ADMIN_ID, `
💰 **Платеж успешно завершен!**
📋 Order ID: ${orderId}
💵 Сумма: ${paymentAmount}
📅 Время: ${new Date().toLocaleString('ru-RU')}
    `);
    
    res.status(200).send('OK');
});

// ❌ FAIL URL
app.post('/fail', verifyWebhook, (req, res) => {
    const { order_id, amount, error } = req.body;
    
    console.log('❌ Неудачный платеж:', { order_id, error });
    
    bot.sendMessage(ADMIN_ID, `
💔 **Платеж не удался!**
📋 Order ID: ${order_id}
❌ Ошибка: ${error || 'Неизвестная ошибка'}
    `, { parse_mode: 'Markdown' });
    
    res.status(200).send('OK');
});

// 🔁 RESULT URL (обработка ответа)
app.post('/result', verifyWebhook, (req, res) => {
    const { order_id, status, transaction_id } = req.body;
    const orderId = cleanField(order_id, 100);
    const paymentStatus = cleanField(status, 50);
    const transactionId = cleanField(transaction_id, 100);
    if (!orderId || !paymentStatus || !transactionId) {
        return res.status(400).send('Invalid payment result');
    }
    
    console.log('🔁 Результат платежа:', { order_id, status, transaction_id });
    
    const data = readPayments();
    const payment = data.payments.find(p => p.order_id === orderId);
    if (payment) {
        payment.status = paymentStatus;
        payment.transaction_id = transactionId;
        writePayments(data);
    }
    
    res.status(200).send('OK');
});

// 💸 REFUND URL (возврат)
app.post('/refund', verifyWebhook, (req, res) => {
    const { order_id, amount, reason } = req.body;
    
    console.log('💸 Возврат:', { order_id, amount, reason });
    
    bot.sendMessage(ADMIN_ID, `
💸 **Возврат платежа!**
📋 Order ID: ${order_id}
💵 Сумма: ${amount}
📝 Причина: ${reason || 'Не указана'}
    `, { parse_mode: 'Markdown' });
    
    res.status(200).send('OK');
});

// ⚡ CHARGEBACK URL
app.post('/chargeback', verifyWebhook, (req, res) => {
    const { order_id, amount, reason } = req.body;
    
    console.log('⚡ Чарджбэк:', { order_id, amount, reason });
    
    bot.sendMessage(ADMIN_ID, `
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

if (require.main === module) app.listen(PORT, () => {
    console.log(`💳 Платежный сервер запущен на порту ${PORT}`);
});

module.exports = app;
