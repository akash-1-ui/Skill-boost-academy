const ACCESS_API_BASE = window.SkillBoostApp?.buildApiUrl('/api/access')
    || `${window.location.origin}/api/access`;
const ACCESS_SESSION_STORAGE_KEY = 'skillboost-access-owner-session';
const ACCESS_REQUEST_TIMEOUT_MS = 30000;
const ACCESS_REGISTER_TIMEOUT_MS = 90000;

let accessSession = readStoredSession();
let toastTimeoutId = null;
const monitoringState = {
    instructor: {
        members: [],
        query: ''
    },
    student: {
        members: [],
        query: ''
    }
};

document.addEventListener('DOMContentLoaded', () => {
    bindAccessPortalEvents();
    
    // Detect which page we're on and initialize appropriately
    const isHomePage = document.getElementById('registerModal') !== null;
    const isDashboardPage = document.getElementById('dashboardSection') !== null;
    
    if (isHomePage) {
        console.log('[PAGE] Home page detected - initializing portal');
        initializeAccessPortal();
    } else if (isDashboardPage) {
        console.log('[PAGE] Dashboard page detected - initializing dashboard');
        initializeDashboard();
    } else {
        console.warn('[PAGE] Unknown page - could not determine initialization');
    }
});

function bindAccessPortalEvents() {
    const registerForm = document.getElementById('modalRegisterForm');
    const loginForm = document.getElementById('modalLoginForm');
    if (registerForm) {
        registerForm.addEventListener('submit', handleModalRegisterSubmit);
    }
    if (loginForm) {
        loginForm.addEventListener('submit', handleModalLoginSubmit);
    }

    document.querySelectorAll('[data-open-modal]').forEach((button) => {
        button.addEventListener('click', () => openModal(button.getAttribute('data-open-modal')));
    });

    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', (e) => closeModal(e.target.closest('.modal')));
    });

    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
        backdrop.addEventListener('click', (e) => closeModal(e.target.closest('.modal')));
    });

    bindQuickAccessEvents();

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            setQuickAccessMenuState(false);
            closeModal(document.querySelector('.modal:not([hidden])'));
        }
    });

    const refreshBtn = document.getElementById('refreshDashboardButton');
    const logoutBtn = document.getElementById('logoutButton');
    const confirmTerminateBtn = document.getElementById('confirmTerminateButton');
    if (refreshBtn) refreshBtn.addEventListener('click', handleRefreshDashboard);
    if (logoutBtn) logoutBtn.addEventListener('click', logoutAccessOwner);
    if (confirmTerminateBtn) confirmTerminateBtn.addEventListener('click', handleTerminateAccessOwner);
    document.querySelectorAll('[data-monitoring-search]').forEach((input) => {
        input.addEventListener('input', handleMonitoringSearchInput);
    });
    document.querySelectorAll('[data-close-terminate]').forEach((button) => {
        button.addEventListener('click', () => closeModal(document.getElementById('terminateAccountModal')));
    });

    document.body.addEventListener('click', (event) => {
        const copyButton = event.target.closest('[data-copy-target]');
        if (copyButton) {
            copyFromElement(copyButton.getAttribute('data-copy-target'));
            return;
        }

        const scrollTargetButton = event.target.closest('[data-scroll-target]');
        if (scrollTargetButton) {
            scrollToDashboardSection(scrollTargetButton.getAttribute('data-scroll-target'));
            return;
        }

        const memberActionButton = event.target.closest('[data-member-action]');
        if (memberActionButton) {
            handleMemberAccessToggle(memberActionButton);
            return;
        }

        const planButton = event.target.closest('[data-plan-id]');
        if (planButton) {
            const planId = Number(planButton.getAttribute('data-plan-id'));
            if (Number.isInteger(planId) && planId > 0) {
                upgradePlan(planId, planButton);
            }
        }
    });
}

function openRegisterModal() {
    openModal('registerModal');
}

function openLoginModal() {
    openModal('loginModal');
}

function buildAccessPageUrl(pageName) {
    if (window.SkillBoostApp?.buildHtmlUrl) {
        return window.SkillBoostApp.buildHtmlUrl(pageName);
    }

    return new URL(pageName, window.location.href).toString();
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) {
        console.warn('[MODAL] Modal not found:', modalId);
        return;
    }

    console.log('[MODAL] Opening modal:', modalId);
    clearModalNotices(modal);
    
    // Remove hidden attribute to make modal visible
    modal.removeAttribute('hidden');
    modal.style.display = 'flex'; // Force display flex for visibility
    
    document.body.classList.add('modal-open');
    
    // Focus on first input
    const firstInput = modal.querySelector('input');
    if (firstInput) {
        setTimeout(() => firstInput.focus(), 50);
    }
    
    console.log('[MODAL] Modal opened successfully');
}

function closeModal(modalElement) {
    if (modalElement) {
        console.log('[MODAL] Closing modal');
        modalElement.setAttribute('hidden', '');
        modalElement.style.display = 'none'; // Force hidden state
        
        const form = modalElement.querySelector('form');
        if (form) {
            form.reset();
        }
        
        clearModalNotices(modalElement);
    }

    if (!document.querySelector('.modal:not([hidden])')) {
        document.body.classList.remove('modal-open');
    }
    
    console.log('[MODAL] Modal closed');
}

function clearModalNotices(modalElement) {
    modalElement?.querySelectorAll('.notice[id]').forEach((notice) => {
        setNotice(notice.id, '', 'info');
    });
}

