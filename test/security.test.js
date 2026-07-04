const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DataType, newDb } = require('pg-mem');
const TelegramBotClient = require('../telegram-client');

process.env.BOT_TOKEN = 'test-token';
process.env.PAYMENT_BOT_TOKEN = 'test-payment-token';
process.env.ADMIN_ID = '123456789';
process.env.SESSION_SECRET = 'a'.repeat(64);
process.env.PAYMENT_WEBHOOK_SECRET = 'b'.repeat(64);
process.env.DATABASE_URL = 'postgresql://test';
process.env.DISABLE_TELEGRAM_POLLING = 'true';
process.env.CORS_ORIGINS = 'null';

const memoryDatabase = newDb();
memoryDatabase.public.registerFunction({
    name: 'octet_length',
    args: [DataType.bytea],
    returns: DataType.integer,
    implementation: value => value.length
});
memoryDatabase.public.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: value => value.length
});
memoryDatabase.public.registerFunction({
    name: 'decode',
    args: [DataType.text, DataType.text],
    returns: DataType.bytea,
    implementation: (value, encoding) => Buffer.from(value, encoding)
});
memoryDatabase.public.registerFunction({
    name: 'pg_advisory_lock',
    args: [DataType.bigint],
    returns: DataType.bool,
    implementation: () => true
});
memoryDatabase.public.registerFunction({
    name: 'pg_advisory_unlock',
    args: [DataType.bigint],
    returns: DataType.bool,
    implementation: () => true
});
const adapter = memoryDatabase.adapters.createPg();
const testPool = new adapter.Pool();

const database = require('../db');
database.setPoolForTests(testPool);

const keysRepository = require('../repositories/keys');
const rentalsRepository = require('../repositories/rentals');
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

test.before(async () => {
    await database.initializeDatabase();
});

test.beforeEach(async () => {
    await database.query('DELETE FROM rentals');
    await database.query('DELETE FROM payments');
    await database.query('DELETE FROM telegram_users');
    await database.query('DELETE FROM subscription_keys');
});

test.after(async () => {
    global.fetch = realFetch;
    await database.closeDatabase();
});

test('subscription API requires a server-issued session', async () => {
    const key = 'RES-SECURITY-TEST';
    await keysRepository.addUnusedKey(key);

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
        assert.equal((await database.query('SELECT COUNT(*)::INT AS count FROM rentals')).rows[0].count, 1);

        const rebound = await fetch(`${baseUrl}/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, telegramId: '987654321' })
        });
        assert.equal((await rebound.json()).valid, false);
    });
});

test('deleting a key revokes its session and cascades its rentals', async () => {
    const key = 'RES-DELETE-CASCADE';
    await keysRepository.addUnusedKey(key);
    const activated = await keysRepository.activateKey(key, '123456789', 30);
    await rentalsRepository.addRental({
        id: crypto.randomUUID(),
        subscriptionKeyId: activated.record.id,
        propertyName: 'Car',
        start: new Date(),
        end: new Date(Date.now() + 3600000),
        originalEnd: new Date(Date.now() + 3600000),
        total: 100,
        telegramId: '123456789'
    });

    assert.equal(await keysRepository.deleteByHash(activated.record.keyHash), true);
    assert.equal((await database.query('SELECT COUNT(*)::INT AS count FROM rentals')).rows[0].count, 0);
});

test('/restorekey restores an active subscription without storing the plaintext key', async () => {
    const key = 'RES-RESTORED-KEY';
    const nextYear = new Date().getUTCFullYear() + 1;

    await subscriptionApp.locals.bot.dispatch({
        message: {
            text: `/restorekey ${key} 123456789 ${nextYear}-12-31`,
            chat: { id: 123456789 }
        }
    });

    const restored = await keysRepository.findByPlainKey(key);
    assert.equal(restored.used, true);
    assert.equal(restored.telegramId, '123456789');
    assert.equal(restored.keyHint, 'ED-KEY');

    const stored = await database.query(
        'SELECT key_hash, key_hint FROM subscription_keys WHERE id = $1',
        [restored.id]
    );
    assert.equal(stored.rows[0].key_hash.toString('hex'), keysRepository.hashKey(key));
    assert.equal(Object.hasOwn(stored.rows[0], 'key'), false);
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

test('payment webhook stores a valid successful payment once', async () => {
    await withServer(paymentApp, async baseUrl => {
        const body = JSON.stringify({ order_id: 'paid-1', amount: 10, status: 'paid' });
        const signature = crypto.createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET)
            .update(Buffer.from(body))
            .digest('hex');
        const request = () => fetch(`${baseUrl}/success`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Signature': `sha256=${signature}`
            },
            body
        });

        assert.equal((await request()).status, 200);
        assert.equal((await request()).status, 200);
        const stored = await database.query(
            'SELECT order_id, amount, status FROM payments WHERE order_id = $1',
            ['paid-1']
        );
        assert.equal(stored.rowCount, 1);
        assert.equal(stored.rows[0].status, 'paid');
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
