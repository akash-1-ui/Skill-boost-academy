const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

export async function apiRequest(path, options = {}) {
    const {
        method = 'GET',
        token,
        body,
        isForm = false
    } = options;

    const headers = {};
    if (!isForm) {
        headers['Content-Type'] = 'application/json';
    }
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body))
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        const error = new Error(payload.error || 'Request failed');
        error.status = response.status;
        error.payload = payload;
        throw error;
    }

    return payload;
}