function bindQuickAccessEvents() {
    const toggle = document.getElementById('quickAccessToggle');
    const menu = document.getElementById('quickAccessMenu');
    if (!toggle || !menu) {
        return;
    }

    toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        setQuickAccessMenuState(menu.hidden);
    });

    menu.addEventListener('click', (event) => {
        event.stopPropagation();

        const quickAccessLink = event.target.closest('[data-scroll-target]');
        if (!quickAccessLink) {
            return;
        }

        scrollToDashboardSection(quickAccessLink.getAttribute('data-scroll-target'));
        setQuickAccessMenuState(false);
    });

    document.addEventListener('click', (event) => {
        if (menu.hidden) {
            return;
        }

        if (event.target.closest('#quickAccessToggle') || event.target.closest('#quickAccessMenu')) {
            return;
        }

        setQuickAccessMenuState(false);
    });
}

function setQuickAccessMenuState(isOpen) {
    const toggle = document.getElementById('quickAccessToggle');
    const menu = document.getElementById('quickAccessMenu');
    if (!toggle || !menu) {
        return;
    }

    menu.hidden = !isOpen;
    toggle.setAttribute('aria-expanded', String(isOpen));
}

function scrollToDashboardSection(targetId) {
    const target = document.getElementById(targetId);
    if (!target) {
        return;
    }

    target.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
    });
}

async function handleRefreshDashboard() {
    const refreshButton = document.getElementById('refreshDashboardButton');
    if (!refreshButton) {
        return;
    }

    setQuickAccessMenuState(false);
    setButtonBusy(refreshButton, true, 'Refresh', 'Refreshing...');

    try {
        await loadDashboard(true);
    } finally {
        setButtonBusy(refreshButton, false, 'Refresh');
    }
}

async function handleTerminateAccessOwner() {
    if (!accessSession?.token) {
        setNotice('terminateNotice', 'Your owner session has expired. Please login again.', 'error');
        return;
    }

    const modal = document.getElementById('terminateAccountModal');
    const confirmButton = document.getElementById('confirmTerminateButton');

    setNotice(
        'terminateNotice',
        'Deleting academy workspace, linked users, access, courses, and instructor uploaded videos...',
        'warning'
    );
    setButtonBusy(confirmButton, true, 'Delete Permanently', 'Deleting...');

    try {
        const response = await requestAccess('/terminate', {
            method: 'DELETE',
            token: accessSession.token
        });

        accessSession = null;
        persistSession(null);
        closeModal(modal);
        showToast(response.message || 'Academy account terminated permanently.', 'success');

        window.setTimeout(() => {
            window.location.href = buildAccessPageUrl('access.html');
        }, 1200);
    } catch (error) {
        setNotice(
            'terminateNotice',
            error.message || 'Unable to terminate the academy account right now.',
            'error'
        );
    } finally {
        setButtonBusy(confirmButton, false, 'Delete Permanently');
    }
}

async function handleModalRegisterSubmit(event) {
    event.preventDefault();

    const modal = event.target.closest('.modal');
    const submitButton = document.getElementById('modalRegisterSubmitButton');
    const payload = {
        academy_name: document.getElementById('modalRegisterAcademyName').value.trim(),
        customer_name: document.getElementById('modalRegisterOwnerName').value.trim(),
        customer_email: document.getElementById('modalRegisterOwnerEmail').value.trim(),
        phone: document.getElementById('modalRegisterOwnerPhone').value.trim(),
        password: document.getElementById('modalRegisterOwnerPassword').value
    };

    if (!payload.academy_name || !payload.customer_name || !payload.customer_email || !payload.password) {
        setNotice('modalRegisterNotice', '', 'info');
        showToast('Please fill in academy name, owner name, email, and password.', 'warning', 3600);
        return;
    }

    setNotice('modalRegisterNotice', '', 'info');
    showToast('Creating your admin account and academy workspace...', 'info', 10000);
    setButtonBusy(submitButton, true, 'Create Owner Account', 'Creating Workspace...');

    try {
        console.log('[DEBUG] Submitting register form with payload:', payload);
        const response = await requestAccess('/register', {
            method: 'POST',
            body: payload,
            timeoutMs: ACCESS_REGISTER_TIMEOUT_MS
        });

        console.log('[DEBUG] Register response:', response);
        establishSession(response);
        console.log('[DEBUG] Session established');
        modal.querySelector('form').reset();
        setNotice('modalRegisterNotice', '', 'info');
        showToast('Workspace created successfully. Opening dashboard...', 'success', 2200);
        closeModal(modal);
        
        // Redirect to dashboard page
        console.log('[DEBUG] Redirecting to dashboard...');
        window.location.href = buildAccessPageUrl('access-dashboard.html');
    } catch (error) {
        console.error('[DEBUG] Register error:', error);
        setNotice('modalRegisterNotice', '', 'info');
        showToast(error.message || 'Unable to create the owner account.', 'error', 4200);
    } finally {
        setButtonBusy(submitButton, false, 'Create Owner Account');
    }
}

async function handleModalLoginSubmit(event) {
    event.preventDefault();

    const modal = event.target.closest('.modal');
    const submitButton = document.getElementById('modalLoginSubmitButton');
    const payload = {
        email: document.getElementById('modalLoginOwnerEmail').value.trim(),
        password: document.getElementById('modalLoginOwnerPassword').value
    };

    if (!payload.email || !payload.password) {
        showToast('Please enter the admin email and password.', 'warning', 3200);
        return;
    }

    setNotice('modalLoginNotice', '', 'info');
    showToast('Signing in to the admin dashboard...', 'info', 2200);
    setButtonBusy(submitButton, true, 'Login To Dashboard', 'Signing In...');

    try {
        console.log('[DEBUG] Submitting login form with payload:', payload);
        const response = await requestAccess('/login', {
            method: 'POST',
            body: payload
        });

        console.log('[DEBUG] Login response:', response);
        establishSession(response);
        console.log('[DEBUG] Session established');
        modal.querySelector('form').reset();
        setNotice('modalLoginNotice', '', 'info');
        showToast('Login successful. Loading dashboard...', 'success', 2200);
        closeModal(modal);
        
        // Redirect to dashboard page
        console.log('[DEBUG] Redirecting to dashboard...');
        window.location.href = buildAccessPageUrl('access-dashboard.html');
    } catch (error) {
        console.error('[DEBUG] Login error:', error);
        setNotice('modalLoginNotice', '', 'info');
        showToast(error.message || 'Unable to login.', 'error', 4200);
    } finally {
        setButtonBusy(submitButton, false, 'Login To Dashboard');
    }
}

