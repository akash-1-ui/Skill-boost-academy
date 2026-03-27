const studentForm = document.getElementById('studentLoginForm');
const instructorForm = document.getElementById('instructorLoginForm');
const registerLink = document.getElementById('registerLink');
const registerHref = document.getElementById('registerHref');
const roleTabs = document.querySelectorAll('.role-tab');
const roleTabsContainer = document.querySelector('.role-tabs');
const switchRoleBlocks = document.querySelectorAll('.switch-role');

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

let pendingResetPhone = '';
let pendingResetRole = '';
let currentRole = 'instructor';

function setForgotStatus(message, type) {
  forgotStatus.textContent = message || '';
  forgotStatus.classList.remove('forgot-status-error', 'forgot-status-success');
  if (type === 'error') forgotStatus.classList.add('forgot-status-error');
  if (type === 'success') forgotStatus.classList.add('forgot-status-success');
}

function setRoleView(selectedRole) {
  studentForm.style.display = 'none';
  instructorForm.style.display = 'none';
  registerLink.style.display = 'none';

  if (selectedRole === 'student') {
    studentForm.style.display = 'flex';
    registerHref.href = 'registration.html';
    registerLink.style.display = 'block';
  } else if (selectedRole === 'instructor') {
    instructorForm.style.display = 'flex';
    registerHref.href = 'instructor_registration.html';
    registerLink.style.display = 'block';
  }
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

const initialRole = new URLSearchParams(window.location.search).get('role');
const isForcedRole = initialRole === 'student' || initialRole === 'instructor';
if (isForcedRole) {
  setActiveRole(initialRole);
  if (roleTabsContainer) roleTabsContainer.classList.add('is-hidden');
  switchRoleBlocks.forEach((block) => block.classList.add('is-hidden'));
} else {
  setActiveRole('instructor');
}

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

studentForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('studentEmail').value;
  const password = document.getElementById('studentPassword').value;

  try {
    const res = await fetch('http://localhost:3000/api/login/student', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    let result;
    try {
      result = await res.json();
    } catch (jsonErr) {
      result = { error: 'Invalid server response' };
    }

    if (res.ok) {
      fetch(`http://localhost:3000/api/student-profile?email=${encodeURIComponent(email)}`)
        .then((res2) => res2.json())
        .then((profile) => {
          if (result && result.student && result.student.id) {
            localStorage.setItem('studentId', String(result.student.id));
          }
          if (profile && profile.name) {
            localStorage.setItem(`studentName_${email}`, profile.name);
          }
          if (profile && profile.id) {
            localStorage.setItem('studentId', String(profile.id));
          }
          localStorage.setItem('studentEmail', email);
          window.location.href = 'student_home.html';
        })
        .catch(() => {
          if (result && result.student && result.student.id) {
            localStorage.setItem('studentId', String(result.student.id));
          }
          localStorage.setItem('studentEmail', email);
          window.location.href = 'student_home.html';
        });
    } else {
      alert(result.error || 'Login failed. Please check your credentials and try again.');
    }
  } catch (err) {
    console.error('Login failed:', err);
    alert('Network error or server unavailable. Please check your connection and try again.');
  }
});

instructorForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('instructorEmail').value;
  const password = document.getElementById('instructorPassword').value;

  try {
    const res = await fetch('http://localhost:3000/api/login/instructor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    let data;
    try {
      data = await res.json();
    } catch (jsonErr) {
      data = { error: 'Invalid server response' };
    }

    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }

    if (!data.instructor || !data.instructor.id) {
      throw new Error('Invalid instructor data received');
    }

    localStorage.setItem('instructorId', data.instructor.id);
    localStorage.setItem('instructorName', data.instructor.name);
    localStorage.setItem('instructorPhoto', data.instructor.photo || '/uploads/default-avatar.svg');
    localStorage.setItem('instructorEmail', data.instructor.email);

    window.location.href = 'instructor_home.html';
  } catch (err) {
    console.error('Login failed:', err);
    alert(err.message || 'Login failed. Please try again.');
  }
});
