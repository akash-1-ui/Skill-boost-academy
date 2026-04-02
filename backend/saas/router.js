const express = require('express');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const { getDurationOption } = require('../courseLifecycle');
const { getCloudinaryStatus, uploadVideoAsset } = require('../cloudinary');
const { getSubscriptionPlan, listSubscriptionPlans } = require('./constants');
const {
    authMiddleware,
    roleMiddleware,
    organizationFilterMiddleware,
    subscriptionMiddleware,
    signToken,
    isSubscriptionExpired
} = require('./middleware');

let Stripe = null;
try {
    Stripe = require('stripe');
} catch (error) {
    Stripe = null;
}

const router = express.Router();
const DEFAULT_PROFILE_PHOTO = '/uploads/default-avatar.svg';
const DEFAULT_COURSE_COVER = '/uploads/default-course-cover.svg';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const localVideoDirectory = path.join(__dirname, '..', 'videos');
const tempVideoDirectory = path.join(__dirname, '..', 'tmp', 'videos');

fs.mkdirSync(localVideoDirectory, { recursive: true });
fs.mkdirSync(tempVideoDirectory, { recursive: true });

const uploadStorage = multer.diskStorage({
    destination(req, file, cb) {
        cb(null, tempVideoDirectory);
    },
    filename(req, file, cb) {
        const extension = path.extname(file.originalname || '') || '.mp4';
        cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
    }
});

const videoUpload = multer({
    storage: uploadStorage,
    limits: { fileSize: 200 * 1024 * 1024 },
    fileFilter(req, file, cb) {
        if (!file.mimetype.startsWith('video/')) {
            return cb(new Error('Please upload a valid video file'));
        }

        return cb(null, true);
    }
});

function asyncHandler(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function toPositiveInt(value) {
    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized <= 0) {
        return null;
    }
    return normalized;
}

function normalizeAccessCode(value) {
    return String(value || '').trim().toUpperCase();
}

function formatDateForSql(date) {
    return new Date(date).toISOString().slice(0, 10);
}

function addDays(date, numberOfDays) {
    const target = new Date(date);
    target.setDate(target.getDate() + numberOfDays);
    return target;
}

function normalizeLimit(value) {
    return value === null || value === undefined ? null : Number(value);
}

function isUnlimited(value) {
    return value === null || value === undefined;
}

function mapPlan(plan) {
    return {
        id: plan.id,
        name: plan.name,
        amount: plan.amount,
        currency: plan.currency,
        duration_days: plan.durationDays,
        duration_label: plan.durationLabel,
        student_limit: plan.studentLimit,
        instructor_limit: plan.instructorLimit,
        student_limit_label: isUnlimited(plan.studentLimit) ? 'Unlimited' : String(plan.studentLimit),
        instructor_limit_label: isUnlimited(plan.instructorLimit) ? 'Unlimited' : String(plan.instructorLimit)
    };
}

function buildOrganizationPayload(organization) {
    return {
        id: Number(organization.id),
        college_name: organization.college_name,
        access_code: organization.access_code,
        student_limit: normalizeLimit(organization.student_limit),
        instructor_limit: normalizeLimit(organization.instructor_limit),
        subscription_status: organization.subscription_status,
        expiry_date: organization.expiry_date,
        subscription_expired: isSubscriptionExpired(organization)
    };
}

function buildUserPayload(user) {
    return {
        id: Number(user.id),
        username: user.username,
        email: user.email,
        phone: user.phone || '',
        role: user.role,
        expertise: user.expertise || '',
        branch: user.branch || '',
        profile_photo: user.profile_photo || DEFAULT_PROFILE_PHOTO,
        organization_id: Number(user.organization_id)
    };
}

function buildMonthSeries(rows, valueField = 'total', monthCount = 6) {
    const now = new Date();
    const buckets = [];

    for (let offset = monthCount - 1; offset >= 0; offset -= 1) {
        const cursor = new Date(now.getFullYear(), now.getMonth() - offset, 1);
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
        const label = cursor.toLocaleString('en-US', { month: 'short', year: 'numeric' });
        buckets.push({ key, label });
    }

    const valueMap = new Map(
        (rows || []).map((row) => [String(row.bucket), Number(row[valueField] || 0)])
    );

    return {
        labels: buckets.map((bucket) => bucket.label),
        values: buckets.map((bucket) => valueMap.get(bucket.key) || 0)
    };
}

function getStripeClient() {
    if (!Stripe || !process.env.STRIPE_SECRET_KEY) {
        return null;
    }

    return new Stripe(process.env.STRIPE_SECRET_KEY);
}

