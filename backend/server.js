require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const db = require('./db');
const bcrypt = require('bcrypt');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const {
    COURSE_DURATION_OPTIONS,
    DEFAULT_COURSE_DURATION_DAYS,
    getDurationOption,
    calculateExpiryDate,
    getCourseLifecycleStatus,
    getDaysRemaining
} = require('./courseLifecycle');
const {
    getCloudinaryStatus,
    uploadVideoAsset,
    deleteVideoAssetByUrl,
    extractCloudinaryPublicId
} = require('./cloudinary');
const { saasRouter, ensureMultiTenantSchema } = require('./saas');

let cron = null;
try {
    cron = require('node-cron');
} catch (error) {
    console.warn('node-cron is not installed. Scheduled cleanup jobs are disabled until dependencies are installed.');
}

const app = express();
const port = process.env.PORT || 3000;
const DEFAULT_PROFILE_PHOTO = '/uploads/default-avatar.svg';
const RESET_OTP_EXPIRY_MINUTES = Number(process.env.RESET_OTP_EXPIRY_MINUTES || 10);
const RESET_OTP_RESEND_SECONDS = Number(process.env.RESET_OTP_RESEND_SECONDS || 60);
const RESET_OTP_MAX_ATTEMPTS = Number(process.env.RESET_OTP_MAX_ATTEMPTS || 5);
const LOCAL_VIDEO_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

try {
    fs.mkdirSync(path.join(__dirname, 'videos'), { recursive: true });
    fs.mkdirSync(path.join(__dirname, 'tmp', 'videos'), { recursive: true });
    fs.mkdirSync(path.join(__dirname, 'uploads', 'covers'), { recursive: true });
    console.log('Upload directories created/verified');
} catch (err) {
    console.error('Error creating upload directories:', err);
}

