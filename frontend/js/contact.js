const CONTACT_RETURN_ROUTES = {
  student: {
    href: 'student_home.html',
    ctaLabel: 'Back to Student Dashboard',
    navLabel: 'Back'
  },
  instructor: {
    href: 'instructor_home.html',
    ctaLabel: 'Back to Instructor Dashboard',
    navLabel: 'Back'
  }
};
const buildApiUrl = window.SkillBoostApp?.buildApiUrl
  || ((path = '') => `${window.location.origin}${String(path || '').startsWith('/') ? path : `/${path}`}`);

function configureContactReturnLinks() {
  const params = new URLSearchParams(window.location.search);
  const source = String(params.get('from') || '').trim().toLowerCase();
  const route = CONTACT_RETURN_ROUTES[source];

  if (!route) {
    return;
  }

  document.querySelectorAll('[data-home-link]').forEach((link) => {
    link.setAttribute('href', route.href);
  });

  const navLink = document.querySelector('[data-home-nav-link]');
  if (navLink) {
    navLink.textContent = route.navLabel;
  }

  const ctaLink = document.querySelector('[data-home-cta]');
  if (ctaLink) {
    ctaLink.textContent = route.ctaLabel;
  }
}

configureContactReturnLinks();

document.getElementById('contactForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
  const message = document.getElementById('message').value.trim();

  try {
    const response = await fetch(buildApiUrl('/api/contact'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, message })
    });
    if (response.ok) {
      document.getElementById('contactForm').style.display = 'none';
      document.getElementById('responseMessage').style.display = 'grid';
    } else {
      let data = {};
      try {
        data = await response.json();
      } catch (jsonErr) {
        data = { error: 'Invalid server response' };
      }
      alert(data.error || 'There was an error sending your message. Please try again.');
    }
  } catch (err) {
    alert('Network error or server unavailable. Please check your connection and try again.');
  }
});
