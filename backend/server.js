require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const db = require('./db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const mongoStore = require('./mongoStore');
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
    uploadCoverAsset,
    deleteVideoAssetByUrl,
    deleteCoverAssetByUrl,
    extractCloudinaryPublicId
} = require('./cloudinary');

let cron = null;
try {
    cron = require('node-cron');
} catch (error) {
    console.warn('node-cron is not installed. Scheduled cleanup jobs are disabled until dependencies are installed.');
}

const app = express();
const port = process.env.PORT || 3000;
const DEFAULT_PROFILE_PHOTO = '/uploads/default-avatar.svg';
const RESET_OTP_EXPIRY_MINUTES = Number(process.env.RESET_OTP_EXPIRY_MINUTES || 2);
const RESET_OTP_RESEND_SECONDS = Number(process.env.RESET_OTP_RESEND_SECONDS || 120);
const RESET_OTP_MAX_ATTEMPTS = Number(process.env.RESET_OTP_MAX_ATTEMPTS || 5);
const LOCAL_VIDEO_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const ACCESS_OWNER_JWT_SECRET = process.env.ACCESS_OWNER_JWT_SECRET || 'skillboostacademy-access-owner-secret';
const PASSWORD_RESET_JWT_SECRET = process.env.PASSWORD_RESET_JWT_SECRET || 'skillboostacademy-password-reset-secret';
const DB_CONNECTION_TIMEOUT_MS = Number(process.env.DB_CONNECTION_TIMEOUT_MS || 15000);
const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';
const PROJECT_ROOT = path.join(__dirname, '..');
const FRONTEND_ROOT = path.join(PROJECT_ROOT, 'frontend');
const FRONTEND_HTML_ROOT = path.join(FRONTEND_ROOT, 'HTML');

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
    origin: function (origin, callback) {
        // Allow all origins (including no origin for development)
        callback(null, true);
    },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin'],
    exposedHeaders: ['Content-Type'],
    maxAge: 86400
}));
app.use(bodyParser.json({ limit: '25mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '25mb' }));

app.use(express.static(FRONTEND_ROOT));
app.use(express.static(PROJECT_ROOT));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/videos', express.static(path.join(__dirname, 'videos')));

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
});

// Root route - serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(FRONTEND_HTML_ROOT, 'index.html'));
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
            databaseUrl: !!process.env.DATABASE_URL,
            hasMongoUri: mongoStore.isMongoEnabled(),
            mongoDbName: String(process.env.MONGODB_DB || process.env.DB_NAME || '').trim() || null
        }
    };
    
    res.status(cloudinaryStatus.ready ? 200 : 503).json(status);
});

app.get('/api/health/mongo', async (req, res) => {
    if (!mongoStore.isMongoEnabled()) {
        return res.status(503).json({
            success: false,
            mongo: 'disabled',
            message: 'MONGODB_URI is not configured'
        });
    }

    try {
        await mongoStore.pingMongo();
        return res.json({
            success: true,
            mongo: 'ok',
            database: String(process.env.MONGODB_DB || process.env.DB_NAME || 'skill_boost_nexus').trim()
        });
    } catch (error) {
        return res.status(error.status || 503).json({
            success: false,
            mongo: 'error',
            message: error.message
        });
    }
});

function asPositiveInt(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
        return null;
    }
    return n;
}