async function persistVideoFileLocally(file) {
    const extension = path.extname(file.originalname || '') || path.extname(file.filename || '') || '.mp4';
    const finalName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`;
    const finalPath = path.join(localVideoDirectory, finalName);
    await fs.promises.rename(file.path, finalPath);
    return `/videos/${finalName}`;
}

async function removeTempFile(filePath) {
    if (!filePath) {
        return;
    }

    try {
        await fs.promises.unlink(filePath);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Failed to clean up upload:', error);
        }
    }
}

async function storeVideoAsset(file) {
    const cloudinaryStatus = getCloudinaryStatus();
    if (cloudinaryStatus.ready) {
        const result = await uploadVideoAsset(file.path);
        return result.secure_url;
    }

    return persistVideoFileLocally(file);
}

async function createNotifications(connection, organizationId, userIds, message, type) {
    const recipients = Array.from(new Set((userIds || []).map(toPositiveInt).filter(Boolean)));
    if (recipients.length === 0) {
        return 0;
    }

    const values = recipients.flatMap((userId) => [userId, message, type, organizationId]);
    const placeholders = recipients.map(() => '(?, ?, ?, 0, NOW(), ?)').join(', ');

    await connection.query(
        `INSERT INTO notifications (
            user_id,
            message,
            type,
            is_read,
            created_at,
            organization_id
         )
         VALUES ${placeholders}`,
        values
    );

    return recipients.length;
}

async function getOrganizationByAccessCode(accessCode) {
    const normalizedAccessCode = normalizeAccessCode(accessCode);
    const [rows] = await db.query(
        `SELECT id, college_name, access_code, student_limit, instructor_limit, subscription_status, expiry_date
         FROM organizations
         WHERE access_code = ?
         LIMIT 1`,
        [normalizedAccessCode]
    );

    return rows[0] || null;
}

async function activateSubscription({ organization, plan, paymentId, provider, status, metadata }) {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [existingPayment] = await connection.query(
            `SELECT id
             FROM subscriptions
             WHERE payment_id = ?
             LIMIT 1`,
            [paymentId]
        );

        if (existingPayment.length === 0) {
            const baseDate = organization?.expiry_date && new Date(organization.expiry_date) > new Date()
                ? new Date(organization.expiry_date)
                : new Date();
            const nextExpiry = addDays(baseDate, plan.durationDays);
            const expiryDate = formatDateForSql(nextExpiry);

            await connection.query(
                `UPDATE organizations
                 SET student_limit = ?,
                     instructor_limit = ?,
                     subscription_status = 'active',
                     expiry_date = ?
                 WHERE id = ?`,
                [plan.studentLimit, plan.instructorLimit, expiryDate, organization.id]
            );

            await connection.query(
                `INSERT INTO subscriptions (
                    organization_id,
                    plan_id,
                    plan_name,
                    amount,
                    currency,
                    student_limit,
                    instructor_limit,
                    duration_days,
                    provider,
                    status,
                    payment_id,
                    metadata,
                    created_at
                 )
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    organization.id,
                    plan.id,
                    plan.name,
                    plan.amount,
                    plan.currency,
                    plan.studentLimit,
                    plan.instructorLimit,
                    plan.durationDays,
                    provider,
                    status,
                    paymentId,
                    metadata ? JSON.stringify(metadata) : null
                ]
            );
        }

        const [refreshedRows] = await connection.query(
            `SELECT id, college_name, access_code, student_limit, instructor_limit, subscription_status, expiry_date
             FROM organizations
             WHERE id = ?
             LIMIT 1`,
            [organization.id]
        );

        await connection.commit();
        return refreshedRows[0];
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function fetchStudentCourseCatalog(organizationId, studentEmail) {
    const [rows] = await db.query(
        `SELECT
            c.id,
            c.title,
            c.category,
            c.description,
            c.cover_path,
            c.created_at,
            c.duration_days,
            c.duration_label,
            c.enrolled_students,
            u.username AS instructor_name,
            MAX(CASE WHEN e.id IS NOT NULL THEN 1 ELSE 0 END) AS is_enrolled,
            COUNT(DISTINCT cv.id) AS total_videos,
            COUNT(DISTINCT CASE WHEN p.is_watched = 1 THEN p.video_id END) AS watched_videos
         FROM courses c
         INNER JOIN users u
           ON u.id = c.instructor_id
          AND u.organization_id = c.organization_id
         LEFT JOIN enrollments e
           ON e.course_id = c.id
          AND e.student_email = ?
          AND e.organization_id = c.organization_id
         LEFT JOIN course_videos cv
           ON cv.course_id = c.id
          AND cv.organization_id = c.organization_id
         LEFT JOIN course_video_progress p
           ON p.video_id = cv.id
          AND p.student_email = ?
          AND p.organization_id = c.organization_id
         WHERE c.organization_id = ?
         GROUP BY c.id
         ORDER BY c.created_at DESC, c.id DESC`,
        [studentEmail, studentEmail, organizationId]
    );

    return rows.map((row) => {
        const totalVideos = Number(row.total_videos || 0);
        const watchedVideos = Number(row.watched_videos || 0);
        const progress = totalVideos > 0 ? Math.round((watchedVideos / totalVideos) * 100) : 0;

        return {
            id: Number(row.id),
            title: row.title,
            category: row.category,
            description: row.description || '',
            cover_path: row.cover_path || DEFAULT_COURSE_COVER,
            created_at: row.created_at,
            duration_days: Number(row.duration_days || 90),
            duration_label: row.duration_label || 'Full course',
            enrolled_students: Number(row.enrolled_students || 0),
            instructor_name: row.instructor_name,
            is_enrolled: Boolean(Number(row.is_enrolled || 0)),
            total_videos: totalVideos,
            watched_videos: watchedVideos,
            progress_percentage: progress
        };
    });
}

const authenticated = [authMiddleware, organizationFilterMiddleware];
const principalOnly = [...authenticated, roleMiddleware('principal')];
const principalWithSubscription = [...principalOnly, subscriptionMiddleware()];
const instructorOnly = [...authenticated, roleMiddleware('instructor')];
const instructorWithSubscription = [...instructorOnly, subscriptionMiddleware()];
const studentOnly = [...authenticated, roleMiddleware('student')];
const studentWithSubscription = [...studentOnly, subscriptionMiddleware()];

router.get('/meta/plans', (req, res) => {
    return res.json({
        plans: listSubscriptionPlans().map(mapPlan)
    });
});

router.post('/auth/register', asyncHandler(async (req, res) => {
    const collegeName = String(req.body.collegeName || '').trim();
    const accessCode = normalizeAccessCode(req.body.accessCode);
    const username = String(req.body.username || req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').trim();
    const password = String(req.body.password || '');

    if (!collegeName || !accessCode || !username || !email || !password) {
        return res.status(400).json({
            error: 'collegeName, accessCode, username, email and password are required'
        });
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [existingOrganization] = await connection.query(
            `SELECT id
             FROM organizations
             WHERE access_code = ?
             LIMIT 1`,
            [accessCode]
        );

        if (existingOrganization.length > 0) {
            await connection.rollback();
            return res.status(409).json({ error: 'Access code already in use' });
        }

        const [organizationResult] = await connection.query(
            `INSERT INTO organizations (
                college_name,
                access_code,
                student_limit,
                instructor_limit,
                subscription_status,
                expiry_date,
                created_at
             )
             VALUES (?, ?, 0, 0, 'expired', NULL, NOW())`,
            [collegeName, accessCode]
        );

        const organizationId = Number(organizationResult.insertId);
        const passwordHash = await bcrypt.hash(password, 10);

        const [principalResult] = await connection.query(
            `INSERT INTO users (
                username,
                email,
                phone,
                password,
                role,
                organization_id,
                created_at
             )
             VALUES (?, ?, ?, ?, 'principal', ?, NOW())`,
            [username, email, phone || null, passwordHash, organizationId]
        );

        await connection.commit();

        const user = {
            id: Number(principalResult.insertId),
            username,
            email,
            phone,
            role: 'principal',
            organization_id: organizationId,
            profile_photo: null
        };

        return res.status(201).json({
            message: 'Organization registered successfully',
            token: signToken(user),
            user: buildUserPayload(user),
            organization: buildOrganizationPayload({
                id: organizationId,
                college_name: collegeName,
                access_code: accessCode,
                student_limit: 0,
                instructor_limit: 0,
                subscription_status: 'expired',
                expiry_date: null
            })
        });
    } catch (error) {
        await connection.rollback();

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Email or access code already exists' });
        }

        throw error;
    } finally {
        connection.release();
    }
}));

router.post('/auth/login', asyncHandler(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const accessCode = normalizeAccessCode(req.body.accessCode);

    if (!email || !password || !accessCode) {
        return res.status(400).json({ error: 'email, password and accessCode are required' });
    }

    const organization = await getOrganizationByAccessCode(accessCode);
    if (!organization) {
        return res.status(401).json({ error: 'Invalid access code' });
    }

    const [users] = await db.query(
        `SELECT id, username, email, phone, password, role, expertise, branch, profile_photo, organization_id
         FROM users
         WHERE email = ?
           AND organization_id = ?
         LIMIT 1`,
        [email, organization.id]
    );

    if (users.length === 0) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];
    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    return res.json({
        message: 'Login successful',
        token: signToken(user),
        user: buildUserPayload(user),
        organization: buildOrganizationPayload(organization)
    });
}));

