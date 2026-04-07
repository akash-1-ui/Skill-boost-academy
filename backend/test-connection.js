const mysql = require('mysql2');
require('dotenv').config();

console.log('Testing Railway MySQL Connection...');
console.log('Host:', process.env.DB_HOST);
console.log('Port:', process.env.DB_PORT);
console.log('User:', process.env.DB_USER);
console.log('Database:', process.env.DB_NAME);

const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 10000,
    enableKeepAlive: true,
    keepAliveInitialDelayMs: 0
});

connection.connect((err) => {
    if (err) {
        console.error('\n❌ Connection Failed:');
        console.error('Error Code:', err.code);
        console.error('Error Message:', err.message);
        
        if (err.code === 'ETIMEDOUT') {
            console.log('\n⚠️  ETIMEDOUT - Connection attempt timed out');
            console.log('Possible causes:');
            console.log('1. Railway database proxy is unreachable');
            console.log('2. Network/Firewall is blocking the connection');
            console.log('3. Verify your internet connection');
            console.log('4. Check if Railway service is running');
        }
        process.exit(1);
    } else {
        console.log('\n✅ Connection Successful!');
        connection.query('SELECT 1', (err, results) => {
            if (err) {
                console.error('Query failed:', err.message);
            } else {
                console.log('✅ Query test passed');
            }
            connection.end();
            process.exit(0);
        });
    }
});

// Set timeout for the entire test
setTimeout(() => {
    console.error('\n❌ Test timed out after 15 seconds');
    connection.end();
    process.exit(1);
}, 15000);
