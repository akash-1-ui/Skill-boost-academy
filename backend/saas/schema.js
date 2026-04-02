const db = require('../db');

const LEGACY_ACCESS_CODE = 'LEGACY-CAMPUS';
const DEFAULT_EXPIRY_DATE_SQL = 'DATE_ADD(CURDATE(), INTERVAL 365 DAY)';

async function tableExists(tableName) {
    const [rows] = await db.query(
        `SELECT 1
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND table_name = ?
         LIMIT 1`,
        [tableName]
    );
    return rows.length > 0;
}

async function columnExists(tableName, columnName) {
    const [rows] = await db.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName]);
    return rows.length > 0;
}

async function ensureColumn(tableName, columnName, definitionSql) {
    if (await columnExists(tableName, columnName)) {
        return;
    }

    await db.query(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
    console.log(`Added ${columnName} to ${tableName}`);
}

async function getIndexColumns(tableName) {
    const [rows] = await db.query(`SHOW INDEX FROM ${tableName}`);
    const indexMap = new Map();

    rows.forEach((row) => {
        if (!indexMap.has(row.Key_name)) {
            indexMap.set(row.Key_name, {
                nonUnique: Number(row.Non_unique),
                columns: []
            });
        }

        indexMap.get(row.Key_name).columns[Number(row.Seq_in_index) - 1] = row.Column_name;
    });

    return indexMap;
}

async function ensureIndex(tableName, indexName, indexSql) {
    const indexes = await getIndexColumns(tableName);
    if (indexes.has(indexName)) {
        return;
    }

    await db.query(`ALTER TABLE ${tableName} ADD ${indexSql}`);
    console.log(`Added ${indexName} index to ${tableName}`);
}

async function dropIndexIfExists(tableName, indexName) {
    const indexes = await getIndexColumns(tableName);
    if (!indexes.has(indexName) || indexName === 'PRIMARY') {
        return;
    }

    await db.query(`ALTER TABLE ${tableName} DROP INDEX ${indexName}`);
    console.log(`Dropped ${indexName} index from ${tableName}`);
}

async function ensureOrganizationsTable() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS organizations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            college_name VARCHAR(255) NOT NULL,
            access_code VARCHAR(100) NOT NULL UNIQUE,
            student_limit INT DEFAULT 0,
            instructor_limit INT DEFAULT 0,
            subscription_status ENUM('active', 'expired') DEFAULT 'expired',
            expiry_date DATE NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

async function ensureUsersTableShape() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL,
            phone VARCHAR(20),
            password VARCHAR(255) NOT NULL,
            role ENUM('principal', 'instructor', 'student') NOT NULL,
            expertise VARCHAR(255),
            branch VARCHAR(255),
            profile_photo LONGTEXT,
            organization_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await ensureColumn('users', 'organization_id', 'organization_id INT NULL AFTER profile_photo');
    await db.query(`
        ALTER TABLE users
        MODIFY role ENUM('principal', 'instructor', 'student') NOT NULL
    `);

    const indexes = await getIndexColumns('users');
    for (const [indexName, details] of indexes.entries()) {
        if (details.nonUnique === 0 && details.columns.length === 1 && details.columns[0] === 'email' && indexName !== 'PRIMARY') {
            await dropIndexIfExists('users', indexName);
        }
    }

    await ensureIndex('users', 'uniq_users_org_email', 'UNIQUE INDEX uniq_users_org_email (organization_id, email)');
    await ensureIndex('users', 'idx_users_org_role', 'INDEX idx_users_org_role (organization_id, role)');
}

async function ensureTenantColumns() {
    const tenantColumnDefinitions = [
        ['courses', 'organization_id', 'organization_id INT NULL AFTER expiry_warning_sent_at'],
        ['videos', 'organization_id', 'organization_id INT NULL AFTER created_at'],
        ['messages', 'organization_id', 'organization_id INT NULL AFTER created_at'],
        ['group_messages', 'organization_id', 'organization_id INT NULL AFTER timestamp'],
        ['notifications', 'organization_id', 'organization_id INT NULL AFTER created_at'],
        ['enrollments', 'organization_id', 'organization_id INT NULL AFTER created_at'],
        ['course_videos', 'organization_id', 'organization_id INT NULL AFTER created_at'],
        ['course_views', 'organization_id', 'organization_id INT NULL AFTER created_at'],
        ['course_video_progress', 'organization_id', 'organization_id INT NULL AFTER created_at'],
        ['contacts', 'organization_id', 'organization_id INT NULL AFTER created_at']
    ];

    for (const [tableName, columnName, definitionSql] of tenantColumnDefinitions) {
        if (await tableExists(tableName)) {
            await ensureColumn(tableName, columnName, definitionSql);
        }
    }
}

