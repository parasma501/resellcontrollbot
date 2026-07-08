const { query } = require('../db');

async function recordSuccessfulPayment({ orderId, amount, status }) {
    const result = await query(`
        INSERT INTO payments (order_id, amount, status)
        VALUES ($1, $2, $3)
        ON CONFLICT (order_id) DO UPDATE SET
            amount = EXCLUDED.amount,
            status = EXCLUDED.status,
            updated_at = NOW()
        WHERE payments.amount <> EXCLUDED.amount
           OR payments.status <> EXCLUDED.status
        RETURNING id
    `, [orderId, amount, status]);
    return { duplicate: result.rowCount === 0 };
}

async function updatePaymentResult({ orderId, status, transactionId }) {
    const result = await query(`
        UPDATE payments
        SET status = $2,
            transaction_id = $3,
            updated_at = NOW()
        WHERE order_id = $1
    `, [orderId, status, transactionId]);
    return result.rowCount > 0;
}

module.exports = {
    recordSuccessfulPayment,
    updatePaymentResult
};
