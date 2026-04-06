const studentForm = document.getElementById('studentLoginForm');
const instructorForm = document.getElementById('instructorLoginForm');
const registerLink = document.getElementById('registerLink');
const registerHref = document.getElementById('registerHref');
const roleTabs = document.querySelectorAll('.role-tab');
const roleTabsContainer = document.querySelector('.role-tabs');
const switchRoleBlocks = document.querySelectorAll('.switch-role');
const switchRoleLinks = document.querySelectorAll('.switch-role a');

const studentAccessCodeInput = document.getElementById('studentAccessCode');
const studentEmailInput = document.getElementById('studentEmail');
const studentPasswordInput = document.getElementById('studentPassword');
const instructorAccessCodeInput = document.getElementById('instructorAccessCode');
const instructorEmailInput = document.getElementById('instructorEmail');
const instructorPasswordInput = document.getElementById('instructorPassword');
const studentLoginStatus = document.getElementById('studentLoginStatus');
const instructorLoginStatus = document.getElementById('instructorLoginStatus');
const loginIntroTitle = document.getElementById('loginIntroTitle');
const loginIntroCopy = document.getElementById('loginIntroCopy');
const loginRoleBadge = document.getElementById('loginRoleBadge');
const loginRoleFeatureTitle = document.getElementById('loginRoleFeatureTitle');
const loginRoleFeatureList = document.getElementById('loginRoleFeatureList');
const loginRoleTipTitle = document.getElementById('loginRoleTipTitle');
const loginRoleTipText = document.getElementById('loginRoleTipText');
const loginRoleTipBadge = document.getElementById('loginRoleTipBadge');

const forgotModal = document.getElementById('forgotPasswordModal');
const forgotCloseBtn = document.getElementById('forgotCloseBtn');
const forgotRole = document.getElementById('forgotRole');
const forgotEmail = document.getElementById('forgotEmail');
const forgotOtp = document.getElementById('forgotOtp');
const forgotNewPassword = document.getElementById('forgotNewPassword');
const forgotConfirmPassword = document.getElementById('forgotConfirmPassword');
const forgotStepRequest = document.getElementById('forgotStepRequest');
const forgotStepVerify = document.getElementById('forgotStepVerify');
const forgotStepReset = document.getElementById('forgotStepReset');
const forgotStatus = document.getElementById('forgotStatus');
const forgotDeliveryNote = document.getElementById('forgotDeliveryNote');
const forgotOtpTimer = document.getElementById('forgotOtpTimer');
const forgotResetEmail = document.getElementById('forgotResetEmail');
const sendResetCodeBtn = document.getElementById('sendResetCodeBtn');
const resendResetCodeBtn = document.getElementById('resendResetCodeBtn');
const verifyResetCodeBtn = document.getElementById('verifyResetCodeBtn');
const resetPasswordBtn = document.getElementById('resetPasswordBtn');
const buildApiUrl = window.SkillBoostApp?.buildApiUrl
  || ((path = '') => `${window.location.origin}${String(path || '').startsWith('/') ? path : `/${path}`}`);

const loginQuery = new URLSearchParams(window.location.search);
const requestedRole = loginQuery.get('role');
const presetAccessCode = normalizeAccessCode(loginQuery.get('code'));
const presetEmail = String(loginQuery.get('email') || '').trim();
const loginNotice = String(loginQuery.get('notice') || '').trim();

let pendingResetEmail = '';
let pendingResetRole = '';
let pendingResetToken = '';
let forgotOtpExpiresAt = 0;
let forgotResendAvailableAt = 0;
let forgotOtpTimerId = null;
let currentRole = 'instructor';

const loginRoleContent = {
  student: {
    title: 'Sign in as a student and continue learning without losing momentum.',
    copy: 'Use your academy access code to open lessons, track progress, and stay connected with instructor updates.',
    badge: 'Student Access',
    featureTitle: 'Features available for students',
    features: [
      'Resume enrolled courses and continue lessons quickly.',
      'Watch academy videos and learning materials in one place.',
      'Track your learning progress and course activity.',
      'Receive announcements and updates from instructors.'
    ],
    tipTitle: 'Student sign-in tip',
    tipText: 'Use the academy access code shared by your academy to enter the correct student dashboard.',
    tipBadge: 'Student'
  },
  instructor: {
    title: 'Sign in as an instructor and return to your teaching dashboard.',
    copy: 'Use your academy access code to manage courses, upload lessons, and support learners from one place.',
    badge: 'Instructor Access',
    featureTitle: 'Features available for instructors',
    features: [
      'Create and manage academy courses from one dashboard.',
      'Upload videos and organize learning materials.',
      'Monitor student enrollment and course activity.',
      'Share announcements and updates with students.'
    ],
    tipTitle: 'Instructor sign-in tip',
    tipText: 'Use the academy access code shared by the academy owner to open the correct instructor workspace.',
    tipBadge: 'Instructor'
  }
};