router.get('/auth/me', authenticated, asyncHandler(async (req, res) => {
    return res.json({
        user: buildUserPayload(req.currentUser),
        organization: buildOrganizationPayload(req.organization)
    });
}));

router.get('/principal/dashboard', principalWithSubscription, asyncHandler(async (req, res) => {
    const organizationId = req.organization.id;

    const [[countRows], [studentGrowthRows], [enrollmentRows], [videoViewRows]] = await Promise.all([
        db.query(
            `SELECT
                SUM(CASE WHEN role = 'student' THEN 1 ELSE 0 END) AS total_students,
                SUM(CASE WHEN role = 'instructor' THEN 1 ELSE 0 END) AS total_instructors
             FROM users
             WHERE organization_id = ?`,
            [organizationId]
        ),
        db.query(
            `SELECT DATE_FORMAT(created_at, '%Y-%m') AS bucket, COUNT(*) AS total
             FROM users
             WHERE organization_id = ?
               AND role = 'student'
             GROUP BY bucket
             ORDER BY bucket ASC`,
            [organizationId]
        ),
        db.query(
            `SELECT DATE_FORMAT(created_at, '%Y-%m') AS bucket, COUNT(*) AS total
             FROM enrollments
             WHERE organization_id = ?
             GROUP BY bucket
             ORDER BY bucket ASC`,
            [organizationId]
        ),
        db.query(
            `SELECT DATE_FORMAT(created_at, '%Y-%m') AS bucket, COUNT(*) AS total
             FROM course_views
             WHERE organization_id = ?
             GROUP BY bucket
             ORDER BY bucket ASC`,
            [organizationId]
        )
    ]);

    const [[courseRows], [videoRows], [recentSubscriptions]] = await Promise.all([
        db.query(
            `SELECT COUNT(*) AS total_courses
             FROM courses
             WHERE organization_id = ?`,
            [organizationId]
        ),
        db.query(
            `SELECT COUNT(*) AS total_videos
             FROM course_videos
             WHERE organization_id = ?`,
            [organizationId]
        ),
        db.query(
            `SELECT id, plan_name, amount, status, payment_id, created_at
             FROM subscriptions
             WHERE organization_id = ?
             ORDER BY created_at DESC
             LIMIT 5`,
            [organizationId]
        )
    ]);

    return res.json({
        organization: buildOrganizationPayload(req.organization),
        statistics: {
            total_students: Number(countRows[0].total_students || 0),
            total_instructors: Number(countRows[0].total_instructors || 0),
            total_courses: Number(courseRows[0].total_courses || 0),
            total_videos: Number(videoRows[0].total_videos || 0)
        },
        charts: {
            student_growth: buildMonthSeries(studentGrowthRows),
            course_enrollments: buildMonthSeries(enrollmentRows),
            video_views: buildMonthSeries(videoViewRows)
        },
        recent_payments: recentSubscriptions.map((payment) => ({
            id: Number(payment.id),
            plan_name: payment.plan_name,
            amount: Number(payment.amount || 0),
            status: payment.status,
            payment_id: payment.payment_id,
            created_at: payment.created_at
        }))
    });
}));

router.get('/principal/instructors', principalWithSubscription, asyncHandler(async (req, res) => {
    const [rows] = await db.query(
        `SELECT id, username, email, phone, expertise, created_at, organization_id, profile_photo
         FROM users
         WHERE organization_id = ?
           AND role = 'instructor'
         ORDER BY created_at DESC, id DESC`,
        [req.organization.id]
    );

    return res.json({
        instructors: rows.map((row) => buildUserPayload(row))
    });
}));

router.get('/principal/students', principalWithSubscription, asyncHandler(async (req, res) => {
    const [rows] = await db.query(
        `SELECT id, username, email, phone, branch, created_at, organization_id, profile_photo
         FROM users
         WHERE organization_id = ?
           AND role = 'student'
         ORDER BY created_at DESC, id DESC`,
        [req.organization.id]
    );

    return res.json({
        students: rows.map((row) => buildUserPayload(row))
    });
}));

router.post('/principal/create-instructor', principalWithSubscription, asyncHandler(async (req, res) => {
    const username = String(req.body.username || req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').trim();
    const expertise = String(req.body.expertise || '').trim();
    const password = String(req.body.password || '');

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'username, email and password are required' });
    }

    const [countRows] = await db.query(
        `SELECT COUNT(*) AS total
         FROM users
         WHERE organization_id = ?
           AND role = 'instructor'`,
        [req.organization.id]
    );

    const currentCount = Number(countRows[0].total || 0);
    if (!isUnlimited(req.organization.instructor_limit) && currentCount >= Number(req.organization.instructor_limit)) {
        return res.status(409).json({ error: 'Instructor limit reached' });
    }

    const [existingRows] = await db.query(
        `SELECT id
         FROM users
         WHERE organization_id = ?
           AND email = ?
         LIMIT 1`,
        [req.organization.id, email]
    );

    if (existingRows.length > 0) {
        return res.status(409).json({ error: 'Email already exists in this organization' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
        `INSERT INTO users (
            username,
            email,
            phone,
            password,
            role,
            expertise,
            organization_id,
            created_at
         )
         VALUES (?, ?, ?, ?, 'instructor', ?, ?, NOW())`,
        [username, email, phone || null, passwordHash, expertise || null, req.organization.id]
    );

    return res.status(201).json({
        message: 'Instructor created successfully',
        instructor: buildUserPayload({
            id: Number(result.insertId),
            username,
            email,
            phone,
            expertise,
            role: 'instructor',
            organization_id: req.organization.id,
            profile_photo: null
        })
    });
}));

router.post('/principal/create-student', principalWithSubscription, asyncHandler(async (req, res) => {
    const username = String(req.body.username || req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').trim();
    const branch = String(req.body.branch || '').trim();
    const password = String(req.body.password || '');

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'username, email and password are required' });
    }

    const [countRows] = await db.query(
        `SELECT COUNT(*) AS total
         FROM users
         WHERE organization_id = ?
           AND role = 'student'`,
        [req.organization.id]
    );

    const currentCount = Number(countRows[0].total || 0);
    if (!isUnlimited(req.organization.student_limit) && currentCount >= Number(req.organization.student_limit)) {
        return res.status(409).json({ error: 'Student limit reached' });
    }

    const [existingRows] = await db.query(
        `SELECT id
         FROM users
         WHERE organization_id = ?
           AND email = ?
         LIMIT 1`,
        [req.organization.id, email]
    );

    if (existingRows.length > 0) {
        return res.status(409).json({ error: 'Email already exists in this organization' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
        `INSERT INTO users (
            username,
            email,
            phone,
            password,
            role,
            branch,
            organization_id,
            created_at
         )
         VALUES (?, ?, ?, ?, 'student', ?, ?, NOW())`,
        [username, email, phone || null, passwordHash, branch || null, req.organization.id]
    );

    return res.status(201).json({
        message: 'Student created successfully',
        student: buildUserPayload({
            id: Number(result.insertId),
            username,
            email,
            phone,
            branch,
            role: 'student',
            organization_id: req.organization.id,
            profile_photo: null
        })
    });
}));

