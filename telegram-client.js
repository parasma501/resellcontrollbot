class TelegramBotClient {
    constructor(token, options = {}) {
        if (!token) throw new Error('Telegram bot token is required');
        this.baseUrl = `https://api.telegram.org/bot${token}`;
        this.handlers = [];
        this.callbackHandlers = [];
        this.offset = 0;
        this.polling = options.polling === true;
        this.requestTimeoutMs = options.requestTimeoutMs || 45000;
        if (this.polling) setImmediate(() => this.poll());
    }

    async request(method, payload = {}) {
        const timeoutMs = payload.timeout
            ? Math.max(this.requestTimeoutMs, (Number(payload.timeout) + 5) * 1000)
            : this.requestTimeoutMs;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(`${this.baseUrl}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        }).finally(() => clearTimeout(timeout));
        let result;
        try {
            result = await response.json();
        } catch {
            throw new Error(`Telegram API returned invalid JSON: ${response.status}`);
        }
        if (!response.ok || !result.ok) throw new Error(result.description || `Telegram API error: ${response.status}`);
        return result.result;
    }

    sendMessage(chatId, text, options = {}) {
        return this.request('sendMessage', { chat_id: chatId, text, ...options });
    }

    answerCallbackQuery(callbackQueryId, options = {}) {
        return this.request('answerCallbackQuery', { callback_query_id: callbackQueryId, ...options });
    }

    editMessageReplyMarkup(chatId, messageId, replyMarkup) {
        return this.request('editMessageReplyMarkup', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: replyMarkup
        });
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

    onCallbackQuery(handler) {
        this.callbackHandlers.push(handler);
    }

    async dispatch(update) {
        const message = update && update.message ? update.message : update;
        if (message && typeof message.text === 'string') {
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

        if (update && update.callback_query) {
            for (const handler of this.callbackHandlers) {
                await Promise.resolve(handler(update.callback_query)).catch(error => {
                    console.error('Telegram callback handler error:', error.message);
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
                    allowed_updates: ['message', 'callback_query']
                });
                for (const update of updates) {
                    this.offset = Math.max(this.offset, update.update_id + 1);
                    await this.dispatch(update);
                }
            } catch (error) {
                console.error('Telegram polling error:', error.message);
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
    }
}

module.exports = TelegramBotClient;