function normalizeAccessCode(value) {
  return String(value || '').trim().toUpperCase();
}

function getPreferredAccessCode() {
  return normalizeAccessCode(
    studentAccessCodeInput?.value ||
    instructorAccessCodeInput?.value ||
    presetAccessCode
  );
}

function buildHref(basePath, extraParams = {}) {
  const params = new URLSearchParams();
  const accessCode = getPreferredAccessCode();

  Object.entries(extraParams).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });

  if (accessCode) {
    params.set('code', accessCode);
  }

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function getRoleEmailInput(role) {
  return role === 'student' ? studentEmailInput : instructorEmailInput;
}

function getForgotPrefillEmail(role) {
  return normalizeEmail(getRoleEmailInput(role)?.value || '');
}

function formatOtpCountdown(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function clearForgotOtpTimer() {
  if (forgotOtpTimerId) {
    window.clearInterval(forgotOtpTimerId);
    forgotOtpTimerId = null;
  }

  forgotOtpExpiresAt = 0;
  forgotResendAvailableAt = 0;

  if (forgotOtpTimer) {
    forgotOtpTimer.textContent = 'Code expires in 02:00';
  }

  if (resendResetCodeBtn) {
    resendResetCodeBtn.hidden = true;
    resendResetCodeBtn.disabled = true;
    resendResetCodeBtn.textContent = 'Resend Code';
  }
}

function setForgotStep(stepName) {
  forgotStepRequest.style.display = stepName === 'request' ? 'flex' : 'none';
  forgotStepVerify.style.display = stepName === 'verify' ? 'flex' : 'none';
  forgotStepReset.style.display = stepName === 'reset' ? 'flex' : 'none';
}

function updateForgotOtpTimer() {
  const now = Date.now();
  const secondsLeft = forgotOtpExpiresAt
    ? Math.max(0, Math.ceil((forgotOtpExpiresAt - now) / 1000))
    : 0;
  const canResend = forgotResendAvailableAt > 0 && now >= forgotResendAvailableAt;

  if (forgotOtpTimer) {
    forgotOtpTimer.textContent = secondsLeft > 0
      ? `Code expires in ${formatOtpCountdown(secondsLeft)}`
      : 'Code expired. Resend to get a new code.';
  }

  if (verifyResetCodeBtn && forgotStepVerify.style.display !== 'none') {
    verifyResetCodeBtn.disabled = secondsLeft === 0;
  }

  if (resendResetCodeBtn) {
    resendResetCodeBtn.hidden = !canResend;
    resendResetCodeBtn.disabled = !canResend;
  }

  if (secondsLeft === 0 && forgotOtpTimerId) {
    window.clearInterval(forgotOtpTimerId);
    forgotOtpTimerId = null;
  }
}

function startForgotOtpTimer(expiresInSeconds, resendAfterSeconds = expiresInSeconds) {
  clearForgotOtpTimer();

  const safeExpirySeconds = Math.max(0, Number(expiresInSeconds) || 0);
  const safeResendSeconds = Math.max(0, Number(resendAfterSeconds) || safeExpirySeconds);

  forgotOtpExpiresAt = Date.now() + safeExpirySeconds * 1000;
  forgotResendAvailableAt = Date.now() + safeResendSeconds * 1000;

  updateForgotOtpTimer();
  forgotOtpTimerId = window.setInterval(updateForgotOtpTimer, 1000);
}

function setForgotStatus(message, type) {
  forgotStatus.textContent = message || '';
  forgotStatus.classList.remove('forgot-status-error', 'forgot-status-success');
  if (type === 'error') forgotStatus.classList.add('forgot-status-error');
  if (type === 'success') forgotStatus.classList.add('forgot-status-success');
}

function setAuthStatus(element, message, type = 'info') {
  if (!element) {
    return;
  }

  if (!message) {
    element.hidden = true;
    element.textContent = '';
    element.className = 'auth-status';
    return;
  }

  element.hidden = false;
  element.textContent = message;
  element.className = `auth-status ${type}`;
}

function setSubmitState(form, busy, busyLabel) {
  const submitButton = form?.querySelector("button[type='submit']");
  if (!submitButton) {
    return;
  }

  if (!submitButton.dataset.defaultLabel) {
    submitButton.dataset.defaultLabel = submitButton.textContent;
  }

  submitButton.disabled = busy;
  submitButton.textContent = busy ? busyLabel : submitButton.dataset.defaultLabel;
}

function getRoleStatusElement(role) {
  return role === 'student' ? studentLoginStatus : instructorLoginStatus;
}

function getRoleLabel(role) {
  return role === 'student' ? 'Student' : 'Instructor';
}

function setRoleStatus(role, message, type = 'error') {
  const statusElement = getRoleStatusElement(role);
  if (!statusElement) {
    return null;
  }

  setAuthStatus(statusElement, message, type);
}

function renderRoleIntro(selectedRole) {
  const content = loginRoleContent[selectedRole] || loginRoleContent.instructor;

  if (loginIntroTitle) loginIntroTitle.textContent = content.title;
  if (loginIntroCopy) loginIntroCopy.textContent = content.copy;
  if (loginRoleBadge) loginRoleBadge.textContent = content.badge;
  if (loginRoleFeatureTitle) loginRoleFeatureTitle.textContent = content.featureTitle;
  if (loginRoleTipTitle) loginRoleTipTitle.textContent = content.tipTitle;
  if (loginRoleTipText) loginRoleTipText.textContent = content.tipText;
  if (loginRoleTipBadge) loginRoleTipBadge.textContent = content.tipBadge;

  if (loginRoleFeatureList) {
    loginRoleFeatureList.innerHTML = '';

    content.features.forEach((feature) => {
      const item = document.createElement('li');
      item.textContent = feature;
      loginRoleFeatureList.appendChild(item);
    });
  }
}

function updateAccessAwareLinks() {
  if (registerHref) {
    registerHref.href = currentRole === 'student'
      ? buildHref('registration.html')
      : buildHref('instructor_registration.html');
  }

  switchRoleLinks.forEach((link) => {
    const targetRole = (link.getAttribute('href') || '').includes('role=student') ? 'student' : 'instructor';
    link.href = buildHref('login.html', { role: targetRole });
  });
}

function applyPrefillValues() {
  if (presetAccessCode) {
    if (studentAccessCodeInput) studentAccessCodeInput.value = presetAccessCode;
    if (instructorAccessCodeInput) instructorAccessCodeInput.value = presetAccessCode;
  }

  if (presetEmail) {
    if (requestedRole === 'student' && studentEmailInput) {
      studentEmailInput.value = presetEmail;
    }

    if (requestedRole === 'instructor' && instructorEmailInput) {
      instructorEmailInput.value = presetEmail;
    }
  }
}

function setRoleView(selectedRole) {
  if (studentForm) studentForm.style.display = 'none';
  if (instructorForm) instructorForm.style.display = 'none';
  if (registerLink) registerLink.style.display = 'none';

  if (selectedRole === 'student') {
    if (studentForm) studentForm.style.display = 'flex';
    if (registerLink) registerLink.style.display = 'block';
  } else if (selectedRole === 'instructor') {
    if (instructorForm) instructorForm.style.display = 'flex';
    if (registerLink) registerLink.style.display = 'block';
  }

  updateAccessAwareLinks();
}

function setActiveRole(selectedRole) {
  currentRole = selectedRole;
  roleTabs.forEach((tab) => {
    const isActive = tab.dataset.role === selectedRole;
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    tab.classList.toggle('active', isActive);
  });
  renderRoleIntro(selectedRole);
  setRoleView(selectedRole);
}

function openForgotModal(initialRole) {
  const resolvedRole = initialRole || currentRole || 'student';
  forgotRole.value = resolvedRole;
  forgotEmail.value = getForgotPrefillEmail(resolvedRole);
  if (forgotResetEmail) {
    forgotResetEmail.value = '';
  }
  forgotOtp.value = '';
  forgotNewPassword.value = '';
  forgotConfirmPassword.value = '';
  pendingResetEmail = '';
  pendingResetRole = resolvedRole;
  pendingResetToken = '';
  if (forgotDeliveryNote) {
    forgotDeliveryNote.textContent = 'We sent a 6-digit verification code to your email.';
  }
  clearForgotOtpTimer();
  setForgotStep('request');
  setForgotStatus('', null);
  forgotModal.classList.add('show');
  forgotModal.setAttribute('aria-hidden', 'false');
}

function closeForgotModal() {
  clearForgotOtpTimer();
  pendingResetEmail = '';
  pendingResetRole = '';
  pendingResetToken = '';
  forgotModal.classList.remove('show');
  forgotModal.setAttribute('aria-hidden', 'true');
}

roleTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const selectedRole = tab.dataset.role;
    if (selectedRole) {
      setActiveRole(selectedRole);
    }
  });
});