router.get('/principal/subscription', principalOnly, asyncHandler(async (req, res) => {
    const [payments] = await db.query(
        `SELECT id, plan_id, plan_name, amount, currency, status, payment_id, created_at
         FROM subscriptions
         WHERE organization_id = ?
         ORDER BY created_at DESC`,
        [req.organization.id]
    );

    return res.json({
        organization: buildOrganizationPayload(req.organization),
        plans: listSubscriptionPlans().map(mapPlan),
        payments: payments.map((payment) => ({
            id: Number(payment.id),
            plan_id: payment.plan_id,
            plan_name: payment.plan_name,
            amount: Number(payment.amount || 0),
            currency: payment.currency,
            status: payment.status,
            payment_id: payment.payment_id,
            created_at: payment.created_at
        }))
    });
}));

router.post('/principal/subscription', principalOnly, asyncHandler(async (req, res) => {
    const plan = getSubscriptionPlan(req.body.planId);

    if (!plan) {
        return res.status(400).json({ error: 'Invalid plan selected' });
    }

    const stripe = getStripeClient();
    if (stripe) {
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card'],
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency: plan.currency.toLowerCase(),
                        unit_amount: plan.amount,
                        product_data: {
                            name: `${plan.name} Plan`,
                            description: `${plan.durationLabel} access for ${req.organization.college_name}`
                        }
                    }
                }
            ],
            success_url: `${FRONTEND_URL}/principal/subscription?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${FRONTEND_URL}/principal/subscription?canceled=1`,
            metadata: {
                organizationId: String(req.organization.id),
                planId: plan.id
            }
        });

        return res.json({
            mode: 'stripe',
            checkout_url: session.url,
            session_id: session.id
        });
    }

    const paymentId = `SIM-${Date.now()}-${req.organization.id}`;
    const refreshedOrganization = await activateSubscription({
        organization: req.organization,
        plan,
        paymentId,
        provider: 'simulated',
        status: 'paid',
        metadata: { mode: 'local-simulation' }
    });

    return res.json({
        mode: 'simulated',
        message: 'Subscription activated in local simulation mode',
        organization: buildOrganizationPayload(refreshedOrganization)
    });
}));

router.post('/principal/subscription/confirm', principalOnly, asyncHandler(async (req, res) => {
    const sessionId = String(req.body.sessionId || '').trim();
    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
    }

    const stripe = getStripeClient();
    if (!stripe) {
        return res.status(400).json({ error: 'Stripe is not configured for confirmation' });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session || session.payment_status !== 'paid') {
        return res.status(400).json({ error: 'Payment is not completed yet' });
    }

    if (Number(session.metadata?.organizationId) !== req.organization.id) {
        return res.status(403).json({ error: 'Payment does not belong to this organization' });
    }

    const plan = getSubscriptionPlan(session.metadata?.planId);
    if (!plan) {
        return res.status(400).json({ error: 'Unknown subscription plan' });
    }

    const refreshedOrganization = await activateSubscription({
        organization: req.organization,
        plan,
        paymentId: String(session.payment_intent || session.id),
        provider: 'stripe',
        status: 'paid',
        metadata: {
            session_id: session.id,
            customer_email: session.customer_details?.email || ''
        }
    });

    return res.json({
        message: 'Subscription activated successfully',
        organization: buildOrganizationPayload(refreshedOrganization)
    });
}));

router.get('/principal/payments', principalOnly, asyncHandler(async (req, res) => {
    const [rows] = await db.query(
        `SELECT id, plan_id, plan_name, amount, currency, status, payment_id, provider, created_at
         FROM subscriptions
         WHERE organization_id = ?
         ORDER BY created_at DESC`,
        [req.organization.id]
    );

    return res.json({
        payments: rows.map((row) => ({
            id: Number(row.id),
            plan_id: row.plan_id,
            plan_name: row.plan_name,
            amount: Number(row.amount || 0),
            currency: row.currency,
            status: row.status,
            payment_id: row.payment_id,
            provider: row.provider,
            created_at: row.created_at
        }))
    });
}));

router.get('/principal/settings', principalOnly, asyncHandler(async (req, res) => {
    return res.json({
        organization: buildOrganizationPayload(req.organization),
        principal: buildUserPayload(req.currentUser)
    });
}));

router.put('/principal/settings', principalOnly, asyncHandler(async (req, res) => {
    const collegeName = String(req.body.collegeName || req.organization.college_name).trim();
    const accessCode = normalizeAccessCode(req.body.accessCode || req.organization.access_code);
    const username = String(req.body.username || req.currentUser.username).trim();
    const phone = String(req.body.phone || req.currentUser.phone || '').trim();

    if (!collegeName || !accessCode || !username) {
        return res.status(400).json({ error: 'collegeName, accessCode and username are required' });
    }

    const [codeRows] = await db.query(
        `SELECT id
         FROM organizations
         WHERE access_code = ?
           AND id <> ?
         LIMIT 1`,
        [accessCode, req.organization.id]
    );

    if (codeRows.length > 0) {
        return res.status(409).json({ error: 'Access code already in use' });
    }

    await db.query(
        `UPDATE organizations
         SET college_name = ?, access_code = ?
         WHERE id = ?`,
        [collegeName, accessCode, req.organization.id]
    );

    await db.query(
        `UPDATE users
         SET username = ?, phone = ?
         WHERE id = ?
           AND organization_id = ?`,
        [username, phone || null, req.currentUser.id, req.organization.id]
    );

    return res.json({
        message: 'Settings updated successfully'
    });
}));

