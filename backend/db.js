const mysql = require('mysql2');

const databaseName = process.env.DB_NAME || 'course_registration';

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '@inspiron16H',
    database: databaseName,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test database connection
pool.getConnection((err, connection) => {
    if (err) {
        console.error('Database Connection failed:', err);
        return;
    }
    console.log('Successfully connected to database');
    connection.release();
});

const promisePool = pool.promise();

async function ensureColumnExists(tableName, columnName, definitionSql) {
    const [columns] = await promisePool.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName]);
    if (columns.length === 0) {
        await promisePool.query(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
        console.log(`Added ${columnName} column to ${tableName}`);
    }
}

async function initializeDatabase() {
    try {
        await promisePool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL UNIQUE,
                phone VARCHAR(20),
                password VARCHAR(255) NOT NULL,
                role ENUM('student', 'instructor') NOT NULL,
                expertise VARCHAR(255),
                branch VARCHAR(255),
                profile_photo LONGTEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Keep existing databases backward compatible with older schemas.
        await ensureColumnExists('users', 'phone', 'phone VARCHAR(20) AFTER email');
        await ensureColumnExists('users', 'expertise', 'expertise VARCHAR(255) AFTER role');
        await ensureColumnExists('users', 'branch', 'branch VARCHAR(255) AFTER expertise');
        await ensureColumnExists('users', 'profile_photo', 'profile_photo LONGTEXT AFTER branch');

        console.log(`Users table verified/created in database "${databaseName}"`);
    } catch (error) {
        console.error('Database initialization error:', error);
        throw error;
    }
}

initializeDatabase().catch((error) => {
    console.error('Database init failed:', error);
});

module.exports = promisePool;