const isForcedRole = requestedRole === 'student' || requestedRole === 'instructor';
if (isForcedRole) {
  setActiveRole(requestedRole);
  if (roleTabsContainer) roleTabsContainer.classList.add('is-hidden');
  switchRoleBlocks.forEach((block) => block.classList.add('is-hidden'));
} else {
  setActiveRole('instructor');
}

applyPrefillValues();
updateAccessAwareLinks();

if (loginNotice === 'use_another_code') {
  const noticeRole = requestedRole === 'student' || requestedRole === 'instructor' ? requestedRole : currentRole;
  setRoleStatus(
    noticeRole,
    `${getRoleLabel(noticeRole)} access for this academy code is already full. Please use another access code or contact the academy owner.`,
    'error'
  );
}

if (loginNotice === 'restricted_by_admin') {
  const noticeRole = requestedRole === 'student' || requestedRole === 'instructor' ? requestedRole : currentRole;
  setRoleStatus(
    noticeRole,
    `${getRoleLabel(noticeRole)} access has been restricted by the academy admin. Please contact the academy admin to restore access.`,
    'error'
  );
}

[studentAccessCodeInput, instructorAccessCodeInput].forEach((input) => {
  input?.addEventListener('input', () => {
    input.value = normalizeAccessCode(input.value);
    updateAccessAwareLinks();
  });
});

