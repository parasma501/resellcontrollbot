const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ======== КОНФИГУРАЦИЯ ========
const BOT_TOKEN = process.env.BOT_TOKEN || '8601564949:AAHcdt-buu5sv8kSTj1kyz5yh21IIWj01a8';
const ADMIN_ID = process.env.ADMIN_ID || '705565283';
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || '/opt/render/project/data';
const PAYMENT_LINK = process.env.PAYMENT_LINK || 'https://yoomoney.ru/to/4100119530608840';

// ======== ИНИЦИАЛИЗАЦИЯ ========
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

console.log('🤖 Бот запущен!');
console.log(`💳 Платежный сервер на порту ${PORT}`);

// ======== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ========
function readRentData() {
    try {
        const filePath = path.join(DATA_DIR, 'rent-data.json');
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (error) {
        console.error('Ошибка чтения rent-data.json:', error);
    }
    return { rentals: [], lastNotification: {} };
}

function writeRentData(data) {
    try {
        const filePath = path.join(DATA_DIR, 'rent-data.json');
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Ошибка записи rent-data.json:', error);
    }
}

function readSubscription() {
    try {
        const filePath = path.join(DATA_DIR, 'subscription.json');
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (error) {
        console.error('Ошибка чтения subscription.json:', error);
    }
    return { isActive: false, expiryDate: null };
}

function writeSubscription(data) {
    try {
        const filePath = path.join(DATA_DIR, 'subscription.json');
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Ошибка записи subscription.json:', error);
    }
}

function readPayments() {
    try {
        const filePath = path.join(DATA_DIR, 'payments.json');
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (error) {
        console.error('Ошибка чтения payments.json:', error);
    }
    return { payments: [] };
}

function writePayments(data) {
    try {
        const filePath = path.join(DATA_DIR, 'payments.json');
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Ошибка записи payments.json:', error);
    }
}

function formatDateTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// ======== КОМАНДЫ БОТА ========
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `
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
    `;
    bot.sendMessage(chatId, welcomeMessage);
});

bot.onText(/\/pay/, (msg) => {
    const chatId = msg.chat.id;
    // Здесь будет ссылка на оплату через Palych
    const paymentMessage = `
💎 **Оплата подписки**

Нажми кнопку ниже для оплаты:

[ОПЛАТИТЬ](${PAYMENT_LINK})

После оплаты подписка активируется автоматически!
    `;
    bot.sendMessage(chatId, paymentMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    const subscription = readSubscription();
    let message;
    if (subscription.isActive && subscription.expiryDate) {
        const expiry = new Date(subscription.expiryDate);
        const now = new Date();
        const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
        message = `
💎 **Статус подписки: АКТИВЕН** ✅

📅 Окончание: ${formatDateTime(subscription.expiryDate)}
📊 Осталось дней: ${daysLeft > 0 ? daysLeft : 0}
        `;
    } else {
        message = `
❌ **Подписка неактивна**

💎 Оплати подписку: /pay
        `;
    }
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/payments/, (msg) => {
    const chatId = msg.chat.id;
    const data = readPayments();
    if (!data.payments || data.payments.length === 0) {
        bot.sendMessage(chatId, '📭 История платежей пуста');
        return;
    }
    let message = '💳 **История платежей:**\n\n';
    data.payments.slice(-10).reverse().forEach((payment, index) => {
        message += `${index + 1}. 💵 ${payment.amount}$ - ${payment.status}\n`;
        message += `   📅 ${formatDateTime(payment.timestamp)}\n\n`;
    });
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// ======== ПРОВЕРКА АРЕНД ========
function checkRentalsAndNotify() {
    const data = readRentData();
    const now = new Date();
    const notificationsSent = data.lastNotification || {};
    let hasChanges = false;

    data.rentals.forEach((rental) => {
        const endDate = new Date(rental.end);
        const rentalId = rental.id;
        if (endDate <= now && !notificationsSent[rentalId]) {
            const message = `
🔔 **Аренда завершена!**

🚗 Машина: *${rental.propertyName}*
📅 Начало: ${formatDateTime(rental.start)}
📅 Конец: ${formatDateTime(rental.end)}
💰 Сумма: ${rental.total.toLocaleString('ru-RU')}$

Машина вернулась с аренды!
            `;
            bot.sendMessage(ADMIN_ID, message, { parse_mode: 'Markdown' });
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

// ======== ПЛАТЕЖНЫЕ WEBHOOKS ========
app.post('/success', (req, res) => {
    const { order_id, amount, status, user_id } = req.body;
    
    console.log('✅ Успешный платеж:', { order_id, amount, status });
    
    const data = readPayments();
    data.payments.push({
        order_id,
        amount,
        status,
        timestamp: new Date().toISOString(),
        user_id
    });
    writePayments(data);
    
    // Активируем подписку
    const subscription = readSubscription();
    subscription.isActive = true;
    subscription.expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 дней
    writeSubscription(subscription);
    
    // Уведомляем админа
    bot.sendMessage(ADMIN_ID, `
💰 **Платеж успешно завершен!**

📋 Order ID: ${order_id}
💵 Сумма: ${amount}
📅 Время: ${new Date().toLocaleString('ru-RU')}
🔄 Подписка АКТИВИРОВАНА
    `, { parse_mode: 'Markdown' });
    
    // Уведомляем пользователя
    if (user_id) {
        bot.sendMessage(user_id, `
✅ **Оплата прошла успешно!**

💎 Ваша подписка активирована!
📅 Действует до: ${formatDateTime(subscription.expiryDate)}
        `, { parse_mode: 'Markdown' });
    }
    
    res.status(200).send('OK');
});

app.post('/fail', (req, res) => {
    const { order_id, error, user_id } = req.body;
    
    console.log('❌ Неудачный платеж:', { order_id, error });
    
    bot.sendMessage(ADMIN_ID, `
💔 **Платеж не удался!**

📋 Order ID: ${order_id}
❌ Ошибка: ${error || 'Неизвестная ошибка'}
    `, { parse_mode: 'Markdown' });
    
    res.status(200).send('OK');
});

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

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// ======== ЗАПУСК ========
app.listen(PORT, () => {
    console.log(`💳 Payment server running on port ${PORT}`);
});

app.get('/', (req, res) => {
    res.send('🤖 Resell Control Bot is alive!');
});
