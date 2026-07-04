const { query } = require('../db');

function toIso(value) {
    return value ? new Date(value).toISOString() : null;
}

function mapRental(row) {
    if (!row) return null;
    return {
        id: row.id,
        subscriptionKeyId: String(row.subscription_key_id),
        propertyName: row.property_name,
        start: toIso(row.start_at),
        end: toIso(row.end_at),
        originalEnd: toIso(row.original_end_at),
        total: Number(row.total),
        telegramId: String(row.telegram_id),
        notifiedAt: toIso(row.notified_at),
        notified: row.notified_at !== null,
        endedEarly: row.ended_early,
        createdAt: toIso(row.created_at)
    };
}

async function addRental(rental) {
    const result = await query(`
        INSERT INTO rentals (
            id,
            subscription_key_id,
            property_name,
            start_at,
            end_at,
            original_end_at,
            total,
            telegram_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
    `, [
        rental.id,
        rental.subscriptionKeyId,
        rental.propertyName,
        rental.start,
        rental.end,
        rental.originalEnd,
        rental.total,
        rental.telegramId
    ]);
    return mapRental(result.rows[0]);
}

async function listPendingNotifications(limit = 100) {
    const result = await query(`
        SELECT *
        FROM rentals
        WHERE notified_at IS NULL
          AND end_at <= NOW()
        ORDER BY end_at
        LIMIT $1
    `, [limit]);
    return result.rows.map(mapRental);
}

async function markNotified(id) {
    await query(
        'UPDATE rentals SET notified_at = NOW() WHERE id = $1 AND notified_at IS NULL',
        [id]
    );
}

async function endRentalEarly(id, subscriptionKeyId, endAt) {
    const result = await query(`
        UPDATE rentals
        SET end_at = $3,
            notified_at = NOW(),
            ended_early = TRUE
        WHERE id = $1
          AND subscription_key_id = $2
        RETURNING *
    `, [id, subscriptionKeyId, endAt]);
    return mapRental(result.rows[0]);
}

async function clearFinishedRentals() {
    const result = await query('DELETE FROM rentals WHERE end_at <= NOW()');
    return result.rowCount;
}

async function clearAllRentals() {
    const result = await query('DELETE FROM rentals');
    return result.rowCount;
}

async function listRentals() {
    const result = await query('SELECT * FROM rentals ORDER BY end_at');
    return result.rows.map(mapRental);
}

module.exports = {
    addRental,
    clearAllRentals,
    clearFinishedRentals,
    endRentalEarly,
    listPendingNotifications,
    listRentals,
    markNotified
};
