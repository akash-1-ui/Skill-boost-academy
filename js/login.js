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

const forgotModal = document.getElementById('forgotPasswordModal');
const forgotCloseBtn = document.getElementById('forgotCloseBtn');
const forgotRole = document.getElementById('forgotRole');
const forgotPhone = document.getElementById('forgotPhone');
const forgotOtp = document.getElementById('forgotOtp');
const forgotNewPassword = document.getElementById('forgotNewPassword');
const forgotConfirmPassword = document.getElementById('forgotConfirmPassword');
const forgotStepRequest = document.getElementById('forgotStepRequest');
const forgotStepVerify = document.getElementById('forgotStepVerify');
const forgotStatus = document.getElementById('forgotStatus');
const sendResetCodeBtn = document.getElementById('sendResetCodeBtn');
const resetPasswordBtn = document.getElementById('resetPasswordBtn');

const loginQuery = new URLSearchParams(window.location.search);
const requestedRole = loginQuery.get('role');
const presetAccessCode = normalizeAccessCode(loginQuery.get('code'));
const presetEmail = String(loginQuery.get('email') || '').trim();
const loginNotice = String(loginQuery.get('notice') || '').trim();

let pendingResetPhone = '';
let pendingResetRole = '';
let currentRole = 'instructor';

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
  setRoleView(selectedRole);
}

function openForgotModal(initialRole) {
  const resolvedRole = initialRole || currentRole || 'student';
  forgotRole.value = resolvedRole;
  forgotPhone.value = '';
  forgotOtp.value = '';
  forgotNewPassword.value = '';
  forgotConfirmPassword.value = '';
  pendingResetPhone = '';
  pendingResetRole = resolvedRole;
  forgotStepRequest.style.display = 'flex';
  forgotStepVerify.style.display = 'none';
  setForgotStatus('', null);
  forgotModal.classList.add('show');
  forgotModal.setAttribute('aria-hidden', 'false');
}

function closeForgotModal() {
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
  const targetStatus = requestedRole === 'student' ? studentLoginStatus : instructorLoginStatus;
  setAuthStatus(
    targetStatus,
    'This access code has reached its active user limit for your account. Please use another access code.',
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

sendResetCodeBtn.addEventListener('click', async () => {
  const rawPhone = forgotPhone.value.trim();
  const phone = rawPhone.replace(/\D/g, '');
  const role = forgotRole.value;

  if (!phone || phone.length < 10) {
    setForgotStatus('Enter a valid mobile number.', 'error');
    return;
  }

  if (!role) {
    setForgotStatus('Select a valid role.', 'error');
    return;
  }

  sendResetCodeBtn.disabled = true;
  sendResetCodeBtn.textContent = 'Sending...';
  setForgotStatus('', null);

  try {
    const res = await fetch('http://localhost:3000/api/forgot-password/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, role })
    });

    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      setForgotStatus(payload.error || 'Failed to send verification code.', 'error');
      return;
    }

    pendingResetPhone = phone;
    pendingResetRole = role;
    forgotStepRequest.style.display = 'none';
    forgotStepVerify.style.display = 'flex';

    const devOtpNote = payload.devOtp ? ` Dev code: ${payload.devOtp}` : '';
    setForgotStatus((payload.message || 'Verification code sent successfully.') + devOtpNote, 'success');
  } catch (error) {
    console.error('Send OTP error:', error);
    setForgotStatus('Network error. Please try again.', 'error');
  } finally {
    sendResetCodeBtn.disabled = false;
    sendResetCodeBtn.textContent = 'Send Code';
  }
});

resetPasswordBtn.addEventListener('click', async () => {
  const otp = forgotOtp.value.trim();
  const newPassword = forgotNewPassword.value;
  const confirmPassword = forgotConfirmPassword.value;

  if (!pendingResetPhone || !pendingResetRole) {
    setForgotStatus('Please request a verification code first.', 'error');
    forgotStepRequest.style.display = 'flex';
    forgotStepVerify.style.display = 'none';
    return;
  }

  if (!otp || otp.length !== 6) {
    setForgotStatus('Enter the 6-digit verification code.', 'error');
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
    const res = await fetch('http://localhost:3000/api/forgot-password/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: pendingResetPhone,
        role: pendingResetRole,
        otp,
        newPassword
      })
    });

    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      setForgotStatus(payload.error || 'Failed to reset password.', 'error');
      return;
    }

    setForgotStatus(payload.message || 'Password reset successful. Please login again.', 'success');
    setTimeout(() => {
      closeForgotModal();
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
    const res = await fetch('http://localhost:3000/api/login/student', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, accessCode })
    });

    const result = await res.json().catch(() => ({ error: 'Invalid server response' }));

    if (!res.ok) {
      setAuthStatus(
        studentLoginStatus,
        result.error || 'Login failed. Please check your credentials and try again.',
        'error'
      );
      return;
    }

    setAuthStatus(studentLoginStatus, 'Login successful. Opening your dashboard...', 'success');

    fetch(`http://localhost:3000/api/student-profile?email=${encodeURIComponent(email)}`)
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
    const res = await fetch('http://localhost:3000/api/login/instructor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, accessCode })
    });

    const payload = await res.json().catch(() => ({ error: 'Invalid server response' }));

    if (!res.ok) {
      setAuthStatus(
        instructorLoginStatus,
        payload.error || 'Login failed. Please check your credentials and try again.',
        'error'
      );
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
