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
        try {
            await promisePool.query(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
            console.log(`Added ${columnName} column to ${tableName}`);
        } catch (error) {
            if (error?.code === 'ER_DUP_FIELDNAME') {
                console.log(`${columnName} column already exists in ${tableName}`);
                return;
            }
            throw error;
        }
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
                academy_id VARCHAR(36),
                academy_access_status VARCHAR(20) NOT NULL DEFAULT 'active',
                academy_access_last_login_at DATETIME NULL,
                academy_access_restricted_at DATETIME NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Keep existing databases backward compatible with older schemas.
        await ensureColumnExists('users', 'phone', 'phone VARCHAR(20) AFTER email');
        await ensureColumnExists('users', 'expertise', 'expertise VARCHAR(255) AFTER role');
        await ensureColumnExists('users', 'branch', 'branch VARCHAR(255) AFTER expertise');
        await ensureColumnExists('users', 'profile_photo', 'profile_photo LONGTEXT AFTER branch');
        await ensureColumnExists('users', 'academy_id', 'academy_id VARCHAR(36) NULL AFTER profile_photo');
        await ensureColumnExists('users', 'academy_access_status', `academy_access_status VARCHAR(20) NOT NULL DEFAULT 'active' AFTER academy_id`);
        await ensureColumnExists('users', 'academy_access_last_login_at', 'academy_access_last_login_at DATETIME NULL AFTER academy_access_status');
        await ensureColumnExists('users', 'academy_access_restricted_at', 'academy_access_restricted_at DATETIME NULL AFTER academy_access_last_login_at');
        await promisePool.query(`
            UPDATE users
            SET academy_access_status = 'active'
            WHERE academy_access_status IS NULL
               OR academy_access_status = ''
        `);

        console.log(`Users table verified/created in database "${databaseName}"`);

        // Create group messages table
        await promisePool.query(`
            CREATE TABLE IF NOT EXISTS group_messages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                sender_id INT NOT NULL,
                sender_name VARCHAR(255) NOT NULL,
                role ENUM('student', 'instructor') NOT NULL,
                group_type ENUM('students', 'instructors') NOT NULL,
                message_category VARCHAR(50) NOT NULL DEFAULT 'instructor_message',
                message TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_group_type (group_type),
                INDEX idx_timestamp (timestamp)
            )
        `);

        await ensureColumnExists(
            'group_messages',
            'message_category',
            `message_category VARCHAR(50) NOT NULL DEFAULT 'instructor_message' AFTER group_type`
        );

        console.log(`Group messages table verified/created in database "${databaseName}"`);
    } catch (error) {
        console.error('Database initialization error:', error);
        throw error;
    }
}

initializeDatabase().catch((error) => {
    console.error('Database init failed:', error);
});

module.exports = promisePool;
