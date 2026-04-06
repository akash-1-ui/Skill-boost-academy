const ACCESS_SESSION_STORAGE_KEY = 'skillboost-access-owner-session';
const PAYMENT_PENDING_STORAGE_KEY = 'skillboost-payment-pending';
const APP_ORIGIN = 'http://localhost:3000';
const ACCESS_API_BASE = `${APP_ORIGIN}/api/access`;

const FALLBACK_PLAN_CATALOG = {
    1: {
        name: 'Basic',
        description: 'Starter access for smaller academies that need a compact seat limit.',
        max_instructors: 1,
        max_students: 10
    },
    2: {
        name: 'Pro',
        description: 'Balanced growth plan for academies adding more instructors and student seats.',
        max_instructors: 10,
        max_students: 200
    },
    3: {
        name: 'Advanced',
        description: 'Higher-capacity plan for larger academies with more active enrollments.',
        max_instructors: 25,
        max_students: 1000
    }
};

let accessSession = null;
let paymentContext = null;
let paymentGatewayReady = true;

document.addEventListener('DOMContentLoaded', async () => {
    accessSession = readStoredJson(ACCESS_SESSION_STORAGE_KEY);

    if (!accessSession?.token) {
        showPaymentNotice('Your owner session is missing. Redirecting to the access page...', 'warning');
        window.setTimeout(() => {
            window.location.href = 'access.html';
        }, 1400);
        return;
    }

    paymentContext = resolvePaymentContext();

    if (!paymentContext?.plan_id || paymentContext.plan_price <= 0) {
        showPaymentNotice('Select a paid subscription plan from the dashboard first. Redirecting...', 'warning');
        window.setTimeout(() => {
            window.location.href = 'access-dashboard.html';
        }, 1600);
        return;
    }

    renderPaymentSummary();
    prefillOwnerFields();
    bindPaymentEvents();
    await checkPaymentAvailability();
});

function bindPaymentEvents() {
    const checkoutForm = document.getElementById('paymentCheckoutForm');
    checkoutForm?.addEventListener('submit', handleCheckoutSubmit);
}

async function checkPaymentAvailability() {
    try {
        const config = await requestAccess('/payment-config', {
            token: accessSession?.token
        });

        paymentGatewayReady = Boolean(config?.ready);
        if (!paymentGatewayReady) {
            setPayAvailability(false, 'Payments Unavailable');
            showPaymentNotice(
                config?.message || 'Online payments are unavailable right now. Configure Razorpay in backend/.env first.',
                'warning'
            );
            return;
        }

        paymentGatewayReady = true;
        setPayAvailability(true);
    } catch (error) {
        paymentGatewayReady = false;
        setPayAvailability(false, 'Payments Unavailable');
        showPaymentNotice(
            error.message || 'Unable to verify payment gateway availability right now.',
            'warning'
        );
    }
}

function resolvePaymentContext() {
    const pending = readStoredJson(PAYMENT_PENDING_STORAGE_KEY) || {};
    const params = new URLSearchParams(window.location.search);
    const planId = Number(params.get('plan') || pending.plan_id || 0);
    const amount = Number(params.get('amount') || pending.plan_price || 0);
    const fallbackPlan = FALLBACK_PLAN_CATALOG[planId] || {};
    const summary = accessSession?.summary || {};

    return {
        plan_id: planId,
        plan_price: amount,
        plan_name: String(pending.plan_name || fallbackPlan.name || 'Selected Plan').trim(),
        plan_description: String(
            pending.plan_description ||
            fallbackPlan.description ||
            'Activate the selected plan for your academy workspace.'
        ).trim(),
        max_instructors: Number(pending.max_instructors || fallbackPlan.max_instructors || 0),
        max_students: Number(pending.max_students || fallbackPlan.max_students || 0),
        academy_name: String(
            pending.academy_name ||
            summary?.academy?.academy_name ||
            'Academy workspace'
        ).trim(),
        access_code: String(
            pending.access_code ||
            summary?.academy?.access_code ||
            '-'
        ).trim(),
        owner_name: String(
            pending.owner_name ||
            summary?.customer?.name ||
            ''
        ).trim(),
        owner_email: String(
            pending.owner_email ||
            summary?.customer?.email ||
            ''
        ).trim(),
        owner_phone: String(
            pending.owner_phone ||
            summary?.customer?.phone ||
            ''
        ).trim(),
        timestamp: Number(pending.timestamp || 0)
    };
}