function initializeAccessPortal() {
    // This is the HOME PAGE (access.html)
    // Always show the home page content
    // No authentication check needed here
    console.log('[INIT] Initializing access home page');
    document.body.classList.remove('dashboard-mode');
    
    // Setup logout button if exists (in navbar)
    const logoutBtn = document.getElementById('logoutButton');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logoutAccessOwner);
    }
}

function initializeDashboard() {
    // This is the DASHBOARD PAGE (access-dashboard.html)
    // Check for active session before showing dashboard
    console.log('[INIT] Initializing dashboard page');
    document.body.classList.add('dashboard-mode');
    
    if (!accessSession?.token) {
        console.log('[AUTH] No active session found - redirecting to home page');
        window.location.href = buildAccessPageUrl('access.html');
        return;
    }
    
    console.log('[AUTH] Session verified - loading dashboard data');
    loadDashboard(false);
}

async function loadDashboard(showRefreshToast) {
    if (!accessSession?.token) {
        console.warn('[DASHBOARD] No session token - cannot load dashboard');
        return;
    }

    try {
        console.log('[DEBUG] Loading dashboard with token:', accessSession.token);
        const payload = await requestAccess('/dashboard', {
            token: accessSession.token
        });

        console.log('[DEBUG] Dashboard payload received:', payload);
        console.log('[DEBUG] Plans count:', payload.plans ? payload.plans.length : 0);
        console.log('[DEBUG] Payments count:', payload.payments ? payload.payments.length : 0);
        console.log('[DEBUG] Activity logs count:', payload.activity_logs ? payload.activity_logs.length : 0);

        accessSession.summary = payload.summary;
        persistSession(accessSession);
        console.log('[DEBUG] Calling renderDashboard');
        renderDashboard(payload);
        console.log('[DEBUG] renderDashboard completed');

        if (showRefreshToast) {
            showToast('Dashboard refreshed.', 'success');
        }
    } catch (error) {
        console.error('[DEBUG] loadDashboard error:', error);
        if (error.status === 401) {
            logoutAccessOwner();
            setNotice('loginNotice', 'Your session expired. Please login again.', 'warning');
            showToast('Session expired. Please login again.', 'warning');
            return;
        }

        setDashboardNotice(error.message || 'Unable to load the owner dashboard.', 'error');
    }
}

function renderDashboard(payload) {
    const summary = payload.summary || {};
    const academy = summary.academy || {};
    const customer = summary.customer || {};
    const currentPlan = summary.current_plan || {};
    const usage = payload.usage || {};
    const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
    const statistics = payload.statistics || {};

    console.log('[DEBUG] renderDashboard called');
    console.log('[DEBUG] Summary:', summary);
    console.log('[DEBUG] Current plan:', currentPlan);
    console.log('[DEBUG] Payload plans:', payload.plans);

    document.getElementById('dashboardTitle').textContent = academy.academy_name || 'Academy dashboard';
    document.getElementById('dashboardSubtitle').textContent =
        `Manage access, subscription plans, payment history, and invite access from one place.`;

    // Quick access code
    document.getElementById('quickAccessCodeValue').textContent = academy.access_code || '-';

    // Info section
    document.getElementById('academyNameValue').textContent = academy.academy_name || '-';
    document.getElementById('ownerNameValue').textContent = customer.name || '-';
    document.getElementById('ownerEmailValue').textContent = customer.email || '-';

    // Plan info
    const planName = currentPlan.name ? `${currentPlan.name} Plan` : 'No active plan';
    const planLimits = currentPlan.name 
        ? `${Number(currentPlan.max_instructors || 0)} instructors | ${Number(currentPlan.max_students || 0)} students`
        : 'Choose a plan to enable seats';
    document.getElementById('currentPlanValue').textContent = planName;
    document.getElementById('planLimitsValue').textContent = planLimits;

    // Capacity section
    document.getElementById('activeInstructorsValue').textContent = String(statistics.active_instructors || 0);
    document.getElementById('activeStudentsValue').textContent = String(statistics.active_students || 0);
    document.getElementById('instructorLimitValue').textContent = 
        `of ${String(statistics.instructor_limit || 0)} limit`;
    document.getElementById('studentLimitValue').textContent = 
        `of ${String(statistics.student_limit || 0)} limit`;

    // Usage bars
    const instructorPercent = Number(usage.instructors?.percentage || 0);
    const studentPercent = Number(usage.students?.percentage || 0);
    document.getElementById('instructorUsageText').textContent = `${instructorPercent}%`;
    document.getElementById('studentUsageText').textContent = `${studentPercent}%`;
    document.getElementById('instructorUsageBar').style.width = `${instructorPercent}%`;
    document.getElementById('studentUsageBar').style.width = `${studentPercent}%`;

    // Invite link - combined into single link
    const academyAccessCode = academy.access_code || '';
    const joinLink = buildAcademyJoinLink(academyAccessCode);
    document.getElementById('academyJoinLink').value = joinLink;

    renderWarnings({
        warnings,
        usage,
        statistics
    });
    renderMonitoring(payload.monitoring || {});
    console.log('[DEBUG] About to call renderPlans with', payload.plans?.length, 'plans and currentPlanId:', currentPlan.id);
    renderPlans(payload.plans || [], currentPlan);
    renderPayments(payload.payments || []);

    const sessionBadge = document.getElementById('sessionBadge');
    if (sessionBadge) {
        sessionBadge.hidden = false;
    }
    clearDuplicateUsageNotice(warnings);
}

