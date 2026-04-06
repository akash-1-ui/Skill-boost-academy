const registerForm = document.getElementById('registerForm');
const accessCodeInput = document.getElementById('accessCode');
const successMessage = document.getElementById('success-message');
const registrationStatus = document.getElementById('registrationStatus');

const registrationQuery = new URLSearchParams(window.location.search);
const presetAccessCode = normalizeAccessCode(registrationQuery.get('code'));
const buildApiUrl = window.SkillBoostApp?.buildApiUrl
  || ((path = '') => `${window.location.origin}${String(path || '').startsWith('/') ? path : `/${path}`}`);

if (accessCodeInput && presetAccessCode) {
  accessCodeInput.value = presetAccessCode;
}

function normalizeAccessCode(value) {
  return String(value || '').trim().toUpperCase();
}

function setRegistrationStatus(message, type = 'info') {
  if (!registrationStatus) {
    return;
  }

  if (!message) {
    registrationStatus.hidden = true;
    registrationStatus.textContent = '';
    registrationStatus.className = 'auth-status';
    return;
  }

  registrationStatus.hidden = false;
  registrationStatus.textContent = message;
  registrationStatus.className = `auth-status ${type}`;
}

function setSubmitState(button, busy, busyLabel) {
  if (!button) {
    return;
  }

  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent;
  }

  button.disabled = busy;
  button.textContent = busy ? busyLabel : button.dataset.defaultLabel;
}

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const submitButton = registerForm.querySelector("button[type='submit']");
  const accessCode = normalizeAccessCode(accessCodeInput.value);
  const name = document.getElementById('fullname').value.trim();
  const email = document.getElementById('email').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const course = document.getElementById('course').value.trim();
  const password = document.getElementById('password').value;

  accessCodeInput.value = accessCode;
  successMessage.style.display = 'none';

  if (!accessCode || !name || !email || !phone || !course || !password) {
    setRegistrationStatus('Please fill in every field, including the academy access code.', 'error');
    return;
  }

  setRegistrationStatus('Creating your student account...', 'info');
  setSubmitState(submitButton, true, 'Registering...');

  try {
    const res = await fetch(buildApiUrl('/api/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, course, password, accessCode })
    });

    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      setRegistrationStatus(payload.error || 'Registration failed. Please check your details and try again.', 'error');
      return;
    }

    if (payload.access_status === 'restricted') {
      setRegistrationStatus(
        payload.message || 'Account created, but access is restricted by the academy admin because all active student seats are full.',
        'error'
      );
      const nextUrl = `login.html?role=student&code=${encodeURIComponent(accessCode)}&email=${encodeURIComponent(email)}&notice=restricted_by_admin`;
      window.setTimeout(() => {
        window.location.href = nextUrl;
      }, 1800);
      return;
    }

    setRegistrationStatus('', 'info');
    successMessage.style.display = 'block';

    const nextUrl = `login.html?role=student&code=${encodeURIComponent(accessCode)}&email=${encodeURIComponent(email)}`;
    window.setTimeout(() => {
      window.location.href = nextUrl;
    }, 1200);
  } catch (error) {
    console.error('Student registration error:', error);
    setRegistrationStatus('Network error or server unavailable. Please try again.', 'error');
  } finally {
    setSubmitState(submitButton, false, 'Registering...');
  }
});
