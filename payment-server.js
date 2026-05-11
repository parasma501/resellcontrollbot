const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = '8601564949:AAHcdt-buu5sv8kSTj1kyz5yh21IIWj01a8';
const ADMIN_ID = '705565283';

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Путь к файлу платежей (в папке data как и остальные)
const PAYMENT_FILE = path.join(__dirname, '../data/payments.json');

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

// ✅ SUCCESS URL
app.post('/success', (req, res) => {
    const { order_id, amount, status } = req.body;
    
    console.log('✅ Успешный платеж:', { order_id, amount, status });
    
    const data = readPayments();
    data.payments.push({
        order_id,
        amount,
        status,
        timestamp: new Date().toISOString()
    });
    writePayments(data);
    
    bot.sendMessage(ADMIN_ID, `
💰 **Платеж успешно завершен!**
📋 Order ID: ${order_id}
💵 Сумма: ${amount}
📅 Время: ${new Date().toLocaleString('ru-RU')}
    `, { parse_mode: 'Markdown' });
    
    res.status(200).send('OK');
});

// ❌ FAIL URL
app.post('/fail', (req, res) => {
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
app.post('/result', (req, res) => {
    const { order_id, status, transaction_id } = req.body;
    
    console.log('🔁 Результат платежа:', { order_id, status, transaction_id });
    
    const data = readPayments();
    const payment = data.payments.find(p => p.order_id === order_id);
    if (payment) {
        payment.status = status;
        payment.transaction_id = transaction_id;
        writePayments(data);
    }
    
    res.status(200).send('OK');
});

// 💸 REFUND URL (возврат)
app.post('/refund', (req, res) => {
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
app.post('/chargeback', (req, res) => {
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

app.listen(PORT, () => {
    console.log(`💳 Платежный сервер запущен на порту ${PORT}`);
});