function buildAcademyJoinLink(accessCode) {
    const normalizedCode = String(accessCode || '').trim();
    if (!normalizedCode) {
        return '-';
    }

    const joinUrl = new URL(buildAccessPageUrl('index.html'));
    joinUrl.searchParams.set('code', normalizedCode);
    return joinUrl.toString();
}

function renderWarningsLegacy(warnings) {
    const warningList = document.getElementById('warningList');

    if (!warnings.length) {
        warningList.innerHTML = '<div class="capacity-note">✓ You have available capacity for new instructors and students. No warnings at this time.</div>';
        return;
    }

    warningList.innerHTML = warnings.map((warning) => (
        `<div class="warning-note">⚠ ${escapeHtml(warning)}</div>`
    )).join('');
}

function renderWarnings(context = {}) {
    const warningList = document.getElementById('warningList');
    if (!warningList) {
        return;
    }

    const statistics = context.statistics || {};
    const usage = context.usage || {};
    const fallbackWarnings = Array.isArray(context.warnings) ? context.warnings : [];

    const instructorCurrent = Number(statistics.active_instructors || usage.instructors?.current || 0);
    const studentCurrent = Number(statistics.active_students || usage.students?.current || 0);
    const instructorLimit = Number(statistics.instructor_limit || usage.instructors?.limit || 0);
    const studentLimit = Number(statistics.student_limit || usage.students?.limit || 0);

    const instructorExceeded = Boolean(usage.instructors?.exceeded || (instructorLimit > 0 && instructorCurrent >= instructorLimit));
    const studentExceeded = Boolean(usage.students?.exceeded || (studentLimit > 0 && studentCurrent >= studentLimit));
    const instructorNearLimit = Boolean(usage.instructors?.near_limit);
    const studentNearLimit = Boolean(usage.students?.near_limit);

    const seatsMarkup = [];
    if (instructorExceeded || instructorNearLimit) {
        seatsMarkup.push(buildCapacityMetricCard(
            'Instructor seats',
            instructorCurrent,
            instructorLimit,
            instructorExceeded ? 'Limit reached' : 'Close to limit'
        ));
    }

    if (studentExceeded || studentNearLimit) {
        seatsMarkup.push(buildCapacityMetricCard(
            'Student seats',
            studentCurrent,
            studentLimit,
            studentExceeded ? 'Limit reached' : 'Close to limit'
        ));
    }

    if (instructorExceeded && studentExceeded) {
        warningList.innerHTML = buildCapacityAlertCard({
            tone: 'critical',
            badge: 'Upgrade Required',
            title: 'Instructor and student limits reached',
            message: 'New registrations and logins with this academy access code can be blocked because both seat limits are fully used. Upgrade the plan to reopen capacity.',
            seatsMarkup
        });
        return;
    }

    if (instructorExceeded) {
        warningList.innerHTML = buildCapacityAlertCard({
            tone: 'critical',
            badge: 'Upgrade Required',
            title: 'Instructor limit reached',
            message: 'Instructor seats for the current plan are fully used. Upgrade the plan to allow more instructor registrations and logins with this academy access code.',
            seatsMarkup
        });
        return;
    }

    if (studentExceeded) {
        warningList.innerHTML = buildCapacityAlertCard({
            tone: 'critical',
            badge: 'Upgrade Required',
            title: 'Student limit reached',
            message: 'Student seats for the current plan are fully used. Upgrade the plan to allow more student registrations and logins with this academy access code.',
            seatsMarkup
        });
        return;
    }

    if (instructorNearLimit || studentNearLimit) {
        warningList.innerHTML = buildCapacityAlertCard({
            tone: 'advisory',
            badge: 'Capacity Warning',
            title: 'Plan capacity is getting close',
            message: 'Seat usage is above 80% for at least one role. Review the remaining capacity and consider upgrading soon to avoid blocking new users.',
            seatsMarkup
        });
        return;
    }

    if (!fallbackWarnings.length) {
        warningList.innerHTML = '<div class="capacity-note">Capacity is available for new instructors and students.</div>';
        return;
    }

    warningList.innerHTML = fallbackWarnings.map((warning) => (
        `<div class="warning-note">${escapeHtml(warning)}</div>`
    )).join('');
}

function buildCapacityMetricCard(label, current, limit, statusText) {
    return `
        <div class="capacity-alert-metric">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(String(current))} / ${escapeHtml(String(limit))}</strong>
            <small>${escapeHtml(statusText)}</small>
        </div>
    `;
}

function buildCapacityAlertCard(config) {
    const tone = config.tone === 'critical' ? 'critical' : 'advisory';
    const badge = config.badge || 'Capacity Notice';
    const title = config.title || 'Capacity update';
    const message = config.message || '';
    const seatsMarkup = Array.isArray(config.seatsMarkup) ? config.seatsMarkup.join('') : '';
    const actionLabel = tone === 'critical' ? 'Upgrade Plan' : 'Review Plans';

    return `
        <div class="capacity-alert is-${tone}">
            <div class="capacity-alert-header">
                <div class="capacity-alert-copy">
                    <span class="capacity-alert-badge">${escapeHtml(badge)}</span>
                    <strong>${escapeHtml(title)}</strong>
                    <p>${escapeHtml(message)}</p>
                </div>
                <button
                    type="button"
                    class="chip-btn primary capacity-alert-action"
                    data-scroll-target="dashboardPlansSection">
                    ${escapeHtml(actionLabel)}
                </button>
            </div>
            ${seatsMarkup ? `<div class="capacity-alert-metrics">${seatsMarkup}</div>` : ''}
        </div>
    `;
}

