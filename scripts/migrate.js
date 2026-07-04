require('dotenv').config({ quiet: true });

const { closeDatabase, initializeDatabase } = require('../db');

async function migrate() {
    await initializeDatabase();
    console.log('Database migrations completed');
}

migrate()
    .catch(error => {
        console.error('Database migration failed:', error);
        process.exitCode = 1;
    })
    .finally(() => closeDatabase());
