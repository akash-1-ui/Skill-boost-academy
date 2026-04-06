const instructorRegistrationForm = document.getElementById('instructorRegistrationForm');
const instructorAccessCodeInput = document.getElementById('accessCode');
const instructorSuccessMessage = document.getElementById('success-message');
const instructorRegistrationStatus = document.getElementById('instructorRegistrationStatus');

const instructorRegistrationQuery = new URLSearchParams(window.location.search);
const presetInstructorAccessCode = normalizeAccessCode(instructorRegistrationQuery.get('code'));

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
    setInstructorRegistrationStatus('Please fill in every required field, including the academy access code.', 'error');
    return;
  }

  if (!email.includes('@')) {
    setInstructorRegistrationStatus('Please enter a valid email address.', 'error');
    return;
  }

  setInstructorRegistrationStatus('Creating your instructor account...', 'info');
  setInstructorSubmitState(submitButton, true, 'Registering...');

  try {
    const response = await fetch('http://localhost:3000/api/register/instructor', {
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
      setInstructorRegistrationStatus(payload.error || 'Registration failed. Please check your details and try again.', 'error');
      return;
    }

    if (payload.access_status === 'restricted') {
      setInstructorRegistrationStatus(
        payload.message || 'Account created, but access is restricted by the academy admin because all active instructor seats are full.',
        'error'
      );
      const nextUrl = `login.html?role=instructor&code=${encodeURIComponent(accessCode)}&email=${encodeURIComponent(email)}&notice=restricted_by_admin`;
      window.setTimeout(() => {
        window.location.href = nextUrl;
      }, 1800);
      return;
    }

    setInstructorRegistrationStatus('', 'info');
    instructorSuccessMessage.style.display = 'block';

    const nextUrl = `login.html?role=instructor&code=${encodeURIComponent(accessCode)}&email=${encodeURIComponent(email)}`;
    window.setTimeout(() => {
      window.location.href = nextUrl;
    }, 1200);
  } catch (error) {
    console.error('Instructor registration error:', error);
    setInstructorRegistrationStatus('Network error or server unavailable. Please try again.', 'error');
  } finally {
    setInstructorSubmitState(submitButton, false, 'Registering...');
  }
});
