const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ======== КОНФИГУРАЦИЯ ========
const BOT_TOKEN = process.env.BOT_TOKEN || '8597812988:AAHpBTTmWvFPB0drkx01_DlwXLylEqOQIWM';
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

function readKeys() {
    try {
        const filePath = path.join(DATA_DIR, 'keys.json');
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (error) {
        console.error('Ошибка чтения keys.json:', error);
    }
    return { keys: [] };
}

function writeKeys(data) {
    try {
        const filePath = path.join(DATA_DIR, 'keys.json');
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Ошибка записи keys.json:', error);
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

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const helpMessage = `
📖 **Помощь:**

/start - Стартовое сообщение
/help - Показать помощь
/status - Проверить статус подписки
/pay - Оплата подписки
/rentals - Активные аренды
/payments - История платежей
/activatekey КЛЮЧ - Активация ключа

🔧 **Админ-команды:**
/generatekey - Создать ключ
/activate - Вручную активировать
/addpayment - Записать платёж
    `;
    bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
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

bot.onText(/\/rentals/, (msg) => {
    const chatId = msg.chat.id;
    const subscription = readSubscription();
    const now = new Date();
    
    // Проверка подписки
    if (!subscription.isActive || !subscription.expiryDate || new Date(subscription.expiryDate) <= now) {
        bot.sendMessage(chatId, `
❌ **Доступ ограничен!**

💎 Ваша подписка истекла.
Оплачивайте через: /pay
        `, { parse_mode: 'Markdown' });
        return;
    }
    
    // Если подписка активна — показываем аренды
    const data = readRentData();
    if (!data.rentals || data.rentals.length === 0) {
        bot.sendMessage(chatId, '📭 Активных аренд нет');
        return;
    }
    const activeRentals = data.rentals.filter(r => new Date(r.end) > new Date());
    if (activeRentals.length === 0) {
        bot.sendMessage(chatId, '📭 Активных аренд нет');
        return;
    }
    let message = '🚗 **Активные аренды:**\n\n';
    activeRentals.forEach((rental, index) => {
        const endDate = new Date(rental.end);
        const now = new Date();
        const diffMs = endDate - now;
        const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));
        message += `${index + 1}. *${rental.propertyName}*\n`;
        message += `   🕐 Окончание: ${formatDateTime(rental.end)} (${diffHours}ч)\n\n`;
    });
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

bot.onText(/\/activate/, (msg) => {
    if (msg.chat.id.toString() !== ADMIN_ID) {
        bot.sendMessage(msg.chat.id, '❌ Доступно только админу!');
        return;
    }
    
    const subscription = readSubscription();
    subscription.isActive = true;
    subscription.expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    writeSubscription(subscription);
    
    bot.sendMessage(msg.chat.id, `
💎 **Подписка активирована!**

📅 Действует до: ${formatDateTime(subscription.expiryDate)}
    `, { parse_mode: 'Markdown' });
});

bot.onText(/\/addpayment/, (msg) => {
    if (msg.chat.id.toString() !== ADMIN_ID) {
        bot.sendMessage(msg.chat.id, '❌ Доступно только админу!');
        return;
    }
    
    const data = readPayments();
    data.payments.push({
        order_id: 'manual-' + Date.now(),
        amount: 1000,  // Сумма платежа
        status: 'completed',
        timestamp: new Date().toISOString(),
        user_id: msg.chat.id  // Кто оплатил
    });
    writePayments(data);
    
    bot.sendMessage(msg.chat.id, '✅ Платеж записан в историю!');
});

// Активация ключа пользователем
bot.onText(/\/activatekey/, (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const key = text.split(' ')[1];
    
    if (!key) {
        bot.sendMessage(chatId, 'Используй: /activatekey ТВОЙ_КЛЮЧ');
        return;
    }
    
    const keys = readKeys();
    const found = keys.find(k => k.key === key);
    
    if (!found) {
        bot.sendMessage(chatId, '❌ Неверный ключ!');
        return;
    }
    
    if (found.used) {
        bot.sendMessage(chatId, '❌ Ключ уже использован!');
        return;
    }
    
    // Активируем ключ
    found.used = true;
    found.activatedBy = chatId;
    found.expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    writeKeys(keys);
    
    // Обновляем подписку пользователя
    const subscription = readSubscription();
    subscription.isActive = true;
    subscription.expiryDate = found.expiryDate;
    writeSubscription(subscription);
    
    bot.sendMessage(chatId, `
✅ **Ключ активирован!**

💎 Подписка активна до: ${formatDateTime(found.expiryDate)}
    `, { parse_mode: 'Markdown' });
});

bot.onText(/\/generatekey/, (msg) => {
    try {
        console.log('🔑 /generatekey вызван!');
        console.log('User ID:', msg.chat.id);
        console.log('User ID type:', typeof msg.chat.id);
        console.log('Admin ID:', ADMIN_ID);
        console.log('Admin ID type:', typeof ADMIN_ID);
        
        const userId = String(msg.chat.id);
        const adminId = String(ADMIN_ID);
        
        console.log('Comparing:', userId, '===', adminId);
        
        if (userId !== adminId) {
            console.log('❌ Не админ!');
            bot.sendMessage(msg.chat.id, '❌ Доступно только админу!');
            return;
        }
        
        console.log('✅ Админ подтверждён!');
        
        const key = 'RES-' + Math.random().toString(36).substring(2, 10).toUpperCase();
        console.log('🔑 Сгенерирован ключ:', key);
        
        console.log('📂 Читаю keys.json...');
        const keys = readKeys();
        console.log('📂 Прочитано ключей:', keys.keys.length);
        
        console.log('📂 Добавляю ключ в массив...');
        keys.push({
            key: key,
            used: false,
            activatedBy: null,
            expiryDate: null,
            createdAt: new Date().toISOString()
        });
        console.log('📂 Ключ добавлен в массив!');
        
        console.log('📂 Записываю keys.json...');
        writeKeys(keys);
        console.log('📂 keys.json записан!');
        
        console.log('📤 Отправляю сообщение пользователю...');
        bot.sendMessage(msg.chat.id, `
🔑 **Новый ключ активации:**

\`${key}\`

Скопируй и отправь пользователю!
        `, { parse_mode: 'Markdown' });
        
        console.log('✅ Ключ отправлен!');
        
    } catch (error) {
        console.error('❌ Ошибка в /generatekey:', error);
        try {
            bot.sendMessage(msg.chat.id, `❌ Ошибка: ${error.message}`);
        } catch (sendError) {
            console.error('Не удалось отправить сообщение об ошибке:', sendError);
        }
    }
});

// Проверка ключа (для Electron приложения)
app.post('/checkkey', (req, res) => {
    const { key } = req.body;
    
    const keys = readKeys();
    const found = keys.find(k => k.key === key);
    
    if (!found || !found.used || !found.expiryDate) {
        return res.json({ valid: false, message: 'Неверный ключ' });
    }
    
    const now = new Date();
    const expiry = new Date(found.expiryDate);
    
    if (now > expiry) {
        return res.json({ valid: false, message: 'Ключ истёк' });
    }
    
    res.json({ 
        valid: true, 
        expiryDate: found.expiryDate,
        activatedBy: found.activatedBy
    });
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