function renderPaymentSummary() {
    const planDescription = paymentContext.plan_description || 'Plan details will appear here once you choose a package from the dashboard.';

    document.getElementById('checkoutAmount').textContent = formatCurrency(paymentContext.plan_price);
    document.getElementById('checkoutPlanName').textContent = paymentContext.plan_name || '-';
    document.getElementById('checkoutPlanDescription').textContent = planDescription;
    document.querySelectorAll('[data-plan-description-note]').forEach((element) => {
        element.textContent = planDescription;
    });
    document.getElementById('checkoutAcademyName').textContent = paymentContext.academy_name || '-';
    document.getElementById('checkoutOwnerName').textContent = paymentContext.owner_name || '-';
    document.getElementById('checkoutAccessCode').textContent = paymentContext.access_code || '-';
    document.getElementById('checkoutBillingNote').textContent =
        `${formatPlanPrice(paymentContext.plan_price)} for the ${paymentContext.plan_name} plan.`;

    const payButton = document.getElementById('payButton');
    payButton.textContent = `Pay ${formatCurrency(paymentContext.plan_price)}`;

    const featureItems = buildFeatureItems(paymentContext);
    const featureList = document.getElementById('checkoutFeatureList');
    featureList.innerHTML = featureItems
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join('');
}

function buildFeatureItems(context) {
    const items = [];

    if (context.max_instructors > 0) {
        items.push(`${context.max_instructors} instructor seats included`);
    }

    if (context.max_students > 0) {
        items.push(`${context.max_students} student seats included`);
    }

    items.push('Unique academy access code remains tied to this academy workspace');
    items.push('Plan activation starts immediately after backend verification');

    if (context.plan_description) {
        items.push(context.plan_description);
    }

    return items;
}

function prefillOwnerFields() {
    document.getElementById('ownerName').value = paymentContext.owner_name || '';
    document.getElementById('ownerEmail').value = paymentContext.owner_email || '';
    document.getElementById('ownerPhone').value = paymentContext.owner_phone || '';
}

async function handleCheckoutSubmit(event) {
    event.preventDefault();

    if (!accessSession?.token) {
        showPaymentNotice('Your owner session expired. Please login again.', 'error');
        return;
    }

    if (!paymentGatewayReady) {
        showPaymentNotice(
            'Online payments are unavailable because Razorpay is not configured on the server. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in backend/.env.',
            'error'
        );
        return;
    }

    if (!window.Razorpay) {
        showPaymentNotice('Razorpay checkout could not load. Please refresh and try again.', 'error');
        return;
    }

    const ownerName = String(document.getElementById('ownerName').value || '').trim();
    const ownerEmail = String(document.getElementById('ownerEmail').value || '').trim();
    const ownerPhone = String(document.getElementById('ownerPhone').value || '').trim();

    if (!ownerName || !ownerEmail || !ownerPhone) {
        showPaymentNotice('Please fill in owner name, email, and phone number before continuing.', 'error');
        return;
    }

    const phoneDigits = sanitizePhone(ownerPhone);
    if (phoneDigits.length < 10) {
        showPaymentNotice('Enter a valid phone number before starting payment.', 'error');
        return;
    }

    setSubmitBusy(true, 'Creating Order...');
    showPaymentNotice('Creating your secure payment order...', 'info');

    try {
        const orderPayload = await requestAccess('/orders', {
            method: 'POST',
            token: accessSession.token,
            body: {
                plan_id: paymentContext.plan_id
            }
        });

        if (!orderPayload?.order?.id || !orderPayload?.key_id) {
            throw new Error('The payment gateway did not return a valid order.');
        }

        const options = {
            key: orderPayload.key_id,
            order_id: orderPayload.order.id,
            amount: Number(orderPayload.order.amount || 0),
            currency: orderPayload.order.currency || 'INR',
            name: 'Skill Boost Nexus',
            description: `${paymentContext.plan_name} plan for ${paymentContext.academy_name}`,
            prefill: {
                name: ownerName,
                email: ownerEmail,
                contact: ownerPhone
            },
            notes: {
                academy_name: paymentContext.academy_name,
                access_code: paymentContext.access_code,
                plan_id: String(paymentContext.plan_id)
            },
            handler: async (response) => {
                await handlePaymentSuccess(response);
            },
            modal: {
                ondismiss: () => {
                    setSubmitBusy(false);
                    showPaymentNotice('Payment was cancelled before completion.', 'warning');
                }
            }
        };

        setSubmitBusy(true, 'Opening Secure Checkout...');
        showPaymentNotice('Opening Razorpay checkout...', 'info');

        const razorpay = new window.Razorpay(options);
        razorpay.on('payment.failed', (response) => {
            setSubmitBusy(false);
            const reason = response?.error?.description || 'Payment failed. Please try again.';
            showPaymentNotice(reason, 'error');
        });
        razorpay.open();
    } catch (error) {
        setSubmitBusy(false);
        showPaymentNotice(error.message || 'Unable to start payment checkout.', 'error');
    }
}

