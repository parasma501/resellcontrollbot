const { query } = require('../db');

async function saveUser(telegramId) {
    await query(`
        INSERT INTO telegram_users (telegram_id)
        VALUES ($1)
        ON CONFLICT (telegram_id) DO UPDATE
        SET last_seen_at = NOW()
    `, [telegramId]);
}

module.exports = { saveUser };