const forgotPasswordLinks = document.querySelectorAll('.forgot-password-link');
forgotPasswordLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    openForgotModal(link.dataset.role);
  });
});

forgotCloseBtn.addEventListener('click', closeForgotModal);

forgotModal.addEventListener('click', (event) => {
  if (event.target === forgotModal) {
    closeForgotModal();
  }
});

forgotRole?.addEventListener('change', () => {
  if (forgotStepRequest.style.display !== 'none') {
    forgotEmail.value = getForgotPrefillEmail(forgotRole.value);
  }
});

forgotOtp?.addEventListener('input', () => {
  forgotOtp.value = forgotOtp.value.replace(/\D/g, '').slice(0, 6);
});

async function requestResetCode({ isResend = false } = {}) {
  const role = isResend ? pendingResetRole : forgotRole.value;
  const email = normalizeEmail(isResend ? pendingResetEmail : forgotEmail.value);
  const actionButton = isResend ? resendResetCodeBtn : sendResetCodeBtn;
  const defaultLabel = isResend ? 'Resend Code' : 'Send Code';

  if (!isValidEmail(email)) {
    setForgotStatus('Enter a valid registered Gmail address.', 'error');
    return;
  }

  if (!role) {
    setForgotStatus('Select a valid role.', 'error');
    return;
  }

  if (isResend && forgotResendAvailableAt && Date.now() < forgotResendAvailableAt) {
    const secondsRemaining = Math.max(1, Math.ceil((forgotResendAvailableAt - Date.now()) / 1000));
    setForgotStatus(`Please wait ${secondsRemaining} seconds before resending the code.`, 'error');
    return;
  }

  actionButton.disabled = true;
  actionButton.textContent = 'Sending...';
  setForgotStatus('', null);

  try {
    const res = await fetch(buildApiUrl('/api/forgot-password/send-otp'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role })
    });

    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      setForgotStatus(payload.error || 'Failed to send verification code.', 'error');
      return;
    }

    pendingResetEmail = email;
    pendingResetRole = role;
    pendingResetToken = '';
    forgotOtp.value = '';
    forgotNewPassword.value = '';
    forgotConfirmPassword.value = '';
    setForgotStep('verify');

    if (forgotDeliveryNote) {
      forgotDeliveryNote.textContent = `We sent a 6-digit verification code to ${payload.maskedEmail || email}.`;
    }

    startForgotOtpTimer(
      payload.expiresInSeconds || 120,
      payload.resendAfterSeconds || payload.expiresInSeconds || 120
    );

    setForgotStatus(payload.message || 'Verification code sent successfully.', 'success');
  } catch (error) {
    console.error('Send OTP error:', error);
    setForgotStatus('Network error. Please try again.', 'error');
  } finally {
    actionButton.textContent = defaultLabel;
    if (isResend) {
      updateForgotOtpTimer();
    } else {
      actionButton.disabled = false;
    }
  }
}

