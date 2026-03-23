document.getElementById('contactForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
  const message = document.getElementById('message').value.trim();

  try {
    const response = await fetch('http://localhost:3000/api/contact', {
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
