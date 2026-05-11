const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

// ======== КОНФИГУРАЦИЯ ========
const BOT_TOKEN = '8601564949:AAHcdt-buu5sv8kSTj1kyz5yh21IIWj01a8';
const ADMIN_ID = '705565283';
const DATA_DIR = path.join(__dirname, '..', 'data');
const RENT_DATA_FILE = path.join(DATA_DIR, 'rent-data.json');
const SUBSCRIPTION_FILE = path.join(DATA_DIR, 'subscription.json');

// ======== ИНИЦИАЛИЗАЦИЯ ========
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('🤖 Бот запущен!');

bot.onText(/.*/, (msg) => {
    console.log('Получено сообщение:', msg);
    bot.sendMessage(msg.chat.id, 'Бот работает!');
});

// ======== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ========
function readRentData() {
    try {
        if (fs.existsSync(RENT_DATA_FILE)) {
            return JSON.parse(fs.readFileSync(RENT_DATA_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('❌ Ошибка чтения rent-data.json:', error);
    }
    return { rentals: [], lastNotification: {} };
}

function writeRentData(data) {
    try {
        fs.writeFileSync(RENT_DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('❌ Ошибка записи rent-data.json:', error);
    }
}

function readSubscription() {
    try {
        if (fs.existsSync(SUBSCRIPTION_FILE)) {
            return JSON.parse(fs.readFileSync(SUBSCRIPTION_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('❌ Ошибка чтения subscription.json:', error);
    }
    return { isActive: false, expiryDate: null };
}

function writeSubscription(data) {
    try {
        fs.writeFileSync(SUBSCRIPTION_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('❌ Ошибка записи subscription.json:', error);
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

💎 Для активации премиум-версии:
1. Оплати по ссылке: https://yoomoney.ru/to/4100119530608840
2. Напиши мне после оплаты
3. Я выдам код активации
    `;
    bot.sendMessage(chatId, welcomeMessage);
});

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const helpMessage = `
📖 Помощь:

/start - Стартовое сообщение
/status - Проверить статус подписки
/rentals - Показать активные аренды

💡 Уведомления о возврате машин приходят автоматически!
    `;
    bot.sendMessage(chatId, helpMessage);
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

📌 Чтобы получить доступ к премиум-версии:
1. Оплати по ссылке: https://yoomoney.ru/to/4100119530608840
2. Напиши мне после оплаты
3. Я выдам код активации
        `;
    }
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/rentals/, (msg) => {
    const chatId = msg.chat.id;
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

// ======== ПРОВЕРКА И УВЕДОМЛЕНИЯ ОБ АРЕНДЕ ========
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
