(function () {
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
      alert('Student account not found. Please login again.');
      return;
    }

    const confirmed = confirm('This will permanently delete your student account and all learning history. Continue?');
    if (!confirmed) return;

    const typed = prompt('Type DELETE to confirm account deletion.');
    if (typed !== 'DELETE') {
      alert('Account deletion cancelled.');
      return;
    }

    try {
      const response = await fetch('http://localhost:3000/api/account/student', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to delete account');
      }

      clearStudentStorage(email);
      alert('Your account has been deleted.');
      window.location.href = 'index.html';
    } catch (error) {
      alert(error.message || 'Failed to delete account. Please try again.');
    }
  }

  async function terminateInstructorAccount() {
    const instructorId = localStorage.getItem('instructorId');
    const email = localStorage.getItem('instructorEmail') || '';

    if (!instructorId && !email) {
      alert('Instructor account not found. Please login again.');
      return;
    }

    const confirmed = confirm('This will permanently delete your instructor account, courses, and analytics. Continue?');
    if (!confirmed) return;

    const typed = prompt('Type DELETE to confirm account deletion.');
    if (typed !== 'DELETE') {
      alert('Account deletion cancelled.');
      return;
    }

    try {
      const response = await fetch('http://localhost:3000/api/account/instructor', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructorId, email })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to delete account');
      }

      clearInstructorStorage();
      alert('Your account has been deleted.');
      window.location.href = 'index.html';
    } catch (error) {
      alert(error.message || 'Failed to delete account. Please try again.');
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