router.get('/instructor/dashboard', instructorWithSubscription, asyncHandler(async (req, res) => {
    const organizationId = req.organization.id;
    const instructorId = req.currentUser.id;

    const [[courseRows], [studentRows], [viewRows], [messageRows], [recentCourses]] = await Promise.all([
        db.query(
            `SELECT COUNT(*) AS total_courses
             FROM courses
             WHERE organization_id = ?
               AND instructor_id = ?`,
            [organizationId, instructorId]
        ),
        db.query(
            `SELECT COUNT(DISTINCT e.student_email) AS total_students
             FROM enrollments e
             INNER JOIN courses c
               ON c.id = e.course_id
              AND c.organization_id = e.organization_id
             WHERE c.organization_id = ?
               AND c.instructor_id = ?`,
            [organizationId, instructorId]
        ),
        db.query(
            `SELECT COUNT(*) AS total_views
             FROM course_views cv
             INNER JOIN courses c
               ON c.id = cv.course_id
              AND c.organization_id = cv.organization_id
             WHERE c.organization_id = ?
               AND c.instructor_id = ?`,
            [organizationId, instructorId]
        ),
        db.query(
            `SELECT COUNT(*) AS total_messages
             FROM messages
             WHERE organization_id = ?
               AND instructor_id = ?`,
            [organizationId, instructorId]
        ),
        db.query(
            `SELECT
                c.id,
                c.title,
                c.category,
                c.created_at,
                COUNT(DISTINCT cv.id) AS total_videos,
                COUNT(DISTINCT e.id) AS total_enrollments
             FROM courses c
             LEFT JOIN course_videos cv
               ON cv.course_id = c.id
              AND cv.organization_id = c.organization_id
             LEFT JOIN enrollments e
               ON e.course_id = c.id
              AND e.organization_id = c.organization_id
             WHERE c.organization_id = ?
               AND c.instructor_id = ?
             GROUP BY c.id
             ORDER BY c.created_at DESC
             LIMIT 5`,
            [organizationId, instructorId]
        )
    ]);

    return res.json({
        metrics: {
            total_courses: Number(courseRows[0].total_courses || 0),
            total_students_enrolled: Number(studentRows[0].total_students || 0),
            total_video_views: Number(viewRows[0].total_views || 0),
            total_messages: Number(messageRows[0].total_messages || 0)
        },
        recent_courses: recentCourses.map((course) => ({
            id: Number(course.id),
            title: course.title,
            category: course.category,
            created_at: course.created_at,
            total_videos: Number(course.total_videos || 0),
            total_enrollments: Number(course.total_enrollments || 0)
        }))
    });
}));

router.get('/instructor/courses', instructorWithSubscription, asyncHandler(async (req, res) => {
    const [rows] = await db.query(
        `SELECT
            c.id,
            c.title,
            c.category,
            c.description,
            c.cover_path,
            c.created_at,
            c.duration_days,
            c.duration_label,
            COUNT(DISTINCT cv.id) AS total_videos,
            COUNT(DISTINCT e.id) AS total_enrollments
         FROM courses c
         LEFT JOIN course_videos cv
           ON cv.course_id = c.id
          AND cv.organization_id = c.organization_id
         LEFT JOIN enrollments e
           ON e.course_id = c.id
          AND e.organization_id = c.organization_id
         WHERE c.organization_id = ?
           AND c.instructor_id = ?
         GROUP BY c.id
         ORDER BY c.created_at DESC, c.id DESC`,
        [req.organization.id, req.currentUser.id]
    );

    return res.json({
        courses: rows.map((row) => ({
            id: Number(row.id),
            title: row.title,
            category: row.category,
            description: row.description || '',
            cover_path: row.cover_path || DEFAULT_COURSE_COVER,
            created_at: row.created_at,
            duration_days: Number(row.duration_days || 90),
            duration_label: row.duration_label || 'Full course',
            total_videos: Number(row.total_videos || 0),
            total_enrollments: Number(row.total_enrollments || 0)
        }))
    });
}));

router.post('/instructor/courses', instructorWithSubscription, asyncHandler(async (req, res) => {
    const title = String(req.body.title || '').trim();
    const category = String(req.body.category || '').trim();
    const description = String(req.body.description || '').trim();
    const coverPath = String(req.body.coverPath || '').trim();
    const durationDays = toPositiveInt(req.body.durationDays) || 90;
    const durationOption = getDurationOption(durationDays);

    if (!title || !category) {
        return res.status(400).json({ error: 'title and category are required' });
    }

    const [result] = await db.query(
        `INSERT INTO courses (
            instructor_id,
            title,
            duration,
            duration_days,
            duration_label,
            cover_path,
            category,
            description,
            enrolled_students,
            created_at,
            expiry_date,
            organization_id
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), NULL, ?)`,
        [
            req.currentUser.id,
            title,
            `${durationOption.days} days`,
            durationOption.days,
            durationOption.planLabel,
            coverPath || DEFAULT_COURSE_COVER,
            category,
            description || null,
            req.organization.id
        ]
    );

    return res.status(201).json({
        message: 'Course created successfully',
        course_id: Number(result.insertId)
    });
}));