const storage = multer.diskStorage({
    destination(req, file, cb) {
        const destination = file.fieldname === 'video'
            ? path.join(__dirname, 'tmp', 'videos')
            : path.join(__dirname, 'uploads', 'covers');
        cb(null, destination);
    },
    filename(req, file, cb) {
        const timestamp = Date.now();
        const ext = path.extname(file.originalname);
        cb(null, `${timestamp}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter(req, file, cb) {
        if (file.fieldname === 'video' && !file.mimetype.startsWith('video/')) {
            return cb(new Error('Please upload a valid video file'));
        }
        if (file.fieldname === 'cover' && !file.mimetype.startsWith('image/')) {
            return cb(new Error('Please upload a valid image file for cover'));
        }
        return cb(null, true);
    }
});

function optionalVideoUpload(req, res, next) {
    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.includes('multipart/form-data')) {
        return next();
    }
    return upload.single('video')(req, res, next);
}

app.use(cors({
    origin: '*',
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));
app.use(bodyParser.json({ limit: '25mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '25mb' }));

app.use(express.static(path.join(__dirname, '..')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/videos', express.static(path.join(__dirname, 'videos')));

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
});

app.use('/api', saasRouter);

// Root route - serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'HTML', 'index.html'));
});

// Health check endpoint - verify backend and Cloudinary status
app.get('/api/health', (req, res) => {
    const cloudinaryStatus = getCloudinaryStatus();
    const status = {
        backend: 'ok',
        timestamp: new Date().toISOString(),
        cloudinary: {
            ready: cloudinaryStatus.ready,
            reason: cloudinaryStatus.reason || 'Cloudinary is properly configured'
        },
        environmentVariables: {
            hasCloudinaryCloudName: !!process.env.CLOUDINARY_CLOUD_NAME,
            hasCloudinaryApiKey: !!process.env.CLOUDINARY_API_KEY,
            hasCloudinaryApiSecret: !!process.env.CLOUDINARY_API_SECRET,
            databaseUrl: !!process.env.DATABASE_URL
        }
    };
    
    res.status(cloudinaryStatus.ready ? 200 : 503).json(status);
});

function asPositiveInt(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
        return null;
    }
    return n;
}

function hasMeaningfulDisplayName(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return Boolean(
        normalized &&
        !['anonymous', 'anonimous', 'user', 'student', 'instructor'].includes(normalized)
    );
}

function resolvePreferredDisplayName(candidates, fallback) {
    for (const candidate of candidates) {
        const trimmed = String(candidate || '').trim();
        if (hasMeaningfulDisplayName(trimmed)) {
            return trimmed;
        }
    }

    return String(fallback || '').trim();
}

function normalizeGroupMessageCategory(value, messageText = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'new_release' || normalized === 'instructor_message') {
        return normalized;
    }

    return String(messageText || '').trim().startsWith('NEW RELEASE:')
        ? 'new_release'
        : 'instructor_message';
}

function sanitizePhoneNumber(value) {
    return String(value || '').replace(/\D/g, '');
}

function normalizeRole(role) {
    if (!role) {
        return null;
    }

    const normalized = String(role).trim().toLowerCase();
    if (normalized !== 'student' && normalized !== 'instructor') {
        return null;
    }
    return normalized;
}

function maskPhoneNumber(value) {
    const digits = sanitizePhoneNumber(value);
    if (digits.length < 4) {
        return '****';
    }
    const visible = digits.slice(-4);
    return `******${visible}`;
}

function formatWatchHoursFromSeconds(seconds) {
    const value = Number(seconds || 0);
    return Number((value / 3600).toFixed(2));
}

async function findUserByPhoneAndRole(phone, role) {
    const cleanedPhone = sanitizePhoneNumber(phone);
    const cleanedRole = normalizeRole(role);

    if (!cleanedPhone || !cleanedRole) {
        return null;
    }

    const [rows] = await db.query(
        `SELECT id, username, email, phone, role
         FROM users
         WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') = ?
           AND role = ?
         ORDER BY id DESC
         LIMIT 1`,
        [cleanedPhone, cleanedRole]
    );

    return rows[0] || null;
}

async function sendResetOtpSms(phone, otp) {
    const provider = String(process.env.SMS_PROVIDER || 'mock').trim().toLowerCase();
    const messageText = `SkillBoost Academy reset code: ${otp}. Valid for ${RESET_OTP_EXPIRY_MINUTES} minutes.`;

    if (provider === 'twilio') {
        const sid = process.env.TWILIO_ACCOUNT_SID;
        const token = process.env.TWILIO_AUTH_TOKEN;
        const from = process.env.TWILIO_FROM_NUMBER;

        if (!sid || !token || !from) {
            throw new Error('Twilio credentials are not configured');
        }

        const params = new URLSearchParams();
        params.set('To', phone);
        params.set('From', from);
        params.set('Body', messageText);

        const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        });

        if (!response.ok) {
            const providerError = await response.text();
            throw new Error(`SMS provider error: ${providerError}`);
        }

        return { provider: 'twilio' };
    }

    // Fallback for local development when no SMS provider is configured.
    console.log(`[SMS MOCK] Reset OTP for ${phone}: ${otp}`);
    return { provider: 'mock', otp };
}

function normalizeCourse(course) {
    const durationOption = getDurationOption(course.duration_days || course.duration);
    const durationDays = Number(course.duration_days || durationOption.days || DEFAULT_COURSE_DURATION_DAYS);
    const durationLabel = course.duration_label || durationOption.planLabel;
    const expiryDate = course.expiry_date || calculateExpiryDate(course.created_at, durationDays);
    const status = getCourseLifecycleStatus(expiryDate);
    const instructorName = resolvePreferredDisplayName(
        [course.instructor_name, course.username],
        'Instructor'
    );

    return {
        id: course.id,
        instructor_id: course.instructor_id,
        instructor_name: instructorName,
        title: course.title,
        duration: `${durationDays} days`,
        duration_days: durationDays,
        duration_label: durationLabel,
        duration_summary: `${durationDays} days (${durationLabel})`,
        category: course.category,
        description: course.description || '',
        enrolled_students: Number(course.enrolled_students || 0),
        created_at: course.created_at,
        expiry_date: expiryDate,
        status,
        days_remaining: getDaysRemaining(expiryDate),
        cover_path: course.cover_path || null,
        video_path: course.video_path || null,
        // Keep aliases for existing frontend code.
        cover: course.cover_path || null,
        video: course.video_path || null
    };
}

async function createNotifications(userIds, message, type) {
    const uniqueUserIds = Array.from(new Set((userIds || []).map(asPositiveInt).filter(Boolean)));
    if (uniqueUserIds.length === 0 || !message || !type) {
        return 0;
    }

    const placeholders = uniqueUserIds.map(() => '(?, ?, ?, ?, NOW())').join(', ');
    const values = uniqueUserIds.flatMap((userId) => [userId, message, type, 0]);
    await db.query(
        `INSERT INTO notifications (user_id, message, type, is_read, created_at)
         VALUES ${placeholders}`,
        values
    );
    return uniqueUserIds.length;
}

async function getUserById(userId) {
    const normalizedUserId = asPositiveInt(userId);
    if (!normalizedUserId) {
        return null;
    }

    const [rows] = await db.query(
        `SELECT id, username, email, role, profile_photo
         FROM users
         WHERE id = ?
         LIMIT 1`,
        [normalizedUserId]
    );

    return rows[0] || null;
}

async function getSharedActiveCourses(studentUserId, instructorUserId) {
    const normalizedStudentId = asPositiveInt(studentUserId);
    const normalizedInstructorId = asPositiveInt(instructorUserId);

    if (!normalizedStudentId || !normalizedInstructorId) {
        return [];
    }

    const [rows] = await db.query(
        `SELECT
            c.id,
            c.title,
            c.created_at
         FROM courses c
         INNER JOIN users s
           ON s.id = ?
          AND s.role = 'student'
         INNER JOIN enrollments e
           ON e.student_email = s.email
          AND e.course_id = c.id
         WHERE c.instructor_id = ?
           AND (c.expiry_date IS NULL OR c.expiry_date > NOW())
         ORDER BY c.created_at DESC, c.id DESC`,
        [normalizedStudentId, normalizedInstructorId]
    );

    return rows.map((row) => ({
        id: Number(row.id),
        title: row.title,
        created_at: row.created_at
    }));
}

async function getChatParticipants(userId, otherUserId) {
    const normalizedUserId = asPositiveInt(userId);
    const normalizedOtherUserId = asPositiveInt(otherUserId);

    if (!normalizedUserId || !normalizedOtherUserId || normalizedUserId === normalizedOtherUserId) {
        return null;
    }

    const [rows] = await db.query(
        `SELECT id, username, email, role, profile_photo
         FROM users
         WHERE id IN (?, ?)`,
        [normalizedUserId, normalizedOtherUserId]
    );

    if (rows.length !== 2) {
        return null;
    }

    const currentUser = rows.find((row) => Number(row.id) === normalizedUserId);
    const otherUser = rows.find((row) => Number(row.id) === normalizedOtherUserId);

    if (!currentUser || !otherUser) {
        return null;
    }

    if (currentUser.role === 'instructor' && otherUser.role === 'instructor') {
        return {
            currentUser,
            otherUser,
            studentUser: null,
            instructorUser: currentUser,
            sharedCourses: [],
            primaryCourse: null,
            conversationType: 'instructor'
        };
    }

    if (currentUser.role === otherUser.role) {
        return null;
    }

    const studentUser = currentUser.role === 'student' ? currentUser : otherUser;
    const instructorUser = currentUser.role === 'instructor' ? currentUser : otherUser;
    const sharedCourses = await getSharedActiveCourses(studentUser.id, instructorUser.id);

    if (sharedCourses.length === 0) {
        return null;
    }

    return {
        currentUser,
        otherUser,
        studentUser,
        instructorUser,
        sharedCourses,
        primaryCourse: sharedCourses[0] || null,
        conversationType: 'student'
    };
}

function summarizeSharedCourses(sharedCourses) {
    const uniqueTitles = Array.from(
        new Set((sharedCourses || []).map((course) => String(course.title || '').trim()).filter(Boolean))
    );

    if (uniqueTitles.length === 0) {
        return 'No shared active courses';
    }

    if (uniqueTitles.length === 1) {
        return uniqueTitles[0];
    }

    if (uniqueTitles.length === 2) {
        return `${uniqueTitles[0]} and ${uniqueTitles[1]}`;
    }

    return `${uniqueTitles[0]} + ${uniqueTitles.length - 1} more courses`;
}

async function fetchChatConversationsForUser(userId) {
    const currentUser = await getUserById(userId);
    if (!currentUser) {
        return [];
    }

    let relationRows = [];

    if (currentUser.role === 'student') {
        const [rows] = await db.query(
            `SELECT
                u.id AS partner_id,
                u.username AS partner_name,
                u.profile_photo AS partner_photo,
                c.id AS course_id,
                c.title AS course_title,
                c.created_at AS course_created_at
             FROM users me
             INNER JOIN enrollments e ON e.student_email = me.email
             INNER JOIN courses c
               ON c.id = e.course_id
              AND (c.expiry_date IS NULL OR c.expiry_date > NOW())
             INNER JOIN users u
               ON u.id = c.instructor_id
              AND u.role = 'instructor'
             WHERE me.id = ?
               AND me.role = 'student'
             ORDER BY c.created_at DESC, c.id DESC`,
            [currentUser.id]
        );
        relationRows = rows;
    } else if (currentUser.role === 'instructor') {
        const [rows] = await db.query(
            `SELECT
                u.id AS partner_id,
                u.username AS partner_name,
                u.profile_photo AS partner_photo,
                c.id AS course_id,
                c.title AS course_title,
                c.created_at AS course_created_at
             FROM courses c
             INNER JOIN enrollments e ON e.course_id = c.id
             INNER JOIN users u
               ON u.email = e.student_email
              AND u.role = 'student'
             WHERE c.instructor_id = ?
               AND (c.expiry_date IS NULL OR c.expiry_date > NOW())
             ORDER BY c.created_at DESC, c.id DESC`,
            [currentUser.id]
        );
        relationRows = rows;

        const [instructorPeerRows] = await db.query(
            `SELECT
                u.id AS partner_id,
                u.username AS partner_name,
                u.profile_photo AS partner_photo,
                NULL AS course_id,
                NULL AS course_title,
                u.created_at AS course_created_at
             FROM users u
             WHERE u.role = 'instructor'
               AND u.id <> ?
             ORDER BY u.username ASC, u.id ASC`,
            [currentUser.id]
        );

        relationRows = [...relationRows, ...instructorPeerRows];
    }

    if (relationRows.length === 0) {
        return [];
    }

    const conversationMap = new Map();

    relationRows.forEach((row) => {
        const partnerId = Number(row.partner_id);
        if (!partnerId) {
            return;
        }

        if (!conversationMap.has(partnerId)) {
            conversationMap.set(partnerId, {
                partner_id: partnerId,
                partner_name: row.partner_name || 'User',
                partner_photo: row.partner_photo || DEFAULT_PROFILE_PHOTO,
                partner_role: currentUser.role === 'student'
                    ? 'instructor'
                    : (row.course_id ? 'student' : 'instructor'),
                shared_courses: [],
                shared_course_count: 0,
                shared_course_summary: '',
                last_message: '',
                last_message_at: null,
                last_sender_id: null,
                unread_count: 0,
                relationship_updated_at: row.course_created_at || null
            });
        }

        const conversation = conversationMap.get(partnerId);
        const alreadyAddedCourse = conversation.shared_courses.some((course) => Number(course.id) === Number(row.course_id));
        if (row.course_id && !alreadyAddedCourse) {
            conversation.shared_courses.push({
                id: Number(row.course_id),
                title: row.course_title,
                created_at: row.course_created_at
            });
        }
    });

    const [messageRows] = await db.query(
        `SELECT id, sender_id, recipient_id, message, is_read, created_at
         FROM chat_messages
         WHERE sender_id = ? OR recipient_id = ?
         ORDER BY created_at DESC, id DESC`,
        [currentUser.id, currentUser.id]
    );

    messageRows.forEach((messageRow) => {
        const partnerId = Number(messageRow.sender_id) === Number(currentUser.id)
            ? Number(messageRow.recipient_id)
            : Number(messageRow.sender_id);

        const conversation = conversationMap.get(partnerId);
        if (!conversation) {
            return;
        }

        if (!conversation.last_message_at) {
            conversation.last_message = messageRow.message || '';
            conversation.last_message_at = messageRow.created_at;
            conversation.last_sender_id = Number(messageRow.sender_id);
        }

        if (Number(messageRow.recipient_id) === Number(currentUser.id) && !Number(messageRow.is_read)) {
            conversation.unread_count += 1;
        }
    });

    return Array.from(conversationMap.values())
        .map((conversation) => {
            conversation.shared_course_count = conversation.shared_courses.length;
            conversation.shared_course_summary = summarizeSharedCourses(conversation.shared_courses);
            return conversation;
        })
        .sort((left, right) => {
            const leftTime = new Date(left.last_message_at || left.relationship_updated_at || 0).getTime();
            const rightTime = new Date(right.last_message_at || right.relationship_updated_at || 0).getTime();
            if (leftTime !== rightTime) {
                return rightTime - leftTime;
            }
            return String(left.partner_name || '').localeCompare(String(right.partner_name || ''));
        });
}

async function getStudentUserIdsForCourse(courseId) {
    const [rows] = await db.query(
        `SELECT DISTINCT u.id
         FROM enrollments e
         INNER JOIN users u ON u.email = e.student_email
         WHERE e.course_id = ? AND u.role = 'student'`,
        [courseId]
    );

    return rows.map((row) => Number(row.id)).filter(Boolean);
}

function normalizeInlineText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateText(value, maxLength) {
    const text = normalizeInlineText(value);
    if (!text || text.length <= maxLength) {
        return text;
    }

    const shortened = text.slice(0, Math.max(0, maxLength - 3));
    const boundary = shortened.lastIndexOf(' ');
    const finalText = boundary > 40 ? shortened.slice(0, boundary) : shortened;
    return `${finalText.trim()}...`;
}

function buildCourseReleaseMessage(course, instructorName) {
    const title = normalizeInlineText(course?.title) || 'Untitled course';
    const category = normalizeInlineText(course?.category) || 'General learning';
    const description = truncateText(course?.description, 120);
    const durationLabel = normalizeInlineText(course?.durationLabel);
    const durationPlan = normalizeInlineText(course?.durationPlan);
    const durationText = [durationLabel, durationPlan].filter(Boolean).join(' / ');
    const compactSummary = description
        ? `${description.charAt(0).toUpperCase()}${description.slice(1)}${/[.!?]$/.test(description) ? '' : '.'}`
        : `A guided ${category.toLowerCase()} course built for steady learning progress.`;
    const durationNote = durationText ? ` Format: ${durationText}.` : '';

    return `NEW RELEASE: "${title}" by ${instructorName} in ${category}.${durationNote} AI note: ${compactSummary}`;
}

async function sendNewCourseNotifications(courseTitle) {
    const [rows] = await db.query(
        `SELECT id
         FROM users
         WHERE role = 'student'`
    );

    return createNotifications(
        rows.map((row) => Number(row.id)),
        `New course added: ${courseTitle}`,
        'new_course'
    );
}

async function sendNewCourseReleaseAnnouncement(course) {
    if (!course?.instructorId || !course?.title) {
        return 0;
    }

    const [rows] = await db.query(
        `SELECT username
         FROM users
         WHERE id = ? AND role = 'instructor'
         LIMIT 1`,
        [course.instructorId]
    );

    const instructorName = resolvePreferredDisplayName(
        [rows[0]?.username],
        'Instructor'
    );

    const message = buildCourseReleaseMessage(course, instructorName);
    const timestamp = new Date();

    await db.query(
        `INSERT INTO group_messages (sender_id, sender_name, role, group_type, message_category, message, timestamp)
         VALUES (?, ?, 'instructor', 'students', 'new_release', ?, ?)`,
        [course.instructorId, instructorName, message, timestamp]
    );

    return 1;
}

async function sendExpiryWarningNotifications(course) {
    if (!course || !course.id) {
        return 0;
    }

    const studentUserIds = await getStudentUserIdsForCourse(course.id);
    const recipients = [Number(course.instructor_id), ...studentUserIds];
    const message = `Course '${course.title}' will expire tomorrow`;
    return createNotifications(recipients, message, 'expiry_warning');
}

async function sendExpiryDeletionNotification(instructorId, courseTitle) {
    return createNotifications(
        [Number(instructorId)],
        `Your course '${courseTitle}' has been removed after expiry`,
        'deleted'
    );
}

async function ensureColumnExists(tableName, columnName, definitionSql) {
    const [columns] = await db.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName]);
    if (columns.length === 0) {
        try {
            await db.query(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
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

async function ensureColumnNullable(tableName, columnName, columnTypeSql) {
    const [columns] = await db.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName]);
    if (columns.length === 0) {
        return;
    }
    const column = columns[0];
    if (column.Null !== 'YES') {
        await db.query(`ALTER TABLE ${tableName} MODIFY ${columnName} ${columnTypeSql} NULL`);
        console.log(`Updated ${columnName} column to allow NULL in ${tableName}`);
    }
}

async function dropColumnIfExists(tableName, columnName) {
    const [columns] = await db.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName]);
    if (columns.length === 0) {
        return;
    }
    await db.query(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`);
    console.log(`Dropped ${columnName} column from ${tableName}`);
}

async function initializeTables() {
    await db.query(`
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
            INDEX idx_group_type_category (group_type, message_category),
            INDEX idx_timestamp (timestamp)
        )
    `);

    await ensureColumnExists(
        'group_messages',
        'message_category',
        `message_category VARCHAR(50) NOT NULL DEFAULT 'instructor_message' AFTER group_type`
    );

    await db.query(`
        UPDATE group_messages
        SET message_category = CASE
            WHEN message LIKE 'NEW RELEASE:%' THEN 'new_release'
            ELSE 'instructor_message'
        END
        WHERE message_category IS NULL
           OR message_category = ''
           OR message LIKE 'NEW RELEASE:%'
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS courses (
            id INT PRIMARY KEY AUTO_INCREMENT,
            instructor_id INT NOT NULL,
            title VARCHAR(255) NOT NULL,
            duration VARCHAR(50),
            duration_days INT DEFAULT 90,
            duration_label VARCHAR(100) DEFAULT 'Full course',
            cover_path TEXT NOT NULL,
            video_path TEXT NULL,
            category VARCHAR(100) NOT NULL,
            description TEXT,
            enrolled_students INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expiry_date TIMESTAMP NULL DEFAULT NULL,
            expiry_warning_sent_at DATETIME NULL,
            FOREIGN KEY (instructor_id) REFERENCES users(id)
        )
    `);

    await ensureColumnExists('courses', 'duration', 'duration VARCHAR(50) AFTER title');
    await ensureColumnExists('courses', 'duration_days', 'duration_days INT DEFAULT 90 AFTER duration');
    await ensureColumnExists('courses', 'duration_label', `duration_label VARCHAR(100) DEFAULT 'Full course' AFTER duration_days`);
    await ensureColumnExists('courses', 'cover_path', 'cover_path TEXT NOT NULL');
    await ensureColumnExists('courses', 'video_path', 'video_path TEXT NULL');
    await ensureColumnNullable('courses', 'video_path', 'TEXT');
    await ensureColumnExists('courses', 'category', 'category VARCHAR(100) NOT NULL');
    await ensureColumnExists('courses', 'description', 'description TEXT');
    await ensureColumnExists('courses', 'enrolled_students', 'enrolled_students INT DEFAULT 0');
    await ensureColumnExists('courses', 'expiry_date', 'expiry_date TIMESTAMP NULL DEFAULT NULL AFTER created_at');
    await ensureColumnExists('courses', 'expiry_warning_sent_at', 'expiry_warning_sent_at DATETIME NULL AFTER expiry_date');
    await dropColumnIfExists('courses', 'difficulty');

    await db.query(`
        UPDATE courses
        SET duration_days = CASE
            WHEN duration_days IN (30, 60, 90, 180) THEN duration_days
            ELSE ${DEFAULT_COURSE_DURATION_DAYS}
        END
    `);

    await db.query(`
        UPDATE courses
        SET duration_label = CASE duration_days
            WHEN 30 THEN 'Short course'
            WHEN 60 THEN 'Medium course'
            WHEN 180 THEN 'Advanced course'
            ELSE 'Full course'
        END
        WHERE duration_label IS NULL OR duration_label = ''
    `);

    await db.query(`
        UPDATE courses
        SET duration = CONCAT(duration_days, ' days')
        WHERE duration IS NULL
           OR duration = ''
           OR duration REGEXP '^[0-9]+(\\.[0-9]+)?$'
    `);

    await db.query(`
        UPDATE courses
        SET expiry_date = DATE_ADD(created_at, INTERVAL duration_days DAY)
        WHERE expiry_date IS NULL
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS enrollments (
            id INT PRIMARY KEY AUTO_INCREMENT,
            student_email VARCHAR(255) NOT NULL,
            course_id INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_student_course (student_email, course_id)
        )
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS course_views (
            id INT PRIMARY KEY AUTO_INCREMENT,
            student_email VARCHAR(255) NOT NULL,
            course_id INT NOT NULL,
            total_time_spent INT DEFAULT 0,
            last_viewed TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_view (student_email, course_id)
        )
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS videos (
            id INT PRIMARY KEY AUTO_INCREMENT,
            course_id INT NOT NULL,
            title VARCHAR(255) NOT NULL,
            video_url TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (course_id) REFERENCES courses(id)
        )
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS course_videos (
            id INT PRIMARY KEY AUTO_INCREMENT,
            course_id INT NOT NULL,
            title VARCHAR(255) NOT NULL,
            video_path TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (course_id) REFERENCES courses(id)
        )
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS course_video_progress (
            id INT PRIMARY KEY AUTO_INCREMENT,
            student_email VARCHAR(255) NOT NULL,
            video_id INT NOT NULL,
            is_watched TINYINT(1) DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_progress (student_email, video_id),
            FOREIGN KEY (video_id) REFERENCES course_videos(id)
        )
    `);

    await db.query(`
        INSERT INTO course_videos (course_id, title, video_path, created_at)
        SELECT c.id, CONCAT(c.title, ' - Main Video'), c.video_path, c.created_at
        FROM courses c
        LEFT JOIN course_videos cv ON cv.course_id = c.id
        WHERE c.video_path IS NOT NULL AND c.video_path <> '' AND cv.id IS NULL
    `);

    await db.query(`
        INSERT INTO videos (id, course_id, title, video_url, created_at)
        SELECT cv.id, cv.course_id, cv.title, cv.video_path, cv.created_at
        FROM course_videos cv
        LEFT JOIN videos v ON v.id = cv.id
        WHERE v.id IS NULL
    `);

    await db.query(`
        INSERT INTO course_videos (id, course_id, title, video_path, created_at)
        SELECT v.id, v.course_id, v.title, v.video_url, v.created_at
        FROM videos v
        LEFT JOIN course_videos cv ON cv.id = v.id
        WHERE cv.id IS NULL
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS notifications (
            id INT PRIMARY KEY AUTO_INCREMENT,
            user_id INT NOT NULL,
            message TEXT NOT NULL,
            type VARCHAR(50) NOT NULL,
            is_read TINYINT(1) DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS messages (
            id INT PRIMARY KEY AUTO_INCREMENT,
            instructor_id INT NOT NULL,
            title VARCHAR(255) NOT NULL DEFAULT 'Message',
            content TEXT NOT NULL,
            priority VARCHAR(20) NOT NULL DEFAULT 'normal',
            sent_count INT NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (instructor_id) REFERENCES users(id)
        )
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INT PRIMARY KEY AUTO_INCREMENT,
            sender_id INT NOT NULL,
            recipient_id INT NOT NULL,
            course_id INT NULL,
            message TEXT NOT NULL,
            is_read TINYINT(1) DEFAULT 0,
            read_at DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_chat_sender_created (sender_id, created_at),
            INDEX idx_chat_recipient_read (recipient_id, is_read, created_at),
            INDEX idx_chat_pair (sender_id, recipient_id, created_at),
            FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL
        )
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS contacts (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS password_reset_otps (
            id INT PRIMARY KEY AUTO_INCREMENT,
            user_id INT NOT NULL,
            otp_hash VARCHAR(255) NOT NULL,
            attempts INT DEFAULT 0,
            expires_at DATETIME NOT NULL,
            used TINYINT(1) DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_reset_user (user_id),
            INDEX idx_reset_expiry (expires_at)
        )
    `);

    console.log('Application tables verified/created');
}

initializeTables()
    .then(async () => {
        await ensureMultiTenantSchema();
        scheduleCourseLifecycleJobs();
        try {
            const result = await runCourseLifecycleSweep();
            console.log(`Initial course lifecycle sweep complete. warnings=${result.warningCount}, deleted=${result.deletedCount}`);
        } catch (error) {
            console.error('Initial course lifecycle sweep failed:', error);
        }

        try {
            const result = await migrateExistingVideosToCloudinary();
            console.log(`Existing video Cloudinary migration complete. migrated=${result.migratedCount}, skipped=${result.skippedCount}, failed=${result.failedCount}`);
        } catch (error) {
            console.error('Existing video Cloudinary migration failed:', error);
        }
    })
    .catch((err) => {
        console.error('Error initializing application tables:', err);
    });

async function deleteStoredFile(publicPath) {
    if (!publicPath || typeof publicPath !== 'string') {
        return;
    }

    const cleanedPath = publicPath.replace(/^\/+/, '');
    const resolvedBase = path.resolve(__dirname);
    const resolvedFile = path.resolve(__dirname, cleanedPath);

    if (!resolvedFile.startsWith(resolvedBase)) {
        return;
    }

    try {
        await fs.promises.unlink(resolvedFile);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Error deleting file:', resolvedFile, error);
        }
    }
}

function isPathWithinProject(targetPath) {
    if (!targetPath) {
        return false;
    }

    const resolvedTarget = path.resolve(targetPath);
    const allowedRoots = [
        path.resolve(__dirname),
        path.resolve(__dirname, '..')
    ];

    return allowedRoots.some((rootPath) => resolvedTarget === rootPath || resolvedTarget.startsWith(`${rootPath}${path.sep}`));
}

async function deleteAbsoluteFile(targetPath) {
    if (!targetPath || !isPathWithinProject(targetPath)) {
        return;
    }

    try {
        await fs.promises.unlink(targetPath);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Error deleting file:', targetPath, error);
        }
    }
}

