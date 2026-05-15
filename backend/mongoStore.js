const { MongoClient } = require('mongodb');

const DEFAULT_PLANS = [
    {
        id: 1,
        name: 'Basic',
        max_instructors: 1,
        max_students: 10,
        price: 0,
        description: 'Free plan for getting started'
    },
    {
        id: 2,
        name: 'Pro',
        max_instructors: 10,
        max_students: 200,
        price: 499,
        description: 'Perfect for small academies'
    },
    {
        id: 3,
        name: 'Advanced',
        max_instructors: 25,
        max_students: 1000,
        price: 999,
        description: 'For growing academies'
    }
];

function normalizeMongoUri(value) {
    return String(value || '').trim();
}

function getMongoUri() {
    return normalizeMongoUri(process.env.MONGODB_URI || process.env.MONGO_URI);
}

function isMongoEnabled() {
    return /^mongodb(\+srv)?:\/\//i.test(getMongoUri());
}

let clientPromise = null;
let databasePromise = null;

async function getMongoDb() {
    const uri = getMongoUri();
    if (!/^mongodb(\+srv)?:\/\//i.test(uri)) {
        throw new Error('MONGODB_URI is not configured');
    }

    if (!clientPromise) {
        const client = new MongoClient(uri, {
            serverSelectionTimeoutMS: Number(process.env.MONGO_CONNECT_TIMEOUT_MS || 10000)
        });
        clientPromise = client.connect();
    }

    if (!databasePromise) {
        databasePromise = clientPromise.then(async (client) => {
            const dbName = String(process.env.MONGODB_DB || process.env.DB_NAME || 'skill_boost_nexus').trim();
            const db = client.db(dbName);
            await ensureMongoIndexes(db);
            return db;
        });
    }

    return databasePromise;
}

async function ensureMongoIndexes(db) {
    await Promise.all([
        db.collection('customers').createIndex({ email: 1 }, { unique: true }),
        db.collection('academies').createIndex({ customer_id: 1 }),
        db.collection('academies').createIndex({ access_code: 1 }, { unique: true }),
        db.collection('users').createIndex({ academy_id: 1, role: 1 }),
        db.collection('academy_payments').createIndex({ academy_id: 1, created_at: -1 }),
        db.collection('academy_payment_orders').createIndex({ razorpay_order_id: 1 }, { unique: true }),
        db.collection('attempt_logs').createIndex({ academy_id: 1, timestamp: -1 })
    ]);

    for (const plan of DEFAULT_PLANS) {
        await db.collection('plans').updateOne(
            { id: plan.id },
            { $set: { ...plan, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } },
            { upsert: true }
        );
    }
}

async function nextSequence(name) {
    const db = await getMongoDb();
    const result = await db.collection('counters').findOneAndUpdate(
        { _id: name },
        { $inc: { value: 1 } },
        { upsert: true, returnDocument: 'after' }
    );
    return Number(result.value.value);
}

async function getPlan(planId) {
    const db = await getMongoDb();
    return db.collection('plans').findOne({ id: Number(planId) });
}

async function listPlans() {
    const db = await getMongoDb();
    return db.collection('plans')
        .find({})
        .sort({ price: 1, id: 1 })
        .toArray();
}

module.exports = {
    DEFAULT_PLANS,
    getMongoDb,
    getMongoUri,
    getPlan,
    isMongoEnabled,
    listPlans,
    nextSequence
};