async function getConnectionWithTimeout(timeoutMs = DB_CONNECTION_TIMEOUT_MS) {
    let timeoutId = null;

    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            const error = new Error('Database connection timed out');
            error.status = 503;
            reject(error);
        }, timeoutMs);
    });

    try {
        return await Promise.race([
            db.getConnection(),
            timeoutPromise
        ]);
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
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

function maskEmail(value) {
    const normalizedEmail = normalizeCustomerEmail(value);
    const [localPart, domainPart] = normalizedEmail.split('@');
    if (!localPart || !domainPart) {
        return 'your email';
    }

    const [domainName, ...domainSuffixParts] = domainPart.split('.');
    const domainSuffix = domainSuffixParts.length > 0 ? `.${domainSuffixParts.join('.')}` : '';
    const maskedLocal = localPart.length <= 2
        ? `${localPart.charAt(0)}***`
        : `${localPart.slice(0, 2)}***${localPart.slice(-1)}`;
    const maskedDomain = domainName.length <= 2
        ? `${domainName.charAt(0)}***`
        : `${domainName.slice(0, 2)}***${domainName.slice(-1)}`;

    return `${maskedLocal}@${maskedDomain}${domainSuffix}`;
}

function formatWatchHoursFromSeconds(seconds) {
    const value = Number(seconds || 0);
    return Number((value / 3600).toFixed(2));
}

async function findUserByEmailAndRole(email, role, { includePassword = false } = {}) {
    const normalizedEmail = normalizeCustomerEmail(email);
    const cleanedRole = normalizeRole(role);

    if (!normalizedEmail || !cleanedRole) {
        return null;
    }

    const [rows] = await db.query(
        `SELECT id, username, email, phone, role${includePassword ? ', password' : ''}
         FROM users
         WHERE email = ?
           AND role = ?
         ORDER BY id DESC
         LIMIT 1`,
        [normalizedEmail, cleanedRole]
    );

    return rows[0] || null;
}

let resetOtpMailTransporter = null;

function getResetOtpMailTransporter() {
    if (resetOtpMailTransporter) {
        return resetOtpMailTransporter;
    }

    const service = String(process.env.EMAIL_SERVICE || process.env.SMTP_SERVICE || '').trim();
    const host = String(process.env.SMTP_HOST || '').trim();
    const port = Number(process.env.SMTP_PORT || 0);
    const user = String(process.env.EMAIL_USER || process.env.SMTP_USER || '').trim();
    const pass = String(process.env.EMAIL_PASS || process.env.SMTP_PASS || '').trim();

    if (!user || !pass || (!service && !host)) {
        return null;
    }

    const transportConfig = service
        ? {
            service,
            auth: { user, pass }
        }
        : {
            host,
            port: port || 587,
            secure: String(process.env.SMTP_SECURE || '').trim()
                ? String(process.env.SMTP_SECURE).trim().toLowerCase() === 'true'
                : (port || 587) === 465,
            auth: { user, pass }
        };

    resetOtpMailTransporter = nodemailer.createTransport(transportConfig);
    return resetOtpMailTransporter;
}

async function sendResetOtpEmail(email, otp, role, username) {
    const transporter = getResetOtpMailTransporter();
    const roleLabel = role === 'student' ? 'Student' : 'Instructor';
    const greetingName = String(username || roleLabel).trim();
    const authenticatedEmail = String(process.env.EMAIL_USER || process.env.SMTP_USER || '').trim();
    const configuredFromAddress = String(process.env.EMAIL_FROM || process.env.SMTP_FROM || '').trim();
    const serviceName = String(process.env.EMAIL_SERVICE || process.env.SMTP_SERVICE || '').trim().toLowerCase();
    const fromAddress = serviceName === 'gmail'
        ? authenticatedEmail
        : (configuredFromAddress || authenticatedEmail);
    const subject = 'Skill Boost Nexus password reset code';
    const text = [
        `Hello ${greetingName},`,
        '',
        `Your Skill Boost Nexus password reset code is ${otp}.`,
        `This code is valid for ${RESET_OTP_EXPIRY_MINUTES} minutes.`,
        '',
        'If you did not request this code, you can ignore this email.'
    ].join('\n');

    if (!transporter || !fromAddress) {
        const configError = new Error('Email delivery is not configured');
        configError.code = 'EMAIL_NOT_CONFIGURED';
        throw configError;
    }

    await transporter.sendMail({
        from: fromAddress,
        replyTo: configuredFromAddress && configuredFromAddress !== fromAddress ? configuredFromAddress : undefined,
        to: email,
        subject,
        text,
        html: `
            <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.6;">
                <p>Hello ${greetingName},</p>
                <p>Your <strong>Skill Boost Nexus</strong> password reset code is:</p>
                <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 18px 0;">${otp}</p>
                <p>This code is valid for <strong>${RESET_OTP_EXPIRY_MINUTES} minutes</strong>.</p>
                <p>If you did not request this code, you can ignore this email.</p>
            </div>
        `
    });

    return { provider: 'email' };
}

function signPasswordResetToken(user) {
    const passwordSignature = crypto
        .createHash('sha256')
        .update(String(user.password || ''))
        .digest('hex');

    return jwt.sign(
        {
            user_id: Number(user.id),
            role: normalizeRole(user.role),
            purpose: 'password_reset',
            password_signature: passwordSignature
        },
        PASSWORD_RESET_JWT_SECRET,
        { expiresIn: '10m' }
    );
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

if (!mongoStore.isMongoEnabled()) {
    initializeTables()
        .then(async () => {
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
} else {
    console.log('Skipping MySQL table initialization because MongoDB mode is enabled.');
}

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

    if (course.cover_path) {
        await deleteCoverAssetByUrl(course.cover_path);
    }

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
        let uploadedCoverUrl = null;

        if (req.files && req.files.cover && req.files.cover[0]) {
            const uploadedCover = await uploadCoverAsset(req.files.cover[0].path);
            uploadedCoverUrl = uploadedCover.secure_url || uploadedCover.url;
            coverPath = uploadedCoverUrl;
        }

        const expiryDate = calculateExpiryDate(existingCourse.created_at, durationOption.days);

        try {
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
        } catch (dbError) {
            if (uploadedCoverUrl) {
                await deleteCoverAssetByUrl(uploadedCoverUrl);
            }
            throw dbError;
        }

        if (coverPath !== existingCourse.cover_path && existingCourse.cover_path) {
            await deleteCoverAssetByUrl(existingCourse.cover_path);
        }

        return res.json({
            message: 'Course updated successfully',
            courseId,
            expiry_date: expiryDate,
            duration_days: durationOption.days
        });
    } catch (error) {
        console.error('Error updating course:', error);
        const status = String(error.message || '').includes('Cloudinary upload is unavailable') ? 503 : 500;
        return res.status(status).json({ error: status === 503 ? error.message : 'Failed to update course' });
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
        const createdAt = new Date();
        const expiryDate = calculateExpiryDate(createdAt, durationOption.days);
        let coverPath = null;
        let videoPath = null;

        try {
            const uploadedCover = await uploadCoverAsset(req.files.cover[0].path);
            coverPath = uploadedCover.secure_url || uploadedCover.url;
        } catch (coverError) {
            console.error('Cover upload error:', coverError);
            throw new Error(`Cloudinary cover upload failed: ${coverError.message}`);
        }

        if (hasVideo) {
            try {
                const uploadedVideo = await uploadVideoAsset(req.files.video[0].path);
                videoPath = uploadedVideo.secure_url || uploadedVideo.url;
            } catch (videoError) {
                await deleteCoverAssetByUrl(coverPath);
                console.error('Video upload error:', videoError);
                throw new Error(`Cloudinary video upload failed: ${videoError.message}`);
            }
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
            await deleteCoverAssetByUrl(coverPath);
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
        const name = String(req.body.name || '').trim();
        const email = normalizeCustomerEmail(req.body.email);
        const phone = String(req.body.phone || '').trim();
        const course = String(req.body.course || '').trim();
        const password = String(req.body.password || '');
        const accessCode = normalizeAccessCode(req.body.accessCode || req.body.access_code);

        if (!name || !email || !password || !accessCode) {
            return res.status(400).json({ error: 'Name, email, password and access code are required' });
        }

        const academy = await findAcademyByAccessCode(accessCode);
        if (!academy) {
            return res.status(401).json({ error: 'Invalid access code' });
        }

        const [existing] = await db.query(
            `SELECT id, role, academy_id
             FROM users
             WHERE email = ?
             LIMIT 1`,
            [email]
        );
        if (existing.length > 0) {
            const existingUser = existing[0];
            const existingAcademyId = String(existingUser.academy_id || '').trim();

            if (existingUser.role === 'student' && existingAcademyId === String(academy.id)) {
                return res.status(409).json({
                    error: 'A student account for this email already exists for this academy. Please login instead.'
                });
            }

            if (existingUser.role === 'student' && !existingAcademyId) {
                return res.status(409).json({
                    error: 'This email already has a student account. Please login with your existing password and academy access code.'
                });
            }

            return res.status(409).json({ error: 'Email already registered' });
        }

        const capacity = await getAcademyRoleCapacity(academy.id, 'student');
        const registrationStatus = capacity.limit > 0 && capacity.current >= capacity.limit
            ? 'restricted'
            : 'active';
        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await db.query(
            `INSERT INTO users (
                username,
                email,
                phone,
                password,
                role,
                branch,
                academy_id,
                academy_access_status,
                academy_access_restricted_at,
                created_at
             )
             VALUES (?, ?, ?, ?, 'student', ?, ?, ?, CASE WHEN ? = 'restricted' THEN NOW() ELSE NULL END, NOW())`,
            [name, email, phone || null, hashedPassword, course || null, academy.id, registrationStatus, registrationStatus]
        );

        return res.status(201).json({
            message: registrationStatus === 'restricted'
                ? 'Student account created, but access is currently restricted by the academy admin because the active seat limit is full.'
                : 'Registration successful',
            userId: result.insertId,
            academy_id: academy.id,
            access_status: registrationStatus
        });
    } catch (error) {
        console.error('Student registration error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/register/instructor', async (req, res) => {
    try {
        const name = String(req.body.name || '').trim();
        const email = normalizeCustomerEmail(req.body.email);
        const phone = String(req.body.phone || '').trim();
        const expertise = String(req.body.expertise || '').trim();
        const password = String(req.body.password || '');
        const accessCode = normalizeAccessCode(req.body.accessCode || req.body.access_code);

        if (!name || !email || !expertise || !password || !accessCode) {
            return res.status(400).json({ error: 'Name, email, expertise, password and access code are required' });
        }

        const academy = await findAcademyByAccessCode(accessCode);
        if (!academy) {
            return res.status(401).json({ error: 'Invalid access code' });
        }

        const [existing] = await db.query(
            `SELECT id, role, academy_id
             FROM users
             WHERE email = ?
             LIMIT 1`,
            [email]
        );
        if (existing.length > 0) {
            const existingUser = existing[0];
            const existingAcademyId = String(existingUser.academy_id || '').trim();

            if (existingUser.role === 'instructor' && existingAcademyId === String(academy.id)) {
                return res.status(409).json({
                    error: 'An instructor account for this email already exists for this academy. Please login instead.'
                });
            }

            if (existingUser.role === 'instructor' && !existingAcademyId) {
                return res.status(409).json({
                    error: 'This email already has an instructor account. Please login with your existing password and academy access code.'
                });
            }

            return res.status(409).json({ error: 'Email already registered' });
        }

        const capacity = await getAcademyRoleCapacity(academy.id, 'instructor');
        const registrationStatus = capacity.limit > 0 && capacity.current >= capacity.limit
            ? 'restricted'
            : 'active';
        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await db.query(
            `INSERT INTO users (
                username,
                email,
                phone,
                password,
                role,
                expertise,
                academy_id,
                academy_access_status,
                academy_access_restricted_at,
                created_at
             )
             VALUES (?, ?, ?, ?, 'instructor', ?, ?, ?, CASE WHEN ? = 'restricted' THEN NOW() ELSE NULL END, NOW())`,
            [name, email, phone || null, hashedPassword, expertise, academy.id, registrationStatus, registrationStatus]
        );

        return res.status(201).json({
            message: registrationStatus === 'restricted'
                ? 'Instructor account created, but access is currently restricted by the academy admin because the active seat limit is full.'
                : 'Instructor registration successful',
            userId: result.insertId,
            academy_id: academy.id,
            access_status: registrationStatus
        });
    } catch (error) {
        console.error('Instructor registration error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/login/student', async (req, res) => {
    try {
        const email = normalizeCustomerEmail(req.body.email);
        const password = String(req.body.password || '');
        const accessCode = normalizeAccessCode(req.body.accessCode || req.body.access_code);

        if (!email || !password || !accessCode) {
            return res.status(400).json({ error: 'Email, password and access code are required' });
        }

        const academy = await findAcademyByAccessCode(accessCode);
        if (!academy) {
            return res.status(401).json({ error: 'Invalid access code' });
        }

        const [users] = await db.query(
            `SELECT id, username AS name, email, password, branch, profile_photo, academy_access_status
             FROM users
             WHERE email = ? AND role = 'student' AND academy_id = ?
             LIMIT 1`,
            [email, academy.id]
        );

        let student = users[0] || null;

        if (student) {
            const passwordMatches = await bcrypt.compare(password, student.password);
            if (!passwordMatches) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }
        } else {
            const [legacyUsers] = await db.query(
                `SELECT id, username AS name, email, password, branch, profile_photo, academy_id, academy_access_status
                 FROM users
                 WHERE email = ? AND role = 'student'
                 LIMIT 1`,
                [email]
            );

            const legacyStudent = legacyUsers[0] || null;
            const legacyAcademyId = String(legacyStudent?.academy_id || '').trim();

            if (legacyStudent && !legacyAcademyId) {
                const passwordMatches = await bcrypt.compare(password, legacyStudent.password);
                if (!passwordMatches) {
                    return res.status(401).json({ error: 'Invalid credentials' });
                }

                await db.query(
                    `UPDATE users
                     SET academy_id = ?
                     WHERE id = ?`,
                    [academy.id, legacyStudent.id]
                );

                legacyStudent.academy_id = academy.id;
                student = legacyStudent;
            }
        }

        if (!student) {
            const capacity = await getAcademyRoleCapacity(academy.id, 'student');
            if (capacity.limit > 0 && capacity.current >= capacity.limit) {
                const message = buildUseAnotherAccessCodeMessage('student');
                await logAccessAttempt(academy.id, 'student', 'failed', message, email);
                return res.status(403).json({
                    error: message,
                    current_count: capacity.current,
                    max_count: capacity.limit
                });
            }

            return res.status(401).json({
                error: 'No student account was found for this academy access code. Please register first.'
            });
        }

        if (normalizeAcademyAccessStatus(student.academy_access_status) === 'restricted') {
            const message = buildRestrictedAccessMessage('student');
            await logAccessAttempt(academy.id, 'student', 'failed', message, email);
            return res.status(403).json({
                error: message
            });
        }

        const studentSeatState = await getAcademyRoleSeatState(academy.id, 'student');
        if (studentSeatState.limit > 0 &&
            studentSeatState.current > studentSeatState.limit &&
            !studentSeatState.activeUserIds.has(Number(student.id))) {
            const message = buildUseAnotherAccessCodeMessage('student');
            await logAccessAttempt(academy.id, 'student', 'failed', message, email);
            return res.status(403).json({
                error: message,
                current_count: studentSeatState.current,
                max_count: studentSeatState.limit
            });
        }

        await db.query(
            `UPDATE users
             SET academy_access_last_login_at = NOW()
             WHERE id = ?`,
            [student.id]
        );

        delete student.password;
        student.photo = student.profile_photo || DEFAULT_PROFILE_PHOTO;
        delete student.profile_photo;
        delete student.academy_access_status;
        student.academy_id = academy.id;

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
        const email = normalizeCustomerEmail(req.body.email);
        const password = String(req.body.password || '');
        const accessCode = normalizeAccessCode(req.body.accessCode || req.body.access_code);

        if (!email || !password || !accessCode) {
            return res.status(400).json({ error: 'Email, password and access code are required' });
        }

        const academy = await findAcademyByAccessCode(accessCode);
        if (!academy) {
            return res.status(401).json({ error: 'Invalid access code' });
        }

        const [users] = await db.query(
            `SELECT id, username AS name, email, password, expertise, profile_photo, academy_access_status
             FROM users
             WHERE email = ? AND role = 'instructor' AND academy_id = ?
             LIMIT 1`,
            [email, academy.id]
        );

        let instructor = users[0] || null;

        if (instructor) {
            const passwordMatches = await bcrypt.compare(password, instructor.password);
            if (!passwordMatches) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }
        } else {
            const [legacyUsers] = await db.query(
                `SELECT id, username AS name, email, password, expertise, profile_photo, academy_id, academy_access_status
                 FROM users
                 WHERE email = ? AND role = 'instructor'
                 LIMIT 1`,
                [email]
            );

            const legacyInstructor = legacyUsers[0] || null;
            const legacyAcademyId = String(legacyInstructor?.academy_id || '').trim();

            if (legacyInstructor && !legacyAcademyId) {
                const passwordMatches = await bcrypt.compare(password, legacyInstructor.password);
                if (!passwordMatches) {
                    return res.status(401).json({ error: 'Invalid credentials' });
                }

                await db.query(
                    `UPDATE users
                     SET academy_id = ?
                     WHERE id = ?`,
                    [academy.id, legacyInstructor.id]
                );

                legacyInstructor.academy_id = academy.id;
                instructor = legacyInstructor;
            }
        }

        if (!instructor) {
            const capacity = await getAcademyRoleCapacity(academy.id, 'instructor');
            if (capacity.limit > 0 && capacity.current >= capacity.limit) {
                const message = buildUseAnotherAccessCodeMessage('instructor');
                await logAccessAttempt(academy.id, 'instructor', 'failed', message, email);
                return res.status(403).json({
                    error: message,
                    current_count: capacity.current,
                    max_count: capacity.limit
                });
            }

            return res.status(401).json({
                error: 'No instructor account was found for this academy access code. Please register first.'
            });
        }

        if (normalizeAcademyAccessStatus(instructor.academy_access_status) === 'restricted') {
            const message = buildRestrictedAccessMessage('instructor');
            await logAccessAttempt(academy.id, 'instructor', 'failed', message, email);
            return res.status(403).json({
                error: message
            });
        }

        const instructorSeatState = await getAcademyRoleSeatState(academy.id, 'instructor');
        if (instructorSeatState.limit > 0 &&
            instructorSeatState.current > instructorSeatState.limit &&
            !instructorSeatState.activeUserIds.has(Number(instructor.id))) {
            const message = buildUseAnotherAccessCodeMessage('instructor');
            await logAccessAttempt(academy.id, 'instructor', 'failed', message, email);
            return res.status(403).json({
                error: message,
                current_count: instructorSeatState.current,
                max_count: instructorSeatState.limit
            });
        }

        await db.query(
            `UPDATE users
             SET academy_access_last_login_at = NOW()
             WHERE id = ?`,
            [instructor.id]
        );

        delete instructor.password;
        instructor.photo = instructor.profile_photo || DEFAULT_PROFILE_PHOTO;
        delete instructor.profile_photo;
        delete instructor.academy_access_status;
        instructor.academy_id = academy.id;

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

        return res.json({ success: true, message: 'Student account deleted successfully' });
    } catch (error) {
        console.error('Student account delete error:', error);
        return res.status(500).json({ success: false, error: 'Failed to delete account', details: error.message });
    }
});

app.delete('/api/account/instructor', async (req, res) => {
    try {
        const instructorId = asPositiveInt(req.body.instructorId);
        const email = (req.body.email || '').toString().trim();

        if (!instructorId && !email) {
            return res.status(400).json({ error: 'Instructor ID or email is required' });
        }

        // First, get the user_id from instructors table
        let userId;
        if (instructorId) {
            const [instructorRows] = await db.query(
                'SELECT user_id FROM instructors WHERE id = ?',
                [instructorId]
            );
            if (instructorRows.length === 0) {
                return res.status(404).json({ error: 'Instructor account not found' });
            }
            userId = instructorRows[0].user_id;
        } else if (email) {
            const [userRows] = await db.query(
                'SELECT id FROM users WHERE email = ? AND role = ?',
                [email, 'instructor']
            );
            if (userRows.length === 0) {
                return res.status(404).json({ error: 'Instructor account not found' });
            }
            userId = userRows[0].id;
        }

        // Delete instructor-related data
        const [instructorRows] = await db.query(
            'SELECT id FROM instructors WHERE user_id = ?',
            [userId]
        );

        if (instructorRows.length > 0) {
            const instId = instructorRows[0].id;
            
            // Get all courses for this instructor
            const [courses] = await db.query(
                'SELECT id FROM courses WHERE instructor_id = ?',
                [instId]
            );

            // Delete videos for all courses
            for (const course of courses) {
                await db.query(
                    'DELETE FROM course_videos WHERE course_id = ?',
                    [course.id]
                );
            }

            // Delete enrollments for all courses
            for (const course of courses) {
                await db.query(
                    'DELETE FROM enrollments WHERE course_id = ?',
                    [course.id]
                );
            }

            // Delete courses
            await db.query(
                'DELETE FROM courses WHERE instructor_id = ?',
                [instId]
            );

            // Delete messages
            await db.query(
                'DELETE FROM messages WHERE instructor_id = ?',
                [instId]
            );

            // Delete instructor record
            await db.query(
                'DELETE FROM instructors WHERE id = ?',
                [instId]
            );
        }

        // Delete user-related data
        await db.query('DELETE FROM notifications WHERE user_id = ?', [userId]);
        await db.query('DELETE FROM password_reset_otps WHERE user_id = ?', [userId]);
        await db.query('DELETE FROM users WHERE id = ?', [userId]);

        return res.json({
            success: true,
            message: 'Instructor account deleted successfully'
        });
    } catch (error) {
        console.error('Instructor account delete error:', error);
        return res.status(500).json({ success: false, error: 'Failed to delete account', details: error.message });
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
        const { email, role } = req.body;
        const normalizedEmail = normalizeCustomerEmail(email);
        const cleanedRole = normalizeRole(role);
        const expirySeconds = RESET_OTP_EXPIRY_MINUTES * 60;
        const resendAfterSeconds = Math.max(RESET_OTP_RESEND_SECONDS, expirySeconds);

        if (!normalizedEmail || !cleanedRole) {
            return res.status(400).json({ error: 'Valid email address and role are required' });
        }

        const user = await findUserByEmailAndRole(normalizedEmail, cleanedRole);
        if (!user) {
            return res.status(404).json({ error: 'No account found for this email and role' });
        }

        const [recentRows] = await db.query(
            'SELECT created_at FROM password_reset_otps WHERE user_id = ? ORDER BY id DESC LIMIT 1',
            [user.id]
        );

        if (recentRows.length > 0) {
            const createdAt = new Date(recentRows[0].created_at).getTime();
            const elapsedSeconds = Math.floor((Date.now() - createdAt) / 1000);
            if (elapsedSeconds < resendAfterSeconds) {
                return res.status(429).json({
                    error: `Please wait ${resendAfterSeconds - elapsedSeconds} seconds before requesting another code`
                });
            }
        }

        const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        const otpHash = await bcrypt.hash(otp, 10);
        const expiresAt = new Date(Date.now() + expirySeconds * 1000);

        await db.query('UPDATE password_reset_otps SET used = 1 WHERE user_id = ? AND used = 0', [user.id]);
        const [insertResult] = await db.query(
            `INSERT INTO password_reset_otps (user_id, otp_hash, attempts, expires_at, used, created_at)
             VALUES (?, ?, 0, ?, 0, NOW())`,
            [user.id, otpHash, expiresAt]
        );

        let emailResult;
        try {
            emailResult = await sendResetOtpEmail(user.email || normalizedEmail, otp, cleanedRole, user.username);
        } catch (emailError) {
            await db.query('UPDATE password_reset_otps SET used = 1 WHERE id = ?', [insertResult.insertId]);
            throw emailError;
        }

        const maskedEmail = maskEmail(user.email || normalizedEmail);
        const responsePayload = {
            message: `Verification code sent to ${maskedEmail}`,
            maskedEmail,
            expiresInSeconds: expirySeconds,
            resendAfterSeconds
        };

        return res.json(responsePayload);
    } catch (error) {
        console.error('Forgot password send OTP error:', error);
        if (error.code === 'EMAIL_NOT_CONFIGURED') {
            return res.status(503).json({
                error: 'Email delivery is not configured on the server yet. Add EMAIL_SERVICE, EMAIL_USER, EMAIL_PASS, and EMAIL_FROM in backend/.env.'
            });
        }
        return res.status(500).json({ error: 'Failed to send verification code' });
    }
});

app.post('/api/forgot-password/verify-otp', async (req, res) => {
    try {
        const { email, role, otp } = req.body;
        const normalizedEmail = normalizeCustomerEmail(email);
        const cleanedRole = normalizeRole(role);

        if (!normalizedEmail || !cleanedRole || !otp) {
            return res.status(400).json({ error: 'Email, role, and verification code are required' });
        }

        const user = await findUserByEmailAndRole(normalizedEmail, cleanedRole, { includePassword: true });
        if (!user) {
            return res.status(404).json({ error: 'No account found for this email and role' });
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

        await db.query('UPDATE password_reset_otps SET used = 1 WHERE id = ?', [latestOtp.id]);

        return res.json({
            message: 'Verification successful. You can now create a new password.',
            resetToken: signPasswordResetToken(user)
        });
    } catch (error) {
        console.error('Forgot password verify OTP error:', error);
        return res.status(500).json({ error: 'Failed to verify the code' });
    }
});

app.post('/api/forgot-password/reset-password', async (req, res) => {
    try {
        const { resetToken, newPassword } = req.body;

        if (!resetToken || !newPassword) {
            return res.status(400).json({ error: 'Reset session and new password are required' });
        }

        if (String(newPassword).length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters' });
        }

        let decodedToken;
        try {
            decodedToken = jwt.verify(String(resetToken), PASSWORD_RESET_JWT_SECRET);
        } catch (tokenError) {
            return res.status(400).json({ error: 'Reset session expired. Please request a new verification code.' });
        }

        const cleanedRole = normalizeRole(decodedToken.role);
        const userId = Number(decodedToken.user_id || 0);
        if (!userId || !cleanedRole || decodedToken.purpose !== 'password_reset') {
            return res.status(400).json({ error: 'Invalid reset session. Please request a new verification code.' });
        }

        const [userRows] = await db.query(
            `SELECT id, role, password
             FROM users
             WHERE id = ? AND role = ?
             LIMIT 1`,
            [userId, cleanedRole]
        );

        if (userRows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = userRows[0];
        const currentPasswordSignature = crypto
            .createHash('sha256')
            .update(String(user.password || ''))
            .digest('hex');

        if (currentPasswordSignature !== decodedToken.password_signature) {
            return res.status(400).json({ error: 'Reset session is no longer valid. Please request a new verification code.' });
        }

        const hashedPassword = await bcrypt.hash(String(newPassword), 10);
        await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, user.id]);

        return res.json({ message: 'Password reset successful. Please login with your new password.' });
    } catch (error) {
        console.error('Forgot password reset error:', error);
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
        const seatAccess = await getUserSeatAccessState(instructorId, 'instructor');
        if (!seatAccess.allowed) {
            return res.status(403).json({
                error: seatAccess.restricted
                    ? buildRestrictedAccessMessage('instructor')
                    : buildUseAnotherAccessCodeMessage('instructor')
            });
        }

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
        const seatAccess = await getUserSeatAccessState(instructorId, 'instructor');
        if (!seatAccess.allowed) {
            return res.status(403).json({
                error: seatAccess.restricted
                    ? buildRestrictedAccessMessage('instructor')
                    : buildUseAnotherAccessCodeMessage('instructor')
            });
        }

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
        // Get the user_id linked to this instructor
        const [instructorRows] = await db.query(
            'SELECT user_id FROM instructors WHERE id = ?',
            [instructorId]
        );

        if (instructorRows.length === 0) {
            return res.status(404).json({ error: 'Instructor not found' });
        }

        const userId = instructorRows[0].user_id;

        // Get all courses for this instructor
        const [courses] = await db.query(
            'SELECT id FROM courses WHERE instructor_id = ?',
            [instructorId]
        );

        // Delete videos for all courses
        for (const course of courses) {
            await db.query(
                'DELETE FROM course_videos WHERE course_id = ?',
                [course.id]
            );
        }

        // Delete enrollments for all courses
        for (const course of courses) {
            await db.query(
                'DELETE FROM enrollments WHERE course_id = ?',
                [course.id]
            );
        }

        // Delete courses
        await db.query(
            'DELETE FROM courses WHERE instructor_id = ?',
            [instructorId]
        );

        // Delete messages sent by this instructor
        await db.query(
            'DELETE FROM messages WHERE instructor_id = ?',
            [instructorId]
        );

        // Delete instructor
        await db.query(
            'DELETE FROM instructors WHERE id = ?',
            [instructorId]
        );

        // Delete user account (if user_id exists)
        if (userId) {
            await db.query(
                'DELETE FROM users WHERE id = ?',
                [userId]
            );
        }

        return res.json({ success: true, message: 'Account terminated successfully' });
    } catch (error) {
        console.error('Terminate instructor error:', error);
        return res.status(500).json({ error: 'Failed to terminate account', details: error.message });
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

// ============================================
// Academy Access & Subscription APIs
// ============================================

// Initialize plans and academies tables
async function initializeAccessTables() {
    try {
        // Plans table
        await db.query(`
            CREATE TABLE IF NOT EXISTS plans (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(100) NOT NULL UNIQUE,
                max_instructors INT NOT NULL,
                max_students INT NOT NULL,
                price INT NOT NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_name (name)
            )
        `);

        // Customers table
        await db.query(`
            CREATE TABLE IF NOT EXISTS customers (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL UNIQUE,
                phone VARCHAR(20),
                password_hash VARCHAR(255),
                status VARCHAR(50) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_email (email),
                INDEX idx_status (status)
            )
        `);

        // Academies table
        await db.query(`
            CREATE TABLE IF NOT EXISTS academies (
                id VARCHAR(36) PRIMARY KEY,
                customer_id INT NOT NULL,
                plan_id INT NOT NULL,
                academy_name VARCHAR(255) NOT NULL,
                access_code VARCHAR(20) NOT NULL UNIQUE,
                status VARCHAR(50) DEFAULT 'active',
                instructor_count INT DEFAULT 0,
                student_count INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
                FOREIGN KEY (plan_id) REFERENCES plans(id),
                INDEX idx_customer_id (customer_id),
                INDEX idx_access_code (access_code),
                INDEX idx_plan_id (plan_id)
            )
        `);

        // Attempt logs table
        await db.query(`
            CREATE TABLE IF NOT EXISTS attempt_logs (
                id INT PRIMARY KEY AUTO_INCREMENT,
                academy_id VARCHAR(36) NOT NULL,
                type ENUM('student', 'instructor') NOT NULL,
                status ENUM('success', 'failed') DEFAULT 'success',
                reason VARCHAR(255),
                email VARCHAR(255),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (academy_id) REFERENCES academies(id) ON DELETE CASCADE,
                INDEX idx_academy_id (academy_id),
                INDEX idx_type (type),
                INDEX idx_timestamp (timestamp)
            )
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS academy_payments (
                id INT PRIMARY KEY AUTO_INCREMENT,
                academy_id VARCHAR(36) NOT NULL,
                customer_id INT NOT NULL,
                plan_id INT NOT NULL,
                plan_name VARCHAR(100) NOT NULL,
                amount INT NOT NULL,
                currency VARCHAR(10) DEFAULT 'INR',
                status VARCHAR(50) DEFAULT 'completed',
                payment_reference VARCHAR(120) NOT NULL UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (academy_id) REFERENCES academies(id) ON DELETE CASCADE,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
                FOREIGN KEY (plan_id) REFERENCES plans(id),
                INDEX idx_academy_created (academy_id, created_at),
                INDEX idx_customer_created (customer_id, created_at)
            )
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS academy_payment_orders (
                id INT PRIMARY KEY AUTO_INCREMENT,
                academy_id VARCHAR(36) NOT NULL,
                customer_id INT NOT NULL,
                plan_id INT NOT NULL,
                amount INT NOT NULL,
                currency VARCHAR(10) DEFAULT 'INR',
                razorpay_order_id VARCHAR(120) NOT NULL UNIQUE,
                receipt VARCHAR(120) NOT NULL UNIQUE,
                status VARCHAR(50) DEFAULT 'created',
                razorpay_payment_id VARCHAR(120) NULL,
                razorpay_signature VARCHAR(255) NULL,
                payment_status VARCHAR(50) NULL,
                is_consumed TINYINT(1) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (academy_id) REFERENCES academies(id) ON DELETE CASCADE,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
                FOREIGN KEY (plan_id) REFERENCES plans(id),
                INDEX idx_payment_order_academy (academy_id, status),
                INDEX idx_payment_order_customer (customer_id, created_at)
            )
        `);

        await ensureColumnExists('customers', 'password_hash', 'password_hash VARCHAR(255) NULL AFTER phone');
        await ensureColumnExists('academies', 'status', `status VARCHAR(50) DEFAULT 'active' AFTER access_code`);
        await ensureColumnExists('academies', 'plan_activated_at', 'plan_activated_at TIMESTAMP NULL AFTER plan_id');
        await ensureColumnExists('academies', 'plan_expires_at', 'plan_expires_at TIMESTAMP NULL AFTER plan_activated_at');
        await ensureColumnExists('users', 'academy_id', 'academy_id VARCHAR(36) NULL AFTER profile_photo');
        await ensureColumnExists('users', 'academy_access_status', `academy_access_status VARCHAR(20) NOT NULL DEFAULT 'active' AFTER academy_id`);
        await ensureColumnExists('users', 'academy_access_last_login_at', 'academy_access_last_login_at DATETIME NULL AFTER academy_access_status');
        await ensureColumnExists('users', 'academy_access_restricted_at', 'academy_access_restricted_at DATETIME NULL AFTER academy_access_last_login_at');
        await db.query(`
            UPDATE users
            SET academy_access_status = 'active'
            WHERE academy_access_status IS NULL
               OR academy_access_status = ''
        `);

        // Check if plans exist and initialize/update them
        const [existingPlans] = await db.query('SELECT COUNT(*) as count FROM plans');
        if (existingPlans[0].count === 0) {
            await db.query(`
                INSERT INTO plans (id, name, max_instructors, max_students, price, description) VALUES 
                (1, 'Basic', 1, 10, 0, 'Free plan for getting started'),
                (2, 'Pro', 10, 200, 499, 'Perfect for small academies'),
                (3, 'Advanced', 25, 1000, 999, 'For growing academies')
            `);
        } else {
            // Update existing plans to ensure correct configuration
            await db.query(`UPDATE plans SET name = 'Basic', max_instructors = 1, max_students = 10, price = 0, description = 'Free plan for getting started' WHERE id = 1`);
            await db.query(`UPDATE plans SET name = 'Pro', max_instructors = 10, max_students = 200, price = 499, description = 'Perfect for small academies' WHERE id = 2`);
            await db.query(`UPDATE plans SET name = 'Advanced', max_instructors = 25, max_students = 1000, price = 999, description = 'For growing academies' WHERE id = 3`);
        }

        console.log('Access & Subscription tables verified/created');
    } catch (error) {
        console.error('Error initializing access tables:', error);
    }
}

if (!mongoStore.isMongoEnabled()) {
    initializeAccessTables().catch(err => console.error('Failed to initialize access tables:', err));
} else {
    mongoStore.getMongoDbWithTimeout()
        .then(() => console.log('MongoDB access collections verified/created'))
        .catch((err) => console.error('Failed to initialize MongoDB access collections:', err));
}

// Helper function to generate UUID
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function buildAccessCodePrefix(academyName) {
    const firstWord = String(academyName || '')
        .trim()
        .split(/\s+/)
        .find(Boolean) || 'ACADEMY';
    const sanitized = firstWord.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return (sanitized || 'ACADEMY').slice(0, 10);
}

// Helper function to generate access code
function generateAccessCode(academyName = '') {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const prefix = buildAccessCodePrefix(academyName);
    let suffix = '';
    for (let i = 0; i < 4; i++) {
        suffix += chars.charAt(crypto.randomInt(0, chars.length));
    }
    return `${prefix}-${suffix}`;
}

function normalizeCustomerEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function signAccessOwnerToken(context) {
    return jwt.sign(
        {
            customer_id: Number(context.customer_id),
            academy_id: String(context.academy_id)
        },
        ACCESS_OWNER_JWT_SECRET,
        { expiresIn: '12h' }
    );
}

function getRazorpayCredentials() {
    const keyId = String(process.env.RAZORPAY_KEY_ID || '').trim();
    const keySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();

    return {
        keyId,
        keySecret,
        ready: Boolean(keyId && keySecret)
    };
}

function assertRazorpayConfigured() {
    const credentials = getRazorpayCredentials();
    if (!credentials.ready) {
        const error = new Error('Razorpay keys are not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to backend/.env.');
        error.status = 503;
        throw error;
    }

    return credentials;
}

function normalizeRazorpayErrorStatus(error) {
    const status = Number(error?.status || error?.statusCode || 0);
    return status === 401 ? 401 : (status || 500);
}

async function razorpayApiRequest(pathname, options = {}) {
    const credentials = assertRazorpayConfigured();
    const method = String(options.method || 'GET').toUpperCase();
    const headers = {
        Authorization: `Basic ${Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString('base64')}`
    };

    if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${RAZORPAY_API_BASE}${pathname}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload.error?.description || payload.description || 'Razorpay request failed');
        error.status = response.status;
        error.details = payload;
        throw error;
    }

    return payload;
}

async function createRazorpayOrder(payload) {
    return razorpayApiRequest('/orders', {
        method: 'POST',
        body: payload
    });
}

async function fetchRazorpayPayment(paymentId) {
    return razorpayApiRequest(`/payments/${encodeURIComponent(paymentId)}`, {
        method: 'GET'
    });
}

async function captureRazorpayPayment(paymentId, amount, currency = 'INR') {
    return razorpayApiRequest(`/payments/${encodeURIComponent(paymentId)}/capture`, {
        method: 'POST',
        body: {
            amount,
            currency
        }
    });
}

function verifyRazorpaySignature(orderId, paymentId, signature) {
    const { keySecret } = assertRazorpayConfigured();
    const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

    const normalizedSignature = String(signature || '').trim();
    if (!normalizedSignature || normalizedSignature.length !== expectedSignature.length) {
        return false;
    }

    return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'utf8'),
        Buffer.from(normalizedSignature, 'utf8')
    );
}

function normalizeRazorpayAmount(value) {
    const amount = Number(value);
    if (!Number.isInteger(amount) || amount < 100) {
        return null;
    }

    return amount;
}

function formatLegacyPlanName(planName) {
    return String(planName || '').trim() || 'Basic';
}

function buildAccessInviteLinks(req, accessCode) {
    const origin = `${req.protocol}://${req.get('host')}`;
    const safeCode = encodeURIComponent(String(accessCode || '').trim());

    return {
        instructor: `${origin}/HTML/index.html?code=${safeCode}&type=instructor`,
        student: `${origin}/HTML/index.html?code=${safeCode}&type=student`
    };
}

function buildAccessUsageMetric(label, current, limit) {
    const safeCurrent = Number(current || 0);
    const safeLimit = Number(limit || 0);
    const percentage = safeLimit > 0 ? Math.min(100, Math.round((safeCurrent / safeLimit) * 100)) : 0;
    const remaining = safeLimit > 0 ? Math.max(0, safeLimit - safeCurrent) : 0;

    return {
        label,
        current: safeCurrent,
        limit: safeLimit,
        remaining,
        percentage,
        near_limit: safeLimit > 0 && percentage >= 80 && safeCurrent < safeLimit,
        exceeded: safeLimit > 0 && safeCurrent >= safeLimit
    };
}

function buildAccessOwnerSummary(req, context) {
    const planExpiresAt = context.plan_expires_at ? new Date(context.plan_expires_at) : null;
    const now = new Date();
    let daysRemaining = null;
    
    if (planExpiresAt && planExpiresAt > now) {
        daysRemaining = Math.ceil((planExpiresAt - now) / (1000 * 60 * 60 * 24));
    }
    
    return {
        customer: {
            id: Number(context.customer_id),
            name: context.customer_name,
            email: context.customer_email,
            phone: context.customer_phone || '',
            status: context.customer_status || 'active'
        },
        academy: {
            academy_id: context.academy_id,
            academy_name: context.academy_name,
            access_code: context.access_code,
            status: context.academy_status || 'active',
            created_at: context.academy_created_at,
            updated_at: context.academy_updated_at
        },
        current_plan: {
            id: Number(context.plan_id || 0),
            name: formatLegacyPlanName(context.plan_name),
            price: Number(context.plan_price || 0),
            max_instructors: Number(context.max_instructors || 0),
            max_students: Number(context.max_students || 0),
            description: context.plan_description || '',
            activated_at: context.plan_activated_at || null,
            expires_at: context.plan_expires_at || null,
            days_remaining: daysRemaining
        },
        invite_links: buildAccessInviteLinks(req, context.access_code)
    };
}

async function getAccessOwnerContext(customerId, academyId = null, connection = db) {
    const params = [customerId];
    let academyFilter = '';

    if (academyId) {
        academyFilter = ' AND a.id = ?';
        params.push(academyId);
    }

    const [rows] = await connection.query(
        `SELECT
            c.id AS customer_id,
            c.name AS customer_name,
            c.email AS customer_email,
            c.phone AS customer_phone,
            c.password_hash,
            c.status AS customer_status,
            a.id AS academy_id,
            a.academy_name,
            a.access_code,
            a.status AS academy_status,
            a.plan_id,
            a.plan_activated_at,
            a.plan_expires_at,
            a.created_at AS academy_created_at,
            a.updated_at AS academy_updated_at,
            p.name AS plan_name,
            p.max_instructors,
            p.max_students,
            p.price AS plan_price,
            p.description AS plan_description
         FROM customers c
         INNER JOIN academies a ON a.customer_id = c.id
         LEFT JOIN plans p ON p.id = a.plan_id
         WHERE c.id = ?${academyFilter}
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT 1`,
        params
    );

    return rows[0] || null;
}

async function generateUniqueAccessCode(academyName = '', connection = db) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const candidate = generateAccessCode(academyName);
        const [rows] = await connection.query(
            'SELECT id FROM academies WHERE access_code = ? LIMIT 1',
            [candidate]
        );

        if (rows.length === 0) {
            return candidate;
        }
    }

    throw new Error('Unable to generate a unique access code');
}

async function insertAcademyPayment(connection, payload) {
    const paymentReference = String(payload.paymentReference || `PAY-${Date.now()}-${Math.floor(Math.random() * 1000000)}`).trim();
    const currency = String(payload.currency || 'INR').trim() || 'INR';

    await connection.query(
        `INSERT INTO academy_payments (
            academy_id,
            customer_id,
            plan_id,
            plan_name,
            amount,
            currency,
            status,
            payment_reference,
            created_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
            payload.academyId,
            payload.customerId,
            payload.planId,
            payload.planName,
            payload.amount,
            currency,
            payload.status,
            paymentReference
        ]
    );

    return paymentReference;
}

async function findReusablePlanPayment(connection, payload) {
    const [rows] = await connection.query(
        `SELECT id, payment_reference, currency, amount, created_at
         FROM academy_payments
         WHERE academy_id = ?
           AND customer_id = ?
           AND plan_id = ?
           AND amount > 0
           AND status = 'completed'
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [
            payload.academyId,
            payload.customerId,
            payload.planId
        ]
    );

    return rows[0] || null;
}

async function accessOwnerAuth(req, res, next) {
    const authorization = String(req.headers.authorization || '').trim();
    if (!authorization.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const token = authorization.slice('Bearer '.length).trim();
    if (!token) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    let payload;
    try {
        payload = jwt.verify(token, ACCESS_OWNER_JWT_SECRET);
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Invalid or expired session' });
    }

    try {
        const context = await getAccessOwnerContext(payload.customer_id, payload.academy_id);
        if (!context) {
            return res.status(401).json({ success: false, message: 'Access owner session is no longer valid' });
        }

        req.accessOwner = context;
        req.accessOwnerToken = token;
        return next();
    } catch (error) {
        console.error('Access owner auth error:', error);
        return res.status(500).json({ success: false, message: 'Failed to validate access owner session' });
    }
}

async function fetchLegacyDashboardData(academyId) {
    const [[academyRows], [instructorRows], [studentRows], [logs]] = await Promise.all([
        db.query(
            `SELECT a.*, p.max_instructors, p.max_students, p.name AS plan_name, p.price AS plan_price, p.description
             FROM academies a
             LEFT JOIN plans p ON p.id = a.plan_id
             WHERE a.id = ?`,
            [academyId]
        ),
        db.query(
            `SELECT COUNT(*) AS count
             FROM attempt_logs
             WHERE academy_id = ?
               AND type = 'instructor'
               AND status = 'success'`,
            [academyId]
        ),
        db.query(
            `SELECT COUNT(*) AS count
             FROM attempt_logs
             WHERE academy_id = ?
               AND type = 'student'
               AND status = 'success'`,
            [academyId]
        ),
        db.query(
            `SELECT type, status, reason, email, timestamp
             FROM attempt_logs
             WHERE academy_id = ?
             ORDER BY timestamp DESC
             LIMIT 20`,
            [academyId]
        )
    ]);

    const academy = academyRows[0] || null;
    const instructorCount = Number(instructorRows[0].count || 0);
    const studentCount = Number(studentRows[0].count || 0);

    return {
        academy,
        instructorCount,
        studentCount,
        logs: logs.map((log) => ({
            type: log.type,
            status: log.status,
            reason: log.reason,
            email: log.email,
            timestamp: log.timestamp
        }))
    };
}

function normalizeAccessCode(value) {
    return String(value || '').trim().toUpperCase();
}

function getAccessRoleLabel(role) {
    return normalizeRole(role) === 'student' ? 'Student' : 'Instructor';
}

function buildAccessLimitMessage(role) {
    const normalizedRole = normalizeRole(role) || 'student';
    const roleLabel = getAccessRoleLabel(normalizedRole);
    return `${roleLabel} limit exceeded for the current plan. New ${normalizedRole} registrations and additional logins are blocked for this access code until the owner upgrades the plan or restricts unused access.`;
}

function buildUseAnotherAccessCodeMessage(role) {
    const normalizedRole = normalizeRole(role) || 'student';
    const roleLabel = getAccessRoleLabel(normalizedRole);
    return `${roleLabel} access for this academy code is already full. Please use another access code or contact the academy owner.`;
}

function normalizeAcademyAccessStatus(value) {
    return String(value || '').trim().toLowerCase() === 'restricted' ? 'restricted' : 'active';
}

function buildRestrictedAccessMessage(role) {
    const normalizedRole = normalizeRole(role) || 'student';
    const roleLabel = getAccessRoleLabel(normalizedRole);
    return `${roleLabel} access has been restricted by the academy admin. Please contact the academy admin to restore access.`;
}

async function findAcademyByAccessCode(accessCode, connection = db) {
    const normalizedCode = normalizeAccessCode(accessCode);
    if (!normalizedCode) {
        return null;
    }

    const [rows] = await connection.query(
        `SELECT
            a.id,
            a.customer_id,
            a.plan_id,
            a.academy_name,
            a.access_code,
            p.max_instructors,
            p.max_students,
            p.name AS plan_name
         FROM academies a
         LEFT JOIN plans p ON p.id = a.plan_id
         WHERE a.access_code = ?
         LIMIT 1`,
        [normalizedCode]
    );

    return rows[0] || null;
}

async function getAcademyRoleCapacity(academyId, role, connection = db) {
    const normalizedRole = normalizeRole(role);
    if (!academyId || !normalizedRole) {
        return {
            current: 0,
            limit: 0
        };
    }

    const limitColumn = normalizedRole === 'student' ? 'max_students' : 'max_instructors';
    const [rows] = await connection.query(
        `SELECT
            p.${limitColumn} AS seat_limit,
            (
                SELECT COUNT(*)
                FROM users
                WHERE academy_id = ?
                  AND role = ?
                  AND COALESCE(academy_access_status, 'active') <> 'restricted'
            ) AS current_count
         FROM academies a
         LEFT JOIN plans p ON p.id = a.plan_id
         WHERE a.id = ?
         LIMIT 1`,
        [academyId, normalizedRole, academyId]
    );

    const row = rows[0] || {};
    return {
        current: Number(row.current_count || 0),
        limit: Number(row.seat_limit || 0)
    };
}

async function getAcademyRoleSeatState(academyId, role, connection = db) {
    const normalizedRole = normalizeRole(role);
    if (!academyId || !normalizedRole) {
        return {
            current: 0,
            limit: 0,
            activeCount: 0,
            overflowCount: 0,
            activeUserIds: new Set(),
            activeUsers: [],
            allUsers: []
        };
    }

    const capacity = await getAcademyRoleCapacity(academyId, normalizedRole, connection);
    const [rows] = await connection.query(
        `SELECT id, email, created_at
         FROM users
         WHERE academy_id = ?
           AND role = ?
           AND COALESCE(academy_access_status, 'active') <> 'restricted'
         ORDER BY created_at ASC, id ASC`,
        [academyId, normalizedRole]
    );

    const limit = Number(capacity.limit || 0);
    const activeUsers = limit > 0 ? rows.slice(0, limit) : rows;
    const activeUserIds = new Set(activeUsers.map((user) => Number(user.id)).filter(Boolean));

    return {
        current: rows.length,
        limit,
        activeCount: activeUsers.length,
        overflowCount: limit > 0 ? Math.max(0, rows.length - limit) : 0,
        activeUserIds,
        activeUsers,
        allUsers: rows
    };
}

async function getUserSeatAccessState(userId, role, connection = db) {
    const normalizedRole = normalizeRole(role);
    const normalizedUserId = asPositiveInt(userId);
    if (!normalizedUserId || !normalizedRole) {
        return {
            allowed: false,
            academyId: '',
            seatState: null,
            restricted: false
        };
    }

    const [rows] = await connection.query(
        `SELECT id, academy_id, academy_access_status
         FROM users
         WHERE id = ?
           AND role = ?
         LIMIT 1`,
        [normalizedUserId, normalizedRole]
    );

    const user = rows[0] || null;
    const academyId = String(user?.academy_id || '').trim();
    const isRestricted = normalizeAcademyAccessStatus(user?.academy_access_status) === 'restricted';
    if (!user || !academyId) {
        return {
            allowed: false,
            academyId,
            seatState: null,
            restricted: false
        };
    }

    if (isRestricted) {
        return {
            allowed: false,
            academyId,
            seatState: null,
            restricted: true
        };
    }

    const seatState = await getAcademyRoleSeatState(academyId, normalizedRole, connection);
    return {
        allowed: seatState.activeUserIds.has(normalizedUserId),
        academyId,
        seatState,
        restricted: false
    };
}

async function getAcademyMonitoredUsers(academyId, role, connection = db) {
    const normalizedRole = normalizeRole(role);
    if (!academyId || !normalizedRole) {
        return [];
    }

    const [rows] = await connection.query(
        `SELECT
            id,
            username,
            email,
            role,
            created_at,
            academy_access_status,
            academy_access_last_login_at,
            academy_access_restricted_at
         FROM users
         WHERE academy_id = ?
           AND role = ?
         ORDER BY
            CASE WHEN COALESCE(academy_access_status, 'active') = 'restricted' THEN 1 ELSE 0 END ASC,
            COALESCE(academy_access_last_login_at, created_at) DESC,
            id DESC`,
        [academyId, normalizedRole]
    );

    return rows.map((row) => ({
        id: Number(row.id),
        name: row.username || `${getAccessRoleLabel(normalizedRole)} User`,
        email: row.email || '',
        role: normalizedRole,
        access_status: normalizeAcademyAccessStatus(row.academy_access_status),
        joined_at: row.created_at,
        last_login_at: row.academy_access_last_login_at,
        restricted_at: row.academy_access_restricted_at
    }));
}

async function findAcademyUserForSessionStatus(role, userId, email, connection = db) {
    const normalizedRole = normalizeRole(role);
    const normalizedUserId = asPositiveInt(userId);
    const normalizedEmail = normalizeCustomerEmail(email);
    if (!normalizedRole || (!normalizedUserId && !normalizedEmail)) {
        return null;
    }

    if (normalizedUserId) {
        const [rows] = await connection.query(
            `SELECT id, email, role, academy_id, academy_access_status
             FROM users
             WHERE id = ?
               AND role = ?
             LIMIT 1`,
            [normalizedUserId, normalizedRole]
        );
        return rows[0] || null;
    }

    const [rows] = await connection.query(
        `SELECT id, email, role, academy_id, academy_access_status
         FROM users
         WHERE email = ?
           AND role = ?
         LIMIT 1`,
        [normalizedEmail, normalizedRole]
    );
    return rows[0] || null;
}

async function logAccessAttempt(academyId, type, status, reason, email, connection = db) {
    const normalizedType = normalizeRole(type);
    if (!academyId || !normalizedType) {
        return;
    }

    try {
        await connection.query(
            `INSERT INTO attempt_logs (academy_id, type, status, reason, email, timestamp)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [academyId, normalizedType, status === 'failed' ? 'failed' : 'success', reason || null, email || null]
        );
    } catch (error) {
        console.error('Access attempt log error:', error);
    }
}

app.use('/api/access', handleMongoAccessRoutes);

// ACCESS OWNER - Register academy owner and starter academy
app.post('/api/access/register', async (req, res) => {
    const customerName = String(req.body.customer_name || req.body.name || '').trim();
    const customerEmail = normalizeCustomerEmail(req.body.customer_email || req.body.email);
    const phone = String(req.body.phone || '').trim();
    const password = String(req.body.password || '');
    const academyName = String(req.body.academy_name || req.body.academyName || '').trim();

    if (!customerName || !customerEmail || !password || !academyName) {
        return res.status(400).json({
            success: false,
            message: 'Academy name, customer name, email, and password are required'
        });
    }

    let connection = null;

    try {
        connection = await getConnectionWithTimeout();
        await connection.beginTransaction();

        const [existingCustomers] = await connection.query(
            'SELECT id, password_hash FROM customers WHERE email = ? LIMIT 1',
            [customerEmail]
        );

        const passwordHash = await bcrypt.hash(password, 10);
        let customerId = null;
        let academyId = null;

        if (existingCustomers.length > 0) {
            customerId = Number(existingCustomers[0].id);

            if (existingCustomers[0].password_hash) {
                await connection.rollback();
                return res.status(409).json({
                    success: false,
                    message: 'This customer already has access owner credentials. Please login instead.'
                });
            }

            await connection.query(
                `UPDATE customers
                 SET name = ?, phone = ?, password_hash = ?, status = 'active'
                 WHERE id = ?`,
                [customerName, phone || null, passwordHash, customerId]
            );

            const [academyRows] = await connection.query(
                'SELECT id FROM academies WHERE customer_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
                [customerId]
            );

            if (academyRows.length > 0) {
                academyId = academyRows[0].id;
            }
        } else {
            const [customerResult] = await connection.query(
                `INSERT INTO customers (name, email, phone, password_hash, status, created_at)
                 VALUES (?, ?, ?, ?, 'active', NOW())`,
                [customerName, customerEmail, phone || null, passwordHash]
            );
            customerId = Number(customerResult.insertId);
        }

        if (!academyId) {
            academyId = generateUUID();
            const accessCode = await generateUniqueAccessCode(academyName, connection);

            await connection.query(
                `INSERT INTO academies (
                    id,
                    customer_id,
                    plan_id,
                    academy_name,
                    access_code,
                    status,
                    instructor_count,
                    student_count,
                    created_at,
                    updated_at
                 )
                 VALUES (?, ?, 1, ?, ?, 'active', 0, 0, NOW(), NOW())`,
                [academyId, customerId, academyName, accessCode]
            );
        }

        const context = await getAccessOwnerContext(customerId, academyId, connection);
        await connection.commit();

        return res.status(201).json({
            success: true,
            message: 'Access owner registered successfully',
            token: signAccessOwnerToken(context),
            summary: buildAccessOwnerSummary(req, context)
        });
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error('Access owner registration error:', error);
        return res.status(error.status || 500).json({
            success: false,
            message: error.status === 503
                ? 'The database is taking too long to respond. Please try again in a moment.'
                : 'Failed to register access owner',
            error: error.message
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// ACCESS OWNER - Login
app.post('/api/access/login', async (req, res) => {
    const customerEmail = normalizeCustomerEmail(req.body.customer_email || req.body.email);
    const password = String(req.body.password || '');

    if (!customerEmail || !password) {
        return res.status(400).json({
            success: false,
            message: 'Email and password are required'
        });
    }

    try {
        const [customerRows] = await db.query(
            'SELECT id, password_hash FROM customers WHERE email = ? LIMIT 1',
            [customerEmail]
        );

        if (customerRows.length === 0 || !customerRows[0].password_hash) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        const passwordMatches = await bcrypt.compare(password, customerRows[0].password_hash);
        if (!passwordMatches) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        const context = await getAccessOwnerContext(customerRows[0].id);
        if (!context) {
            return res.status(404).json({
                success: false,
                message: 'No academy workspace found for this account'
            });
        }

        return res.json({
            success: true,
            message: 'Login successful',
            token: signAccessOwnerToken(context),
            summary: buildAccessOwnerSummary(req, context)
        });
    } catch (error) {
        console.error('Access owner login error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to login access owner',
            error: error.message
        });
    }
});

// ACCESS OWNER - Session summary
app.get('/api/access/me', accessOwnerAuth, (req, res) => {
    return res.json({
        success: true,
        summary: buildAccessOwnerSummary(req, req.accessOwner)
    });
});

// ACCESS OWNER - Private dashboard
app.get('/api/access/dashboard', accessOwnerAuth, async (req, res) => {
    try {
        const academyId = req.accessOwner.academy_id;

        const [
            instructorSeatState,
            studentSeatState,
            instructorMonitoringRows,
            studentMonitoringRows,
            [paymentRows],
            [planRows],
            [paidPlanRows],
            [attemptRows]
        ] = await Promise.all([
            getAcademyRoleSeatState(academyId, 'instructor'),
            getAcademyRoleSeatState(academyId, 'student'),
            getAcademyMonitoredUsers(academyId, 'instructor'),
            getAcademyMonitoredUsers(academyId, 'student'),
            db.query(
                `SELECT id, plan_id, plan_name, amount, currency, status, payment_reference, created_at
                 FROM academy_payments
                 WHERE academy_id = ?
                   AND amount > 0
                 ORDER BY created_at DESC, id DESC
                 LIMIT 12`,
                [academyId]
            ),
            db.query(
                `SELECT id, name, max_instructors, max_students, price, description
                 FROM plans
                 ORDER BY CASE WHEN price = 0 THEN 999999 ELSE price END ASC, id ASC`
            ),
            db.query(
                `SELECT DISTINCT plan_id
                 FROM academy_payments
                 WHERE academy_id = ?
                   AND customer_id = ?
                   AND amount > 0
                   AND status = 'completed'`,
                [academyId, req.accessOwner.customer_id]
            ),
            db.query(
                `SELECT type, status, reason, email, timestamp
                 FROM attempt_logs
                 WHERE academy_id = ?
                 ORDER BY timestamp DESC
                 LIMIT 20`,
                [academyId]
            )
        ]);

        const instructorCount = Number(instructorSeatState.activeCount || 0);
        const studentCount = Number(studentSeatState.activeCount || 0);
        const instructorUsage = buildAccessUsageMetric('Instructor', instructorCount, req.accessOwner.max_instructors);
        const studentUsage = buildAccessUsageMetric('Student', studentCount, req.accessOwner.max_students);
        const paidPlanIds = new Set(
            paidPlanRows.map((row) => Number(row.plan_id || 0)).filter(Boolean)
        );
        const warnings = [];

        if (Number(instructorSeatState.overflowCount || 0) > 0) {
            warnings.push('Instructor access is above the current plan capacity. Restrict unused instructor accounts from Monitoring or upgrade the plan to restore healthy capacity.');
        } else if (instructorUsage.exceeded) {
            warnings.push('Instructor limit exceeded for the current plan. New instructor registrations and logins with this access code are blocked until you upgrade the plan.');
        } else if (instructorUsage.near_limit) {
            warnings.push('Instructor seat usage is above 80% of the current plan.');
        }

        if (Number(studentSeatState.overflowCount || 0) > 0) {
            warnings.push('Student access is above the current plan capacity. Restrict unused student accounts from Monitoring or upgrade the plan to restore healthy capacity.');
        } else if (studentUsage.exceeded) {
            warnings.push('Student limit exceeded for the current plan. New student registrations and logins with this access code are blocked until you upgrade the plan.');
        } else if (studentUsage.near_limit) {
            warnings.push('Student seat usage is above 80% of the current plan.');
        }

        return res.json({
            success: true,
            summary: buildAccessOwnerSummary(req, req.accessOwner),
            statistics: {
                active_instructors: instructorCount,
                active_students: studentCount,
                instructor_limit: Number(req.accessOwner.max_instructors || 0),
                student_limit: Number(req.accessOwner.max_students || 0)
            },
            usage: {
                instructors: instructorUsage,
                students: studentUsage
            },
            monitoring: {
                instructors: instructorMonitoringRows,
                students: studentMonitoringRows
            },
            warnings,
            plans: planRows.map((plan) => ({
                id: Number(plan.id),
                name: plan.name,
                max_instructors: Number(plan.max_instructors || 0),
                max_students: Number(plan.max_students || 0),
                price: Number(plan.price || 0),
                description: plan.description || '',
                is_paid_before: paidPlanIds.has(Number(plan.id || 0)),
                activation_mode: Number(plan.price || 0) <= 0
                    ? 'free'
                    : paidPlanIds.has(Number(plan.id || 0))
                        ? 'reactivate'
                        : 'purchase'
            })),
            payments: paymentRows.map((payment) => ({
                id: Number(payment.id),
                plan_id: Number(payment.plan_id || 0),
                plan_name: payment.plan_name,
                amount: Number(payment.amount || 0),
                currency: payment.currency || 'INR',
                status: payment.status,
                payment_reference: payment.payment_reference,
                created_at: payment.created_at
            })),
            activity_logs: attemptRows.map((log) => ({
                type: log.type,
                status: log.status,
                reason: log.reason,
                email: log.email,
                timestamp: log.timestamp
            }))
        });
    } catch (error) {
        console.error('Access owner dashboard error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to load access owner dashboard',
            error: error.message
        });
    }
});

app.get('/api/access/session-status', async (req, res) => {
    const role = normalizeRole(req.query.role);
    const userId = asPositiveInt(req.query.userId || req.query.user_id);
    const email = normalizeCustomerEmail(req.query.email);

    if (!role || (!userId && !email)) {
        return res.status(400).json({
            success: false,
            message: 'A valid role and user reference are required.'
        });
    }

    try {
        const user = await findAcademyUserForSessionStatus(role, userId, email);
        if (!user) {
            return res.status(404).json({
                success: false,
                allowed: false,
                reason: 'session_invalid',
                message: 'This account could not be found. Please login again.'
            });
        }

        const seatAccess = await getUserSeatAccessState(user.id, role);
        if (seatAccess.restricted) {
            return res.json({
                success: true,
                allowed: false,
                reason: 'restricted_by_admin',
                message: buildRestrictedAccessMessage(role)
            });
        }

        if (!seatAccess.allowed) {
            return res.json({
                success: true,
                allowed: false,
                reason: 'use_another_code',
                message: buildUseAnotherAccessCodeMessage(role)
            });
        }

        return res.json({
            success: true,
            allowed: true,
            reason: 'allowed',
            message: `${getAccessRoleLabel(role)} session is active.`
        });
    } catch (error) {
        console.error('Access session status error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to verify access session status',
            error: error.message
        });
    }
});

async function handleAccessMemberStatusUpdate(req, res) {
    const userId = asPositiveInt(req.params.userId);
    const role = normalizeRole(req.body.role);
    const requestedStatus = String(req.body.access_status || req.body.accessStatus || '').trim().toLowerCase();
    const nextStatus = requestedStatus === 'restricted'
        ? 'restricted'
        : requestedStatus === 'active'
            ? 'active'
            : '';

    if (!userId) {
        return res.status(400).json({
            success: false,
            message: 'A valid user ID is required'
        });
    }

    if (!role) {
        return res.status(400).json({
            success: false,
            message: 'A valid role is required'
        });
    }

    if (!nextStatus) {
        return res.status(400).json({
            success: false,
            message: 'A valid access status is required'
        });
    }

    try {
        const [rows] = await db.query(
            `SELECT id, username, email, role, academy_id, academy_access_status
             FROM users
             WHERE id = ?
               AND role = ?
               AND academy_id = ?
             LIMIT 1`,
            [userId, role, req.accessOwner.academy_id]
        );

        const member = rows[0] || null;
        if (!member) {
            return res.status(404).json({
                success: false,
                message: 'This academy member was not found.'
            });
        }

        const currentStatus = normalizeAcademyAccessStatus(member.academy_access_status);
        const roleLabel = getAccessRoleLabel(role);
        if (currentStatus === 'restricted' && nextStatus === 'active') {
            const capacity = await getAcademyRoleCapacity(req.accessOwner.academy_id, role);
            if (capacity.limit <= 0 || capacity.current >= capacity.limit) {
                return res.status(409).json({
                    success: false,
                    message: `${roleLabel} access cannot be allowed right now because all active seats are already full. Restrict another active ${role} or upgrade the plan first.`
                });
            }
        }

        if (currentStatus !== nextStatus) {
            await db.query(
                `UPDATE users
                 SET academy_access_status = ?,
                     academy_access_restricted_at = CASE WHEN ? = 'restricted' THEN NOW() ELSE NULL END
                 WHERE id = ?`,
                [nextStatus, nextStatus, userId]
            );
        }

        const message = nextStatus === 'restricted'
            ? `${member.username || roleLabel} has been restricted from using this academy access code.`
            : `${member.username || roleLabel} can use this academy access code again.`;

        return res.json({
            success: true,
            message,
            member: {
                id: Number(member.id),
                name: member.username || `${roleLabel} User`,
                email: member.email || '',
                role,
                access_status: nextStatus
            }
        });
    } catch (error) {
        console.error('Academy member access update error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to update academy member access',
            error: error.message
        });
    }
}

async function getMongoAccessOwnerContext(customerId, academyId = null) {
    const mongoDb = await mongoStore.getMongoDb();
    const customer = await mongoDb.collection('customers').findOne({ id: Number(customerId) });
    if (!customer) {
        return null;
    }

    const academyQuery = { customer_id: Number(customer.id) };
    if (academyId) {
        academyQuery.id = String(academyId);
    }

    const academy = await mongoDb.collection('academies').findOne(academyQuery, { sort: { created_at: -1, id: -1 } });
    if (!academy) {
        return null;
    }

    const plan = await mongoDb.collection('plans').findOne({ id: Number(academy.plan_id || 1) }) || {};
    return {
        customer_id: Number(customer.id),
        customer_name: customer.name,
        customer_email: customer.email,
        customer_phone: customer.phone || '',
        password_hash: customer.password_hash,
        customer_status: customer.status || 'active',
        academy_id: academy.id,
        academy_name: academy.academy_name,
        access_code: academy.access_code,
        academy_status: academy.status || 'active',
        plan_id: Number(academy.plan_id || 1),
        plan_activated_at: academy.plan_activated_at || null,
        plan_expires_at: academy.plan_expires_at || null,
        academy_created_at: academy.created_at,
        academy_updated_at: academy.updated_at,
        plan_name: plan.name || 'Basic',
        max_instructors: Number(plan.max_instructors || 0),
        max_students: Number(plan.max_students || 0),
        plan_price: Number(plan.price || 0),
        plan_description: plan.description || ''
    };
}

async function generateUniqueMongoAccessCode(academyName = '') {
    const mongoDb = await mongoStore.getMongoDb();
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const candidate = generateAccessCode(academyName);
        const existing = await mongoDb.collection('academies').findOne({ access_code: candidate }, { projection: { id: 1 } });
        if (!existing) {
            return candidate;
        }
    }

    throw new Error('Unable to generate a unique access code');
}

async function mongoAccessOwnerAuth(req, res) {
    const authorization = String(req.headers.authorization || '').trim();
    if (!authorization.startsWith('Bearer ')) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return null;
    }

    try {
        const payload = jwt.verify(authorization.slice('Bearer '.length).trim(), ACCESS_OWNER_JWT_SECRET);
        const context = await getMongoAccessOwnerContext(payload.customer_id, payload.academy_id);
        if (!context) {
            res.status(401).json({ success: false, message: 'Access owner session is no longer valid' });
            return null;
        }
        return context;
    } catch (error) {
        res.status(401).json({ success: false, message: 'Invalid or expired session' });
        return null;
    }
}

async function handleMongoAccessRoutes(req, res, next) {
    if (!mongoStore.isMongoEnabled()) {
        return next();
    }

    const routePath = req.path.replace(/\/+$/, '') || '/';
    const now = new Date();

    try {
        const mongoDb = await mongoStore.getMongoDbWithTimeout();

        if (req.method === 'POST' && routePath === '/register') {
            const customerName = String(req.body.customer_name || req.body.name || '').trim();
            const customerEmail = normalizeCustomerEmail(req.body.customer_email || req.body.email);
            const phone = String(req.body.phone || '').trim();
            const password = String(req.body.password || '');
            const academyName = String(req.body.academy_name || req.body.academyName || '').trim();

            if (!customerName || !customerEmail || !password || !academyName) {
                return res.status(400).json({ success: false, message: 'Academy name, customer name, email, and password are required' });
            }

            let customer = await mongoDb.collection('customers').findOne({ email: customerEmail });
            if (customer?.password_hash) {
                return res.status(409).json({ success: false, message: 'This customer already has access owner credentials. Please login instead.' });
            }

            const passwordHash = await bcrypt.hash(password, 10);
            if (!customer) {
                customer = {
                    id: await mongoStore.nextSequence('customers'),
                    name: customerName,
                    email: customerEmail,
                    phone: phone || '',
                    password_hash: passwordHash,
                    status: 'active',
                    created_at: now,
                    updated_at: now
                };
                await mongoDb.collection('customers').insertOne(customer);
            } else {
                await mongoDb.collection('customers').updateOne(
                    { id: Number(customer.id) },
                    { $set: { name: customerName, phone: phone || '', password_hash: passwordHash, status: 'active', updated_at: now } }
                );
                customer = await mongoDb.collection('customers').findOne({ id: Number(customer.id) });
            }

            let academy = await mongoDb.collection('academies').findOne({ customer_id: Number(customer.id) }, { sort: { created_at: -1 } });
            if (!academy) {
                academy = {
                    id: generateUUID(),
                    customer_id: Number(customer.id),
                    plan_id: 1,
                    academy_name: academyName,
                    access_code: await generateUniqueMongoAccessCode(academyName),
                    status: 'active',
                    instructor_count: 0,
                    student_count: 0,
                    created_at: now,
                    updated_at: now
                };
                await mongoDb.collection('academies').insertOne(academy);
            }

            const context = await getMongoAccessOwnerContext(customer.id, academy.id);
            return res.status(201).json({
                success: true,
                message: 'Access owner registered successfully',
                token: signAccessOwnerToken(context),
                summary: buildAccessOwnerSummary(req, context)
            });
        }

        if (req.method === 'POST' && routePath === '/login') {
            const customerEmail = normalizeCustomerEmail(req.body.customer_email || req.body.email);
            const password = String(req.body.password || '');
            if (!customerEmail || !password) {
                return res.status(400).json({ success: false, message: 'Email and password are required' });
            }

            const customer = await mongoDb.collection('customers').findOne({ email: customerEmail });
            if (!customer?.password_hash || !(await bcrypt.compare(password, customer.password_hash))) {
                return res.status(401).json({ success: false, message: 'Invalid credentials' });
            }

            const context = await getMongoAccessOwnerContext(customer.id);
            if (!context) {
                return res.status(404).json({ success: false, message: 'No academy workspace found for this account' });
            }

            return res.json({
                success: true,
                message: 'Login successful',
                token: signAccessOwnerToken(context),
                summary: buildAccessOwnerSummary(req, context)
            });
        }

        const accessOwner = await mongoAccessOwnerAuth(req, res);
        if (!accessOwner) {
            return;
        }

        if (req.method === 'GET' && routePath === '/me') {
            return res.json({ success: true, summary: buildAccessOwnerSummary(req, accessOwner) });
        }

        if (req.method === 'GET' && routePath === '/payment-config') {
            const credentials = getRazorpayCredentials();
            return res.json({
                success: true,
                ready: credentials.ready,
                message: credentials.ready
                    ? 'Razorpay payment gateway is configured.'
                    : 'Razorpay payment gateway is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to backend/.env.'
            });
        }

        if (req.method === 'GET' && routePath === '/dashboard') {
            const [plans, payments, paidPlanRows, attemptRows] = await Promise.all([
                mongoStore.listPlans(),
                mongoDb.collection('academy_payments').find({ academy_id: accessOwner.academy_id, amount: { $gt: 0 } }).sort({ created_at: -1 }).limit(12).toArray(),
                mongoDb.collection('academy_payments').find({
                    academy_id: accessOwner.academy_id,
                    customer_id: Number(accessOwner.customer_id),
                    amount: { $gt: 0 },
                    status: 'completed'
                }).toArray(),
                mongoDb.collection('attempt_logs').find({ academy_id: accessOwner.academy_id }).sort({ timestamp: -1 }).limit(20).toArray()
            ]);

            const paidPlanIds = new Set(paidPlanRows.map((row) => Number(row.plan_id || 0)).filter(Boolean));
            const instructorUsage = buildAccessUsageMetric('Instructor', 0, accessOwner.max_instructors);
            const studentUsage = buildAccessUsageMetric('Student', 0, accessOwner.max_students);
            return res.json({
                success: true,
                summary: buildAccessOwnerSummary(req, accessOwner),
                statistics: {
                    active_instructors: 0,
                    active_students: 0,
                    instructor_limit: Number(accessOwner.max_instructors || 0),
                    student_limit: Number(accessOwner.max_students || 0)
                },
                usage: { instructors: instructorUsage, students: studentUsage },
                monitoring: { instructors: [], students: [] },
                warnings: [],
                plans: plans.map((plan) => ({
                    id: Number(plan.id),
                    name: plan.name,
                    max_instructors: Number(plan.max_instructors || 0),
                    max_students: Number(plan.max_students || 0),
                    price: Number(plan.price || 0),
                    description: plan.description || '',
                    is_paid_before: paidPlanIds.has(Number(plan.id || 0)),
                    activation_mode: Number(plan.price || 0) <= 0
                        ? 'free'
                        : paidPlanIds.has(Number(plan.id || 0))
                            ? 'reactivate'
                            : 'purchase'
                })),
                payments: payments.map((payment) => ({
                    id: Number(payment.id || 0),
                    plan_id: Number(payment.plan_id || 0),
                    plan_name: payment.plan_name,
                    amount: Number(payment.amount || 0),
                    currency: payment.currency || 'INR',
                    status: payment.status,
                    payment_reference: payment.payment_reference,
                    created_at: payment.created_at
                })),
                activity_logs: attemptRows.map((log) => ({
                    type: log.type,
                    status: log.status,
                    reason: log.reason,
                    email: log.email,
                    timestamp: log.timestamp
                }))
            });
        }

        if (req.method === 'POST' && routePath === '/orders') {
            const planId = asPositiveInt(req.body.plan_id || req.body.planId);
            const plan = planId ? await mongoStore.getPlan(planId) : null;
            if (!plan) {
                return res.status(404).json({ success: false, message: 'Selected plan was not found' });
            }
            if (Number(plan.price || 0) <= 0) {
                return res.status(400).json({ success: false, message: 'The selected plan does not require payment.' });
            }

            const amountInPaise = normalizeRazorpayAmount(Math.round(Number(plan.price || 0) * 100));
            const receipt = `rcpt_${String(accessOwner.academy_id).slice(0, 8)}_${Date.now()}`;
            const order = await createRazorpayOrder({
                amount: amountInPaise,
                currency: 'INR',
                receipt,
                notes: {
                    academy_id: String(accessOwner.academy_id),
                    customer_id: String(accessOwner.customer_id),
                    plan_id: String(plan.id)
                }
            });

            await mongoDb.collection('academy_payment_orders').insertOne({
                id: await mongoStore.nextSequence('academy_payment_orders'),
                academy_id: accessOwner.academy_id,
                customer_id: Number(accessOwner.customer_id),
                plan_id: Number(plan.id),
                amount: Number(order.amount || amountInPaise),
                currency: order.currency || 'INR',
                razorpay_order_id: order.id,
                receipt: order.receipt || receipt,
                status: 'created',
                is_consumed: 0,
                created_at: now,
                updated_at: now
            });

            return res.json({
                success: true,
                key_id: assertRazorpayConfigured().keyId,
                order: {
                    id: order.id,
                    amount: Number(order.amount || amountInPaise),
                    currency: order.currency || 'INR',
                    receipt: order.receipt || receipt
                },
                plan: { id: Number(plan.id), name: plan.name, price: Number(plan.price || 0) }
            });
        }

        if (req.method === 'POST' && routePath === '/verify-payment') {
            const razorpayOrderId = String(req.body.razorpay_order_id || '').trim();
            const razorpayPaymentId = String(req.body.razorpay_payment_id || '').trim();
            const razorpaySignature = String(req.body.razorpay_signature || '').trim();
            const planId = asPositiveInt(req.body.plan_id || req.body.planId);
            if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !planId) {
                return res.status(400).json({ success: false, message: 'Order ID, payment ID, signature, and plan ID are required' });
            }

            const paymentOrder = await mongoDb.collection('academy_payment_orders').findOne({
                academy_id: accessOwner.academy_id,
                customer_id: Number(accessOwner.customer_id),
                razorpay_order_id: razorpayOrderId
            });
            if (!paymentOrder) {
                return res.status(404).json({ success: false, message: 'Matching payment order was not found' });
            }
            if (Number(paymentOrder.plan_id) !== Number(planId)) {
                return res.status(400).json({ success: false, message: 'The payment order does not match the selected plan' });
            }
            if (!verifyRazorpaySignature(paymentOrder.razorpay_order_id, razorpayPaymentId, razorpaySignature)) {
                return res.status(400).json({ success: false, message: 'Payment signature verification failed' });
            }

            await mongoDb.collection('academy_payment_orders').updateOne(
                { _id: paymentOrder._id },
                { $set: { status: 'verified', razorpay_payment_id: razorpayPaymentId, razorpay_signature: razorpaySignature, payment_status: 'verified', updated_at: now } }
            );

            return res.json({ success: true, message: 'Payment verified successfully', payment_id: razorpayPaymentId, payment_status: 'verified' });
        }

        if (req.method === 'POST' && routePath === '/subscription') {
            const planId = asPositiveInt(req.body.plan_id || req.body.planId);
            const plan = planId ? await mongoStore.getPlan(planId) : null;
            if (!plan) {
                return res.status(404).json({ success: false, message: 'Selected plan was not found' });
            }

            if (Number(plan.price || 0) > 0) {
                const verifiedPaymentOrder = await mongoDb.collection('academy_payment_orders').findOne({
                    academy_id: accessOwner.academy_id,
                    customer_id: Number(accessOwner.customer_id),
                    plan_id: Number(plan.id),
                    status: 'verified',
                    is_consumed: { $ne: 1 }
                }, { sort: { updated_at: -1 } });

                if (!verifiedPaymentOrder) {
                    return res.status(402).json({ success: false, message: `Complete payment for the ${plan.name} plan before activating it.` });
                }

                await mongoDb.collection('academy_payments').insertOne({
                    id: await mongoStore.nextSequence('academy_payments'),
                    academy_id: accessOwner.academy_id,
                    customer_id: Number(accessOwner.customer_id),
                    plan_id: Number(plan.id),
                    plan_name: plan.name,
                    amount: Number(plan.price || 0),
                    currency: verifiedPaymentOrder.currency || 'INR',
                    status: 'completed',
                    payment_reference: verifiedPaymentOrder.razorpay_payment_id || verifiedPaymentOrder.razorpay_order_id,
                    created_at: now
                });

                await mongoDb.collection('academy_payment_orders').updateOne(
                    { _id: verifiedPaymentOrder._id },
                    { $set: { status: 'consumed', is_consumed: 1, updated_at: now } }
                );
            }

            await mongoDb.collection('academies').updateOne(
                { id: accessOwner.academy_id, customer_id: Number(accessOwner.customer_id) },
                {
                    $set: {
                        plan_id: Number(plan.id),
                        status: 'active',
                        plan_activated_at: now,
                        plan_expires_at: Number(plan.price || 0) > 0 ? new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000) : null,
                        updated_at: now
                    }
                }
            );

            const updatedContext = await getMongoAccessOwnerContext(accessOwner.customer_id, accessOwner.academy_id);
            return res.json({
                success: true,
                message: `${plan.name} plan activated successfully.`,
                summary: buildAccessOwnerSummary(req, updatedContext)
            });
        }

        return next();
    } catch (error) {
        console.error('Mongo access route error:', error);
        return res.status(error.status || 500).json({
            success: false,
            message: error.message || 'Mongo access request failed',
            error: error.details || error.message
        });
    }
}

app.patch('/api/access/members/:userId/access-status', accessOwnerAuth, handleAccessMemberStatusUpdate);
app.post('/api/access/members/:userId/access-status', accessOwnerAuth, handleAccessMemberStatusUpdate);

app.get('/api/access/payment-config', accessOwnerAuth, (req, res) => {
    const credentials = getRazorpayCredentials();

    return res.json({
        success: true,
        ready: credentials.ready,
        message: credentials.ready
            ? 'Razorpay payment gateway is configured.'
            : 'Razorpay payment gateway is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to backend/.env.'
    });
});

// RAZORPAY STANDARD CHECKOUT - Create a generic order
app.post('/api/create-order', async (req, res) => {
    const amount = normalizeRazorpayAmount(req.body.amount);
    const currency = String(req.body.currency || 'INR').trim().toUpperCase();
    const receipt = String(req.body.receipt || `rcpt_${Date.now()}`).trim();

    if (!amount) {
        return res.status(400).json({
            success: false,
            message: 'Amount must be an integer of at least 100 paise'
        });
    }

    try {
        const order = await createRazorpayOrder({
            amount,
            currency: currency || 'INR',
            receipt
        });

        return res.json({
            success: true,
            order_id: order.id,
            amount: Number(order.amount || amount),
            currency: order.currency || currency || 'INR'
        });
    } catch (error) {
        console.error('Create generic Razorpay order error:', error);
        return res.status(normalizeRazorpayErrorStatus(error)).json({
            success: false,
            message: error.message || 'Failed to create Razorpay order',
            error: error.details || error.message
        });
    }
});

// RAZORPAY STANDARD CHECKOUT - Verify the payment signature
app.post('/api/verify-payment', (req, res) => {
    const razorpayOrderId = String(req.body.razorpay_order_id || '').trim();
    const razorpayPaymentId = String(req.body.razorpay_payment_id || '').trim();
    const razorpaySignature = String(req.body.razorpay_signature || '').trim();

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
        return res.status(400).json({
            success: false,
            message: 'Order ID, payment ID, and signature are required'
        });
    }

    try {
        const signatureIsValid = verifyRazorpaySignature(
            razorpayOrderId,
            razorpayPaymentId,
            razorpaySignature
        );

        if (!signatureIsValid) {
            return res.status(400).json({
                success: false,
                message: 'Payment signature verification failed'
            });
        }

        return res.json({
            success: true,
            message: 'Payment signature verified successfully',
            payment_id: razorpayPaymentId,
            order_id: razorpayOrderId
        });
    } catch (error) {
        console.error('Generic payment verification error:', error);
        return res.status(normalizeRazorpayErrorStatus(error)).json({
            success: false,
            message: error.message || 'Payment verification failed',
            error: error.details || error.message
        });
    }
});

// ACCESS OWNER - Create a Razorpay order for a paid plan
app.post('/api/access/orders', accessOwnerAuth, async (req, res) => {
    const planId = asPositiveInt(req.body.plan_id || req.body.planId);
    if (!planId) {
        return res.status(400).json({
            success: false,
            message: 'A valid plan ID is required'
        });
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [planRows] = await connection.query(
            `SELECT id, name, max_instructors, max_students, price, description
             FROM plans
             WHERE id = ?
             LIMIT 1`,
            [planId]
        );

        if (planRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Selected plan was not found'
            });
        }

        const plan = planRows[0];
        const planPrice = Number(plan.price || 0);
        if (planPrice <= 0) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'The selected plan does not require payment.'
            });
        }

        const currentPlanId = Number(req.accessOwner.plan_id || 0);
        if (currentPlanId === Number(plan.id)) {
            await connection.rollback();
            return res.status(409).json({
                success: false,
                message: `${plan.name} is already the active plan.`
            });
        }

        const reusablePayment = await findReusablePlanPayment(connection, {
            academyId: req.accessOwner.academy_id,
            customerId: req.accessOwner.customer_id,
            planId: Number(plan.id)
        });

        if (reusablePayment) {
            await connection.rollback();
            return res.status(409).json({
                success: false,
                message: `${plan.name} was already purchased for this academy. Switch to it directly from the dashboard without paying again.`
            });
        }

        const amountInPaise = normalizeRazorpayAmount(Math.round(planPrice * 100));
        if (!amountInPaise) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Selected plan amount must be at least 100 paise'
            });
        }

        const receipt = `rcpt_${String(req.accessOwner.academy_id).slice(0, 8)}_${Date.now()}`;
        const order = await createRazorpayOrder({
            amount: amountInPaise,
            currency: 'INR',
            receipt,
            notes: {
                academy_id: String(req.accessOwner.academy_id),
                customer_id: String(req.accessOwner.customer_id),
                plan_id: String(plan.id)
            }
        });

        await connection.query(
            `INSERT INTO academy_payment_orders (
                academy_id,
                customer_id,
                plan_id,
                amount,
                currency,
                razorpay_order_id,
                receipt,
                status,
                created_at,
                updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, 'created', NOW(), NOW())`,
            [
                req.accessOwner.academy_id,
                req.accessOwner.customer_id,
                Number(plan.id),
                Number(order.amount || amountInPaise),
                order.currency || 'INR',
                order.id,
                order.receipt || receipt
            ]
        );

        await connection.commit();

        return res.json({
            success: true,
            key_id: assertRazorpayConfigured().keyId,
            order: {
                id: order.id,
                amount: Number(order.amount || amountInPaise),
                currency: order.currency || 'INR',
                receipt: order.receipt || receipt
            },
            plan: {
                id: Number(plan.id),
                name: plan.name,
                price: planPrice
            }
        });
    } catch (error) {
        await connection.rollback();
        console.error('Create Razorpay order error:', error);
        return res.status(normalizeRazorpayErrorStatus(error)).json({
            success: false,
            message: error.message || 'Failed to create payment order',
            error: error.details || error.message
        });
    } finally {
        connection.release();
    }
});

// ACCESS OWNER - Change or renew plan
app.post('/api/access/subscription', accessOwnerAuth, async (req, res) => {
    const planId = asPositiveInt(req.body.plan_id || req.body.planId);
    if (!planId) {
        return res.status(400).json({
            success: false,
            message: 'A valid plan ID is required'
        });
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [planRows] = await connection.query(
            `SELECT id, name, max_instructors, max_students, price, description
             FROM plans
             WHERE id = ?
             LIMIT 1`,
            [planId]
        );

        if (planRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Selected plan was not found'
            });
        }

        const plan = planRows[0];
        const currentPlanId = Number(req.accessOwner.plan_id || 0);

        if (currentPlanId === Number(plan.id)) {
            await connection.rollback();
            return res.json({
                success: true,
                message: `${plan.name} is already the active plan.`,
                summary: buildAccessOwnerSummary(req, req.accessOwner)
            });
        }

        let verifiedPaymentOrder = null;
        let reusablePayment = null;
        if (Number(plan.price || 0) > 0) {
            const [paymentOrderRows] = await connection.query(
                `SELECT id, razorpay_order_id, razorpay_payment_id, currency
                 FROM academy_payment_orders
                 WHERE academy_id = ?
                   AND customer_id = ?
                   AND plan_id = ?
                   AND status = 'verified'
                   AND is_consumed = 0
                 ORDER BY updated_at DESC, id DESC
                 LIMIT 1`,
                [
                    req.accessOwner.academy_id,
                    req.accessOwner.customer_id,
                    Number(plan.id)
                ]
            );

            verifiedPaymentOrder = paymentOrderRows[0] || null;

            if (!verifiedPaymentOrder) {
                reusablePayment = await findReusablePlanPayment(connection, {
                    academyId: req.accessOwner.academy_id,
                    customerId: req.accessOwner.customer_id,
                    planId: Number(plan.id)
                });
            }

            if (!verifiedPaymentOrder && !reusablePayment) {
                await connection.rollback();
                return res.status(402).json({
                    success: false,
                    message: `Complete payment for the ${plan.name} plan before activating it.`
                });
            }
        }

        await connection.query(
            `UPDATE academies
             SET plan_id = ?, 
                 status = 'active', 
                 plan_activated_at = NOW(),
                 plan_expires_at = IF(? > 0, DATE_ADD(NOW(), INTERVAL 31 DAY), NULL),
                 updated_at = NOW()
             WHERE id = ?
               AND customer_id = ?`,
            [plan.id, Number(plan.price || 0), req.accessOwner.academy_id, req.accessOwner.customer_id]
        );

        let paymentReference = reusablePayment?.payment_reference || null;
        let successMessage = `${plan.name} plan activated successfully.`;

        if (verifiedPaymentOrder) {
            paymentReference = await insertAcademyPayment(connection, {
                academyId: req.accessOwner.academy_id,
                customerId: req.accessOwner.customer_id,
                planId: Number(plan.id),
                planName: plan.name,
                amount: Number(plan.price || 0),
                currency: verifiedPaymentOrder?.currency || 'INR',
                status: 'completed',
                paymentReference: verifiedPaymentOrder?.razorpay_payment_id || verifiedPaymentOrder?.razorpay_order_id
            });
        } else if (!reusablePayment && Number(plan.price || 0) > 0) {
            paymentReference = await insertAcademyPayment(connection, {
                academyId: req.accessOwner.academy_id,
                customerId: req.accessOwner.customer_id,
                planId: Number(plan.id),
                planName: plan.name,
                amount: Number(plan.price || 0),
                currency: 'INR',
                status: 'completed'
            });
        }

        if (verifiedPaymentOrder) {
            await connection.query(
                `UPDATE academy_payment_orders
                 SET status = 'consumed',
                     is_consumed = 1,
                     updated_at = NOW()
                 WHERE id = ?`,
                [verifiedPaymentOrder.id]
            );
        }

        if (reusablePayment) {
            successMessage = `${plan.name} plan activated using your previous payment.`;
        }

        const updatedContext = await getAccessOwnerContext(
            req.accessOwner.customer_id,
            req.accessOwner.academy_id,
            connection
        );

        await connection.commit();

        return res.json({
            success: true,
            message: successMessage,
            payment_reference: paymentReference,
            summary: buildAccessOwnerSummary(req, updatedContext)
        });
    } catch (error) {
        await connection.rollback();
        console.error('Access owner subscription error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to update subscription plan',
            error: error.message
        });
    } finally {
        connection.release();
    }
});

// PAYMENT VERIFICATION - Verify Razorpay payment
app.post('/api/access/verify-payment', accessOwnerAuth, async (req, res) => {
    const razorpayOrderId = String(req.body.razorpay_order_id || '').trim();
    const razorpayPaymentId = String(req.body.razorpay_payment_id || '').trim();
    const razorpaySignature = String(req.body.razorpay_signature || '').trim();
    const planId = asPositiveInt(req.body.plan_id || req.body.planId);

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !planId) {
        return res.status(400).json({
            success: false,
            message: 'Order ID, payment ID, signature, and plan ID are required'
        });
    }

    const connection = await db.getConnection();

    try {
        const [paymentOrderRows] = await connection.query(
            `SELECT id, amount, currency, plan_id, razorpay_order_id, status, is_consumed
             FROM academy_payment_orders
             WHERE academy_id = ?
               AND customer_id = ?
               AND razorpay_order_id = ?
             LIMIT 1`,
            [
                req.accessOwner.academy_id,
                req.accessOwner.customer_id,
                razorpayOrderId
            ]
        );

        if (paymentOrderRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Matching payment order was not found'
            });
        }

        const paymentOrder = paymentOrderRows[0];
        if (Number(paymentOrder.plan_id) !== Number(planId)) {
            return res.status(400).json({
                success: false,
                message: 'The payment order does not match the selected plan'
            });
        }

        if (Number(paymentOrder.is_consumed || 0) === 1) {
            return res.status(409).json({
                success: false,
                message: 'This payment has already been used to activate a plan'
            });
        }

        const signatureIsValid = verifyRazorpaySignature(
            paymentOrder.razorpay_order_id,
            razorpayPaymentId,
            razorpaySignature
        );

        if (!signatureIsValid) {
            return res.status(400).json({
                success: false,
                message: 'Payment signature verification failed'
            });
        }

        let payment = await fetchRazorpayPayment(razorpayPaymentId);
        if (String(payment.order_id || '').trim() !== paymentOrder.razorpay_order_id) {
            return res.status(400).json({
                success: false,
                message: 'Payment order mismatch received from Razorpay'
            });
        }

        if (Number(payment.amount || 0) !== Number(paymentOrder.amount || 0)) {
            return res.status(400).json({
                success: false,
                message: 'Paid amount does not match the selected plan amount'
            });
        }

        let paymentStatus = String(payment.status || '').trim().toLowerCase();
        if (paymentStatus === 'authorized') {
            payment = await captureRazorpayPayment(
                razorpayPaymentId,
                Number(paymentOrder.amount || 0),
                paymentOrder.currency || 'INR'
            );
            paymentStatus = String(payment.status || '').trim().toLowerCase();
        }

        if (paymentStatus !== 'captured') {
            return res.status(400).json({
                success: false,
                message: `Payment is not captured yet. Current Razorpay status: ${paymentStatus || 'unknown'}.`
            });
        }

        await connection.query(
            `UPDATE academy_payment_orders
             SET status = 'verified',
                 razorpay_payment_id = ?,
                 razorpay_signature = ?,
                 payment_status = ?,
                 updated_at = NOW()
             WHERE id = ?`,
            [
                razorpayPaymentId,
                razorpaySignature,
                paymentStatus,
                paymentOrder.id
            ]
        );

        return res.json({
            success: true,
            message: 'Payment verified successfully',
            payment_id: razorpayPaymentId,
            payment_status: paymentStatus
        });
    } catch (error) {
        console.error('Payment verification error:', error);
        return res.status(normalizeRazorpayErrorStatus(error)).json({
            success: false,
            message: error.message || 'Payment verification failed',
            error: error.details || error.message
        });
    } finally {
        connection.release();
    }
});

// ACCESS OWNER - Permanently terminate the current academy workspace
app.delete('/api/access/terminate', accessOwnerAuth, async (req, res) => {
    const academyId = String(req.accessOwner.academy_id || '').trim();
    const customerId = Number(req.accessOwner.customer_id || 0);

    if (!academyId || !customerId) {
        return res.status(400).json({
            success: false,
            message: 'Unable to resolve the academy account for termination'
        });
    }

    const connection = await db.getConnection();
    const coverAssets = new Set();
    const videoAssets = new Set();

    try {
        await connection.beginTransaction();

        const [userRows] = await connection.query(
            `SELECT id, email, role
             FROM users
             WHERE academy_id = ?`,
            [academyId]
        );

        const userIds = userRows.map((user) => Number(user.id)).filter(Boolean);
        const instructorIds = userRows
            .filter((user) => String(user.role || '').trim().toLowerCase() === 'instructor')
            .map((user) => Number(user.id))
            .filter(Boolean);
        const studentEmails = userRows
            .filter((user) => String(user.role || '').trim().toLowerCase() === 'student')
            .map((user) => String(user.email || '').trim())
            .filter(Boolean);

        let courseRows = [];
        let courseIds = [];
        let videoIds = [];

        if (instructorIds.length > 0) {
            const [courses] = await connection.query(
                `SELECT id, cover_path, video_path
                 FROM courses
                 WHERE instructor_id IN (?)`,
                [instructorIds]
            );
            courseRows = courses;
            courseIds = courseRows.map((course) => Number(course.id)).filter(Boolean);

            for (const course of courseRows) {
                if (course.cover_path) {
                    coverAssets.add(String(course.cover_path).trim());
                }
                if (course.video_path) {
                    videoAssets.add(String(course.video_path).trim());
                }
            }
        }

        if (courseIds.length > 0) {
            const [videos] = await connection.query(
                `SELECT id, video_url
                 FROM videos
                 WHERE course_id IN (?)`,
                [courseIds]
            );
            videoIds = videos.map((video) => Number(video.id)).filter(Boolean);

            for (const video of videos) {
                if (video.video_url) {
                    videoAssets.add(String(video.video_url).trim());
                }
            }

            await connection.query('DELETE FROM enrollments WHERE course_id IN (?)', [courseIds]);
            await connection.query('DELETE FROM course_views WHERE course_id IN (?)', [courseIds]);
            if (videoIds.length > 0) {
                await connection.query('DELETE FROM course_video_progress WHERE video_id IN (?)', [videoIds]);
            }
            await connection.query('DELETE FROM course_videos WHERE course_id IN (?)', [courseIds]);
            await connection.query('DELETE FROM videos WHERE course_id IN (?)', [courseIds]);
            await connection.query('DELETE FROM courses WHERE id IN (?)', [courseIds]);
        }

        if (studentEmails.length > 0) {
            await connection.query('DELETE FROM enrollments WHERE student_email IN (?)', [studentEmails]);
            await connection.query('DELETE FROM course_views WHERE student_email IN (?)', [studentEmails]);
            await connection.query('DELETE FROM course_video_progress WHERE student_email IN (?)', [studentEmails]);
        }

        if (instructorIds.length > 0) {
            await connection.query('DELETE FROM messages WHERE instructor_id IN (?)', [instructorIds]);
        }

        if (userIds.length > 0) {
            await connection.query('DELETE FROM notifications WHERE user_id IN (?)', [userIds]);
            await connection.query('DELETE FROM password_reset_otps WHERE user_id IN (?)', [userIds]);
            await connection.query('DELETE FROM group_messages WHERE sender_id IN (?)', [userIds]);
            await connection.query(
                'DELETE FROM chat_messages WHERE sender_id IN (?) OR recipient_id IN (?)',
                [userIds, userIds]
            );
            await connection.query('DELETE FROM users WHERE id IN (?)', [userIds]);
        }

        await connection.query('DELETE FROM academies WHERE id = ? AND customer_id = ?', [academyId, customerId]);

        const [remainingAcademyRows] = await connection.query(
            'SELECT id FROM academies WHERE customer_id = ? LIMIT 1',
            [customerId]
        );

        if (remainingAcademyRows.length === 0) {
            await connection.query('DELETE FROM customers WHERE id = ?', [customerId]);
        }

        await connection.commit();

        for (const coverPath of coverAssets) {
            try {
                await deleteStoredFile(coverPath);
            } catch (error) {
                console.error(`Failed to delete course cover during academy termination: ${coverPath}`, error);
            }
        }

        for (const videoPath of videoAssets) {
            try {
                await deleteVideoStorageAsset(videoPath);
            } catch (error) {
                console.error(`Failed to delete video asset during academy termination: ${videoPath}`, error);
            }
        }

        return res.json({
            success: true,
            message: 'Academy account terminated successfully. Linked users, access, courses, and uploaded videos were deleted permanently.'
        });
    } catch (error) {
        await connection.rollback();
        console.error('Access owner termination error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to terminate the academy account',
            error: error.message
        });
    } finally {
        connection.release();
    }
});

// SUBSCRIBE - Create subscription and generate access code
app.post('/api/subscribe', async (req, res) => {
    try {
        const { plan_id, customer_name, customer_email, academy_name } = req.body;

        if (!plan_id || !customer_name || !customer_email || !academy_name) {
            return res.status(400).json({ 
                success: false, 
                message: 'Plan ID, customer name, email, and academy name are required' 
            });
        }

        // Check if email already exists
        const [existingCustomer] = await db.query(
            'SELECT id FROM customers WHERE email = ?',
            [customer_email]
        );

        let customerId;

        if (existingCustomer.length > 0) {
            customerId = existingCustomer[0].id;
        } else {
            // Create new customer
            const [customerResult] = await db.query(
                'INSERT INTO customers (name, email, status, created_at) VALUES (?, ?, ?, NOW())',
                [customer_name, customer_email, 'active']
            );
            customerId = customerResult.insertId;
        }

        // Generate academy ID and access code
        const academyId = generateUUID();
        const accessCode = await generateUniqueAccessCode(academy_name);

        // Create academy
        const [planResult] = await db.query(
            'SELECT name FROM plans WHERE id = ?',
            [plan_id]
        );

        if (planResult.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid plan ID' 
            });
        }

        const planName = planResult[0].name;

        await db.query(
            `INSERT INTO academies (id, customer_id, plan_id, academy_name, access_code, instructor_count, student_count, created_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, 0, 0, NOW(), NOW())`,
            [academyId, customerId, plan_id, academy_name, accessCode]
        );

        // Return success with academy details
        return res.status(201).json({
            success: true,
            message: 'Subscription created successfully',
            academy: {
                academy_id: academyId,
                access_code: accessCode,
                plan_name: planName,
                academy_name: academy_name,
                customer_name: customer_name,
                customer_email: customer_email
            }
        });

    } catch (error) {
        console.error('Subscription error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to create subscription',
            error: error.message 
        });
    }
});

// DASHBOARD - Get academy dashboard data
app.get('/api/dashboard/:academy_id', async (req, res) => {
    try {
        const academyId = req.params.academy_id;

        if (!academyId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Academy ID is required' 
            });
        }

        // Get academy and plan info
        const [academies] = await db.query(
            `SELECT a.*, p.max_instructors, p.max_students, p.name as plan_name
             FROM academies a
             LEFT JOIN plans p ON p.id = a.plan_id
             WHERE a.id = ?`,
            [academyId]
        );

        if (academies.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Academy not found' 
            });
        }

        const academy = academies[0];

        // Get instructor count
        const [instructorCountResult] = await db.query(
            'SELECT COUNT(*) as count FROM attempt_logs WHERE academy_id = ? AND type = "instructor" AND status = "success"',
            [academyId]
        );
        const instructorCount = instructorCountResult[0].count || 0;

        // Get student count
        const [studentCountResult] = await db.query(
            'SELECT COUNT(*) as count FROM attempt_logs WHERE academy_id = ? AND type = "student" AND status = "success"',
            [academyId]
        );
        const studentCount = studentCountResult[0].count || 0;

        // Get attempt logs
        const [logs] = await db.query(
            `SELECT type, status, reason, email, timestamp 
             FROM attempt_logs 
             WHERE academy_id = ? 
             ORDER BY timestamp DESC 
             LIMIT 20`,
            [academyId]
        );

        return res.json({
            success: true,
            data: {
                academy_id: academyId,
                academy_name: academy.academy_name,
                plan_name: academy.plan_name,
                instructor_count: instructorCount,
                student_count: studentCount,
                max_instructors: academy.max_instructors || 10,
                max_students: academy.max_students || 200,
                attempt_logs: logs.map(log => ({
                    type: log.type,
                    status: log.status,
                    reason: log.reason,
                    email: log.email,
                    timestamp: log.timestamp
                }))
            }
        });

    } catch (error) {
        console.error('Dashboard fetch error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to load dashboard',
            error: error.message 
        });
    }
});

// VALIDATE ACCESS - Check access code and track registration attempts
app.post('/api/validate-access', async (req, res) => {
    try {
        const { access_code, email, type } = req.body;

        if (!access_code || !email || !type) {
            return res.status(400).json({ 
                success: false, 
                message: 'Access code, email, and type (student/instructor) are required' 
            });
        }

        // Find academy by access code
        const [academies] = await db.query(
            `SELECT a.*, p.max_instructors, p.max_students, p.name AS plan_name
             FROM academies a
             LEFT JOIN plans p ON p.id = a.plan_id
             WHERE a.access_code = ?`,
            [access_code]
        );

        if (academies.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Invalid access code' 
            });
        }

        const academy = academies[0];

        // Check limits based on type
        let currentCount = 0;
        let maxCount = 0;
        let limitExceeded = false;
        let reason = '';

        if (type === 'instructor') {
            const [countResult] = await db.query(
                'SELECT COUNT(*) as count FROM attempt_logs WHERE academy_id = ? AND type = "instructor" AND status = "success"',
                [academy.id]
            );
            currentCount = countResult[0].count || 0;
            maxCount = academy.max_instructors || 10;
            limitExceeded = currentCount >= maxCount;
            reason = limitExceeded ? `Instructor limit (${maxCount}) exceeded` : '';
        } else if (type === 'student') {
            const [countResult] = await db.query(
                'SELECT COUNT(*) as count FROM attempt_logs WHERE academy_id = ? AND type = "student" AND status = "success"',
                [academy.id]
            );
            currentCount = countResult[0].count || 0;
            maxCount = academy.max_students || 200;
            limitExceeded = currentCount >= maxCount;
            reason = limitExceeded ? `Student limit (${maxCount}) exceeded` : '';
        }

        // Log the attempt
        const status = limitExceeded ? 'failed' : 'success';
        await db.query(
            'INSERT INTO attempt_logs (academy_id, type, status, reason, email, timestamp) VALUES (?, ?, ?, ?, ?, NOW())',
            [academy.id, type, status, reason, email]
        );

        if (limitExceeded) {
            return res.status(403).json({ 
                success: false, 
                message: reason,
                current_count: currentCount,
                max_count: maxCount
            });
        }

        return res.json({
            success: true,
            message: 'Access granted',
            academy: {
                academy_id: academy.id,
                academy_name: academy.academy_name,
                plan_name: academy.plan_name,
                current_count: currentCount + 1,
                max_count: maxCount
            }
        });

    } catch (error) {
        console.error('Access validation error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to validate access',
            error: error.message 
        });
    }
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

    return res.status(404).sendFile(path.join(FRONTEND_HTML_ROOT, 'index.html'), (error) => {
        if (error) {
            res.status(404).json({
                message: 'Route not found',
                path: req.path
            });
        }
    });
});

app.listen(port, () => {
    console.log(`Backend server listening on http://localhost:${port}`);
});