sendResetCodeBtn.addEventListener('click', () => {
  requestResetCode();
});

resendResetCodeBtn?.addEventListener('click', () => {
  requestResetCode({ isResend: true });
});

verifyResetCodeBtn?.addEventListener('click', async () => {
  const otp = forgotOtp.value.trim();

  if (!pendingResetEmail || !pendingResetRole) {
    setForgotStatus('Please request a verification code first.', 'error');
    setForgotStep('request');
    return;
  }

  if (forgotOtpExpiresAt && Date.now() > forgotOtpExpiresAt) {
    updateForgotOtpTimer();
    setForgotStatus('Verification code expired. Please resend a new code.', 'error');
    return;
  }

  if (!/^\d{6}$/.test(otp)) {
    setForgotStatus('Enter the 6-digit verification code.', 'error');
    return;
  }

  verifyResetCodeBtn.disabled = true;
  verifyResetCodeBtn.textContent = 'Verifying...';
  setForgotStatus('', null);

  try {
    const res = await fetch(buildApiUrl('/api/forgot-password/verify-otp'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: pendingResetEmail,
        role: pendingResetRole,
        otp
      })
    });

    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      setForgotStatus(payload.error || 'Failed to verify the code.', 'error');
      return;
    }

    if (!payload.resetToken) {
      setForgotStatus('Verification completed, but the reset session could not be started. Please try again.', 'error');
      return;
    }

    pendingResetToken = payload.resetToken;
    if (forgotResetEmail) {
      forgotResetEmail.value = pendingResetEmail;
    }
    clearForgotOtpTimer();
    setForgotStep('reset');
    setForgotStatus(payload.message || 'Verification successful. You can now change your password.', 'success');
  } catch (error) {
    console.error('Verify OTP error:', error);
    setForgotStatus('Network error. Please try again.', 'error');
  } finally {
    verifyResetCodeBtn.disabled = false;
    verifyResetCodeBtn.textContent = 'Verify Code';
  }
});

forgotStepReset?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const newPassword = forgotNewPassword.value;
  const confirmPassword = forgotConfirmPassword.value;

  if (!pendingResetToken) {
    setForgotStatus('Please verify the email code first.', 'error');
    setForgotStep('verify');
    return;
  }

  if (!newPassword || newPassword.length < 6) {
    setForgotStatus('New password must be at least 6 characters.', 'error');
    return;
  }

  if (newPassword !== confirmPassword) {
    setForgotStatus('New password and confirm password do not match.', 'error');
    return;
  }

  resetPasswordBtn.disabled = true;
  resetPasswordBtn.textContent = 'Updating...';
  setForgotStatus('', null);

  try {
    const res = await fetch(buildApiUrl('/api/forgot-password/reset-password'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resetToken: pendingResetToken,
        newPassword
      })
    });

    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      setForgotStatus(payload.error || 'Failed to reset password.', 'error');
      return;
    }

    setForgotStatus(payload.message || 'Password reset successful. Please login again.', 'success');
    pendingResetToken = '';

    setTimeout(() => {
      closeForgotModal();
      forgotEmail.value = '';
      forgotOtp.value = '';
      forgotNewPassword.value = '';
      forgotConfirmPassword.value = '';
    }, 1000);
  } catch (error) {
    console.error('Reset password error:', error);
    setForgotStatus('Network error. Please try again.', 'error');
  } finally {
    resetPasswordBtn.disabled = false;
    resetPasswordBtn.textContent = 'Reset Password';
  }
});

