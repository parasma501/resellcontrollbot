class TelegramBotClient {
    constructor(token, options = {}) {
        if (!token) throw new Error('Telegram bot token is required');
        this.baseUrl = `https://api.telegram.org/bot${token}`;
        this.handlers = [];
        this.offset = 0;
        this.polling = options.polling === true;
        if (this.polling) setImmediate(() => this.poll());
    }

    async request(method, payload = {}) {
        const response = await fetch(`${this.baseUrl}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok || !result.ok) {
            throw new Error(result.description || `Telegram API error: ${response.status}`);
        }
        return result.result;
    }

    sendMessage(chatId, text, options = {}) {
        return this.request('sendMessage', { chat_id: chatId, text, ...options });
    }

    deleteWebHook(options = {}) {
        return this.request('deleteWebhook', options);
    }

    getWebHookInfo() {
        return this.request('getWebhookInfo');
    }

    onText(regex, handler) {
        this.handlers.push({ regex, handler });
    }

    async dispatch(message) {
        if (!message || typeof message.text !== 'string') return;
        for (const { regex, handler } of this.handlers) {
            regex.lastIndex = 0;
            const match = regex.exec(message.text);
            if (match) {
                await Promise.resolve(handler(message, match)).catch(error => {
                    console.error('Telegram handler error:', error.message);
                });
            }
        }
    }

    async poll() {
        while (this.polling) {
            try {
                const updates = await this.request('getUpdates', {
                    offset: this.offset,
                    timeout: 30,
                    allowed_updates: ['message']
                });
                for (const update of updates) {
                    this.offset = Math.max(this.offset, update.update_id + 1);
                    await this.dispatch(update.message);
                }
            } catch (error) {
                console.error('Telegram polling error:', error.message);
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
    }
}

module.exports = TelegramBotClient;