function clearDuplicateUsageNotice(warnings) {
    const dashboardNotice = document.getElementById('dashboardNotice');
    if (!dashboardNotice || dashboardNotice.hidden || !dashboardNotice.classList.contains('warning')) {
        return;
    }

    const currentMessage = String(dashboardNotice.textContent || '').trim();
    const hasMatchingUsageWarning = warnings.some((warning) => String(warning || '').trim() === currentMessage);

    if (hasMatchingUsageWarning) {
        setDashboardNotice('', 'info', true);
    }
}

function renderPlans(plans, currentPlan) {
    const plansGrid = document.getElementById('plansGrid');
    const currentPlanId = Number(currentPlan?.id || 0);

    console.log('[DEBUG] renderPlans called with plans:', plans, 'currentPlan:', currentPlan);
    console.log('[DEBUG] plansGrid element:', plansGrid);

    if (!plans.length) {
        plansGrid.innerHTML = '<div class="plan-option"><p>No plans are available right now.</p></div>';
        return;
    }

    const planDisplayPriority = {
        advanced: 1,
        pro: 2,
        basic: 3
    };
    const displayPlans = [...plans].sort((left, right) => {
        const leftKey = String(left?.name || '').trim().toLowerCase();
        const rightKey = String(right?.name || '').trim().toLowerCase();
        const leftPriority = planDisplayPriority[leftKey] || 99;
        const rightPriority = planDisplayPriority[rightKey] || 99;

        if (leftPriority !== rightPriority) {
            return leftPriority - rightPriority;
        }

        return Number(left?.id || 0) - Number(right?.id || 0);
    });

    const html = displayPlans.map((plan) => {
        const isCurrent = Number(plan.id) === currentPlanId;
        const cardClass = `plan-option${isCurrent ? ' current' : ''}`;
        const isFree = Number(plan.price) === 0;
        const isBasicPlan = String(plan.name || '').trim().toLowerCase() === 'basic';
        const activationMode = String(plan.activation_mode || (isFree ? 'free' : 'purchase')).trim().toLowerCase();
        const isReactivation = activationMode === 'reactivate';
        const actionLabel = isCurrent
            ? 'Current Plan'
            : (isFree || isReactivation)
                ? `Switch to ${escapeHtml(plan.name)}`
                : `Upgrade to ${escapeHtml(plan.name)}`;
        const buttonClass = isCurrent ? 'ghost-btn' : ((isFree || isReactivation) ? 'primary-btn' : 'upgrade-btn');
        const noRepayNote = isReactivation
            ? '<span>Previously purchased for this academy. No extra payment required.</span>'
            : '';
        
        // Calculate days remaining for paid plans only (not basic, not free)
        let expiryNote = '';
        if (isCurrent && !isBasicPlan && !isFree && currentPlan?.days_remaining !== null && currentPlan?.days_remaining !== undefined) {
            const daysLeft = Number(currentPlan.days_remaining || 0);
            if (daysLeft > 0) {
                expiryNote = `<small class="plan-expiry-text">${daysLeft} day${daysLeft !== 1 ? 's' : ''} left to expire plan</small>`;
            } else if (daysLeft === 0) {
                expiryNote = '<small class="plan-expiry-text">Expires today</small>';
            }
        }

        return `
            <article class="${cardClass}">
                <div class="copy-row">
                    <h4>${escapeHtml(plan.name)}</h4>
                    ${isCurrent ? '<span class="plan-pill current">Active</span>' : ''}
                </div>
                <div class="plan-price">${isFree ? 'Free' : formatPlanPrice(plan.price)}</div>
                <div class="plan-meta">
                    <span>${Number(plan.max_instructors || 0)} instructor seats</span>
                    <span>${Number(plan.max_students || 0)} student seats</span>
                    <span>${escapeHtml(plan.description || 'Plan details available after selection.')}</span>
                    ${noRepayNote}
                    ${expiryNote}
                </div>
                <button
                    type="button"
                    class="${buttonClass}"
                    data-plan-id="${Number(plan.id)}"
                    data-plan-price="${Number(plan.price)}"
                    data-plan-activation-mode="${escapeHtml(activationMode)}"
                    data-plan-name="${escapeHtml(plan.name || '')}"
                    data-plan-description="${escapeHtml(plan.description || '')}"
                    data-plan-instructors="${Number(plan.max_instructors || 0)}"
                    data-plan-students="${Number(plan.max_students || 0)}"
                    ${isCurrent ? 'disabled' : ''}>
                    ${actionLabel}
                </button>
            </article>
        `;
    }).join('');

    plansGrid.innerHTML = html;
    console.log('[DEBUG] Plans rendered, HTML length:', html.length);
}

function renderPayments(payments) {
    const tbody = document.getElementById('paymentsTableBody');
    const visiblePayments = Array.isArray(payments)
        ? payments.filter((payment) => Number(payment?.amount || 0) > 0)
        : [];

    if (!visiblePayments.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">No payment activity yet.</td></tr>';
        return;
    }

    tbody.innerHTML = visiblePayments.map((payment) => `
        <tr>
            <td>${escapeHtml(payment.plan_name || '-')}</td>
            <td>${escapeHtml(formatCurrency(payment.amount, payment.currency))}</td>
            <td><span class="status-pill ${statusTone(payment.status)}">${escapeHtml(formatStatusLabel(payment.status))}</span></td>
            <td>${escapeHtml(payment.payment_reference || '-')}</td>
            <td>${escapeHtml(formatDateTime(payment.created_at))}</td>
        </tr>
    `).join('');
}

function renderMonitoring(monitoring) {
    monitoringState.instructor.members = Array.isArray(monitoring?.instructors) ? monitoring.instructors : [];
    monitoringState.student.members = Array.isArray(monitoring?.students) ? monitoring.students : [];

    renderMonitoringTable('instructor');
    renderMonitoringTable('student');
}