studentForm?.addEventListener('submit', async (event) => {
  event.preventDefault();

  const accessCode = normalizeAccessCode(studentAccessCodeInput.value);
  const email = studentEmailInput.value.trim();
  const password = studentPasswordInput.value;

  studentAccessCodeInput.value = accessCode;

  if (!accessCode || !email || !password) {
    setAuthStatus(studentLoginStatus, 'Please enter the academy access code, email, and password.', 'error');
    return;
  }

  setAuthStatus(studentLoginStatus, 'Signing in to the student dashboard...', 'info');
  setSubmitState(studentForm, true, 'Signing In...');

  try {
    const res = await fetch(buildApiUrl('/api/login/student'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, accessCode })
    });

    const result = await res.json().catch(() => ({ error: 'Invalid server response' }));

    if (!res.ok) {
      const errorMessage = result.error || 'Login failed. Please check your credentials and try again.';
      setAuthStatus(studentLoginStatus, errorMessage, 'error');
      return;
    }

    setAuthStatus(studentLoginStatus, 'Login successful. Opening your dashboard...', 'success');

    fetch(buildApiUrl(`/api/student-profile?email=${encodeURIComponent(email)}`))
      .then((res2) => res2.json())
      .then((profile) => {
        const resolvedStudentId = String(profile?.id || result?.student?.id || '');
        const resolvedStudentName = profile?.name || result?.student?.name || email;

        if (result?.student?.id) {
          localStorage.setItem('studentId', String(result.student.id));
        }
        if (profile?.name) {
          localStorage.setItem(`studentName_${email}`, profile.name);
        }
        if (profile?.id) {
          localStorage.setItem('studentId', String(profile.id));
        }

        localStorage.setItem('studentEmail', email);
        localStorage.setItem('academyId', result?.student?.academy_id || '');
        localStorage.setItem('user', JSON.stringify({
          id: resolvedStudentId,
          role: 'student',
          username: resolvedStudentName,
          email
        }));
        window.location.href = 'student_home.html';
      })
      .catch(() => {
        const fallbackStudentId = String(result?.student?.id || '');
        const fallbackStudentName = result?.student?.name || email;

        if (result?.student?.id) {
          localStorage.setItem('studentId', String(result.student.id));
        }

        localStorage.setItem('studentEmail', email);
        localStorage.setItem('academyId', result?.student?.academy_id || '');
        localStorage.setItem('user', JSON.stringify({
          id: fallbackStudentId,
          role: 'student',
          username: fallbackStudentName,
          email
        }));
        window.location.href = 'student_home.html';
      });
  } catch (error) {
    console.error('Student login failed:', error);
    setAuthStatus(studentLoginStatus, 'Network error or server unavailable. Please try again.', 'error');
  } finally {
    setSubmitState(studentForm, false, 'Signing In...');
  }
});

instructorForm?.addEventListener('submit', async (event) => {
  event.preventDefault();

  const accessCode = normalizeAccessCode(instructorAccessCodeInput.value);
  const email = instructorEmailInput.value.trim();
  const password = instructorPasswordInput.value;

  instructorAccessCodeInput.value = accessCode;

  if (!accessCode || !email || !password) {
    setAuthStatus(instructorLoginStatus, 'Please enter the academy access code, email, and password.', 'error');
    return;
  }

  setAuthStatus(instructorLoginStatus, 'Signing in to the instructor dashboard...', 'info');
  setSubmitState(instructorForm, true, 'Signing In...');

  try {
    const res = await fetch(buildApiUrl('/api/login/instructor'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, accessCode })
    });

    const payload = await res.json().catch(() => ({ error: 'Invalid server response' }));

    if (!res.ok) {
      const errorMessage = payload.error || 'Login failed. Please check your credentials and try again.';
      setAuthStatus(instructorLoginStatus, errorMessage, 'error');
      return;
    }

    if (!payload.instructor || !payload.instructor.id) {
      throw new Error('Invalid instructor data received');
    }

    localStorage.setItem('instructorId', payload.instructor.id);
    localStorage.setItem('instructorName', payload.instructor.name);
    localStorage.setItem('instructorPhoto', payload.instructor.photo || '/uploads/default-avatar.svg');
    localStorage.setItem('instructorEmail', payload.instructor.email);
    localStorage.setItem('academyId', payload.instructor.academy_id || '');
    localStorage.setItem('user', JSON.stringify({
      id: String(payload.instructor.id),
      role: 'instructor',
      username: payload.instructor.name || payload.instructor.email || 'Instructor',
      email: payload.instructor.email || email
    }));

    setAuthStatus(instructorLoginStatus, 'Login successful. Opening your dashboard...', 'success');
    window.location.href = 'instructor_home.html';
  } catch (error) {
    console.error('Instructor login failed:', error);
    setAuthStatus(instructorLoginStatus, error.message || 'Login failed. Please try again.', 'error');
  } finally {
    setSubmitState(instructorForm, false, 'Signing In...');
  }
});
