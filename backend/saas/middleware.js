const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'skillboostacademy-tenant-secret';

function signToken(user) {
    return jwt.sign(
        {
            id: Number(user.id),
            role: user.role,
            organization_id: Number(user.organization_id)
        },
        JWT_SECRET,
        { expiresIn: '12h' }
    );
}

function authMiddleware(req, res, next) {
    const authorization = String(req.headers.authorization || '').trim();
    if (!authorization.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authorization.slice('Bearer '.length).trim();
    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        return next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

function roleMiddleware(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user?.role || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        return next();
    };
}

async function organizationFilterMiddleware(req, res, next) {
    if (!req.user?.organization_id || !req.user?.id) {
        return res.status(403).json({ error: 'Organization context is missing' });
    }

    try {
        const [rows] = await db.query(
            `SELECT
                o.id AS organization_id,
                o.college_name,
                o.access_code,
                o.student_limit,
                o.instructor_limit,
                o.subscription_status,
                o.expiry_date,
                o.created_at AS organization_created_at,
                u.id AS user_id,
                u.username,
                u.email,
                u.phone,
                u.role,
                u.expertise,
                u.branch,
                u.profile_photo,
                u.created_at AS user_created_at
             FROM organizations o
             INNER JOIN users u
               ON u.id = ?
              AND u.organization_id = o.id
             WHERE o.id = ?
             LIMIT 1`,
            [req.user.id, req.user.organization_id]
        );

        if (rows.length === 0) {
            return res.status(403).json({ error: 'Organization access denied' });
        }

        const row = rows[0];
        req.organization = {
            id: Number(row.organization_id),
            college_name: row.college_name,
            access_code: row.access_code,
            student_limit: row.student_limit === null ? null : Number(row.student_limit),
            instructor_limit: row.instructor_limit === null ? null : Number(row.instructor_limit),
            subscription_status: row.subscription_status,
            expiry_date: row.expiry_date,
            created_at: row.organization_created_at
        };
        req.currentUser = {
            id: Number(row.user_id),
            username: row.username,
            email: row.email,
            phone: row.phone,
            role: row.role,
            expertise: row.expertise,
            branch: row.branch,
            profile_photo: row.profile_photo,
            created_at: row.user_created_at,
            organization_id: Number(row.organization_id)
        };

        return next();
    } catch (error) {
        return next(error);
    }
}

function isSubscriptionExpired(organization) {
    if (!organization || organization.subscription_status !== 'active' || !organization.expiry_date) {
        return true;
    }

    const expiryDate = new Date(organization.expiry_date);
    if (Number.isNaN(expiryDate.getTime())) {
        return true;
    }

    expiryDate.setHours(23, 59, 59, 999);
    return expiryDate.getTime() < Date.now();
}

function subscriptionMiddleware() {
    return (req, res, next) => {
        if (isSubscriptionExpired(req.organization)) {
            return res.status(403).json({ error: 'Subscription expired' });
        }

        return next();
    };
}

module.exports = {
    authMiddleware,
    roleMiddleware,
    organizationFilterMiddleware,
    subscriptionMiddleware,
    signToken,
    isSubscriptionExpired
};