router.post('/instructor/upload-video', instructorWithSubscription, (req, res, next) => {
    videoUpload.single('video')(req, res, (error) => {
        if (error) {
            return next(error);
        }

        return next();
    });
}, asyncHandler(async (req, res) => {
    const courseId = toPositiveInt(req.body.courseId);
    const title = String(req.body.title || '').trim();
    const externalVideoUrl = String(req.body.videoUrl || '').trim();

    if (!courseId || !title) {
        if (req.file?.path) {
            await removeTempFile(req.file.path);
        }
        return res.status(400).json({ error: 'courseId and title are required' });
    }

    const [courseRows] = await db.query(
        `SELECT id, title
         FROM courses
         WHERE id = ?
           AND organization_id = ?
           AND instructor_id = ?
         LIMIT 1`,
        [courseId, req.organization.id, req.currentUser.id]
    );

    if (courseRows.length === 0) {
        if (req.file?.path) {
            await removeTempFile(req.file.path);
        }
        return res.status(404).json({ error: 'Course not found' });
    }

    if (!req.file && !externalVideoUrl) {
        return res.status(400).json({ error: 'Upload a video file or provide videoUrl' });
    }

    let videoPath = externalVideoUrl;
    if (req.file) {
        try {
            videoPath = await storeVideoAsset(req.file);
        } catch (error) {
            await removeTempFile(req.file.path);
            throw error;
        }
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [videoInsert] = await connection.query(
            `INSERT INTO course_videos (
                course_id,
                title,
                video_path,
                created_at,
                organization_id
             )
             VALUES (?, ?, ?, NOW(), ?)`,
            [courseId, title, videoPath, req.organization.id]
        );

        await connection.query(
            `INSERT INTO videos (
                course_id,
                title,
                video_url,
                created_at,
                organization_id
             )
             VALUES (?, ?, ?, NOW(), ?)`,
            [courseId, title, videoPath, req.organization.id]
        );

        const [recipientRows] = await connection.query(
            `SELECT DISTINCT u.id
             FROM users u
             INNER JOIN enrollments e
               ON e.student_email = u.email
              AND e.organization_id = u.organization_id
             WHERE u.organization_id = ?
               AND u.role = 'student'
               AND e.course_id = ?`,
            [req.organization.id, courseId]
        );

        const message = `New video added to ${courseRows[0].title}: ${title}`;
        await createNotifications(
            connection,
            req.organization.id,
            recipientRows.map((row) => row.id),
            message,
            'new_video'
        );

        await connection.commit();

        return res.status(201).json({
            message: 'Video uploaded successfully',
            video: {
                id: Number(videoInsert.insertId),
                course_id: courseId,
                title,
                video_path: videoPath
            }
        });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}));

router.get('/instructor/students', instructorWithSubscription, asyncHandler(async (req, res) => {
    const [rows] = await db.query(
        `SELECT
            u.id AS student_id,
            u.username AS student_name,
            u.email AS student_email,
            c.id AS course_id,
            c.title AS course_title,
            COUNT(DISTINCT cv.id) AS total_videos,
            COUNT(DISTINCT CASE WHEN p.is_watched = 1 THEN p.video_id END) AS watched_videos,
            COALESCE(MAX(cvw.total_time_spent), 0) AS total_time_spent
         FROM courses c
         INNER JOIN enrollments e
           ON e.course_id = c.id
          AND e.organization_id = c.organization_id
         INNER JOIN users u
           ON u.email = e.student_email
          AND u.organization_id = e.organization_id
          AND u.role = 'student'
         LEFT JOIN course_videos cv
           ON cv.course_id = c.id
          AND cv.organization_id = c.organization_id
         LEFT JOIN course_video_progress p
           ON p.video_id = cv.id
          AND p.student_email = u.email
          AND p.organization_id = c.organization_id
         LEFT JOIN course_views cvw
           ON cvw.course_id = c.id
          AND cvw.student_email = u.email
          AND cvw.organization_id = c.organization_id
         WHERE c.organization_id = ?
           AND c.instructor_id = ?
         GROUP BY u.id, c.id
         ORDER BY c.title ASC, u.username ASC`,
        [req.organization.id, req.currentUser.id]
    );

    return res.json({
        students: rows.map((row) => {
            const totalVideos = Number(row.total_videos || 0);
            const watchedVideos = Number(row.watched_videos || 0);
            return {
                student_id: Number(row.student_id),
                student_name: row.student_name,
                student_email: row.student_email,
                course_id: Number(row.course_id),
                course_title: row.course_title,
                total_videos: totalVideos,
                watched_videos: watchedVideos,
                progress_percentage: totalVideos > 0 ? Math.round((watchedVideos / totalVideos) * 100) : 0,
                total_time_spent: Number(row.total_time_spent || 0)
            };
        })
    });
}));

router.get('/instructor/students/progress', instructorWithSubscription, asyncHandler(async (req, res) => {
    const [rows] = await db.query(
        `SELECT
            u.id AS student_id,
            u.username AS student_name,
            u.email AS student_email,
            c.id AS course_id,
            c.title AS course_title,
            COUNT(DISTINCT cv.id) AS total_videos,
            COUNT(DISTINCT CASE WHEN p.is_watched = 1 THEN p.video_id END) AS watched_videos
         FROM courses c
         INNER JOIN enrollments e
           ON e.course_id = c.id
          AND e.organization_id = c.organization_id
         INNER JOIN users u
           ON u.email = e.student_email
          AND u.organization_id = e.organization_id
          AND u.role = 'student'
         LEFT JOIN course_videos cv
           ON cv.course_id = c.id
          AND cv.organization_id = c.organization_id
         LEFT JOIN course_video_progress p
           ON p.video_id = cv.id
          AND p.student_email = u.email
          AND p.organization_id = c.organization_id
         WHERE c.organization_id = ?
           AND c.instructor_id = ?
         GROUP BY u.id, c.id
         ORDER BY c.title ASC, u.username ASC`,
        [req.organization.id, req.currentUser.id]
    );

    return res.json({
        progress: rows.map((row) => {
            const totalVideos = Number(row.total_videos || 0);
            const watchedVideos = Number(row.watched_videos || 0);
            return {
                student_id: Number(row.student_id),
                student_name: row.student_name,
                student_email: row.student_email,
                course_id: Number(row.course_id),
                course_title: row.course_title,
                total_videos: totalVideos,
                watched_videos: watchedVideos,
                progress_percentage: totalVideos > 0 ? Math.round((watchedVideos / totalVideos) * 100) : 0
            };
        })
    });
}));

router.get('/instructor/messages', instructorWithSubscription, asyncHandler(async (req, res) => {
    const organizationId = req.organization.id;
    const instructorId = req.currentUser.id;

    const [[broadcastRows], [chatRows]] = await Promise.all([
        db.query(
            `SELECT id, title, content, priority, sent_count, created_at
             FROM messages
             WHERE organization_id = ?
               AND instructor_id = ?
             ORDER BY created_at DESC`,
            [organizationId, instructorId]
        ),
        db.query(
            `SELECT id, sender_id, sender_name, role, group_type, message_category, message, timestamp
             FROM group_messages
             WHERE organization_id = ?
               AND (group_type = 'instructors' OR sender_id = ?)
             ORDER BY timestamp DESC
             LIMIT 100`,
            [organizationId, instructorId]
        )
    ]);

    return res.json({
        broadcasts: broadcastRows.map((row) => ({
            id: Number(row.id),
            title: row.title,
            content: row.content,
            priority: row.priority,
            sent_count: Number(row.sent_count || 0),
            created_at: row.created_at
        })),
        chats: chatRows.reverse().map((row) => ({
            id: Number(row.id),
            sender_id: Number(row.sender_id),
            sender_name: row.sender_name,
            role: row.role,
            group_type: row.group_type,
            message_category: row.message_category,
            message: row.message,
            timestamp: row.timestamp
        }))
    });
}));

router.post('/instructor/messages', instructorWithSubscription, asyncHandler(async (req, res) => {
    const title = String(req.body.title || '').trim();
    const content = String(req.body.content || '').trim();
    const priority = String(req.body.priority || 'normal').trim().toLowerCase();
    const courseId = toPositiveInt(req.body.courseId);

    if (!title || !content) {
        return res.status(400).json({ error: 'title and content are required' });
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        let recipientQuery = `
            SELECT DISTINCT u.id
            FROM users u
            INNER JOIN enrollments e
              ON e.student_email = u.email
             AND e.organization_id = u.organization_id
            INNER JOIN courses c
              ON c.id = e.course_id
             AND c.organization_id = e.organization_id
            WHERE u.organization_id = ?
              AND u.role = 'student'
              AND c.instructor_id = ?
        `;
        const recipientParams = [req.organization.id, req.currentUser.id];

        if (courseId) {
            recipientQuery += ' AND c.id = ?';
            recipientParams.push(courseId);
        }

        const [recipientRows] = await connection.query(recipientQuery, recipientParams);
        const fullMessage = `[${priority.toUpperCase()}] ${title}: ${content}`;

        const sentCount = await createNotifications(
            connection,
            req.organization.id,
            recipientRows.map((row) => row.id),
            fullMessage,
            'instructor_message'
        );

        const [messageResult] = await connection.query(
            `INSERT INTO messages (
                instructor_id,
                title,
                content,
                priority,
                sent_count,
                created_at,
                organization_id
             )
             VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
            [req.currentUser.id, title, content, priority, sentCount, req.organization.id]
        );

        await connection.query(
            `INSERT INTO group_messages (
                sender_id,
                sender_name,
                role,
                group_type,
                message_category,
                message,
                timestamp,
                organization_id
             )
             VALUES (?, ?, 'instructor', 'students', 'instructor_message', ?, NOW(), ?)`,
            [req.currentUser.id, req.currentUser.username, fullMessage, req.organization.id]
        );

        await connection.commit();

        return res.status(201).json({
            message: 'Message sent successfully',
            message_id: Number(messageResult.insertId),
            sent_count: sentCount
        });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}));

router.post('/instructor/messages/chat', instructorWithSubscription, asyncHandler(async (req, res) => {
    const message = String(req.body.message || '').trim();
    const audience = String(req.body.audience || 'instructors').trim().toLowerCase();

    if (!message) {
        return res.status(400).json({ error: 'message is required' });
    }

    if (audience !== 'students' && audience !== 'instructors') {
        return res.status(400).json({ error: 'audience must be students or instructors' });
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [insertResult] = await connection.query(
            `INSERT INTO group_messages (
                sender_id,
                sender_name,
                role,
                group_type,
                message_category,
                message,
                timestamp,
                organization_id
             )
             VALUES (?, ?, 'instructor', ?, 'instructor_message', ?, NOW(), ?)`,
            [req.currentUser.id, req.currentUser.username, audience, message, req.organization.id]
        );

        let recipientIds = [];
        if (audience === 'instructors') {
            const [rows] = await connection.query(
                `SELECT id
                 FROM users
                 WHERE organization_id = ?
                   AND role = 'instructor'
                   AND id <> ?`,
                [req.organization.id, req.currentUser.id]
            );
            recipientIds = rows.map((row) => row.id);
        } else {
            const [rows] = await connection.query(
                `SELECT DISTINCT u.id
                 FROM users u
                 INNER JOIN enrollments e
                   ON e.student_email = u.email
                  AND e.organization_id = u.organization_id
                 INNER JOIN courses c
                   ON c.id = e.course_id
                  AND c.organization_id = e.organization_id
                 WHERE u.organization_id = ?
                   AND u.role = 'student'
                   AND c.instructor_id = ?`,
                [req.organization.id, req.currentUser.id]
            );
            recipientIds = rows.map((row) => row.id);
        }

        await createNotifications(
            connection,
            req.organization.id,
            recipientIds,
            message,
            'chat_message'
        );

        await connection.commit();

        return res.status(201).json({
            id: Number(insertResult.insertId),
            message: 'Chat message sent'
        });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}));

router.get('/student/dashboard', studentWithSubscription, asyncHandler(async (req, res) => {
    const catalog = await fetchStudentCourseCatalog(req.organization.id, req.currentUser.email);
    const enrolledCourses = catalog.filter((course) => course.is_enrolled);

    const [[messageRows], [notificationRows]] = await Promise.all([
        db.query(
            `SELECT COUNT(*) AS total_messages
             FROM group_messages
             WHERE organization_id = ?
               AND group_type = 'students'`,
            [req.organization.id]
        ),
        db.query(
            `SELECT COUNT(*) AS unread_notifications
             FROM notifications
             WHERE organization_id = ?
               AND user_id = ?
               AND is_read = 0`,
            [req.organization.id, req.currentUser.id]
        )
    ]);

    const averageProgress = enrolledCourses.length > 0
        ? Math.round(enrolledCourses.reduce((sum, course) => sum + course.progress_percentage, 0) / enrolledCourses.length)
        : 0;

    return res.json({
        metrics: {
            enrolled_courses: enrolledCourses.length,
            average_progress: averageProgress,
            new_messages: Number(messageRows[0].total_messages || 0),
            unread_notifications: Number(notificationRows[0].unread_notifications || 0)
        },
        enrolled_courses: enrolledCourses
    });
}));

router.get('/student/courses', studentWithSubscription, asyncHandler(async (req, res) => {
    const courses = await fetchStudentCourseCatalog(req.organization.id, req.currentUser.email);

    return res.json({
        courses
    });
}));

router.post('/student/enroll', studentWithSubscription, asyncHandler(async (req, res) => {
    const courseId = toPositiveInt(req.body.courseId);
    if (!courseId) {
        return res.status(400).json({ error: 'courseId is required' });
    }

    const [courseRows] = await db.query(
        `SELECT id
         FROM courses
         WHERE id = ?
           AND organization_id = ?
         LIMIT 1`,
        [courseId, req.organization.id]
    );

    if (courseRows.length === 0) {
        return res.status(404).json({ error: 'Course not found' });
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [existingRows] = await connection.query(
            `SELECT id
             FROM enrollments
             WHERE organization_id = ?
               AND course_id = ?
               AND student_email = ?
             LIMIT 1`,
            [req.organization.id, courseId, req.currentUser.email]
        );

        if (existingRows.length === 0) {
            await connection.query(
                `INSERT INTO enrollments (
                    student_email,
                    course_id,
                    created_at,
                    organization_id
                 )
                 VALUES (?, ?, NOW(), ?)`,
                [req.currentUser.email, courseId, req.organization.id]
            );

            await connection.query(
                `UPDATE courses
                 SET enrolled_students = enrolled_students + 1
                 WHERE id = ?
                   AND organization_id = ?`,
                [courseId, req.organization.id]
            );
        }

        await connection.commit();

        return res.status(existingRows.length === 0 ? 201 : 200).json({
            message: existingRows.length === 0 ? 'Enrolled successfully' : 'Already enrolled'
        });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}));

router.get('/student/progress', studentWithSubscription, asyncHandler(async (req, res) => {
    const courses = await fetchStudentCourseCatalog(req.organization.id, req.currentUser.email);

    return res.json({
        progress: courses.filter((course) => course.is_enrolled)
    });
}));

router.post('/student/progress', studentWithSubscription, asyncHandler(async (req, res) => {
    const videoId = toPositiveInt(req.body.videoId);
    const watched = req.body.watched === undefined ? true : Boolean(req.body.watched);
    const timeSpent = Math.max(0, Number(req.body.timeSpent || 0));

    if (!videoId) {
        return res.status(400).json({ error: 'videoId is required' });
    }

    const [videoRows] = await db.query(
        `SELECT cv.id, cv.course_id
         FROM course_videos cv
         INNER JOIN courses c
           ON c.id = cv.course_id
          AND c.organization_id = cv.organization_id
         WHERE cv.id = ?
           AND cv.organization_id = ?
         LIMIT 1`,
        [videoId, req.organization.id]
    );

    if (videoRows.length === 0) {
        return res.status(404).json({ error: 'Video not found' });
    }

    const courseId = Number(videoRows[0].course_id);

    const [enrollmentRows] = await db.query(
        `SELECT id
         FROM enrollments
         WHERE organization_id = ?
           AND course_id = ?
           AND student_email = ?
         LIMIT 1`,
        [req.organization.id, courseId, req.currentUser.email]
    );

    if (enrollmentRows.length === 0) {
        return res.status(403).json({ error: 'Enroll in the course before tracking progress' });
    }

    await db.query(
        `INSERT INTO course_video_progress (
            student_email,
            video_id,
            is_watched,
            updated_at,
            created_at,
            organization_id
         )
         VALUES (?, ?, ?, NOW(), NOW(), ?)
         ON DUPLICATE KEY UPDATE
            is_watched = VALUES(is_watched),
            updated_at = NOW(),
            organization_id = VALUES(organization_id)`,
        [req.currentUser.email, videoId, watched ? 1 : 0, req.organization.id]
    );

    await db.query(
        `INSERT INTO course_views (
            student_email,
            course_id,
            total_time_spent,
            last_viewed,
            created_at,
            organization_id
         )
         VALUES (?, ?, ?, NOW(), NOW(), ?)
         ON DUPLICATE KEY UPDATE
            total_time_spent = total_time_spent + VALUES(total_time_spent),
            last_viewed = NOW(),
            organization_id = VALUES(organization_id)`,
        [req.currentUser.email, courseId, timeSpent, req.organization.id]
    );

    return res.json({
        message: 'Progress updated successfully'
    });
}));

router.get('/student/watch-video', studentWithSubscription, asyncHandler(async (req, res) => {
    const courseId = toPositiveInt(req.query.courseId);
    if (!courseId) {
        return res.status(400).json({ error: 'courseId is required' });
    }

    const [courseRows] = await db.query(
        `SELECT
            c.id,
            c.title,
            c.category,
            c.description,
            c.cover_path,
            u.username AS instructor_name
         FROM courses c
         INNER JOIN users u
           ON u.id = c.instructor_id
          AND u.organization_id = c.organization_id
         WHERE c.id = ?
           AND c.organization_id = ?
         LIMIT 1`,
        [courseId, req.organization.id]
    );

    if (courseRows.length === 0) {
        return res.status(404).json({ error: 'Course not found' });
    }

    const [enrollmentRows] = await db.query(
        `SELECT id
         FROM enrollments
         WHERE organization_id = ?
           AND course_id = ?
           AND student_email = ?
         LIMIT 1`,
        [req.organization.id, courseId, req.currentUser.email]
    );

    if (enrollmentRows.length === 0) {
        return res.status(403).json({ error: 'You are not enrolled in this course' });
    }

    const [videoRows] = await db.query(
        `SELECT
            cv.id,
            cv.title,
            cv.video_path,
            cv.created_at,
            COALESCE(p.is_watched, 0) AS is_watched,
            p.updated_at
         FROM course_videos cv
         LEFT JOIN course_video_progress p
           ON p.video_id = cv.id
          AND p.student_email = ?
          AND p.organization_id = cv.organization_id
         WHERE cv.organization_id = ?
           AND cv.course_id = ?
         ORDER BY cv.created_at ASC, cv.id ASC`,
        [req.currentUser.email, req.organization.id, courseId]
    );

    return res.json({
        course: {
            id: Number(courseRows[0].id),
            title: courseRows[0].title,
            category: courseRows[0].category,
            description: courseRows[0].description || '',
            cover_path: courseRows[0].cover_path || DEFAULT_COURSE_COVER,
            instructor_name: courseRows[0].instructor_name
        },
        videos: videoRows.map((video) => ({
            id: Number(video.id),
            title: video.title,
            video_path: video.video_path,
            created_at: video.created_at,
            is_watched: Boolean(Number(video.is_watched || 0)),
            updated_at: video.updated_at
        }))
    });
}));

router.get('/student/messages', studentWithSubscription, asyncHandler(async (req, res) => {
    const [rows] = await db.query(
        `SELECT id, sender_id, sender_name, role, group_type, message_category, message, timestamp
         FROM group_messages
         WHERE organization_id = ?
           AND (group_type = 'students' OR sender_id = ?)
         ORDER BY timestamp DESC
         LIMIT 100`,
        [req.organization.id, req.currentUser.id]
    );

    return res.json({
        messages: rows.reverse().map((row) => ({
            id: Number(row.id),
            sender_id: Number(row.sender_id),
            sender_name: row.sender_name,
            role: row.role,
            group_type: row.group_type,
            message_category: row.message_category,
            message: row.message,
            timestamp: row.timestamp
        }))
    });
}));

router.post('/student/messages', studentWithSubscription, asyncHandler(async (req, res) => {
    const message = String(req.body.message || '').trim();
    if (!message) {
        return res.status(400).json({ error: 'message is required' });
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [insertResult] = await connection.query(
            `INSERT INTO group_messages (
                sender_id,
                sender_name,
                role,
                group_type,
                message_category,
                message,
                timestamp,
                organization_id
             )
             VALUES (?, ?, 'student', 'instructors', 'instructor_message', ?, NOW(), ?)`,
            [req.currentUser.id, req.currentUser.username, message, req.organization.id]
        );

        const [instructorRows] = await connection.query(
            `SELECT DISTINCT u.id
             FROM users u
             INNER JOIN courses c
               ON c.instructor_id = u.id
              AND c.organization_id = u.organization_id
             INNER JOIN enrollments e
               ON e.course_id = c.id
              AND e.organization_id = c.organization_id
             WHERE u.organization_id = ?
               AND u.role = 'instructor'
               AND e.student_email = ?`,
            [req.organization.id, req.currentUser.email]
        );

        await createNotifications(
            connection,
            req.organization.id,
            instructorRows.map((row) => row.id),
            message,
            'student_message'
        );

        await connection.commit();

        return res.status(201).json({
            id: Number(insertResult.insertId),
            message: 'Message sent successfully'
        });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}));

router.get('/student/notifications', studentWithSubscription, asyncHandler(async (req, res) => {
    const [rows] = await db.query(
        `SELECT id, message, type, is_read, created_at
         FROM notifications
         WHERE organization_id = ?
           AND user_id = ?
         ORDER BY created_at DESC`,
        [req.organization.id, req.currentUser.id]
    );

    return res.json({
        notifications: rows.map((row) => ({
            id: Number(row.id),
            message: row.message,
            type: row.type,
            is_read: Boolean(Number(row.is_read || 0)),
            created_at: row.created_at
        }))
    });
}));

router.post('/student/notifications/:notificationId/read', studentWithSubscription, asyncHandler(async (req, res) => {
    const notificationId = toPositiveInt(req.params.notificationId);
    if (!notificationId) {
        return res.status(400).json({ error: 'notificationId is required' });
    }

    await db.query(
        `UPDATE notifications
         SET is_read = 1
         WHERE id = ?
           AND user_id = ?
           AND organization_id = ?`,
        [notificationId, req.currentUser.id, req.organization.id]
    );

    return res.json({
        message: 'Notification marked as read'
    });
}));

module.exports = router;
