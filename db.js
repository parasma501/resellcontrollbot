const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

let pool;

function createPool() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL must be set');
    }

    const options = { connectionString };
    if (process.env.DATABASE_SSL === 'true') {
        options.ssl = { rejectUnauthorized: false };
    }
    return new Pool(options);
}

function getPool() {
    if (!pool) pool = createPool();
    return pool;
}

async function query(text, params) {
    return getPool().query(text, params);
}

async function withTransaction(callback) {
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function initializeDatabase() {
    const database = getPool();
    const client = await database.connect();
    try {
        await client.query('SELECT pg_advisory_lock($1::BIGINT)', [742019351]);
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(100) PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        const migrationsDir = path.join(__dirname, 'migrations');
        const migrations = fs.readdirSync(migrationsDir)
            .filter(name => /^\d+.*\.sql$/.test(name))
            .sort();

        for (const version of migrations) {
            const applied = await client.query(
                'SELECT 1 FROM schema_migrations WHERE version = $1',
                [version]
            );
            if (applied.rowCount) continue;

            const sql = fs.readFileSync(path.join(migrationsDir, version), 'utf8');
            await client.query('BEGIN');
            try {
                await client.query(sql);
                await client.query(
                    'INSERT INTO schema_migrations (version) VALUES ($1)',
                    [version]
                );
                await client.query('COMMIT');
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
        }
    } finally {
        await client.query('SELECT pg_advisory_unlock($1::BIGINT)', [742019351])
            .catch(() => {});
        client.release();
    }
}

async function closeDatabase() {
    if (!pool) return;
    await pool.end();
    pool = undefined;
}

function setPoolForTests(testPool) {
    pool = testPool;
}

module.exports = {
    closeDatabase,
    initializeDatabase,
    query,
    setPoolForTests,
    withTransaction
};
