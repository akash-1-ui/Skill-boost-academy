const instructorRegistrationForm = document.getElementById('instructorRegistrationForm');
const instructorAccessCodeInput = document.getElementById('accessCode');
const instructorSuccessMessage = document.getElementById('success-message');
const instructorRegistrationStatus = document.getElementById('instructorRegistrationStatus');
const authToast = document.getElementById('authToast');

const instructorRegistrationQuery = new URLSearchParams(window.location.search);
const presetInstructorAccessCode = normalizeAccessCode(instructorRegistrationQuery.get('code'));
const buildApiUrl = window.SkillBoostApp?.buildApiUrl
  || ((path = '') => `${window.location.origin}${String(path || '').startsWith('/') ? path : `/${path}`}`);
let authToastTimeoutId = null;

if (instructorAccessCodeInput && presetInstructorAccessCode) {
  instructorAccessCodeInput.value = presetInstructorAccessCode;
}

function normalizeAccessCode(value) {
  return String(value || '').trim().toUpperCase();
}

function setInstructorRegistrationStatus(message, type = 'info') {
  if (!instructorRegistrationStatus) {
    return;
  }

  if (!message) {
    instructorRegistrationStatus.hidden = true;
    instructorRegistrationStatus.textContent = '';
    instructorRegistrationStatus.className = 'auth-status';
    return;
  }

  instructorRegistrationStatus.hidden = false;
  instructorRegistrationStatus.textContent = message;
  instructorRegistrationStatus.className = `auth-status ${type}`;
}

function hideAuthToast() {
  if (!authToast) {
    return;
  }

  authToast.classList.remove('show');
}

function showAuthToast(message, type = 'info', durationMs = 3200) {
  if (!authToast || !message) {
    return;
  }

  authToast.textContent = message;
  authToast.className = `auth-toast show ${type}`;

  window.clearTimeout(authToastTimeoutId);
  authToastTimeoutId = window.setTimeout(() => {
    hideAuthToast();
  }, durationMs);
}

function setInstructorSubmitState(button, busy, busyLabel) {
  if (!button) {
    return;
  }

  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent;
  }

  button.disabled = busy;
  button.textContent = busy ? busyLabel : button.dataset.defaultLabel;
}

instructorRegistrationForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const submitButton = instructorRegistrationForm.querySelector("button[type='submit']");
  const accessCode = normalizeAccessCode(instructorAccessCodeInput.value);
  const name = document.getElementById('fullname').value.trim();
  const email = document.getElementById('email').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const expertise = document.getElementById('expertise').value.trim();
  const password = document.getElementById('password').value;

  instructorAccessCodeInput.value = accessCode;
  instructorSuccessMessage.style.display = 'none';

  if (!accessCode || !name || !email || !expertise || !password) {
    setInstructorRegistrationStatus('', 'info');
    showAuthToast('Please fill in every required field, including the academy access code.', 'warning', 3600);
    return;
  }

  if (!email.includes('@')) {
    setInstructorRegistrationStatus('', 'info');
    showAuthToast('Please enter a valid email address.', 'warning', 3600);
    return;
  }

  setInstructorRegistrationStatus('', 'info');
  showAuthToast('Creating your instructor account...', 'info', 10000);
  setInstructorSubmitState(submitButton, true, 'Registering...');
  let redirectScheduled = false;

  try {
    const response = await fetch(buildApiUrl('/api/register/instructor'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        email,
        phone,
        expertise,
        password,
        accessCode
      })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setInstructorRegistrationStatus('', 'info');
      showAuthToast(payload.error || 'Registration failed. Please check your details and try again.', 'error', 4200);
      return;
    }

    if (payload.access_status === 'restricted') {
      setInstructorRegistrationStatus('', 'info');
      showAuthToast(
        payload.message || 'Account created, but access is restricted by the academy admin because all active instructor seats are full.',
        'error',
        4200
      );
      const nextUrl = `login.html?role=instructor&code=${encodeURIComponent(accessCode)}&email=${encodeURIComponent(email)}&notice=restricted_by_admin`;
      redirectScheduled = true;
      window.setTimeout(() => {
        window.location.href = nextUrl;
      }, 1800);
      return;
    }

    setInstructorRegistrationStatus('', 'info');
    showAuthToast('Registration successful. Redirecting to instructor login...', 'success', 2200);

    const nextUrl = `login.html?role=instructor&code=${encodeURIComponent(accessCode)}&email=${encodeURIComponent(email)}`;
    redirectScheduled = true;
    window.setTimeout(() => {
      window.location.href = nextUrl;
    }, 1200);
  } catch (error) {
    console.error('Instructor registration error:', error);
    setInstructorRegistrationStatus('', 'info');
    showAuthToast('Network error or server unavailable. Please try again.', 'error', 4200);
  } finally {
    if (!redirectScheduled) {
      setInstructorSubmitState(submitButton, false, 'Registering...');
    }
  }
});
