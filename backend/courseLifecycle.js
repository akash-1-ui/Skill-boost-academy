const COURSE_DURATION_OPTIONS = [
    { days: 30, optionLabel: '30 days', planLabel: 'Short course' },
    { days: 60, optionLabel: '60 days', planLabel: 'Medium course' },
    { days: 90, optionLabel: '90 days', planLabel: 'Full course' },
    { days: 180, optionLabel: '180 days', planLabel: 'Advanced course' }
];

const DEFAULT_COURSE_DURATION_DAYS = 90;
const WARNING_WINDOW_MS = 24 * 60 * 60 * 1000;

function getDurationOption(value) {
    const numericValue = Number(value);
    if (!Number.isInteger(numericValue)) {
        return COURSE_DURATION_OPTIONS.find((option) => option.days === DEFAULT_COURSE_DURATION_DAYS);
    }

    return COURSE_DURATION_OPTIONS.find((option) => option.days === numericValue) ||
        COURSE_DURATION_OPTIONS.find((option) => option.days === DEFAULT_COURSE_DURATION_DAYS);
}

function calculateExpiryDate(createdAt, durationDays) {
    const startDate = createdAt ? new Date(createdAt) : new Date();
    const option = getDurationOption(durationDays);
    const expiryDate = new Date(startDate.getTime());
    expiryDate.setDate(expiryDate.getDate() + option.days);
    return expiryDate;
}

function getCourseLifecycleStatus(expiryDate, now = new Date()) {
    if (!expiryDate) {
        return 'Active';
    }

    const expiry = new Date(expiryDate);
    if (Number.isNaN(expiry.getTime())) {
        return 'Active';
    }

    const remaining = expiry.getTime() - now.getTime();
    if (remaining <= 0) {
        return 'Expired';
    }

    if (remaining <= WARNING_WINDOW_MS) {
        return 'Expiring Soon';
    }

    return 'Active';
}

function getDaysRemaining(expiryDate, now = new Date()) {
    if (!expiryDate) {
        return null;
    }

    const expiry = new Date(expiryDate);
    if (Number.isNaN(expiry.getTime())) {
        return null;
    }

    return Math.max(0, Math.ceil((expiry.getTime() - now.getTime()) / WARNING_WINDOW_MS));
}

function isCourseActive(expiryDate, now = new Date()) {
    return getCourseLifecycleStatus(expiryDate, now) !== 'Expired';
}

module.exports = {
    COURSE_DURATION_OPTIONS,
    DEFAULT_COURSE_DURATION_DAYS,
    getDurationOption,
    calculateExpiryDate,
    getCourseLifecycleStatus,
    getDaysRemaining,
    isCourseActive
};
