require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const db = require('./db');
const bcrypt = require('bcrypt');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;
const DEFAULT_PROFILE_PHOTO = '/uploads/default-avatar.svg';
const RESET_OTP_EXPIRY_MINUTES = Number(process.env.RESET_OTP_EXPIRY_MINUTES || 10);
const RESET_OTP_RESEND_SECONDS = Number(process.env.RESET_OTP_RESEND_SECONDS || 60);
const RESET_OTP_MAX_ATTEMPTS = Number(process.env.RESET_OTP_MAX_ATTEMPTS || 5);

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

try {
    fs.mkdirSync(path.join(__dirname, 'videos'), { recursive: true });
    fs.mkdirSync(path.join(__dirname, 'uploads', 'covers'), { recursive: true });
    console.log('Upload directories created/verified');
} catch (err) {
    console.error('Error creating upload directories:', err);
}

const storage = multer.diskStorage({
    destination(req, file, cb) {
        const destination = file.fieldname === 'video'
            ? path.join(__dirname, 'videos')
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

function asPositiveInt(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
        return null;
    }
    return n;
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
    return {
        id: course.id,
        instructor_id: course.instructor_id,
        title: course.title,
        duration: course.duration,
        category: course.category,
        difficulty: course.difficulty,
        description: course.description || '',
        enrolled_students: Number(course.enrolled_students || 0),
        created_at: course.created_at,
        cover_path: course.cover_path || null,
        video_path: course.video_path || null,
        // Keep aliases for existing frontend code.
        cover: course.cover_path || null,
        video: course.video_path || null
    };
}

async function ensureColumnExists(tableName, columnName, definitionSql) {
    const [columns] = await db.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName]);
    if (columns.length === 0) {
        await db.query(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
        console.log(`Added ${columnName} column to ${tableName}`);
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

async function initializeTables() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS courses (
            id INT PRIMARY KEY AUTO_INCREMENT,
            instructor_id INT NOT NULL,
            title VARCHAR(255) NOT NULL,
            duration VARCHAR(50),
            cover_path TEXT NOT NULL,
            video_path TEXT NULL,
            category VARCHAR(100) NOT NULL,
            difficulty VARCHAR(50) NOT NULL,
            description TEXT,
            enrolled_students INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (instructor_id) REFERENCES users(id)
        )
    `);

    await ensureColumnExists('courses', 'duration', 'duration VARCHAR(50) AFTER title');
    await ensureColumnExists('courses', 'cover_path', 'cover_path TEXT NOT NULL');
    await ensureColumnExists('courses', 'video_path', 'video_path TEXT NULL');
    await ensureColumnNullable('courses', 'video_path', 'TEXT');
    await ensureColumnExists('courses', 'category', 'category VARCHAR(100) NOT NULL');
    await ensureColumnExists('courses', 'difficulty', 'difficulty VARCHAR(50) NOT NULL');
    await ensureColumnExists('courses', 'description', 'description TEXT');
    await ensureColumnExists('courses', 'enrolled_students', 'enrolled_students INT DEFAULT 0');

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

initializeTables().catch((err) => {
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

async function deleteInstructorCourses(instructorId) {
    const [courses] = await db.query(
        'SELECT id, cover_path, video_path FROM courses WHERE instructor_id = ?',
        [instructorId]
    );

    if (courses.length === 0) {
        return 0;
    }

    const courseIds = courses.map((course) => course.id);

    await db.query('DELETE FROM enrollments WHERE course_id IN (?)', [courseIds]);
    await db.query('DELETE FROM course_views WHERE course_id IN (?)', [courseIds]);
    const [videoRows] = await db.query(
        'SELECT id, video_path FROM course_videos WHERE course_id IN (?)',
        [courseIds]
    );
    const videoIds = videoRows.map((video) => video.id);
    if (videoIds.length > 0) {
        await db.query('DELETE FROM course_video_progress WHERE video_id IN (?)', [videoIds]);
    }
    await db.query('DELETE FROM course_videos WHERE course_id IN (?)', [courseIds]);
    await db.query('DELETE FROM courses WHERE id IN (?)', [courseIds]);

    for (const course of courses) {
        await deleteStoredFile(course.cover_path);
        await deleteStoredFile(course.video_path);
    }
    for (const video of videoRows) {
        await deleteStoredFile(video.video_path);
    }

    return courseIds.length;
}

app.get('/api/test', (req, res) => {
    res.json({ message: 'Server is working!' });
});

app.get('/api/courses', async (req, res) => {
    try {
        const studentEmail = (req.query.studentEmail || '').toString().trim();

        if (studentEmail) {
            const [courses] = await db.query(
                `SELECT
                    c.*,
                    COUNT(DISTINCT cv.id) AS video_count,
                    COUNT(DISTINCT CASE WHEN p.is_watched = 1 THEN p.video_id END) AS watched_count
                 FROM courses c
                 LEFT JOIN course_videos cv ON cv.course_id = c.id
                 LEFT JOIN course_video_progress p
                   ON p.video_id = cv.id AND p.student_email = ?
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

        const [courses] = await db.query('SELECT * FROM courses ORDER BY created_at DESC');
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
        return res.json(normalizeCourse(rows[0]));
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
            'SELECT * FROM courses WHERE instructor_id = ? ORDER BY created_at DESC',
            [instructorId]
        );
        return res.json(courses.map(normalizeCourse));
    } catch (error) {
        console.error('Error fetching instructor courses:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/course-videos/:courseId', async (req, res) => {
    const courseId = asPositiveInt(req.params.courseId);
    if (!courseId) {
        return res.status(400).json({ error: 'Invalid course ID' });
    }

    try {
        const studentEmail = (req.query.studentEmail || '').toString().trim();
        const [courseRows] = await db.query(
            'SELECT id, title, video_path FROM courses WHERE id = ?',
            [courseId]
        );

        if (courseRows.length === 0) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const course = courseRows[0];
        const [videos] = studentEmail
            ? await db.query(
                `SELECT
                    cv.id,
                    cv.title,
                    cv.video_path,
                    cv.created_at,
                    COALESCE(p.is_watched, 0) AS is_watched
                 FROM course_videos cv
                 LEFT JOIN course_video_progress p
                   ON p.video_id = cv.id AND p.student_email = ?
                 WHERE cv.course_id = ?
                 ORDER BY cv.created_at ASC`,
                [studentEmail, courseId]
            )
            : await db.query(
                `SELECT id, title, video_path, created_at
                 FROM course_videos
                 WHERE course_id = ?
                 ORDER BY created_at ASC`,
                [courseId]
            );

        const items = videos.map((video) => ({
            id: video.id,
            course_id: courseId,
            title: video.title,
            video_path: video.video_path,
            video: video.video_path,
            created_at: video.created_at,
            is_watched: Number(video.is_watched || 0)
        }));

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

app.post('/api/course-videos', upload.single('video'), async (req, res) => {
    try {
        const courseId = asPositiveInt(req.body.course_id);
        const instructorId = asPositiveInt(req.body.instructor_id);
        const title = (req.body.title || '').toString().trim() || 'Lesson Video';

        if (!courseId) {
            return res.status(400).json({ error: 'Valid course_id is required' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'Video file is required' });
        }

        const [courseRows] = await db.query(
            'SELECT id, instructor_id FROM courses WHERE id = ?',
            [courseId]
        );

        if (courseRows.length === 0) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const course = courseRows[0];
        if (instructorId && Number(course.instructor_id) !== Number(instructorId)) {
            return res.status(403).json({ error: 'You can only upload videos to your own courses' });
        }

        const videoPath = `/videos/${path.basename(req.file.path)}`;
        const [result] = await db.query(
            `INSERT INTO course_videos (course_id, title, video_path, created_at)
             VALUES (?, ?, ?, NOW())`,
            [courseId, title, videoPath]
        );

        return res.status(201).json({
            message: 'Video uploaded successfully',
            video: {
                id: result.insertId,
                course_id: courseId,
                title,
                video_path: videoPath,
                video: videoPath
            }
        });
    } catch (error) {
        console.error('Course video upload error:', error);
        return res.status(500).json({ error: 'Failed to upload video' });
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
            `SELECT cv.id, cv.title, cv.video_path, c.instructor_id
             FROM course_videos cv
             INNER JOIN courses c ON c.id = cv.course_id
             WHERE cv.id = ?`,
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
        const updatedPath = hasNewVideo ? `/videos/${path.basename(req.file.path)}` : existing.video_path;

        await db.query(
            'UPDATE course_videos SET title = ?, video_path = ? WHERE id = ?',
            [updatedTitle, updatedPath, videoId]
        );

        if (hasNewVideo && existing.video_path && existing.video_path !== updatedPath) {
            await deleteStoredFile(existing.video_path);
        }

        return res.json({
            message: 'Video updated successfully',
            video: {
                id: videoId,
                title: updatedTitle,
                video_path: updatedPath,
                video: updatedPath
            }
        });
    } catch (error) {
        console.error('Course video update error:', error);
        return res.status(500).json({ error: 'Failed to update video' });
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
            `SELECT cv.id, cv.video_path, c.instructor_id
             FROM course_videos cv
             INNER JOIN courses c ON c.id = cv.course_id
             WHERE cv.id = ?`,
            [videoId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Video not found' });
        }

        const existing = rows[0];
        if (Number(existing.instructor_id) !== Number(instructorId)) {
            return res.status(403).json({ error: 'You can only delete your own course videos' });
        }

        await db.query('DELETE FROM course_video_progress WHERE video_id = ?', [videoId]);
        await db.query('DELETE FROM course_videos WHERE id = ?', [videoId]);

        await deleteStoredFile(existing.video_path);

        return res.json({ message: 'Video deleted successfully' });
    } catch (error) {
        console.error('Course video delete error:', error);
        return res.status(500).json({ error: 'Failed to delete video' });
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

app.delete('/api/courses/:courseId', async (req, res) => {
    const courseId = asPositiveInt(req.params.courseId);
    if (!courseId) {
        return res.status(400).json({ error: 'Invalid course ID' });
    }

    try {
        const [existingRows] = await db.query(
            'SELECT id, cover_path, video_path FROM courses WHERE id = ?',
            [courseId]
        );

        if (existingRows.length === 0) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const existingCourse = existingRows[0];

        await db.query('DELETE FROM enrollments WHERE course_id = ?', [courseId]);
        await db.query('DELETE FROM course_views WHERE course_id = ?', [courseId]);
        const [videoRows] = await db.query(
            'SELECT id, video_path FROM course_videos WHERE course_id = ?',
            [courseId]
        );
        const videoIds = videoRows.map((video) => video.id);
        if (videoIds.length > 0) {
            await db.query('DELETE FROM course_video_progress WHERE video_id IN (?)', [videoIds]);
        }
        await db.query('DELETE FROM course_videos WHERE course_id = ?', [courseId]);
        await db.query('DELETE FROM courses WHERE id = ?', [courseId]);

        await deleteStoredFile(existingCourse.cover_path);
        await deleteStoredFile(existingCourse.video_path);
        for (const video of videoRows) {
            await deleteStoredFile(video.video_path);
        }

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
        const { title, duration, category, difficulty, description, instructor_id } = req.body;
        const instructorId = asPositiveInt(instructor_id);

        if (!courseId) {
            return res.status(400).json({ error: 'Invalid course ID' });
        }

        if (!title || !duration || !category || !difficulty || !description || !instructorId) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const [rows] = await db.query(
            'SELECT id, instructor_id, cover_path FROM courses WHERE id = ?',
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

        await db.query(
            `UPDATE courses
             SET title = ?, duration = ?, category = ?, difficulty = ?, description = ?, cover_path = ?
             WHERE id = ?`,
            [title, duration, category, difficulty, description, coverPath, courseId]
        );

        if (coverPath !== existingCourse.cover_path) {
            await deleteStoredFile(existingCourse.cover_path);
        }

        return res.json({ message: 'Course updated successfully', courseId });
    } catch (error) {
        console.error('Error updating course:', error);
        return res.status(500).json({ error: 'Failed to update course' });
    }
});

app.post('/submit-course', upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'cover', maxCount: 1 }
]), async (req, res) => {
    try {
        if (!req.files || !req.files.cover) {
            return res.status(400).json({ error: 'Cover file is required' });
        }

        const { title, duration, category, difficulty, description, instructor_id } = req.body;
        const instructorId = asPositiveInt(instructor_id);

        if (!title || !duration || !category || !difficulty || !description || !instructorId) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const hasVideo = req.files.video && req.files.video[0];
        const videoPath = hasVideo ? `/videos/${path.basename(req.files.video[0].path)}` : null;
        const coverPath = `/uploads/covers/${path.basename(req.files.cover[0].path)}`;

        const [result] = await db.query(
            `INSERT INTO courses (
                instructor_id,
                title,
                duration,
                cover_path,
                video_path,
                category,
                difficulty,
                description,
                enrolled_students,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NOW())`,
              [instructorId, title, duration, coverPath, videoPath, category, difficulty, description]
        );

        if (videoPath) {
            await db.query(
                `INSERT INTO course_videos (course_id, title, video_path, created_at)
                 VALUES (?, ?, ?, NOW())`,
                [result.insertId, `${title} - Main Video`, videoPath]
            );
        }

        return res.status(201).json({
            message: 'Course created successfully',
            courseId: result.insertId
        });
    } catch (error) {
        console.error('Error uploading course:', error);
        return res.status(500).json({
            error: 'Failed to upload course',
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
            `SELECT username AS name, email, branch, profile_photo
             FROM users
             WHERE email = ? AND role = 'student'`,
            [email]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }

        const student = rows[0];
        return res.json({
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

        const [courses] = await db.query('SELECT id FROM courses WHERE id = ?', [numericCourseId]);
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
                c.difficulty,
                c.enrolled_students,
                cv.total_time_spent,
                cv.last_viewed,
                u.username AS instructor_name
             FROM course_views cv
             INNER JOIN courses c ON c.id = cv.course_id
             LEFT JOIN users u ON u.id = c.instructor_id
             WHERE cv.student_email = ?
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
                COUNT(DISTINCT cv.id) AS video_count,
                COUNT(DISTINCT cvw.id) AS watch_record_count
             FROM courses c
             LEFT JOIN course_videos cv ON cv.course_id = c.id
             LEFT JOIN course_views cvw ON cvw.course_id = c.id
             WHERE c.instructor_id = ?
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

        const [watchSummaryRows] = await db.query(
            `SELECT COALESCE(SUM(cv.total_time_spent), 0) AS totalWatchSeconds
             FROM course_views cv
             INNER JOIN courses c ON c.id = cv.course_id
             WHERE c.instructor_id = ?`,
            [instructorId]
        );

        const totalWatchSeconds = Number(watchSummaryRows[0].totalWatchSeconds || 0);

        const [topWatchedRows] = await db.query(
            `SELECT
                c.id,
                c.title,
                c.category,
                c.difficulty,
                c.enrolled_students,
                COALESCE(SUM(cv.total_time_spent), 0) AS totalWatchSeconds,
                COUNT(cv.id) AS watchRecords
             FROM courses c
             LEFT JOIN course_views cv ON cv.course_id = c.id
             WHERE c.instructor_id = ?
             GROUP BY c.id, c.title, c.category, c.difficulty, c.enrolled_students
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
                zeroEnrollmentCourses,
                latestUpload,
                totalWatchSeconds,
                totalWatchHours: formatWatchHoursFromSeconds(totalWatchSeconds)
            },
            topCourse: topCourse ? {
                id: topCourse.id,
                title: topCourse.title,
                enrolled_students: Number(topCourse.enrolled_students || 0),
                category: topCourse.category,
                difficulty: topCourse.difficulty
            } : null,
            topWatchedCourses: topWatchedRows.map((row) => ({
                id: row.id,
                title: row.title,
                category: row.category,
                difficulty: row.difficulty,
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
             WHERE instructor_id = ?`,
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
        message: err.message
    });
});

app.use((req, res, next) => {
    const wantsJson = (req.headers.accept && req.headers.accept.includes('application/json')) ||
        req.path.startsWith('/api') ||
        req.path === '/submit-course';

    if (wantsJson) {
        return res.status(404).json({ error: 'Not found' });
    }

    return next();
});

app.listen(port, () => {
    console.log(`Backend server listening on http://localhost:${port}`);
});
