const mysql = require('mysql2');
require('dotenv').config();

const MYSQL_PUBLIC_URL = process.env.MYSQL_PUBLIC_URL;

if (!MYSQL_PUBLIC_URL) {
    console.error('❌ MYSQL_PUBLIC_URL not found in .env');
    console.log('Make sure you have MYSQL_PUBLIC_URL set in your Railway dashboard Variables');
    process.exit(1);
}

console.log('Testing Railway MySQL with PUBLIC_URL...');
console.log('Connection String:', MYSQL_PUBLIC_URL.replace(/:[^@]*@/, ':****@'));

const connection = mysql.createConnection(MYSQL_PUBLIC_URL);

connection.connect((err) => {
    if (err) {
        console.error('\n❌ Connection Failed:');
        console.error('Error Code:', err.code);
        console.error('Error Message:', err.message);
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

setTimeout(() => {
    console.error('\n❌ Test timed out after 15 seconds');
    connection.end();
    process.exit(1);
}, 15000);
