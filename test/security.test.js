const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const TelegramBotClient = require('../telegram-client');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resell-security-'));
process.env.BOT_TOKEN = 'test-token';
process.env.PAYMENT_BOT_TOKEN = 'test-payment-token';
process.env.ADMIN_ID = '123456789';
process.env.SESSION_SECRET = 'a'.repeat(64);
process.env.PAYMENT_WEBHOOK_SECRET = 'b'.repeat(64);
process.env.DATA_DIR = dataDir;
process.env.DISABLE_TELEGRAM_POLLING = 'true';
process.env.CORS_ORIGINS = 'null';

const key = 'RES-SECURITY-TEST';
fs.writeFileSync(path.join(dataDir, 'keys.json'), JSON.stringify([{
    keyHash: crypto.createHash('sha256').update(key).digest('hex'),
    keyHint: 'TYTEST',
    used: false,
    expiryDate: new Date(Date.now() + 86400000).toISOString(),
    createdAt: new Date().toISOString(),
    telegramId: null
}], null, 2));

const subscriptionApp = require('../combined-server');
const paymentApp = require('../payment-server');
const realFetch = global.fetch;

global.fetch = async (url, options) => {
    if (String(url).startsWith('https://api.telegram.org/')) {
        return new Response(JSON.stringify({ ok: true, result: {} }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    return realFetch(url, options);
};

async function withServer(app, callback) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const { port } = server.address();
    try {
        await callback(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

test('subscription API requires a server-issued session', async () => {
    await withServer(subscriptionApp, async baseUrl => {
        const unauthenticated = await fetch(`${baseUrl}/api/add-rental`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                propertyName: 'Car',
                start: new Date().toISOString(),
                end: new Date(Date.now() + 3600000).toISOString(),
                total: 100
            })
        });
        assert.equal(unauthenticated.status, 401);

        const activation = await fetch(`${baseUrl}/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, telegramId: '123456789' })
        });
        const activated = await activation.json();
        assert.equal(activated.valid, true);
        assert.match(activated.sessionToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
        const daysLeft = (new Date(activated.expiryDate) - new Date()) / 86400000;
        assert.ok(daysLeft > 29 && daysLeft <= 31);

        const session = await fetch(`${baseUrl}/api/session`, {
            headers: { Authorization: `Bearer ${activated.sessionToken}` }
        });
        assert.equal(session.status, 200);

        const rental = await fetch(`${baseUrl}/api/add-rental`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${activated.sessionToken}`
            },
            body: JSON.stringify({
                propertyName: 'Car',
                start: new Date().toISOString(),
                end: new Date(Date.now() + 3600000).toISOString(),
                total: 100
            })
        });
        assert.equal(rental.status, 200);

        const rebound = await fetch(`${baseUrl}/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, telegramId: '987654321' })
        });
        assert.equal((await rebound.json()).valid, false);
    });
});

test('payment webhook rejects an invalid signature', async () => {
    await withServer(paymentApp, async baseUrl => {
        const response = await fetch(`${baseUrl}/success`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Signature': 'sha256=00'
            },
            body: JSON.stringify({ order_id: '1', amount: 10, status: 'paid' })
        });
        assert.equal(response.status, 401);
    });
});

test('payment webhook stores a valid successful payment', async () => {
    await withServer(paymentApp, async baseUrl => {
        const body = JSON.stringify({ order_id: 'paid-1', amount: 10, status: 'paid' });
        const signature = crypto.createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET)
            .update(Buffer.from(body))
            .digest('hex');
        const response = await fetch(`${baseUrl}/success`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Signature': `sha256=${signature}`
            },
            body
        });
        assert.equal(response.status, 200);
        const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'payments.json'), 'utf8'));
        assert.equal(stored.payments.some(payment => payment.order_id === 'paid-1'), true);
    });
});

test('telegram client dispatches callback queries', async () => {
    const bot = new TelegramBotClient('test-token', { polling: false });
    let callbackData = null;

    bot.onCallbackQuery(query => {
        callbackData = query.data;
    });

    await bot.dispatch({
        callback_query: {
            id: 'callback-1',
            data: 'deletekey:cancel:test',
            from: { id: 123456789 },
            message: { chat: { id: 123456789 }, message_id: 1 }
        }
    });

    assert.equal(callbackData, 'deletekey:cancel:test');
});
