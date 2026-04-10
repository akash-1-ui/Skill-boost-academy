(function () {
  const buildApiUrl = window.SkillBoostApp?.buildApiUrl
    || ((path = '') => `${window.location.origin}${String(path || '').startsWith('/') ? path : `/${path}`}`);
  const showPageToast = (message, tone = 'info', durationMs = 3200) => {
    if (window.SkillBoostPageToast?.show) {
      window.SkillBoostPageToast.show(message, tone, durationMs);
      return;
    }

    if (message) {
      window.alert(message);
    }
  };

  function clearStudentStorage(email) {
    if (!email) return;
    localStorage.removeItem('studentEmail');
    localStorage.removeItem('studentId');
    localStorage.removeItem('academyId');
    localStorage.removeItem('user');
    localStorage.removeItem(`studentName_${email}`);
    localStorage.removeItem(`studentBranch_${email}`);
    localStorage.removeItem(`studentPhoto_${email}`);
    localStorage.removeItem(`enrolledCourses_${email}`);
    localStorage.removeItem(`timeSpent_${email}`);
    localStorage.removeItem(`viewedVideos_${email}`);
  }

  function clearInstructorStorage() {
    localStorage.removeItem('instructorId');
    localStorage.removeItem('instructorName');
    localStorage.removeItem('instructorPhoto');
    localStorage.removeItem('instructorEmail');
    localStorage.removeItem('instructorCourse');
    localStorage.removeItem('instructorBio');
    localStorage.removeItem('academyId');
    localStorage.removeItem('user');
  }

  async function terminateStudentAccount() {
    const email = localStorage.getItem('studentEmail') || '';
    if (!email) {
      showPageToast('Student account not found. Please login again.', 'error', 3600);
      return;
    }

    const confirmed = confirm('This will permanently delete your student account and all learning history. Continue?');
    if (!confirmed) return;

    const typed = prompt('Type DELETE to confirm account deletion.');
    if (typed !== 'DELETE') {
      showPageToast('Account deletion cancelled.', 'warning', 2600);
      return;
    }

    try {
      const response = await fetch(buildApiUrl('/api/account/student'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const payload = await response.json().catch(() => ({ error: 'Failed to parse response' }));
      if (!response.ok) {
        throw new Error(payload.error || payload.message || 'Failed to delete account');
      }

      clearStudentStorage(email);
      showPageToast('Your account has been deleted successfully.', 'success', 2800);
      window.setTimeout(() => {
        window.location.href = 'index.html';
      }, 900);
    } catch (error) {
      console.error('Account deletion error:', error);
      showPageToast(error.message || 'Failed to delete account. Please try again.', 'error', 4200);
    }
  }

  async function terminateInstructorAccount() {
    const instructorId = localStorage.getItem('instructorId');
    const email = localStorage.getItem('instructorEmail') || '';

    if (!instructorId && !email) {
      showPageToast('Instructor account not found. Please login again.', 'error', 3600);
      return;
    }

    const confirmed = confirm('This will permanently delete your instructor account, courses, and analytics. Continue?');
    if (!confirmed) return;

    const typed = prompt('Type DELETE to confirm account deletion.');
    if (typed !== 'DELETE') {
      showPageToast('Account deletion cancelled.', 'warning', 2600);
      return;
    }

    try {
      const response = await fetch(buildApiUrl('/api/account/instructor'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructorId, email })
      });

      const payload = await response.json().catch(() => ({ error: 'Failed to parse response' }));
      if (!response.ok) {
        throw new Error(payload.error || payload.message || 'Failed to delete account');
      }

      clearInstructorStorage();
      showPageToast('Your account has been deleted successfully.', 'success', 2800);
      window.setTimeout(() => {
        window.location.href = 'index.html';
      }, 900);
    } catch (error) {
      console.error('Account deletion error:', error);
      showPageToast(error.message || 'Failed to delete account. Please try again.', 'error', 4200);
    }
  }

  const studentBtn = document.getElementById('terminateStudent');
  if (studentBtn) {
    studentBtn.addEventListener('click', (event) => {
      event.preventDefault();
      terminateStudentAccount();
    });
  }

  const instructorBtn = document.getElementById('terminateInstructor');
  if (instructorBtn) {
    instructorBtn.addEventListener('click', (event) => {
      event.preventDefault();
      terminateInstructorAccount();
    });
  }
})();