function handleMonitoringSearchInput(event) {
    const input = event.target;
    const role = String(input?.dataset?.monitoringSearch || '').trim().toLowerCase();

    if (role !== 'instructor' && role !== 'student') {
        return;
    }

    monitoringState[role].query = String(input.value || '').trim().toLowerCase();
    renderMonitoringTable(role);
}

function getFilteredMonitoringMembers(role) {
    const normalizedRole = role === 'instructor' ? 'instructor' : 'student';
    const members = Array.isArray(monitoringState[normalizedRole]?.members) ? monitoringState[normalizedRole].members : [];
    const query = String(monitoringState[normalizedRole]?.query || '').trim().toLowerCase();

    if (!query) {
        return members;
    }

    return members.filter((member) => {
        const name = String(member?.name || '').toLowerCase();
        const email = String(member?.email || '').toLowerCase();
        return name.includes(query) || email.includes(query);
    });
}

function renderMonitoringTable(role) {
    const normalizedRole = role === 'instructor' ? 'instructor' : 'student';
    const tableBodyId = normalizedRole === 'instructor'
        ? 'monitoringInstructorsTableBody'
        : 'monitoringStudentsTableBody';
    const tbody = document.getElementById(tableBodyId);
    if (!tbody) {
        return;
    }

    const roleLabel = normalizedRole === 'instructor' ? 'instructor' : 'student';
    const members = getFilteredMonitoringMembers(normalizedRole);
    const hasSearchQuery = Boolean(String(monitoringState[normalizedRole]?.query || '').trim());

    if (!members.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-cell">${
                    hasSearchQuery
                        ? `No ${escapeHtml(roleLabel)} accounts match this search.`
                        : `No ${escapeHtml(roleLabel)} accounts have joined with this academy access code yet.`
                }</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = members.map((member) => {
        const currentStatus = String(member.access_status || 'active').trim().toLowerCase() === 'restricted'
            ? 'restricted'
            : 'active';
        const actionLabel = currentStatus === 'restricted' ? 'Allow Access' : 'Restrict Access';
        const actionTone = currentStatus === 'restricted' ? 'allow' : 'restrict';
        const nextStatus = currentStatus === 'restricted' ? 'active' : 'restricted';

        return `
            <tr>
                <td>
                    <div class="monitoring-user">
                        <strong>${escapeHtml(member.name || '-')}</strong>
                        <span>${escapeHtml(member.email || '-')}</span>
                    </div>
                </td>
                <td>
                    <span class="status-pill ${currentStatus === 'restricted' ? 'failed' : 'success'}">
                        ${escapeHtml(currentStatus === 'restricted' ? 'Restricted' : 'Active')}
                    </span>
                </td>
                <td>${escapeHtml(formatMonitoringDate(member.joined_at, '-'))}</td>
                <td>${escapeHtml(formatMonitoringDate(member.last_login_at, 'Not logged in yet'))}</td>
                <td>
                    <button
                        type="button"
                        class="monitoring-action-btn ${actionTone}"
                        data-member-action="toggle-access"
                        data-member-id="${Number(member.id)}"
                        data-member-role="${escapeHtml(normalizedRole)}"
                        data-member-next-status="${escapeHtml(nextStatus)}"
                        data-member-name="${escapeHtml(member.name || roleLabel)}">
                        ${escapeHtml(actionLabel)}
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

async function handleMemberAccessToggle(button) {
    if (!accessSession?.token) {
        showToast('Your owner session has expired. Please login again.', 'warning');
        logoutAccessOwner();
        return;
    }

    const userId = Number(button.getAttribute('data-member-id'));
    const role = String(button.getAttribute('data-member-role') || '').trim().toLowerCase();
    const nextStatus = String(button.getAttribute('data-member-next-status') || '').trim().toLowerCase();
    const memberName = String(button.getAttribute('data-member-name') || 'This user').trim();

    if (!Number.isInteger(userId) || userId <= 0 || (role !== 'student' && role !== 'instructor')) {
        showToast('Unable to update this member right now.', 'error');
        return;
    }

    const idleLabel = button.textContent.trim() || (nextStatus === 'restricted' ? 'Restrict Access' : 'Allow Access');
    const busyLabel = nextStatus === 'restricted' ? 'Restricting...' : 'Allowing...';

    setButtonBusy(button, true, idleLabel, busyLabel);

    try {
        const response = await updateMemberAccessStatus(userId, role, nextStatus);

        const successMessage = response.message || `${memberName} access updated successfully.`;
        setDashboardNotice(successMessage, 'success');
        showToast(successMessage, 'success');
        await loadDashboard(false);
    } catch (error) {
        const failureMessage = error.message || `Unable to update ${memberName} right now.`;
        setDashboardNotice(failureMessage, 'error');
        showToast(failureMessage, 'error');
    } finally {
        setButtonBusy(button, false, idleLabel);
    }
}

async function updateMemberAccessStatus(userId, role, nextStatus) {
    const payload = {
        role,
        access_status: nextStatus
    };

    try {
        return await requestAccess(`/members/${userId}/access-status`, {
            method: 'PATCH',
            token: accessSession.token,
            body: payload
        });
    } catch (error) {
        if (error.status) {
            throw error;
        }

        return requestAccess(`/members/${userId}/access-status`, {
            method: 'POST',
            token: accessSession.token,
            body: payload
        });
    }
}

function renderActivityLegacy(logs) {
    const tbody = document.getElementById('activityTableBody');
    if (!tbody) {
        return;
    }

    if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">No activity logged yet.</td></tr>';
        return;
    }

    tbody.innerHTML = logs.map((log) => `
        <tr>
            <td>${escapeHtml(capitalize(log.type || '-'))}</td>
            <td><span class="status-pill ${statusTone(log.status)}">${escapeHtml(formatStatusLabel(log.status))}</span></td>
            <td>${escapeHtml(log.email || '-')}</td>
            <td>${escapeHtml(log.reason || '-')}</td>
            <td>${escapeHtml(formatDateTime(log.timestamp))}</td>
        </tr>
    `).join('');
}

async function upgradePlan(planId, button) {
    if (!accessSession?.token) {
        showToast('Please login first.', 'warning');
        return;
    }

    const planPrice = Number(button.getAttribute('data-plan-price'));
    const activationMode = String(
        button.getAttribute('data-plan-activation-mode') || (planPrice === 0 ? 'free' : 'purchase')
    ).trim().toLowerCase();
    const originalLabel = button.textContent;

    // Free plans and previously purchased paid plans can be activated directly.
    if (planPrice === 0 || activationMode === 'reactivate') {
        button.disabled = true;
        button.textContent = activationMode === 'reactivate' ? 'Switching...' : 'Activating...';
        setDashboardNotice(
            activationMode === 'reactivate'
                ? 'Switching to your previously purchased plan...'
                : 'Activating your free plan...',
            'info'
        );

        try {
            const response = await requestAccess('/subscription', {
                method: 'POST',
                token: accessSession.token,
                body: { plan_id: planId }
            });

            if (response.summary) {
                accessSession.summary = response.summary;
                persistSession(accessSession);
            }

            const successMessage = response.message || (
                activationMode === 'reactivate'
                    ? 'Plan activated successfully using your previous payment.'
                    : 'Free plan activated successfully.'
            );
            setDashboardNotice(successMessage, 'success');
            showToast(successMessage, 'success');
            await loadDashboard(false);
        } catch (error) {
            setDashboardNotice(error.message || 'Unable to activate the plan.', 'error');
            button.disabled = false;
            button.textContent = originalLabel;
        }
        return;
    }

    // For paid plans, redirect to payment page
    button.disabled = true;
    button.textContent = 'Processing...';
    setDashboardNotice('Redirecting to payment...', 'info');

    try {
        // Store plan details in localStorage for payment page to access
        const paymentData = {
            plan_id: planId,
            plan_price: planPrice,
            plan_name: button.getAttribute('data-plan-name') || '',
            plan_description: button.getAttribute('data-plan-description') || '',
            max_instructors: Number(button.getAttribute('data-plan-instructors') || 0),
            max_students: Number(button.getAttribute('data-plan-students') || 0),
            academy_name: accessSession?.summary?.academy?.academy_name || '',
            access_code: accessSession?.summary?.academy?.access_code || '',
            owner_name: accessSession?.summary?.customer?.name || '',
            owner_email: accessSession?.summary?.customer?.email || '',
            owner_phone: accessSession?.summary?.customer?.phone || '',
            token: accessSession.token,
            timestamp: Date.now()
        };
        localStorage.setItem('skillboost-payment-pending', JSON.stringify(paymentData));
        
        // Redirect to payment page
        window.location.href = `payment.html?plan=${planId}&amount=${planPrice}`;
    } catch (error) {
        setDashboardNotice('Unable to process payment.', 'error');
        button.disabled = false;
        button.textContent = originalLabel;
    }
}

function logoutAccessOwner() {
    console.log('[LOGOUT] Signing out...');
    accessSession = null;
    persistSession(null);
    showToast('Signed out of the owner portal.', 'success');
    
    // Redirect back to access home page
    window.location.href = buildAccessPageUrl('access.html');
}

function setAuthenticatedState(isAuthenticated) {
    const authSection = document.getElementById('authSection');
    const dashboardSection = document.getElementById('dashboardSection');
    const registerButton = document.getElementById('registerModalButton');
    const loginButton = document.getElementById('loginModalButton');
    const sessionBadge = document.getElementById('sessionBadge');
    const workspaceLink = document.getElementById('workspaceLink');
    const accessHero = document.getElementById('accessHero');

    console.log('[AUTH] Setting authenticated state to:', isAuthenticated);

    if (authSection) {
        authSection.hidden = isAuthenticated;
    }
    
    if (dashboardSection) {
        dashboardSection.hidden = !isAuthenticated;
    }
    
    // When AUTHENTICATED: Hide Register/Login buttons and Hero (show dashboard only)
    // When NOT AUTHENTICATED: Show Register/Login buttons and Hero (show home page only)
    if (registerButton) {
        registerButton.hidden = isAuthenticated; // Hide when logged in
    }
    if (loginButton) {
        loginButton.hidden = isAuthenticated; // Hide when logged in
    }
    
    if (sessionBadge) {
        sessionBadge.hidden = !isAuthenticated;
    }
    
    if (workspaceLink) {
        workspaceLink.hidden = isAuthenticated;
    }
    
    if (accessHero) {
        accessHero.hidden = isAuthenticated;
    }

    document.body.classList.toggle('dashboard-mode', isAuthenticated);

    if (isAuthenticated) {
        console.log('[AUTH] Showing dashboard only');
        window.requestAnimationFrame(() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            dashboardSection?.focus?.({ preventScroll: true });
        });
        return;
    }

    console.log('[AUTH] Showing access home page');
    window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

function clearDashboard() {
    document.getElementById('dashboardTitle').textContent = 'Academy dashboard';
    document.getElementById('dashboardSubtitle').textContent = 'Manage access, subscription plans, payment history, and invite access from one place.';
    document.getElementById('quickAccessCodeValue').textContent = '-';
    document.getElementById('academyNameValue').textContent = '-';
    document.getElementById('ownerNameValue').textContent = '-';
    document.getElementById('ownerEmailValue').textContent = '-';
    document.getElementById('currentPlanValue').textContent = 'No active plan';
    document.getElementById('planLimitsValue').textContent = 'Choose a plan to enable seats';
    document.getElementById('academyJoinLink').value = '-';
    document.getElementById('paymentsTableBody').innerHTML = '<tr><td colspan="5" class="empty-cell">No payment activity yet.</td></tr>';
    document.getElementById('monitoringInstructorsTableBody').innerHTML = '<tr><td colspan="5" class="empty-cell">No instructor accounts yet.</td></tr>';
    document.getElementById('monitoringStudentsTableBody').innerHTML = '<tr><td colspan="5" class="empty-cell">No student accounts yet.</td></tr>';
    const monitoringInstructorSearch = document.getElementById('monitoringInstructorSearch');
    const monitoringStudentSearch = document.getElementById('monitoringStudentSearch');
    if (monitoringInstructorSearch) {
        monitoringInstructorSearch.value = '';
    }
    if (monitoringStudentSearch) {
        monitoringStudentSearch.value = '';
    }
    monitoringState.instructor.members = [];
    monitoringState.instructor.query = '';
    monitoringState.student.members = [];
    monitoringState.student.query = '';
    document.getElementById('plansGrid').innerHTML = '';
    document.getElementById('warningList').innerHTML = '';
    setDashboardNotice('', 'info', true);
}

function setButtonBusy(button, busy, idleText, busyText = 'Working...') {
    if (!button) {
        return;
    }

    button.disabled = busy;
    if (busy) {
        button.textContent = busyText;
        return;
    }

    button.textContent = idleText;
}

function setNotice(elementId, message, tone = 'info') {
    const element = document.getElementById(elementId);
    if (!element) {
        return;
    }

    if (!message) {
        element.hidden = true;
        element.textContent = '';
        element.className = 'notice info';
        return;
    }

    element.hidden = false;
    element.textContent = message;
    element.className = `notice ${tone}`;
}

function setDashboardNotice(message, tone = 'info', forceHide = false) {
    if (forceHide || !message) {
        setNotice('dashboardNotice', '', tone);
        return;
    }

    setNotice('dashboardNotice', message, tone);
}

function establishSession(payload) {
    if (!payload?.token) {
        throw new Error('The deployed server did not return a valid admin session. Please check the published frontend and backend URLs.');
    }

    accessSession = {
        token: payload.token,
        summary: payload.summary || null,
        createdAt: Date.now()
    };
    persistSession(accessSession);
}

function readStoredSession() {
    try {
        const rawValue = localStorage.getItem(ACCESS_SESSION_STORAGE_KEY);
        return rawValue ? JSON.parse(rawValue) : null;
    } catch (error) {
        return null;
    }
}

function persistSession(session) {
    if (!session?.token) {
        localStorage.removeItem(ACCESS_SESSION_STORAGE_KEY);
        return;
    }

    localStorage.setItem(ACCESS_SESSION_STORAGE_KEY, JSON.stringify(session));
}

async function requestAccess(path, options = {}) {
    const {
        method = 'GET',
        body,
        token,
        timeoutMs = ACCESS_REQUEST_TIMEOUT_MS
    } = options;
    const normalizedMethod = String(method || 'GET').toUpperCase();

    const headers = {};
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller
        ? window.setTimeout(() => controller.abort(), timeoutMs)
        : null;

    let response;

    try {
        response = await fetch(`${ACCESS_API_BASE}${path}`, {
            method: normalizedMethod,
            cache: normalizedMethod === 'GET' ? 'no-store' : 'default',
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller?.signal
        });
    } catch (error) {
        if (timeoutId) {
            window.clearTimeout(timeoutId);
        }

        if (error?.name === 'AbortError') {
            throw new Error('The server did not finish this request in time. If the backend just woke up or the database is slow, please wait a few seconds and try again.');
        }

        throw new Error('Unable to reach the server right now. Please check that the published backend is online and try again.');
    }

    if (timeoutId) {
        window.clearTimeout(timeoutId);
    }

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        const error = new Error(payload.message || payload.error || 'Request failed');
        error.status = response.status;
        throw error;
    }

    return payload;
}

async function copyFromElement(elementId) {
    const element = document.getElementById(elementId);
    const value = element
        ? ('value' in element ? String(element.value || '').trim() : String(element.textContent || '').trim())
        : '';

    if (!value || value === '-') {
        showToast('Nothing to copy yet.', 'warning');
        return;
    }

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
        } else {
            fallbackCopy(value);
        }

        showToast('Copied to clipboard.', 'success');
    } catch (error) {
        showToast('Copy failed. Please copy manually.', 'error');
    }
}

function fallbackCopy(value) {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
}

function showToast(message, tone = 'info', durationMs = 2800) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show ${tone}`;

    window.clearTimeout(toastTimeoutId);
    toastTimeoutId = window.setTimeout(() => {
        toast.classList.remove('show');
    }, durationMs);
}

function formatCurrency(amount, currency = 'INR') {
    const value = Number(amount || 0);
    if (currency !== 'INR') {
        return `${currency} ${value}`;
    }
    return `Rs ${value.toLocaleString('en-IN')}`;
}

function formatPlanPrice(amount) {
    return `${formatCurrency(amount)}/month`;
}

function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '-';
    }

    return date.toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short'
    });
}

function formatMonitoringDate(value, fallback = '-') {
    if (!value) {
        return fallback;
    }

    const formatted = formatDateTime(value);
    return formatted === '-' ? fallback : formatted;
}

function formatUsageValue(metric) {
    return `${Number(metric?.current || 0)} / ${Number(metric?.limit || 0)}`;
}

function formatUsageMeta(metric) {
    const percentage = Number(metric?.percentage || 0);
    const remaining = Number(metric?.remaining || 0);
    return `${percentage}% used | ${remaining} seats remaining`;
}

function formatStatusLabel(value) {
    return capitalize(String(value || '-').replace(/[-_]/g, ' '));
}

function capitalize(value) {
    if (!value) {
        return '-';
    }

    return String(value).replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusTone(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'completed' || normalized === 'success' || normalized === 'workspace-created'
        ? 'success'
        : 'failed';
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
