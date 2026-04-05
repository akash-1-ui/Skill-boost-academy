const db = require('./db');

async function clearHistory() {
    try {
        console.log('Clearing payment history...');
        await db.query('TRUNCATE TABLE academy_payments');
        console.log('✓ Payments cleared');

        console.log('Clearing activity logs...');
        await db.query('TRUNCATE TABLE attempt_logs');
        console.log('✓ Activity logs cleared');

        console.log('\n✓ All history cleared successfully!');
        process.exit(0);
    } catch (error) {
        console.error('Error clearing history:', error);
        process.exit(1);
    }
}

clearHistory();
