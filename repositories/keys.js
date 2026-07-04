const crypto = require('crypto');
const { query, withTransaction } = require('../db');

function hashKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
}

function hashToHex(hash) {
    return Buffer.isBuffer(hash) ? hash.toString('hex') : String(hash);
}

function toIso(value) {
    return value ? new Date(value).toISOString() : null;
}

function mapKey(row) {
    if (!row) return null;
    return {
        id: String(row.id),
        keyHash: hashToHex(row.key_hash),
        keyHint: row.key_hint,
        used: row.telegram_id !== null,
        telegramId: row.telegram_id === null ? null : String(row.telegram_id),
        invalidTelegramId: row.invalid_telegram_id === null
            ? null
            : String(row.invalid_telegram_id),
        createdAt: toIso(row.created_at),
        activatedAt: toIso(row.activated_at),
        expiryDate: toIso(row.expires_at)
    };
}

function isValidKey(key) {
    return typeof key === 'string' && key.length >= 8 && key.length <= 128;
}

async function findByPlainKey(key, client = { query }) {
    if (!isValidKey(key)) return null;
    const result = await client.query(
        "SELECT * FROM subscription_keys WHERE key_hash = DECODE($1, 'hex')",
        [hashKey(key)]
    );
    return mapKey(result.rows[0]);
}

async function findByHashHex(keyHash, client = { query }) {
    if (typeof keyHash !== 'string' || !/^[a-f0-9]{64}$/i.test(keyHash)) return null;
    const result = await client.query(
        "SELECT * FROM subscription_keys WHERE key_hash = DECODE($1, 'hex')",
        [keyHash]
    );
    return mapKey(result.rows[0]);
}

async function listKeys() {
    const result = await query(
        'SELECT * FROM subscription_keys ORDER BY created_at DESC, id DESC'
    );
    return result.rows.map(mapKey);
}

async function addUnusedKey(key) {
    if (!isValidKey(key)) return { status: 'invalid' };
    const result = await query(`
        INSERT INTO subscription_keys (key_hash, key_hint)
        VALUES (DECODE($1, 'hex'), $2)
        ON CONFLICT (key_hash) DO NOTHING
        RETURNING *
    `, [hashKey(key), key.slice(-6)]);
    return result.rowCount
        ? { status: 'created', record: mapKey(result.rows[0]) }
        : { status: 'exists' };
}

async function restoreKey(key, telegramId, expiresAt) {
    if (!isValidKey(key)) return { status: 'invalid' };
    const expiry = new Date(expiresAt);
    if (!Number.isFinite(expiry.getTime()) || expiry <= new Date()) {
        return { status: 'invalid_expiry' };
    }

    const activatedAt = new Date(Math.min(
        Date.now(),
        expiry.getTime() - 1000
    ));
    const result = await query(`
        INSERT INTO subscription_keys (
            key_hash,
            key_hint,
            telegram_id,
            activated_at,
            expires_at,
            invalid_telegram_id
        )
        VALUES (DECODE($1, 'hex'), $2, $3, $4, $5, NULL)
        ON CONFLICT (key_hash) DO UPDATE SET
            key_hint = EXCLUDED.key_hint,
            telegram_id = EXCLUDED.telegram_id,
            activated_at = EXCLUDED.activated_at,
            expires_at = EXCLUDED.expires_at,
            invalid_telegram_id = NULL
        RETURNING *
    `, [hashKey(key), key.slice(-6), telegramId, activatedAt, expiry]);
    return { status: 'restored', record: mapKey(result.rows[0]) };
}

async function activateKey(key, telegramId, subscriptionDays) {
    if (!isValidKey(key)) return { status: 'not_found' };
    return withTransaction(async client => {
        const selected = await client.query(
            "SELECT * FROM subscription_keys WHERE key_hash = DECODE($1, 'hex') FOR UPDATE",
            [hashKey(key)]
        );
        const record = mapKey(selected.rows[0]);
        if (!record) return { status: 'not_found' };

        if (record.used && new Date(record.expiryDate) <= new Date()) {
            return { status: 'expired' };
        }
        if (record.used && record.telegramId !== String(telegramId)) {
            return { status: 'bound_to_another_user' };
        }
        if (record.used) return { status: 'active', record };

        const activatedAt = new Date();
        const expiresAt = new Date(activatedAt);
        expiresAt.setUTCDate(expiresAt.getUTCDate() + subscriptionDays);
        const updated = await client.query(`
            UPDATE subscription_keys
            SET telegram_id = $2,
                activated_at = $3,
                expires_at = $4,
                invalid_telegram_id = NULL
            WHERE key_hash = DECODE($1, 'hex')
            RETURNING *
        `, [hashKey(key), telegramId, activatedAt, expiresAt]);
        return { status: 'active', record: mapKey(updated.rows[0]) };
    });
}

async function resetKey(key) {
    if (!isValidKey(key)) return false;
    const result = await query(`
        UPDATE subscription_keys
        SET telegram_id = NULL,
            activated_at = NULL,
            expires_at = NULL,
            invalid_telegram_id = NULL
        WHERE key_hash = DECODE($1, 'hex')
    `, [hashKey(key)]);
    return result.rowCount > 0;
}

async function deleteByHash(keyHash) {
    if (typeof keyHash !== 'string' || !/^[a-f0-9]{64}$/i.test(keyHash)) return false;
    const result = await query(
        "DELETE FROM subscription_keys WHERE key_hash = DECODE($1, 'hex')",
        [keyHash]
    );
    return result.rowCount > 0;
}

async function updateTelegramId(keyHash, telegramId) {
    if (typeof keyHash !== 'string' || !/^[a-f0-9]{64}$/i.test(keyHash)) return null;
    const result = await query(`
        UPDATE subscription_keys
        SET telegram_id = $2,
            invalid_telegram_id = NULL
        WHERE key_hash = DECODE($1, 'hex')
          AND activated_at IS NOT NULL
          AND expires_at > NOW()
        RETURNING *
    `, [keyHash, telegramId]);
    return mapKey(result.rows[0]);
}

async function invalidateTelegramId(keyHash, telegramId) {
    if (typeof keyHash !== 'string' || !/^[a-f0-9]{64}$/i.test(keyHash)) return;
    await query(`
        UPDATE subscription_keys
        SET telegram_id = NULL,
            activated_at = NULL,
            expires_at = NULL,
            invalid_telegram_id = $2
        WHERE key_hash = DECODE($1, 'hex')
    `, [keyHash, telegramId]);
}

module.exports = {
    activateKey,
    addUnusedKey,
    deleteByHash,
    findByHashHex,
    findByPlainKey,
    hashKey,
    invalidateTelegramId,
    listKeys,
    resetKey,
    restoreKey,
    updateTelegramId
};
