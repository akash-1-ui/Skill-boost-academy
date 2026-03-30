const fs = require('fs');

let cloudinaryModule = null;
let cloudinaryError = null;

try {
    cloudinaryModule = require('cloudinary').v2;
} catch (error) {
    cloudinaryError = error;
}

const CLOUDINARY_CONFIG = {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
    api_key: process.env.CLOUDINARY_API_KEY || '',
    api_secret: process.env.CLOUDINARY_API_SECRET || ''
};

if (cloudinaryModule && CLOUDINARY_CONFIG.cloud_name && CLOUDINARY_CONFIG.api_key && CLOUDINARY_CONFIG.api_secret) {
    cloudinaryModule.config(CLOUDINARY_CONFIG);
}

function getCloudinaryStatus() {
    if (!cloudinaryModule) {
        return {
            ready: false,
            reason: cloudinaryError ? cloudinaryError.message : 'cloudinary package is not installed'
        };
    }

    if (!CLOUDINARY_CONFIG.cloud_name || !CLOUDINARY_CONFIG.api_key || !CLOUDINARY_CONFIG.api_secret) {
        return {
            ready: false,
            reason: 'Cloudinary environment variables are not configured'
        };
    }

    return {
        ready: true,
        reason: ''
    };
}

function isCloudinaryReady() {
    return getCloudinaryStatus().ready;
}

async function removeTemporaryFile(filePath) {
    if (!filePath) {
        return;
    }

    try {
        await fs.promises.unlink(filePath);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Failed to remove temporary upload:', filePath, error);
        }
    }
}

async function uploadVideoAsset(filePath, options = {}) {
    const status = getCloudinaryStatus();
    if (!status.ready) {
        if (options.removeLocalFile !== false) {
            await removeTemporaryFile(filePath);
        }
        throw new Error(`Cloudinary upload is unavailable: ${status.reason}`);
    }

    try {
        const result = await cloudinaryModule.uploader.upload(filePath, {
            resource_type: 'video',
            folder: options.folder || process.env.CLOUDINARY_VIDEO_FOLDER || 'skillboost/courses',
            use_filename: true,
            unique_filename: true,
            overwrite: false
        });

        return result;
    } finally {
        if (options.removeLocalFile !== false) {
            await removeTemporaryFile(filePath);
        }
    }
}

function extractCloudinaryPublicId(videoUrl) {
    if (!videoUrl || typeof videoUrl !== 'string' || !videoUrl.includes('res.cloudinary.com')) {
        return null;
    }

    try {
        const parsedUrl = new URL(videoUrl);
        const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
        const uploadIndex = pathSegments.indexOf('upload');

        if (uploadIndex === -1 || uploadIndex === pathSegments.length - 1) {
            return null;
        }

        const afterUpload = pathSegments.slice(uploadIndex + 1);
        const versionIndex = afterUpload.findIndex((segment) => /^v\d+$/.test(segment));
        const publicIdSegments = versionIndex >= 0 ? afterUpload.slice(versionIndex + 1) : afterUpload;

        if (publicIdSegments.length === 0) {
            return null;
        }

        const lastSegment = publicIdSegments[publicIdSegments.length - 1];
        publicIdSegments[publicIdSegments.length - 1] = lastSegment.replace(/\.[^.]+$/, '');

        return publicIdSegments.join('/');
    } catch (error) {
        return null;
    }
}

async function deleteVideoAssetByUrl(videoUrl) {
    if (!videoUrl) {
        return { result: 'skipped' };
    }

    const publicId = extractCloudinaryPublicId(videoUrl);
    if (!publicId) {
        return { result: 'skipped' };
    }

    const status = getCloudinaryStatus();
    if (!status.ready) {
        return { result: 'skipped', reason: status.reason };
    }

    return cloudinaryModule.uploader.destroy(publicId, {
        resource_type: 'video',
        invalidate: true
    });
}

module.exports = {
    getCloudinaryStatus,
    isCloudinaryReady,
    uploadVideoAsset,
    deleteVideoAssetByUrl,
    extractCloudinaryPublicId
};