async function ensureSubscriptionsTable() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS subscriptions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            organization_id INT NOT NULL,
            plan_id VARCHAR(50) NOT NULL,
            plan_name VARCHAR(100) NOT NULL,
            amount INT NOT NULL,
            currency VARCHAR(10) NOT NULL DEFAULT 'INR',
            student_limit INT NULL,
            instructor_limit INT NULL,
            duration_days INT NOT NULL,
            provider VARCHAR(50) NOT NULL DEFAULT 'stripe',
            status VARCHAR(50) NOT NULL,
            payment_id VARCHAR(255) NOT NULL,
            metadata TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_subscriptions_org_created (organization_id, created_at),
            UNIQUE KEY uniq_subscriptions_payment (payment_id)
        )
    `);
}

async function ensureLegacyOrganization() {
    const [existing] = await db.query(
        `SELECT id
         FROM organizations
         WHERE access_code = ?
         LIMIT 1`,
        [LEGACY_ACCESS_CODE]
    );

    if (existing.length > 0) {
        return Number(existing[0].id);
    }

    const [result] = await db.query(
        `INSERT INTO organizations (
            college_name,
            access_code,
            student_limit,
            instructor_limit,
            subscription_status,
            expiry_date,
            created_at
         )
         VALUES (
            'Legacy Organization',
            ?,
            1000,
            100,
            'active',
            ${DEFAULT_EXPIRY_DATE_SQL},
            NOW()
         )`,
        [LEGACY_ACCESS_CODE]
    );

    return Number(result.insertId);
}

async function backfillTenantData(legacyOrganizationId) {
    await db.query(
        `UPDATE users
         SET organization_id = ?
         WHERE organization_id IS NULL`,
        [legacyOrganizationId]
    );

    if (await tableExists('courses')) {
        await db.query(`
            UPDATE courses c
            INNER JOIN users u ON u.id = c.instructor_id
            SET c.organization_id = u.organization_id
            WHERE c.organization_id IS NULL
        `);
    }

    if (await tableExists('videos')) {
        await db.query(`
            UPDATE videos v
            INNER JOIN courses c ON c.id = v.course_id
            SET v.organization_id = c.organization_id
            WHERE v.organization_id IS NULL
        `);
    }

    if (await tableExists('course_videos')) {
        await db.query(`
            UPDATE course_videos cv
            INNER JOIN courses c ON c.id = cv.course_id
            SET cv.organization_id = c.organization_id
            WHERE cv.organization_id IS NULL
        `);
    }

    if (await tableExists('enrollments')) {
        await db.query(`
            UPDATE enrollments e
            INNER JOIN courses c ON c.id = e.course_id
            SET e.organization_id = c.organization_id
            WHERE e.organization_id IS NULL
        `);
    }

    if (await tableExists('course_views')) {
        await db.query(`
            UPDATE course_views cv
            INNER JOIN courses c ON c.id = cv.course_id
            SET cv.organization_id = c.organization_id
            WHERE cv.organization_id IS NULL
        `);
    }

    if (await tableExists('course_video_progress')) {
        await db.query(`
            UPDATE course_video_progress p
            INNER JOIN course_videos cv ON cv.id = p.video_id
            SET p.organization_id = cv.organization_id
            WHERE p.organization_id IS NULL
        `);
    }

    if (await tableExists('group_messages')) {
        await db.query(`
            UPDATE group_messages gm
            INNER JOIN users u ON u.id = gm.sender_id
            SET gm.organization_id = u.organization_id
            WHERE gm.organization_id IS NULL
        `);
    }

    if (await tableExists('messages')) {
        await db.query(`
            UPDATE messages m
            INNER JOIN users u ON u.id = m.instructor_id
            SET m.organization_id = u.organization_id
            WHERE m.organization_id IS NULL
        `);
    }

    if (await tableExists('notifications')) {
        await db.query(`
            UPDATE notifications n
            INNER JOIN users u ON u.id = n.user_id
            SET n.organization_id = u.organization_id
            WHERE n.organization_id IS NULL
        `);
    }

    if (await tableExists('contacts')) {
        await db.query(
            `UPDATE contacts
             SET organization_id = ?
             WHERE organization_id IS NULL`,
            [legacyOrganizationId]
        );
    }
}

async function ensureTenantIndexes() {
    const indexDefinitions = [
        ['courses', 'idx_courses_org_instructor', 'INDEX idx_courses_org_instructor (organization_id, instructor_id)'],
        ['videos', 'idx_videos_org_course', 'INDEX idx_videos_org_course (organization_id, course_id)'],
        ['messages', 'idx_messages_org_instructor', 'INDEX idx_messages_org_instructor (organization_id, instructor_id)'],
        ['group_messages', 'idx_group_messages_org_type', 'INDEX idx_group_messages_org_type (organization_id, group_type, timestamp)'],
        ['notifications', 'idx_notifications_org_user', 'INDEX idx_notifications_org_user (organization_id, user_id, is_read)'],
        ['enrollments', 'idx_enrollments_org_course_student', 'INDEX idx_enrollments_org_course_student (organization_id, course_id, student_email)'],
        ['course_videos', 'idx_course_videos_org_course', 'INDEX idx_course_videos_org_course (organization_id, course_id)'],
        ['course_views', 'idx_course_views_org_course_student', 'INDEX idx_course_views_org_course_student (organization_id, course_id, student_email)'],
        ['course_video_progress', 'idx_course_video_progress_org_video_student', 'INDEX idx_course_video_progress_org_video_student (organization_id, video_id, student_email)'],
        ['contacts', 'idx_contacts_org_created', 'INDEX idx_contacts_org_created (organization_id, created_at)']
    ];

    for (const [tableName, indexName, definition] of indexDefinitions) {
        if (await tableExists(tableName)) {
            await ensureIndex(tableName, indexName, definition);
        }
    }
}

async function ensureMultiTenantSchema() {
    await ensureOrganizationsTable();
    await ensureUsersTableShape();
    await ensureTenantColumns();
    await ensureSubscriptionsTable();

    const legacyOrganizationId = await ensureLegacyOrganization();
    await backfillTenantData(legacyOrganizationId);
    await ensureTenantIndexes();

    console.log('Multi-tenant SaaS schema verified');
}

module.exports = {
    ensureMultiTenantSchema
};