function normalizeLocalVideoReference(videoUrl) {
    if (!videoUrl || typeof videoUrl !== 'string') {
        return '';
    }

    const trimmed = videoUrl.trim();
    if (!trimmed) {
        return '';
    }

    if (/^https?:\/\//i.test(trimmed)) {
        try {
            const parsedUrl = new URL(trimmed);
            if (!LOCAL_VIDEO_HOSTS.has(String(parsedUrl.hostname || '').toLowerCase())) {
                return '';
            }
            return decodeURIComponent(parsedUrl.pathname || '').split(/[?#]/)[0];
        } catch (error) {
            return '';
        }
    }

    return trimmed.split(/[?#]/)[0];
}

function buildVideoFileCandidates(videoUrl) {
    const normalizedReference = normalizeLocalVideoReference(videoUrl);
    if (!normalizedReference) {
        return [];
    }

    const normalizedPath = normalizedReference.replace(/\\/g, '/');
    const relativePath = normalizedPath.replace(/^\/+/, '');
    const fileName = path.basename(normalizedPath);
    const candidates = [];

    const pushCandidate = (candidatePath) => {
        if (!candidatePath) {
            return;
        }

        const resolvedCandidate = path.resolve(candidatePath);
        if (isPathWithinProject(resolvedCandidate)) {
            candidates.push(resolvedCandidate);
        }
    };

    if (path.isAbsolute(normalizedPath)) {
        pushCandidate(normalizedPath);
    }

    if (relativePath) {
        pushCandidate(path.join(__dirname, relativePath));
        pushCandidate(path.join(__dirname, '..', relativePath));
    }

    if (fileName) {
        pushCandidate(path.join(__dirname, 'videos', fileName));
        pushCandidate(path.join(__dirname, 'tmp', 'videos', fileName));
        pushCandidate(path.join(__dirname, '..', 'videos', fileName));
    }

    return Array.from(new Set(candidates));
}

function resolveExistingVideoFile(videoUrl) {
    const candidatePaths = buildVideoFileCandidates(videoUrl);
    for (const candidatePath of candidatePaths) {
        try {
            const stats = fs.statSync(candidatePath);
            if (stats.isFile()) {
                return candidatePath;
            }
        } catch (error) {
            continue;
        }
    }

    return null;
}

async function deleteVideoStorageAsset(videoUrl) {
    if (!videoUrl || typeof videoUrl !== 'string') {
        return;
    }

    if (extractCloudinaryPublicId(videoUrl)) {
        await deleteVideoAssetByUrl(videoUrl);
        return;
    }

    const resolvedFile = resolveExistingVideoFile(videoUrl);
    if (resolvedFile) {
        await deleteAbsoluteFile(resolvedFile);
        return;
    }

    if (!/^https?:\/\//i.test(videoUrl)) {
        await deleteStoredFile(videoUrl);
    }
}

async function updateMigratedVideoReferences(record, uploadedUrl) {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        if (record.videoId) {
            await connection.query(
                'UPDATE videos SET video_url = ? WHERE id = ?',
                [uploadedUrl, record.videoId]
            );
            await connection.query(
                'UPDATE course_videos SET video_path = ? WHERE id = ?',
                [uploadedUrl, record.videoId]
            );
        } else if (record.courseId) {
            await connection.query(
                'UPDATE videos SET video_url = ? WHERE course_id = ? AND video_url = ?',
                [uploadedUrl, record.courseId, record.sourcePath]
            );
            await connection.query(
                'UPDATE course_videos SET video_path = ? WHERE course_id = ? AND video_path = ?',
                [uploadedUrl, record.courseId, record.sourcePath]
            );
        }

        if (record.courseId) {
            await connection.query(
                'UPDATE courses SET video_path = ? WHERE id = ? AND video_path = ?',
                [uploadedUrl, record.courseId, record.sourcePath]
            );
        }

        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function getVideoMigrationCandidates() {
    const [courseRows] = await db.query(
        `SELECT id AS course_id, video_path AS source_path
         FROM courses
         WHERE video_path IS NOT NULL
           AND video_path <> ''
           AND (expiry_date IS NULL OR expiry_date > NOW())`
    );

    const [videoRows] = await db.query(
        `SELECT v.id AS video_id, v.course_id, v.video_url AS source_path
         FROM videos v
         INNER JOIN courses c ON c.id = v.course_id
         WHERE v.video_url IS NOT NULL
           AND v.video_url <> ''
           AND (c.expiry_date IS NULL OR c.expiry_date > NOW())`
    );

    return [
        ...courseRows.map((row) => ({
            courseId: Number(row.course_id),
            videoId: null,
            sourcePath: row.source_path
        })),
        ...videoRows.map((row) => ({
            courseId: Number(row.course_id),
            videoId: Number(row.video_id),
            sourcePath: row.source_path
        }))
    ];
}

async function migrateExistingVideosToCloudinary() {
    const status = getCloudinaryStatus();
    if (!status.ready) {
        console.log(`Skipping existing video Cloudinary migration: ${status.reason}`);
        return { migratedCount: 0, skippedCount: 0, failedCount: 0 };
    }

    const candidates = await getVideoMigrationCandidates();
    const groupedCandidates = new Map();
    let skippedCount = 0;
    let migratedCount = 0;
    let failedCount = 0;

    for (const candidate of candidates) {
        const sourcePath = String(candidate.sourcePath || '').trim();
        if (!sourcePath || extractCloudinaryPublicId(sourcePath)) {
            skippedCount += 1;
            continue;
        }

        const resolvedFile = resolveExistingVideoFile(sourcePath);
        if (!resolvedFile) {
            skippedCount += 1;
            console.warn(`Skipping existing video migration for missing or remote source: ${sourcePath}`);
            continue;
        }

        const groupKey = resolvedFile.toLowerCase();
        if (!groupedCandidates.has(groupKey)) {
            groupedCandidates.set(groupKey, {
                resolvedFile,
                records: []
            });
        }

        groupedCandidates.get(groupKey).records.push({
            ...candidate,
            sourcePath
        });
    }

    for (const group of groupedCandidates.values()) {
        let uploadedUrl = '';

        try {
            const uploadedVideo = await uploadVideoAsset(group.resolvedFile, { removeLocalFile: false });
            uploadedUrl = uploadedVideo.secure_url || uploadedVideo.url;
        } catch (error) {
            failedCount += group.records.length;
            console.error(`Failed to upload existing video to Cloudinary: ${group.resolvedFile}`, error);
            continue;
        }

        let successfulUpdates = 0;
        let groupFailed = false;

        for (const record of group.records) {
            try {
                await updateMigratedVideoReferences(record, uploadedUrl);
                successfulUpdates += 1;
                migratedCount += 1;
            } catch (error) {
                groupFailed = true;
                failedCount += 1;
                console.error(
                    `Failed to update migrated video reference for course=${record.courseId || 'n/a'} video=${record.videoId || 'n/a'}`,
                    error
                );
            }
        }

        if (successfulUpdates === 0) {
            try {
                await deleteVideoAssetByUrl(uploadedUrl);
            } catch (deleteError) {
                console.error(`Failed to remove unused Cloudinary asset after migration failure: ${uploadedUrl}`, deleteError);
            }
            continue;
        }

        if (!groupFailed) {
            await deleteAbsoluteFile(group.resolvedFile);
        } else {
            console.warn(`Kept local video file after partial migration so failed rows can be retried: ${group.resolvedFile}`);
        }
    }

    return { migratedCount, skippedCount, failedCount };
}

async function fetchCourseVideoRows(courseId, studentEmail = '') {
    const normalizedCourseId = asPositiveInt(courseId);
    if (!normalizedCourseId) {
        return [];
    }

    const [videoRows] = studentEmail
        ? await db.query(
            `SELECT
                v.id,
                v.course_id,
                v.title,
                v.video_url,
                v.created_at,
                COALESCE(p.is_watched, 0) AS is_watched
             FROM videos v
             LEFT JOIN course_video_progress p
               ON p.video_id = v.id AND p.student_email = ?
             WHERE v.course_id = ?
             ORDER BY v.created_at ASC, v.id ASC`,
            [studentEmail, normalizedCourseId]
        )
        : await db.query(
            `SELECT
                v.id,
                v.course_id,
                v.title,
                v.video_url,
                v.created_at,
                0 AS is_watched
             FROM videos v
             WHERE v.course_id = ?
             ORDER BY v.created_at ASC, v.id ASC`,
            [normalizedCourseId]
        );

    return videoRows.map((video) => ({
        id: video.id,
        course_id: video.course_id,
        title: video.title,
        video_url: video.video_url,
        video_path: video.video_url,
        video: video.video_url,
        created_at: video.created_at,
        is_watched: Number(video.is_watched || 0)
    }));
}

async function insertVideoRecord(courseId, title, videoUrl, createdAt = new Date()) {
    const [result] = await db.query(
        `INSERT INTO videos (course_id, title, video_url, created_at)
         VALUES (?, ?, ?, ?)`,
        [courseId, title, videoUrl, createdAt]
    );

    await db.query(
        `INSERT INTO course_videos (id, course_id, title, video_path, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [result.insertId, courseId, title, videoUrl, createdAt]
    );

    return result.insertId;
}

async function updateVideoRecord(videoId, title, videoUrl) {
    await db.query(
        'UPDATE videos SET title = ?, video_url = ? WHERE id = ?',
        [title, videoUrl, videoId]
    );

    await db.query(
        'UPDATE course_videos SET title = ?, video_path = ? WHERE id = ?',
        [title, videoUrl, videoId]
    );
}

async function deleteVideoRecord(videoId) {
    await db.query('DELETE FROM course_video_progress WHERE video_id = ?', [videoId]);
    await db.query('DELETE FROM course_videos WHERE id = ?', [videoId]);
    await db.query('DELETE FROM videos WHERE id = ?', [videoId]);
}

async function deleteCourseWithAssets(courseId, options = {}) {
    const normalizedCourseId = asPositiveInt(courseId);
    if (!normalizedCourseId) {
        return null;
    }

    const [courseRows] = await db.query(
        `SELECT id, title, instructor_id, cover_path, video_path
         FROM courses
         WHERE id = ?`,
        [normalizedCourseId]
    );

    if (courseRows.length === 0) {
        return null;
    }

    const course = courseRows[0];
    const [videoRows] = await db.query(
        `SELECT id, video_url
         FROM videos
         WHERE course_id = ?`,
        [normalizedCourseId]
    );

    const videoIds = videoRows.map((video) => Number(video.id)).filter(Boolean);

    await db.query('DELETE FROM enrollments WHERE course_id = ?', [normalizedCourseId]);
    await db.query('DELETE FROM course_views WHERE course_id = ?', [normalizedCourseId]);
    if (videoIds.length > 0) {
        await db.query('DELETE FROM course_video_progress WHERE video_id IN (?)', [videoIds]);
    }
    await db.query('DELETE FROM course_videos WHERE course_id = ?', [normalizedCourseId]);
    await db.query('DELETE FROM videos WHERE course_id = ?', [normalizedCourseId]);
    await db.query('DELETE FROM courses WHERE id = ?', [normalizedCourseId]);

    await deleteStoredFile(course.cover_path);

    if (course.video_path) {
        await deleteVideoStorageAsset(course.video_path);
    }

    for (const video of videoRows) {
        await deleteVideoStorageAsset(video.video_url);
    }

    if (options.sendExpiryNotification) {
        await sendExpiryDeletionNotification(course.instructor_id, course.title);
    }

    return course;
}

async function deleteInstructorCourses(instructorId) {
    const [courses] = await db.query(
        'SELECT id FROM courses WHERE instructor_id = ?',
        [instructorId]
    );

    if (courses.length === 0) {
        return 0;
    }

    for (const course of courses) {
        await deleteCourseWithAssets(course.id, { sendExpiryNotification: false });
    }

    return courses.length;
}

async function sendUpcomingExpiryWarnings() {
    const [courses] = await db.query(
        `SELECT id, title, instructor_id, expiry_date, expiry_warning_sent_at
         FROM courses
         WHERE expiry_date IS NOT NULL
           AND expiry_date > NOW()
           AND DATE(expiry_date) = DATE(DATE_ADD(NOW(), INTERVAL 1 DAY))
           AND (expiry_warning_sent_at IS NULL OR DATE(expiry_warning_sent_at) < CURDATE())`
    );

    for (const course of courses) {
        await sendExpiryWarningNotifications(course);
        await db.query(
            'UPDATE courses SET expiry_warning_sent_at = NOW() WHERE id = ?',
            [course.id]
        );
    }

    return courses.length;
}

async function cleanupExpiredCourses() {
    const [courses] = await db.query(
        `SELECT id
         FROM courses
         WHERE expiry_date IS NOT NULL
           AND expiry_date <= NOW()`
    );

    for (const course of courses) {
        await deleteCourseWithAssets(course.id, { sendExpiryNotification: true });
    }

    return courses.length;
}

async function runCourseLifecycleSweep() {
    const warningCount = await sendUpcomingExpiryWarnings();
    const deletedCount = await cleanupExpiredCourses();
    return { warningCount, deletedCount };
}

function scheduleCourseLifecycleJobs() {
    if (!cron) {
        return;
    }

    const scheduleExpression = process.env.COURSE_LIFECYCLE_CRON || '0 0 * * *';
    const timezone = process.env.COURSE_LIFECYCLE_TZ || process.env.TZ || 'Asia/Calcutta';

    cron.schedule(scheduleExpression, async () => {
        try {
            const result = await runCourseLifecycleSweep();
            console.log(`Course lifecycle sweep complete. warnings=${result.warningCount}, deleted=${result.deletedCount}`);
        } catch (error) {
            console.error('Course lifecycle sweep failed:', error);
        }
    }, {
        timezone
    });

    console.log(`Course lifecycle cron scheduled with "${scheduleExpression}" in timezone "${timezone}"`);
}

app.get('/api/test', (req, res) => {
    res.json({ message: 'Server is working!' });
});

app.get(['/courses', '/api/courses'], async (req, res) => {
    try {
        const studentEmail = (req.query.studentEmail || '').toString().trim();

        if (studentEmail) {
            const [courses] = await db.query(
                `SELECT
                    c.*,
                    MAX(u.username) AS instructor_name,
                    COUNT(DISTINCT v.id) AS video_count,
                    COUNT(DISTINCT CASE WHEN p.is_watched = 1 THEN p.video_id END) AS watched_count
                 FROM courses c
                 LEFT JOIN users u
                   ON u.id = c.instructor_id
                  AND u.role = 'instructor'
                 LEFT JOIN videos v ON v.course_id = c.id
                 LEFT JOIN course_video_progress p
                   ON p.video_id = v.id AND p.student_email = ?
                 WHERE c.expiry_date IS NULL OR c.expiry_date > NOW()
                 GROUP BY c.id
                 ORDER BY c.created_at DESC`,
                [studentEmail]
            );

            const payload = courses.map((course) => {
                const normalized = normalizeCourse(course);
                let videoCount = Number(course.video_count || 0);
                const watchedCount = Number(course.watched_count || 0);
                if (videoCount === 0 && normalized.video_path) {
                    videoCount = 1;
                }
                return {
                    ...normalized,
                    video_count: videoCount,
                    watched_count: watchedCount
                };
            });

            return res.json(payload);
        }

        const [courses] = await db.query(
            `SELECT
                c.*,
                u.username AS instructor_name
             FROM courses c
             LEFT JOIN users u
               ON u.id = c.instructor_id
              AND u.role = 'instructor'
             WHERE expiry_date IS NULL OR expiry_date > NOW()
             ORDER BY c.created_at DESC`
        );
        return res.json(courses.map(normalizeCourse));
    } catch (error) {
        console.error('Error fetching all courses:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/course/:courseId', async (req, res) => {
    const courseId = asPositiveInt(req.params.courseId);
    if (!courseId) {
        return res.status(400).json({ error: 'Invalid course ID' });
    }

    try {
        const [rows] = await db.query('SELECT * FROM courses WHERE id = ? LIMIT 1', [courseId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Course not found' });
        }
        const normalizedCourse = normalizeCourse(rows[0]);
        if (normalizedCourse.status === 'Expired') {
            return res.status(404).json({ error: 'Course not found' });
        }
        return res.json(normalizedCourse);
    } catch (error) {
        console.error('Error fetching course:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/courses/:instructorId', async (req, res) => {
    const instructorId = asPositiveInt(req.params.instructorId);
    if (!instructorId) {
        return res.status(400).json({ error: 'Invalid instructor ID' });
    }

    try {
        const [courses] = await db.query(
            `SELECT *
             FROM courses
             WHERE instructor_id = ?
               AND (expiry_date IS NULL OR expiry_date > NOW())
             ORDER BY created_at DESC`,
            [instructorId]
        );
        return res.json(courses.map(normalizeCourse));
    } catch (error) {
        console.error('Error fetching instructor courses:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.get(['/courses/:courseId/videos', '/api/course-videos/:courseId'], async (req, res) => {
    const courseId = asPositiveInt(req.params.courseId);
    if (!courseId) {
        return res.status(400).json({ error: 'Invalid course ID' });
    }

    try {
        const studentEmail = (req.query.studentEmail || '').toString().trim();
        const [courseRows] = await db.query(
            `SELECT id, title, video_path, expiry_date
             FROM courses
             WHERE id = ?`,
            [courseId]
        );

        if (courseRows.length === 0) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const course = courseRows[0];
        if (getCourseLifecycleStatus(course.expiry_date) === 'Expired') {
            return res.status(404).json({ error: 'Course not found' });
        }

        const items = await fetchCourseVideoRows(courseId, studentEmail);

        if (items.length === 0 && course.video_path) {
            items.push({
                id: `legacy-${courseId}`,
                course_id: courseId,
                title: `${course.title} - Main Video`,
                video_path: course.video_path,
                video: course.video_path,
                created_at: null,
                is_watched: 0
            });
        }

        return res.json({
            courseId,
            videos: items
        });
    } catch (error) {
        console.error('Error fetching course videos:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.post(['/videos/upload', '/api/videos/upload', '/api/course-videos'], upload.single('video'), async (req, res) => {
    try {
        const courseId = asPositiveInt(req.body.course_id);
        const instructorId = asPositiveInt(req.body.instructor_id);
        const title = (req.body.title || '').toString().trim() || 'Lesson Video';

        console.log('Video upload request received:', { courseId, instructorId, title, hasFile: !!req.file });

        if (!courseId) {
            return res.status(400).json({ error: 'Valid course_id is required' });
        }

        if (!req.file) {
            console.error('Video upload failed: No file provided');
            return res.status(400).json({ error: 'Video file is required' });
        }

        console.log('File received:', { originalName: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype, path: req.file.path });

        const [courseRows] = await db.query(
            `SELECT id, instructor_id, title, expiry_date
             FROM courses
             WHERE id = ?`,
            [courseId]
        );

        if (courseRows.length === 0) {
            console.error(`Course not found: ${courseId}`);
            return res.status(404).json({ error: 'Course not found' });
        }

        const course = courseRows[0];
        if (instructorId && Number(course.instructor_id) !== Number(instructorId)) {
            console.error(`Permission denied: instructor ${instructorId} cannot upload to course ${courseId} (owner: ${course.instructor_id})`);
            return res.status(403).json({ error: 'You can only upload videos to your own courses' });
        }

        if (getCourseLifecycleStatus(course.expiry_date) === 'Expired') {
            console.error(`Course expired: ${courseId}`);
            return res.status(400).json({ error: 'This course has expired and can no longer accept uploads' });
        }

        console.log('Starting Cloudinary upload for file:', req.file.path);
        const uploadedVideo = await uploadVideoAsset(req.file.path);
        const videoUrl = uploadedVideo.secure_url || uploadedVideo.url;
        console.log('Cloudinary upload successful:', { videoUrl, publicId: uploadedVideo.public_id });

        const createdAt = new Date();
        let videoId = null;

        try {
            videoId = await insertVideoRecord(courseId, title, videoUrl, createdAt);
            console.log('Video record inserted:', { videoId, courseId, title });
        } catch (dbError) {
            console.error('Database insert error, cleaning up Cloudinary asset:', dbError);
            await deleteVideoAssetByUrl(videoUrl);
            throw dbError;
        }

        console.log('Video upload completed successfully:', { videoId, courseId });
        return res.status(201).json({
            message: 'Video uploaded successfully',
            video: {
                id: videoId,
                course_id: courseId,
                title,
                video_url: videoUrl,
                video_path: videoUrl,
                video: videoUrl,
                created_at: createdAt
            }
        });
    } catch (error) {
        console.error('Course video upload error:', error);
        const status = String(error.message || '').includes('Cloudinary upload is unavailable') ? 503 : 500;
        const errorMessage = status === 503 
            ? (error.message || 'Cloudinary upload is unavailable. Please check your .env file for CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.')
            : 'Failed to upload video. Please try again or contact support.';
        return res.status(status).json({
            error: errorMessage,
            details: error.message || 'Unknown upload error',
            type: error.constructor.name
        });
    }
});

app.put('/api/course-videos/:videoId', optionalVideoUpload, async (req, res) => {
    try {
        const videoId = asPositiveInt(req.params.videoId);
        const instructorId = asPositiveInt(req.body.instructor_id);

        if (!videoId) {
            return res.status(400).json({ error: 'Invalid video ID' });
        }

        if (!instructorId) {
            return res.status(400).json({ error: 'Instructor ID is required' });
        }

        const [rows] = await db.query(
            `SELECT v.id, v.title, v.video_url, c.instructor_id
             FROM videos v
             INNER JOIN courses c ON c.id = v.course_id
             WHERE v.id = ?`,
            [videoId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Video not found' });
        }

        const existing = rows[0];
        if (Number(existing.instructor_id) !== Number(instructorId)) {
            return res.status(403).json({ error: 'You can only edit your own course videos' });
        }

        const incomingTitle = (req.body.title || '').toString().trim();
        const updatedTitle = incomingTitle || existing.title || 'Lesson Video';
        const hasNewVideo = Boolean(req.file);
        let updatedPath = existing.video_url;
        let uploadedVideoUrl = null;

        if (hasNewVideo) {
            const uploadedVideo = await uploadVideoAsset(req.file.path);
            uploadedVideoUrl = uploadedVideo.secure_url || uploadedVideo.url;
            updatedPath = uploadedVideoUrl;
        }

        try {
            await updateVideoRecord(videoId, updatedTitle, updatedPath);
        } catch (dbError) {
            if (uploadedVideoUrl) {
                await deleteVideoAssetByUrl(uploadedVideoUrl);
            }
            throw dbError;
        }

        if (hasNewVideo && existing.video_url && existing.video_url !== updatedPath) {
            await deleteVideoStorageAsset(existing.video_url);
        }

        return res.json({
            message: 'Video updated successfully',
            video: {
                id: videoId,
                title: updatedTitle,
                video_url: updatedPath,
                video_path: updatedPath,
                video: updatedPath
            }
        });
    } catch (error) {
        console.error('Course video update error:', error);
        const status = String(error.message || '').includes('Cloudinary upload is unavailable') ? 503 : 500;
        return res.status(status).json({
            error: status === 503 ? (error.message || 'Cloudinary upload is unavailable') : 'Failed to update video',
            details: error.message || 'Unknown update error'
        });
    }
});

app.delete('/api/course-videos/:videoId', async (req, res) => {
    try {
        const videoId = asPositiveInt(req.params.videoId);
        const instructorId = asPositiveInt(req.query.instructorId || req.body.instructor_id);

        if (!videoId) {
            return res.status(400).json({ error: 'Invalid video ID' });
        }

        if (!instructorId) {
            return res.status(400).json({ error: 'Instructor ID is required' });
        }

        const [rows] = await db.query(
            `SELECT v.id, v.video_url, c.instructor_id
             FROM videos v
             INNER JOIN courses c ON c.id = v.course_id
             WHERE v.id = ?`,
            [videoId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Video not found' });
        }

        const existing = rows[0];
        if (Number(existing.instructor_id) !== Number(instructorId)) {
            return res.status(403).json({ error: 'You can only delete your own course videos' });
        }

        await deleteVideoRecord(videoId);
        await deleteVideoStorageAsset(existing.video_url);

        return res.json({ message: 'Video deleted successfully' });
    } catch (error) {
        console.error('Course video delete error:', error);
        return res.status(500).json({
            error: 'Failed to delete video',
            details: error.message || 'Unknown delete error'
        });
    }
});

app.post('/api/course-video-progress', async (req, res) => {
    try {
        const studentEmail = (req.body.studentEmail || '').toString().trim();
        const videoId = asPositiveInt(req.body.videoId);
        const isWatched = Number(req.body.isWatched) ? 1 : 0;

        if (!studentEmail || !videoId) {
            return res.status(400).json({ error: 'studentEmail and valid videoId are required' });
        }

        await db.query(
            `INSERT INTO course_video_progress (student_email, video_id, is_watched, created_at)
             VALUES (?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE
                is_watched = VALUES(is_watched),
                updated_at = NOW()`,
            [studentEmail, videoId, isWatched]
        );

        return res.json({ message: 'Progress updated' });
    } catch (error) {
        console.error('Course video progress error:', error);
        return res.status(500).json({ error: 'Failed to update progress' });
    }
});

app.delete(['/courses/:courseId', '/api/courses/:courseId'], async (req, res) => {
    const courseId = asPositiveInt(req.params.courseId);
    if (!courseId) {
        return res.status(400).json({ error: 'Invalid course ID' });
    }

    try {
        const instructorId = asPositiveInt(req.query.instructorId || req.body?.instructor_id);
        const [existingRows] = await db.query(
            `SELECT id, instructor_id
             FROM courses
             WHERE id = ?`,
            [courseId]
        );

        if (existingRows.length === 0) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const existingCourse = existingRows[0];
        if (instructorId && Number(existingCourse.instructor_id) !== Number(instructorId)) {
            return res.status(403).json({ error: 'You can only delete your own courses' });
        }

        await deleteCourseWithAssets(courseId, { sendExpiryNotification: false });

        return res.json({ message: 'Course deleted successfully' });
    } catch (error) {
        console.error('Error deleting course:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/courses/:courseId', upload.fields([
    { name: 'cover', maxCount: 1 }
]), async (req, res) => {
    try {
        const courseId = asPositiveInt(req.params.courseId);
        const { title, category, description, instructor_id } = req.body;
        const instructorId = asPositiveInt(instructor_id);
        const durationOption = getDurationOption(req.body.duration_days || req.body.duration);

        if (!courseId) {
            return res.status(400).json({ error: 'Invalid course ID' });
        }

        if (!title || !category || !description || !instructorId) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const [rows] = await db.query(
            `SELECT id, instructor_id, cover_path, created_at
             FROM courses
             WHERE id = ?`,
            [courseId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const existingCourse = rows[0];
        if (Number(existingCourse.instructor_id) !== Number(instructorId)) {
            return res.status(403).json({ error: 'You can only edit your own courses' });
        }

        let coverPath = existingCourse.cover_path;
        if (req.files && req.files.cover && req.files.cover[0]) {
            coverPath = `/uploads/covers/${path.basename(req.files.cover[0].path)}`;
        }

        const expiryDate = calculateExpiryDate(existingCourse.created_at, durationOption.days);

        await db.query(
            `UPDATE courses
             SET title = ?,
                 duration = ?,
                 duration_days = ?,
                 duration_label = ?,
                 expiry_date = ?,
                 category = ?,
                 description = ?,
                 cover_path = ?
             WHERE id = ?`,
            [
                title,
                durationOption.optionLabel,
                durationOption.days,
                durationOption.planLabel,
                expiryDate,
                category,
                description,
                coverPath,
                courseId
            ]
        );

        if (coverPath !== existingCourse.cover_path) {
            await deleteStoredFile(existingCourse.cover_path);
        }

        return res.json({
            message: 'Course updated successfully',
            courseId,
            expiry_date: expiryDate,
            duration_days: durationOption.days
        });
    } catch (error) {
        console.error('Error updating course:', error);
        return res.status(500).json({ error: 'Failed to update course' });
    }
});

app.post(['/courses', '/api/courses', '/submit-course'], upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'cover', maxCount: 1 }
]), async (req, res) => {
    try {
        if (!req.files || !req.files.cover) {
            return res.status(400).json({ error: 'Cover file is required' });
        }

        const { title, category, description, instructor_id } = req.body;
        const instructorId = asPositiveInt(instructor_id);
        const durationOption = getDurationOption(req.body.duration_days || req.body.duration);

        if (!title || !category || !description || !instructorId) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const hasVideo = req.files.video && req.files.video[0];
        const coverPath = `/uploads/covers/${path.basename(req.files.cover[0].path)}`;
        const createdAt = new Date();
        const expiryDate = calculateExpiryDate(createdAt, durationOption.days);
        let videoPath = null;

        if (hasVideo) {
            const uploadedVideo = await uploadVideoAsset(req.files.video[0].path);
            videoPath = uploadedVideo.secure_url || uploadedVideo.url;
        }

        let courseId = null;

        try {
            const [result] = await db.query(
                `INSERT INTO courses (
                    instructor_id,
                    title,
                    duration,
                    duration_days,
                    duration_label,
                    cover_path,
                    video_path,
                    category,
                    description,
                    enrolled_students,
                    created_at,
                    expiry_date
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
                [
                    instructorId,
                    title,
                    durationOption.optionLabel,
                    durationOption.days,
                    durationOption.planLabel,
                    coverPath,
                    videoPath,
                    category,
                    description,
                    createdAt,
                    expiryDate
                ]
            );

            courseId = result.insertId;

            if (videoPath) {
                await insertVideoRecord(courseId, `${title} - Main Video`, videoPath, createdAt);
            }
        } catch (dbError) {
            await deleteStoredFile(coverPath);
            if (videoPath) {
                await deleteVideoAssetByUrl(videoPath);
            }
            throw dbError;
        }

        try {
            await sendNewCourseNotifications(title);
        } catch (notificationError) {
            console.error('New course notification error:', notificationError);
        }

        try {
            await sendNewCourseReleaseAnnouncement({
                instructorId,
                title,
                category,
                description,
                durationLabel: durationOption.optionLabel,
                durationPlan: durationOption.planLabel
            });
        } catch (releaseError) {
            console.error('New course release announcement error:', releaseError);
        }

        return res.status(201).json({
            message: 'Course created successfully',
            courseId,
            expiry_date: expiryDate,
            duration_days: durationOption.days
        });
    } catch (error) {
        console.error('Error uploading course:', error);
        const status = String(error.message || '').includes('Cloudinary upload is unavailable') ? 503 : 500;
        return res.status(status).json({
            error: status === 503 ? error.message : 'Failed to upload course',
            details: error.message
        });
    }
});

app.post('/api/register', async (req, res) => {
    try {
        const { name, email, phone, course, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email and password are required' });
        }

        const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await db.query(
            `INSERT INTO users (username, email, phone, password, role, branch, created_at)
             VALUES (?, ?, ?, ?, 'student', ?, NOW())`,
            [name, email, phone || null, hashedPassword, course || null]
        );

        return res.status(201).json({
            message: 'Registration successful',
            userId: result.insertId
        });
    } catch (error) {
        console.error('Student registration error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/register/instructor', async (req, res) => {
    try {
        const { name, email, phone, expertise, password } = req.body;

        if (!name || !email || !expertise || !password) {
            return res.status(400).json({ error: 'Name, email, expertise and password are required' });
        }

        const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await db.query(
            `INSERT INTO users (username, email, phone, password, role, expertise, created_at)
             VALUES (?, ?, ?, ?, 'instructor', ?, NOW())`,
            [name, email, phone || null, hashedPassword, expertise]
        );

        return res.status(201).json({
            message: 'Instructor registration successful',
            userId: result.insertId
        });
    } catch (error) {
        console.error('Instructor registration error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/login/student', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const [users] = await db.query(
            `SELECT id, username AS name, email, password, branch, profile_photo
             FROM users
             WHERE email = ? AND role = 'student'`,
            [email]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const student = users[0];
        const passwordMatches = await bcrypt.compare(password, student.password);
        if (!passwordMatches) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        delete student.password;
        student.photo = student.profile_photo || DEFAULT_PROFILE_PHOTO;
        delete student.profile_photo;

        return res.json({
            message: 'Login successful',
            student
        });
    } catch (error) {
        console.error('Student login error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/login/instructor', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const [users] = await db.query(
            `SELECT id, username AS name, email, password, expertise, profile_photo
             FROM users
             WHERE email = ? AND role = 'instructor'`,
            [email]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const instructor = users[0];
        const passwordMatches = await bcrypt.compare(password, instructor.password);
        if (!passwordMatches) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        delete instructor.password;
        instructor.photo = instructor.profile_photo || DEFAULT_PROFILE_PHOTO;
        delete instructor.profile_photo;

        return res.json({
            message: 'Login successful',
            instructor
        });
    } catch (error) {
        console.error('Instructor login error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/account/student', async (req, res) => {
    try {
        const email = (req.body.email || '').toString().trim();
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const [rows] = await db.query(
            'SELECT id FROM users WHERE email = ? AND role = ? LIMIT 1',
            [email, 'student']
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Student account not found' });
        }

        const userId = rows[0].id;

        await db.query('DELETE FROM enrollments WHERE student_email = ?', [email]);
        await db.query('DELETE FROM course_video_progress WHERE student_email = ?', [email]);
        await db.query('DELETE FROM course_views WHERE student_email = ?', [email]);
        await db.query('DELETE FROM notifications WHERE user_id = ?', [userId]);
        await db.query('DELETE FROM password_reset_otps WHERE user_id = ?', [userId]);
        await db.query('DELETE FROM users WHERE id = ?', [userId]);

        return res.json({ message: 'Student account deleted successfully' });
    } catch (error) {
        console.error('Student account delete error:', error);
        return res.status(500).json({ error: 'Failed to delete account' });
    }
});

app.delete('/api/account/instructor', async (req, res) => {
    try {
        const instructorId = asPositiveInt(req.body.instructorId);
        const email = (req.body.email || '').toString().trim();

        if (!instructorId && !email) {
            return res.status(400).json({ error: 'Instructor ID or email is required' });
        }

        const [rows] = instructorId
            ? await db.query('SELECT id, email FROM users WHERE id = ? AND role = ? LIMIT 1', [instructorId, 'instructor'])
            : await db.query('SELECT id, email FROM users WHERE email = ? AND role = ? LIMIT 1', [email, 'instructor']);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Instructor account not found' });
        }

        const userId = rows[0].id;

        const removedCourses = await deleteInstructorCourses(userId);
        await db.query('DELETE FROM notifications WHERE user_id = ?', [userId]);
        await db.query('DELETE FROM password_reset_otps WHERE user_id = ?', [userId]);
        await db.query('DELETE FROM users WHERE id = ?', [userId]);

        return res.json({
            message: 'Instructor account deleted successfully',
            removedCourses
        });
    } catch (error) {
        console.error('Instructor account delete error:', error);
        return res.status(500).json({ error: 'Failed to delete account' });
    }
});

app.get(['/notifications/:userId', '/api/notifications/:userId'], async (req, res) => {
    try {
        const userId = asPositiveInt(req.params.userId);
        if (!userId) {
            return res.status(400).json({ error: 'Valid user ID is required' });
        }

        const [rows] = await db.query(
            `SELECT id, user_id, message, type, is_read, created_at
             FROM notifications
             WHERE user_id = ?
             ORDER BY created_at DESC, id DESC`,
            [userId]
        );

        return res.json(rows.map((notification) => ({
            id: notification.id,
            user_id: notification.user_id,
            message: notification.message,
            type: notification.type,
            is_read: Boolean(notification.is_read),
            created_at: notification.created_at
        })));
    } catch (error) {
        console.error('Notifications fetch error:', error);
        return res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

app.get('/api/chat/conversations', async (req, res) => {
    try {
        const userId = asPositiveInt(req.query.userId);
        if (!userId) {
            return res.status(400).json({ error: 'Valid userId is required' });
        }

        const user = await getUserById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const conversations = await fetchChatConversationsForUser(userId);
        return res.json(conversations);
    } catch (error) {
        console.error('Chat conversations fetch error:', error);
        return res.status(500).json({ error: 'Failed to load conversations' });
    }
});

app.get('/api/chat/messages', async (req, res) => {
    try {
        const userId = asPositiveInt(req.query.userId);
        const otherUserId = asPositiveInt(req.query.withUserId);

        if (!userId || !otherUserId) {
            return res.status(400).json({ error: 'Valid userId and withUserId are required' });
        }

        const participants = await getChatParticipants(userId, otherUserId);
        if (!participants) {
            return res.status(403).json({ error: 'You can only message linked students or instructors from active courses' });
        }

        await db.query(
            `UPDATE chat_messages
             SET is_read = 1,
                 read_at = NOW()
             WHERE sender_id = ?
               AND recipient_id = ?
               AND is_read = 0`,
            [participants.otherUser.id, participants.currentUser.id]
        );

        const [rows] = await db.query(
            `SELECT
                cm.id,
                cm.sender_id,
                cm.recipient_id,
                cm.message,
                cm.course_id,
                cm.is_read,
                cm.read_at,
                cm.created_at,
                s.username AS sender_name,
                s.role AS sender_role,
                r.username AS recipient_name,
                r.role AS recipient_role
             FROM chat_messages cm
             INNER JOIN users s ON s.id = cm.sender_id
             INNER JOIN users r ON r.id = cm.recipient_id
             WHERE (cm.sender_id = ? AND cm.recipient_id = ?)
                OR (cm.sender_id = ? AND cm.recipient_id = ?)
             ORDER BY cm.created_at ASC, cm.id ASC`,
            [participants.currentUser.id, participants.otherUser.id, participants.otherUser.id, participants.currentUser.id]
        );

        return res.json({
            conversation: {
                partner_id: Number(participants.otherUser.id),
                partner_name: participants.otherUser.username || 'User',
                partner_role: participants.otherUser.role,
                partner_photo: participants.otherUser.profile_photo || DEFAULT_PROFILE_PHOTO,
                shared_courses: participants.sharedCourses,
                shared_course_count: participants.sharedCourses.length,
                shared_course_summary: summarizeSharedCourses(participants.sharedCourses)
            },
            messages: rows.map((row) => ({
                id: Number(row.id),
                sender_id: Number(row.sender_id),
                recipient_id: Number(row.recipient_id),
                sender_name: row.sender_name || 'User',
                sender_role: row.sender_role,
                recipient_name: row.recipient_name || 'User',
                recipient_role: row.recipient_role,
                course_id: row.course_id ? Number(row.course_id) : null,
                message: row.message || '',
                is_read: Boolean(row.is_read),
                read_at: row.read_at,
                created_at: row.created_at
            }))
        });
    } catch (error) {
        console.error('Chat messages fetch error:', error);
        return res.status(500).json({ error: 'Failed to load messages' });
    }
});

app.post('/api/chat/messages', async (req, res) => {
    try {
        const senderId = asPositiveInt(req.body.senderId);
        const recipientId = asPositiveInt(req.body.recipientId);
        const message = String(req.body.message || '').trim();

        if (!senderId || !recipientId || !message) {
            return res.status(400).json({ error: 'senderId, recipientId and message are required' });
        }

        if (message.length > 4000) {
            return res.status(400).json({ error: 'Message is too long' });
        }

        const participants = await getChatParticipants(senderId, recipientId);
        if (!participants) {
            return res.status(403).json({ error: 'You can only message linked students or instructors from active courses' });
        }

        const createdAt = new Date();
        const [result] = await db.query(
            `INSERT INTO chat_messages (sender_id, recipient_id, course_id, message, is_read, read_at, created_at)
             VALUES (?, ?, ?, ?, 0, NULL, ?)`,
            [
                participants.currentUser.id,
                participants.otherUser.id,
                participants.primaryCourse ? Number(participants.primaryCourse.id) : null,
                message,
                createdAt
            ]
        );

        return res.status(201).json({
            id: Number(result.insertId),
            sender_id: Number(participants.currentUser.id),
            recipient_id: Number(participants.otherUser.id),
            sender_name: participants.currentUser.username || 'User',
            sender_role: participants.currentUser.role,
            recipient_name: participants.otherUser.username || 'User',
            recipient_role: participants.otherUser.role,
            course_id: participants.primaryCourse ? Number(participants.primaryCourse.id) : null,
            message,
            is_read: false,
            read_at: null,
            created_at: createdAt
        });
    } catch (error) {
        console.error('Chat message send error:', error);
        return res.status(500).json({ error: 'Failed to send message' });
    }
});

app.get('/api/instructor-messages/:instructorId', async (req, res) => {
    try {
        const instructorId = asPositiveInt(req.params.instructorId);
        if (!instructorId) {
            return res.status(400).json({ error: 'Valid instructor ID is required' });
        }

        const [rows] = await db.query(
            `SELECT id, instructor_id, title, content, priority, sent_count, created_at
             FROM messages
             WHERE instructor_id = ?
             ORDER BY created_at DESC, id DESC`,
            [instructorId]
        );

        return res.json(rows.map((message) => ({
            id: message.id,
            instructor_id: message.instructor_id,
            title: message.title,
            content: message.content,
            priority: message.priority,
            sent_count: Number(message.sent_count || 0),
            type: 'sent_message',
            message: message.title && message.title !== 'Message'
                ? `[${String(message.priority || 'normal').toUpperCase()}] ${message.title}: ${message.content}`
                : message.content,
            created_at: message.created_at
        })));
    } catch (error) {
        console.error('Instructor messages fetch error:', error);
        return res.status(500).json({ error: 'Failed to fetch instructor messages' });
    }
});

app.put(['/notifications/read/:notificationId', '/api/notifications/read/:notificationId'], async (req, res) => {
    try {
        const notificationId = asPositiveInt(req.params.notificationId);
        const userId = asPositiveInt(req.body.user_id);

        if (!notificationId) {
            return res.status(400).json({ error: 'Valid notification ID is required' });
        }

        const params = [notificationId];
        let updateQuery = 'UPDATE notifications SET is_read = 1 WHERE id = ?';

        if (userId) {
            updateQuery += ' AND user_id = ?';
            params.push(userId);
        }

        const [result] = await db.query(updateQuery, params);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        return res.json({ message: 'Notification marked as read' });
    } catch (error) {
        console.error('Notification update error:', error);
        return res.status(500).json({ error: 'Failed to update notification' });
    }
});

app.post('/api/forgot-password/send-otp', async (req, res) => {
    try {
        const { phone, role } = req.body;
        const cleanedPhone = sanitizePhoneNumber(phone);
        const cleanedRole = normalizeRole(role);

        if (!cleanedPhone || !cleanedRole) {
            return res.status(400).json({ error: 'Valid phone number and role are required' });
        }

        const user = await findUserByPhoneAndRole(cleanedPhone, cleanedRole);
        if (!user) {
            return res.status(404).json({ error: 'No account found for this mobile number and role' });
        }

        const [recentRows] = await db.query(
            'SELECT created_at FROM password_reset_otps WHERE user_id = ? ORDER BY id DESC LIMIT 1',
            [user.id]
        );

        if (recentRows.length > 0) {
            const createdAt = new Date(recentRows[0].created_at).getTime();
            const elapsedSeconds = Math.floor((Date.now() - createdAt) / 1000);
            if (elapsedSeconds < RESET_OTP_RESEND_SECONDS) {
                return res.status(429).json({
                    error: `Please wait ${RESET_OTP_RESEND_SECONDS - elapsedSeconds} seconds before requesting another code`
                });
            }
        }

        const otp = String(Math.floor(100000 + Math.random() * 900000));
        const otpHash = await bcrypt.hash(otp, 10);
        const expiresAt = new Date(Date.now() + RESET_OTP_EXPIRY_MINUTES * 60 * 1000);

        await db.query('UPDATE password_reset_otps SET used = 1 WHERE user_id = ? AND used = 0', [user.id]);
        const [insertResult] = await db.query(
            `INSERT INTO password_reset_otps (user_id, otp_hash, attempts, expires_at, used, created_at)
             VALUES (?, ?, 0, ?, 0, NOW())`,
            [user.id, otpHash, expiresAt]
        );

        let smsResult;
        try {
            smsResult = await sendResetOtpSms(user.phone || cleanedPhone, otp);
        } catch (smsError) {
            await db.query('UPDATE password_reset_otps SET used = 1 WHERE id = ?', [insertResult.insertId]);
            throw smsError;
        }

        const responsePayload = {
            message: `Verification code sent to mobile ending ${maskPhoneNumber(user.phone || cleanedPhone)}`
        };

        if (smsResult.provider === 'mock') {
            responsePayload.devOtp = smsResult.otp;
            responsePayload.note = 'SMS provider is in mock mode. Configure Twilio env vars for real SMS delivery.';
        }

        return res.json(responsePayload);
    } catch (error) {
        console.error('Forgot password send OTP error:', error);
        return res.status(500).json({ error: 'Failed to send verification code' });
    }
});

app.post('/api/forgot-password/verify-otp', async (req, res) => {
    try {
        const { phone, role, otp, newPassword } = req.body;
        const cleanedPhone = sanitizePhoneNumber(phone);
        const cleanedRole = normalizeRole(role);

        if (!cleanedPhone || !cleanedRole || !otp || !newPassword) {
            return res.status(400).json({ error: 'Phone, role, verification code and new password are required' });
        }

        if (String(newPassword).length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters' });
        }

        const user = await findUserByPhoneAndRole(cleanedPhone, cleanedRole);
        if (!user) {
            return res.status(404).json({ error: 'No account found for this mobile number and role' });
        }

        const [otpRows] = await db.query(
            `SELECT id, otp_hash, attempts, expires_at
             FROM password_reset_otps
             WHERE user_id = ? AND used = 0
             ORDER BY id DESC
             LIMIT 1`,
            [user.id]
        );

        if (otpRows.length === 0) {
            return res.status(400).json({ error: 'No active verification code found. Please request a new code.' });
        }

        const latestOtp = otpRows[0];
        const expiryTime = new Date(latestOtp.expires_at).getTime();
        if (Date.now() > expiryTime) {
            await db.query('UPDATE password_reset_otps SET used = 1 WHERE id = ?', [latestOtp.id]);
            return res.status(400).json({ error: 'Verification code expired. Please request a new code.' });
        }

        const otpMatches = await bcrypt.compare(String(otp), latestOtp.otp_hash);
        if (!otpMatches) {
            const nextAttempts = Number(latestOtp.attempts || 0) + 1;
            const shouldInvalidate = nextAttempts >= RESET_OTP_MAX_ATTEMPTS;

            await db.query(
                'UPDATE password_reset_otps SET attempts = ?, used = ? WHERE id = ?',
                [nextAttempts, shouldInvalidate ? 1 : 0, latestOtp.id]
            );

            if (shouldInvalidate) {
                return res.status(400).json({ error: 'Maximum attempts reached. Please request a new verification code.' });
            }

            return res.status(400).json({ error: 'Invalid verification code' });
        }

        const hashedPassword = await bcrypt.hash(String(newPassword), 10);

        await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, user.id]);
        await db.query('UPDATE password_reset_otps SET used = 1 WHERE id = ?', [latestOtp.id]);

        return res.json({ message: 'Password reset successful. Please login with your new password.' });
    } catch (error) {
        console.error('Forgot password verify OTP error:', error);
        return res.status(500).json({ error: 'Failed to reset password' });
    }
});

app.get('/api/student-profile', async (req, res) => {
    try {
        const email = (req.query.email || '').toString().trim();
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const [rows] = await db.query(
            `SELECT id, username AS name, email, branch, profile_photo
             FROM users
             WHERE email = ? AND role = 'student'`,
            [email]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }

        const student = rows[0];
        return res.json({
            id: student.id,
            name: student.name,
            email: student.email,
            branch: student.branch || '',
            photo: student.profile_photo || DEFAULT_PROFILE_PHOTO
        });
    } catch (error) {
        console.error('Student profile fetch error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/instructor-profile', async (req, res) => {
    try {
        const email = (req.query.email || '').toString().trim();
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const [rows] = await db.query(
            `SELECT id, username AS name, email, expertise, profile_photo
             FROM users
             WHERE email = ? AND role = 'instructor'`,
            [email]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Instructor not found' });
        }

        const instructor = rows[0];
        return res.json({
            id: instructor.id,
            name: instructor.name,
            email: instructor.email,
            expertise: instructor.expertise || '',
            photo: instructor.profile_photo || DEFAULT_PROFILE_PHOTO
        });
    } catch (error) {
        console.error('Instructor profile fetch error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/instructor-profile', async (req, res) => {
    try {
        const email = String(req.body.email || '').trim();
        const name = String(req.body.name || '').trim();
        const expertise = String(req.body.expertise || '').trim();

        if (!email || !name) {
            return res.status(400).json({ error: 'Email and name are required' });
        }

        const [result] = await db.query(
            `UPDATE users
             SET username = ?, expertise = ?
             WHERE email = ? AND role = 'instructor'`,
            [name, expertise, email]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Instructor not found' });
        }

        await db.query(
            `UPDATE group_messages
             SET sender_name = ?
             WHERE sender_id = (
                SELECT id FROM (
                    SELECT id
                    FROM users
                    WHERE email = ? AND role = 'instructor'
                    LIMIT 1
                ) AS matched_instructor
             )
               AND role = 'instructor'`,
            [name, email]
        );

        return res.json({
            message: 'Instructor profile updated successfully',
            profile: {
                name,
                email,
                expertise
            }
        });
    } catch (error) {
        console.error('Instructor profile update error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/student-photo-base64', async (req, res) => {
    try {
        const { email, photo } = req.body;
        if (!email || !photo) {
            return res.status(400).json({ error: 'Email and photo are required' });
        }

        const [result] = await db.query(
            `UPDATE users
             SET profile_photo = ?
             WHERE email = ? AND role = 'student'`,
            [photo, email]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }

        return res.json({ message: 'Student photo updated successfully' });
    } catch (error) {
        console.error('Student photo update error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/instructor-photo-base64', async (req, res) => {
    try {
        const { email, photo } = req.body;
        if (!email || !photo) {
            return res.status(400).json({ error: 'Email and photo are required' });
        }

        const [result] = await db.query(
            `UPDATE users
             SET profile_photo = ?
             WHERE email = ? AND role = 'instructor'`,
            [photo, email]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Instructor not found' });
        }

        return res.json({ message: 'Instructor photo updated successfully' });
    } catch (error) {
        console.error('Instructor photo update error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/contact', async (req, res) => {
    try {
        const { name, email, message } = req.body;

        if (!name || !email || !message) {
            return res.status(400).json({ error: 'Name, email and message are required' });
        }

        await db.query(
            'INSERT INTO contacts (name, email, message, created_at) VALUES (?, ?, ?, NOW())',
            [name, email, message]
        );

        return res.status(201).json({ message: 'Message received successfully' });
    } catch (error) {
        console.error('Contact form error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/enroll', async (req, res) => {
    try {
        const { studentEmail, courseId } = req.body;
        const numericCourseId = asPositiveInt(courseId);

        if (!studentEmail || !numericCourseId) {
            return res.status(400).json({ error: 'studentEmail and valid courseId are required' });
        }

        const [courses] = await db.query(
            `SELECT id
             FROM courses
             WHERE id = ?
               AND (expiry_date IS NULL OR expiry_date > NOW())`,
            [numericCourseId]
        );
        if (courses.length === 0) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const [insertResult] = await db.query(
            'INSERT IGNORE INTO enrollments (student_email, course_id, created_at) VALUES (?, ?, NOW())',
            [studentEmail, numericCourseId]
        );

        if (insertResult.affectedRows > 0) {
            await db.query(
                'UPDATE courses SET enrolled_students = enrolled_students + 1 WHERE id = ?',
                [numericCourseId]
            );
            return res.status(201).json({ message: 'Enrolled successfully', enrolled: true });
        }

        return res.json({ message: 'Already enrolled', enrolled: true });
    } catch (error) {
        console.error('Enrollment error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/course-view', async (req, res) => {
    try {
        const { studentEmail, courseId, timeSpent } = req.body;
        const numericCourseId = asPositiveInt(courseId);
        const numericTimeSpent = Number.isFinite(Number(timeSpent)) ? Math.max(0, Math.floor(Number(timeSpent))) : 0;

        if (!studentEmail || !numericCourseId) {
            return res.status(400).json({ error: 'studentEmail and valid courseId are required' });
        }

        await db.query(
            `INSERT INTO course_views (student_email, course_id, total_time_spent, last_viewed, created_at)
             VALUES (?, ?, ?, NOW(), NOW())
             ON DUPLICATE KEY UPDATE
                total_time_spent = total_time_spent + VALUES(total_time_spent),
                last_viewed = NOW()`,
            [studentEmail, numericCourseId, numericTimeSpent]
        );

        return res.json({ message: 'Course view tracked' });
    } catch (error) {
        console.error('Course view tracking error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/course-views/:studentEmail', async (req, res) => {
    try {
        const studentEmail = req.params.studentEmail;
        if (!studentEmail) {
            return res.status(400).json({ error: 'Student email is required' });
        }

        const [rows] = await db.query(
            `SELECT
                c.id,
                c.title,
                c.category,
                c.description,
                c.cover_path,
                c.video_path,
                c.duration,
                c.duration_days,
                c.duration_label,
                c.expiry_date,
                c.enrolled_students,
                cv.total_time_spent,
                cv.last_viewed,
                u.username AS instructor_name
             FROM course_views cv
             INNER JOIN courses c ON c.id = cv.course_id
             LEFT JOIN users u ON u.id = c.instructor_id
             WHERE cv.student_email = ?
               AND (c.expiry_date IS NULL OR c.expiry_date > NOW())
             ORDER BY cv.last_viewed DESC`,
            [studentEmail]
        );

        return res.json(rows.map(normalizeCourse).map((course, index) => ({
            ...course,
            instructor_name: rows[index].instructor_name || 'Unknown',
            total_time_spent: Number(rows[index].total_time_spent || 0),
            last_viewed: rows[index].last_viewed
        })));
    } catch (error) {
        console.error('Course history fetch error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/instructor-dashboard/:instructorId', async (req, res) => {
    const instructorId = asPositiveInt(req.params.instructorId);
    if (!instructorId) {
        return res.status(400).json({ error: 'Invalid instructor ID' });
    }

    try {
        const [courseRows] = await db.query(
            `SELECT
                c.*,
                COUNT(DISTINCT v.id) AS video_count,
                COUNT(DISTINCT cvw.id) AS watch_record_count
             FROM courses c
             LEFT JOIN videos v ON v.course_id = c.id
             LEFT JOIN course_views cvw ON cvw.course_id = c.id
             WHERE c.instructor_id = ?
               AND (c.expiry_date IS NULL OR c.expiry_date > NOW())
             GROUP BY c.id
             ORDER BY c.created_at DESC`,
            [instructorId]
        );
        const courses = courseRows.map((course) => {
            const normalized = normalizeCourse(course);
            let videoCount = Number(course.video_count || 0);
            if (videoCount === 0 && normalized.video_path) {
                videoCount = 1;
            }
            return {
                ...normalized,
                video_count: videoCount,
                watch_record_count: Number(course.watch_record_count || 0)
            };
        });

        const totalCourses = courses.length;
        const totalStudents = courses.reduce((sum, course) => sum + Number(course.enrolled_students || 0), 0);
        const averageEnrollment = totalCourses > 0 ? Number((totalStudents / totalCourses).toFixed(2)) : 0;
        const latestUpload = courses.length > 0 ? courses[0].created_at : null;
        const zeroEnrollmentCourses = courses.filter((course) => Number(course.enrolled_students || 0) === 0).length;
        const expiringCourses = courses.filter((course) => {
            const daysRemaining = Number(course.days_remaining);
            return Number.isFinite(daysRemaining) && daysRemaining > 0 && daysRemaining <= 7;
        }).length;

        const [watchSummaryRows] = await db.query(
            `SELECT COALESCE(SUM(cv.total_time_spent), 0) AS totalWatchSeconds
             FROM course_views cv
             INNER JOIN courses c ON c.id = cv.course_id
             WHERE c.instructor_id = ?
               AND (c.expiry_date IS NULL OR c.expiry_date > NOW())`,
            [instructorId]
        );

        const totalWatchSeconds = Number(watchSummaryRows[0].totalWatchSeconds || 0);

        const [topWatchedRows] = await db.query(
            `SELECT
                c.id,
                c.title,
                c.category,
                c.enrolled_students,
                COALESCE(SUM(cv.total_time_spent), 0) AS totalWatchSeconds,
                COUNT(cv.id) AS watchRecords
             FROM courses c
             LEFT JOIN course_views cv ON cv.course_id = c.id
             WHERE c.instructor_id = ?
               AND (c.expiry_date IS NULL OR c.expiry_date > NOW())
             GROUP BY c.id, c.title, c.category, c.enrolled_students
             ORDER BY totalWatchSeconds DESC, watchRecords DESC
             LIMIT 5`,
            [instructorId]
        );

        const topCourse = courses.reduce((best, current) => {
            if (!best) {
                return current;
            }
            if (Number(current.enrolled_students || 0) > Number(best.enrolled_students || 0)) {
                return current;
            }
            return best;
        }, null);

        return res.json({
            metrics: {
                totalCourses,
                totalStudents,
                averageEnrollment,
                expiringCourses,
                zeroEnrollmentCourses,
                latestUpload,
                totalWatchSeconds,
                totalWatchHours: formatWatchHoursFromSeconds(totalWatchSeconds)
            },
            topCourse: topCourse ? {
                id: topCourse.id,
                title: topCourse.title,
                enrolled_students: Number(topCourse.enrolled_students || 0),
                category: topCourse.category
            } : null,
            topWatchedCourses: topWatchedRows.map((row) => ({
                id: row.id,
                title: row.title,
                category: row.category,
                enrolled_students: Number(row.enrolled_students || 0),
                totalWatchSeconds: Number(row.totalWatchSeconds || 0),
                totalWatchHours: formatWatchHoursFromSeconds(row.totalWatchSeconds),
                watchRecords: Number(row.watchRecords || 0)
            })),
            courses
        });
    } catch (error) {
        console.error('Instructor dashboard fetch error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/instructor-summary/:instructorId', async (req, res) => {
    const instructorId = asPositiveInt(req.params.instructorId);
    if (!instructorId) {
        return res.status(400).json({ error: 'Invalid instructor ID' });
    }

    try {
        const [rows] = await db.query(
            `SELECT
                COUNT(*) AS activeCourses,
                COALESCE(SUM(enrolled_students), 0) AS totalStudents
             FROM courses
             WHERE instructor_id = ?
               AND (expiry_date IS NULL OR expiry_date > NOW())`,
            [instructorId]
        );

        return res.json({
            activeCourses: Number(rows[0].activeCourses || 0),
            totalStudents: Number(rows[0].totalStudents || 0)
        });
    } catch (error) {
        console.error('Instructor summary fetch error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/send-message-to-students', async (req, res) => {
    const instructorId = asPositiveInt(req.body.instructorId);
    const title = String(req.body.title || '').trim();
    const content = String(req.body.content || '').trim();
    const priority = String(req.body.priority || 'normal').trim().toLowerCase();

    if (!instructorId || !title || !content) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const [enrolledStudents] = await db.query(
            `SELECT DISTINCT u.id as user_id
             FROM enrollments e
             JOIN courses c ON e.course_id = c.id
             JOIN users u ON e.student_email = u.email
             WHERE c.instructor_id = ?
               AND u.role = 'student'
               AND (c.expiry_date IS NULL OR c.expiry_date > NOW())`,
            [instructorId]
        );

        if (enrolledStudents.length === 0) {
            return res.status(200).json({ message: 'No students enrolled in your courses', sent: 0 });
        }

        const fullMessage = `[${priority.toUpperCase()}] ${title}: ${content}`;
        const sent = await createNotifications(
            enrolledStudents.map((student) => student.user_id),
            fullMessage,
            'instructor_message'
        );

        const createdAt = new Date();
        await db.query(
            `INSERT INTO messages (instructor_id, title, content, priority, sent_count, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [instructorId, title, content, priority, sent, createdAt]
        );

        return res.json({ 
            message: 'Message sent successfully', 
            sent,
            timestamp: createdAt
        });
    } catch (error) {
        console.error('Send message error:', error);
        return res.status(500).json({
            error: 'Failed to send message',
            details: error.message
        });
    }
});

app.post('/api/terminate-instructor', async (req, res) => {
    const { instructorId, instructorEmail } = req.body;

    if (!instructorId || !instructorEmail) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Start transaction for atomic deletion
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // Get all courses for this instructor
            const [courses] = await connection.query(
                'SELECT id FROM courses WHERE instructor_id = ?',
                [instructorId]
            );

            // Delete videos for all courses
            for (const course of courses) {
                await connection.query(
                    'DELETE FROM course_videos WHERE course_id = ?',
                    [course.id]
                );
            }

            // Delete enrollments for all courses
            for (const course of courses) {
                await connection.query(
                    'DELETE FROM enrollments WHERE course_id = ?',
                    [course.id]
                );
            }

            // Delete courses
            await connection.query(
                'DELETE FROM courses WHERE instructor_id = ?',
                [instructorId]
            );

            // Delete messages sent by this instructor
            await connection.query(
                'DELETE FROM messages WHERE instructor_id = ?',
                [instructorId]
            );

            // Delete instructor
            await connection.query(
                'DELETE FROM instructors WHERE id = ?',
                [instructorId]
            );

            await connection.commit();
            connection.release();

            return res.json({ message: 'Account terminated successfully' });
        } catch (error) {
            await connection.rollback();
            connection.release();
            throw error;
        }
    } catch (error) {
        console.error('Terminate instructor error:', error);
        return res.status(500).json({ error: 'Failed to terminate account' });
    }
});

// ============ GROUP MESSAGE APIs ============
app.post('/api/group-messages/send', async (req, res) => {
    try {
        const senderId = Number.parseInt(req.body.sender_id, 10);
        const senderName = String(req.body.sender_name || '').trim();
        const role = String(req.body.role || '').trim().toLowerCase();
        const groupType = String(req.body.group_type || '').trim().toLowerCase();
        const message = String(req.body.message || '').trim();
        const messageCategory = 'instructor_message';

        // Validate inputs
        if (!Number.isInteger(senderId) || senderId <= 0 || !role || !groupType || !message) {
            return res.status(400).json({ 
                error: 'Missing required fields: sender_id, role, group_type, message' 
            });
        }

        // Validate role
        if (role !== 'student' && role !== 'instructor') {
            return res.status(400).json({ error: 'Invalid role. Must be student or instructor.' });
        }

        // Validate group_type
        if (groupType !== 'students' && groupType !== 'instructors') {
            return res.status(400).json({ error: 'Invalid group_type. Must be students or instructors.' });
        }

        // CRITICAL: Only instructors can send messages
        if (role !== 'instructor') {
            return res.status(403).json({ 
                error: 'Only instructors can send messages.' 
            });
        }

        const [senders] = await db.query(
            `SELECT username
             FROM users
             WHERE id = ? AND role = 'instructor'
             LIMIT 1`,
            [senderId]
        );

        if (senders.length === 0) {
            return res.status(404).json({ error: 'Instructor not found.' });
        }

        const accountName = String(senders[0].username || '').trim();
        const resolvedSenderName = resolvePreferredDisplayName(
            [senderName, accountName],
            accountName || 'Instructor'
        );
        if (!resolvedSenderName) {
            return res.status(400).json({ error: 'Instructor name is required.' });
        }

        if (resolvedSenderName !== accountName) {
            await db.query(
                `UPDATE users
                 SET username = ?
                 WHERE id = ? AND role = 'instructor'`,
                [resolvedSenderName, senderId]
            );

            await db.query(
                `UPDATE group_messages
                 SET sender_name = ?
                 WHERE sender_id = ? AND role = 'instructor'`,
                [resolvedSenderName, senderId]
            );
        }

        // Insert message
        const timestamp = new Date();
        const [result] = await db.query(
            `INSERT INTO group_messages (sender_id, sender_name, role, group_type, message_category, message, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [senderId, resolvedSenderName, role, groupType, messageCategory, message, timestamp]
        );

        return res.status(201).json({
            id: result.insertId,
            sender_id: senderId,
            sender_name: resolvedSenderName,
            role,
            group_type: groupType,
            message_category: messageCategory,
            message,
            timestamp
        });
    } catch (error) {
        console.error('Group message send error:', error);
        return res.status(500).json({ error: 'Failed to send message' });
    }
});

app.get('/api/group-messages/:group_type', async (req, res) => {
    try {
        const groupType = String(req.params.group_type || '').trim().toLowerCase();
        const requestedCategory = String(req.query.category || '').trim().toLowerCase();

        // Validate group_type
        if (groupType !== 'students' && groupType !== 'instructors') {
            return res.status(400).json({ error: 'Invalid group_type. Must be students or instructors.' });
        }

        if (requestedCategory && requestedCategory !== 'new_release' && requestedCategory !== 'instructor_message') {
            return res.status(400).json({ error: 'Invalid category. Must be new_release or instructor_message.' });
        }

        // Get all messages for this group
        const [rows] = await db.query(
            `SELECT
                gm.id,
                gm.sender_id,
                gm.sender_name,
                u.username AS sender_account_name,
                gm.role,
                gm.group_type,
                gm.message_category,
                gm.message,
                gm.timestamp
             FROM group_messages gm
             LEFT JOIN users u ON u.id = gm.sender_id
             WHERE gm.group_type = ?
             ORDER BY gm.timestamp ASC`,
            [groupType]
        );

        const messages = rows
            .map((row) => {
                const messageCategory = normalizeGroupMessageCategory(row.message_category, row.message);

                return {
                    id: row.id,
                    sender_id: row.sender_id,
                    sender_name: resolvePreferredDisplayName(
                        [row.sender_name, row.sender_account_name],
                        row.role === 'instructor' ? 'Instructor' : 'User'
                    ),
                    sender_actual_name: resolvePreferredDisplayName(
                        [row.sender_account_name, row.sender_name],
                        row.role === 'instructor' ? 'Instructor' : 'User'
                    ),
                    role: row.role,
                    group_type: row.group_type,
                    message_category: messageCategory,
                    message: row.message,
                    timestamp: row.timestamp
                };
            })
            .filter((message) => !requestedCategory || message.message_category === requestedCategory);

        return res.json({
            group_type: groupType,
            category: requestedCategory || '',
            messages
        });
    } catch (error) {
        console.error('Group messages fetch error:', error);
        return res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.type('application/json');

    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                error: 'File too large',
                message: 'File size exceeds the 100MB limit'
            });
        }
        return res.status(400).json({
            error: 'File upload error',
            message: err.message
        });
    }

    return res.status(500).json({
        error: 'Internal server error',
        message: err.message,
        path: req.path,
        method: req.method
    });
});

app.use((req, res) => {
    const wantsJson = (req.headers.accept && req.headers.accept.includes('application/json')) ||
        req.path.startsWith('/api') ||
        req.path === '/submit-course' ||
        /^\/(courses|videos|notifications)(\/|$)/.test(req.path) ||
        req.method !== 'GET';

    if (wantsJson) {
        return res.status(404).json({ 
            message: 'Route not found',
            details: {
                path: req.path,
                method: req.method
            }
        });
    }

    // For HTML requests, try to serve index.html as fallback
    res.status(404).sendFile(path.join(__dirname, '..', 'HTML', 'index.html')).catch(() => {
        res.status(404).json({ 
            message: 'Route not found',
            path: req.path
        });
    });
});

app.listen(port, () => {
    console.log(`Backend server listening on http://localhost:${port}`);
});
