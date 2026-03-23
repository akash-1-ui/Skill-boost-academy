document.getElementById('registerForm').addEventListener('submit', function (e) {
  e.preventDefault();

  const name = document.getElementById('fullname').value.trim();
  const email = document.getElementById('email').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const course = document.getElementById('course').value;
  const password = document.getElementById('password').value;

  if (!name || !email || !phone || !course || !password) {
    alert('Please fill in all fields.');
    return;
  }

  fetch('http://localhost:3000/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, phone, course, password })
  })
    .then(async res => {
      const ct = res.headers.get('content-type') || '';
      let data;
      if (ct.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        data = { error: 'Unexpected response type', details: text };
      }
      if (!res.ok) throw data;
      return data;
    })
    .then(data => {
      localStorage.setItem('studentEmail', email);
      localStorage.setItem(`studentName_${email}`, name);
      document.getElementById('success-message').style.display = 'block';
      setTimeout(() => {
        window.location.href = 'student_home.html';
      }, 2000);
    })
.catch(err => {
  console.error('Fetch error:', JSON.stringify(err, null, 2));
  if (err && err.error) {
    alert('Error: ' + err.error);
  } else if (err && err.details) {
    alert('Server error: ' + err.details);
  } else {
    alert('Network error or server unavailable. Please check your connection and try again.');
  }
});
});
