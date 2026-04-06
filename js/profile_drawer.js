(function () {
  const buildApiUrl = window.SkillBoostApp?.buildApiUrl
    || ((path = '') => `${window.location.origin}${String(path || '').startsWith('/') ? path : `/${path}`}`);

  const drawer = document.getElementById('profileDrawer');
  if (!drawer) return;

  const role = drawer.dataset.role;
  const overlay = document.getElementById('profileOverlay');
  const toggleButtons = document.querySelectorAll('[data-profile-toggle]');
  const closeBtn = drawer.querySelector('[data-profile-close]');
  const form = document.getElementById('profileForm');
  const nameInput = document.getElementById('profileName');
  const emailInput = document.getElementById('profileEmail');
  const extraInput = document.getElementById('profileExtra');
  const photoImg = document.getElementById('profileImage');
  const uploadInput = document.getElementById('profilePhotoUpload');
  const statusEl = document.getElementById('profileStatus');

  const defaultPhoto = '/uploads/default-avatar.svg';

  function normalizePhoto(value) {
    const raw = String(value || '').trim();
    if (!raw || raw === 'null' || raw === 'undefined') {
      return defaultPhoto;
    }
    if (raw.includes('default-profile-picture-avatar-user-icon-vector-46389216.jpg')) {
      return defaultPhoto;
    }
    return raw;
  }

  function setStatus(message, type) {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.className = 'profile-status' + (type ? ` is-${type}` : '');
  }

  function openDrawer() {
    drawer.classList.add('open');
    overlay?.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    loadProfile();
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    overlay?.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
  }

  toggleButtons.forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      openDrawer();
    });
  });

  if (overlay) {
    overlay.addEventListener('click', closeDrawer);
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closeDrawer);
  }

  function setProfileFields(profile) {
    if (nameInput) nameInput.value = profile.name || '';
    if (emailInput) emailInput.value = profile.email || '';
    if (extraInput) extraInput.value = profile.extra || '';
    if (photoImg) photoImg.src = normalizePhoto(profile.photo);
  }

  function getStudentProfileFromStorage() {
    const email = localStorage.getItem('studentEmail') || '';
    return {
      name: localStorage.getItem(`studentName_${email}`) || '',
      email,
      extra: localStorage.getItem(`studentBranch_${email}`) || '',
      photo: normalizePhoto(localStorage.getItem(`studentPhoto_${email}`))
    };
  }

  function getInstructorProfileFromStorage() {
    return {
      name: localStorage.getItem('instructorName') || '',
      email: localStorage.getItem('instructorEmail') || '',
      extra: localStorage.getItem('instructorCourse') || '',
      photo: normalizePhoto(localStorage.getItem('instructorPhoto'))
    };
  }

  async function refreshStudentProfile(email) {
    if (!email) return;
    try {
      const res = await fetch(buildApiUrl(`/api/student-profile?email=${encodeURIComponent(email)}`));
      if (!res.ok) return;
      const profile = await res.json();
      const normalized = {
        name: profile.name || '',
        email: profile.email || email,
        extra: profile.branch || '',
        photo: normalizePhoto(profile.photo)
      };
      localStorage.setItem(`studentName_${email}`, normalized.name);
      localStorage.setItem(`studentBranch_${email}`, normalized.extra);
      localStorage.setItem(`studentPhoto_${email}`, normalized.photo);
      setProfileFields(normalized);
      const dashboardTitle = document.getElementById('dashboard-title');
      if (dashboardTitle && normalized.name) {
        dashboardTitle.textContent = `${normalized.name}'s Dashboard`;
      }
      const topPhoto = document.getElementById('studentProfilePhoto');
      if (topPhoto) topPhoto.src = normalized.photo;
    } catch (error) {
      console.error('Failed to refresh student profile', error);
    }
  }

  async function refreshInstructorProfile(email) {
    if (!email) return;
    try {
      const res = await fetch(buildApiUrl(`/api/instructor-profile?email=${encodeURIComponent(email)}`));
      if (!res.ok) return;
      const profile = await res.json();
      const normalized = {
        name: profile.name || '',
        email: profile.email || email,
        extra: profile.expertise || '',
        photo: normalizePhoto(profile.photo)
      };
      localStorage.setItem('instructorName', normalized.name);
      localStorage.setItem('instructorEmail', normalized.email);
      localStorage.setItem('instructorCourse', normalized.extra);
      localStorage.setItem('instructorPhoto', normalized.photo);
      setProfileFields(normalized);
      const nameSpan = document.getElementById('instructorName');
      if (nameSpan && normalized.name) {
        nameSpan.textContent = normalized.name;
      }
      const topPhoto = document.getElementById('instructorProfilePhoto');
      if (topPhoto) topPhoto.src = normalized.photo;
    } catch (error) {
      console.error('Failed to refresh instructor profile', error);
    }
  }

  function loadProfile() {
    setStatus('', null);
    if (role === 'student') {
      const profile = getStudentProfileFromStorage();
      setProfileFields(profile);
      refreshStudentProfile(profile.email);
    } else {
      const profile = getInstructorProfileFromStorage();
      setProfileFields(profile);
      const topPhoto = document.getElementById('instructorProfilePhoto');
      if (topPhoto) topPhoto.src = normalizePhoto(profile.photo);
      refreshInstructorProfile(profile.email);
    }
  }

  if (uploadInput) {
    uploadInput.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        if (photoImg) photoImg.src = String(e.target?.result || defaultPhoto);
      };
      reader.readAsDataURL(file);
    });
  }

  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      setStatus('', null);

      const name = nameInput?.value.trim() || '';
      const email = emailInput?.value.trim() || '';
      const extra = extraInput?.value.trim() || '';
      const photo = normalizePhoto(photoImg?.src || defaultPhoto);

      if (!name) {
        setStatus('Name is required.', 'error');
        return;
      }

      try {
        if (role === 'student') {
          if (!email) {
            setStatus('Email is required.', 'error');
            return;
          }

          localStorage.setItem('studentEmail', email);
          localStorage.setItem(`studentName_${email}`, name);
          localStorage.setItem(`studentBranch_${email}`, extra);
          localStorage.setItem(`studentPhoto_${email}`, photo);

          if (photo.startsWith('data:image')) {
            await fetch(buildApiUrl('/api/student-photo-base64'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, photo })
            });
          }

          const dashboardTitle = document.getElementById('dashboard-title');
          if (dashboardTitle) {
            dashboardTitle.textContent = `${name}'s Dashboard`;
          }
          const topPhoto = document.getElementById('studentProfilePhoto');
          if (topPhoto) topPhoto.src = photo;
        } else {
          localStorage.setItem('instructorName', name);
          localStorage.setItem('instructorEmail', email);
          localStorage.setItem('instructorCourse', extra);
          localStorage.setItem('instructorPhoto', photo);

          if (email) {
            await fetch(buildApiUrl('/api/instructor-profile'), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, name, expertise: extra })
            });
          }

          if (photo.startsWith('data:image') && email) {
            await fetch(buildApiUrl('/api/instructor-photo-base64'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, photo })
            });
          }

          const nameSpan = document.getElementById('instructorName');
          if (nameSpan) nameSpan.textContent = name;
          const topPhoto = document.getElementById('instructorProfilePhoto');
          if (topPhoto) topPhoto.src = photo || defaultPhoto;
          localStorage.setItem('user', JSON.stringify({
            id: localStorage.getItem('instructorId') || '',
            role: 'instructor',
            username: name || email,
            email
          }));
        }

        setStatus('Profile updated successfully.', 'success');
      } catch (error) {
        console.error('Profile update error:', error);
        setStatus('Failed to update profile.', 'error');
      }
    });
  }
})();