async function handlePaymentSuccess(response) {
    setProcessingState(true);
    showPaymentNotice('', 'info', true);

    try {
        await requestAccess('/verify-payment', {
            method: 'POST',
            token: accessSession.token,
            body: {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                plan_id: paymentContext.plan_id
            }
        });

        const activation = await requestAccess('/subscription', {
            method: 'POST',
            token: accessSession.token,
            body: {
                plan_id: paymentContext.plan_id
            }
        });

        if (activation.summary) {
            accessSession.summary = activation.summary;
            persistSession(accessSession);
        }

        localStorage.removeItem(PAYMENT_PENDING_STORAGE_KEY);
        setSuccessState(
            activation.message ||
            `${paymentContext.plan_name} plan activated successfully.`
        );

        window.setTimeout(() => {
            window.location.href = 'access-dashboard.html';
        }, 2400);
    } catch (error) {
        setProcessingState(false);
        setSubmitBusy(false);
        showPaymentNotice(error.message || 'Payment verification failed. Please try again.', 'error');
    }
}

function setProcessingState(active) {
    const form = document.getElementById('paymentCheckoutForm');
    const processing = document.getElementById('paymentProcessing');
    const success = document.getElementById('paymentSuccess');

    form.hidden = active;
    processing.hidden = !active;
    success.hidden = true;
}

function setSuccessState(message) {
    const processing = document.getElementById('paymentProcessing');
    const success = document.getElementById('paymentSuccess');
    const form = document.getElementById('paymentCheckoutForm');

    form.hidden = true;
    processing.hidden = true;
    success.hidden = false;
    document.getElementById('paymentSuccessMessage').textContent = message;
}

function setSubmitBusy(busy, busyLabel = 'Processing...') {
    const payButton = document.getElementById('payButton');
    if (!payButton) {
        return;
    }

    if (!payButton.dataset.defaultLabel) {
        payButton.dataset.defaultLabel = payButton.textContent;
    }

    payButton.disabled = busy;
    payButton.textContent = busy ? busyLabel : payButton.dataset.defaultLabel;
}

function setPayAvailability(enabled, disabledLabel = 'Unavailable') {
    const payButton = document.getElementById('payButton');
    if (!payButton) {
        return;
    }

    if (!payButton.dataset.defaultLabel) {
        payButton.dataset.defaultLabel = payButton.textContent;
    }

    payButton.disabled = !enabled;
    payButton.textContent = enabled ? payButton.dataset.defaultLabel : disabledLabel;
}

function showPaymentNotice(message, tone = 'info', forceHide = false) {
    const notice = document.getElementById('paymentNotice');
    if (!notice) {
        return;
    }

    if (forceHide || !message) {
        notice.hidden = true;
        notice.textContent = '';
        notice.className = 'notice info';
        return;
    }

    notice.hidden = false;
    notice.textContent = message;
    notice.className = `notice ${tone}`;
}

async function requestAccess(path, options = {}) {
    const {
        method = 'GET',
        body,
        token
    } = options;

    const headers = {};
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${ACCESS_API_BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        const error = new Error(payload.message || payload.error || 'Request failed');
        error.status = response.status;
        throw error;
    }

    return payload;
}

function persistSession(session) {
    if (!session?.token) {
        localStorage.removeItem(ACCESS_SESSION_STORAGE_KEY);
        return;
    }

    localStorage.setItem(ACCESS_SESSION_STORAGE_KEY, JSON.stringify(session));
}

function readStoredJson(key) {
    try {
        const rawValue = localStorage.getItem(key);
        return rawValue ? JSON.parse(rawValue) : null;
    } catch (error) {
        return null;
    }
}

function sanitizePhone(value) {
    return String(value || '').replace(/\D/g, '');
}

function formatCurrency(amount) {
    const value = Number(amount || 0);
    return `Rs ${value.toLocaleString('en-IN')}`;
}

function formatPlanPrice(amount) {
    return `${formatCurrency(amount)}/month`;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

