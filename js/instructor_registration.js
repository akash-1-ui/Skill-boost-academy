document.getElementById('instructorRegistrationForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    try {
        // Get form data
        const name = document.getElementById('fullname').value.trim();
        const email = document.getElementById('email').value.trim();
        const phone = document.getElementById('phone').value.trim();
        const expertise = document.getElementById('expertise').value.trim();
        const password = document.getElementById('password').value;

        // Validate the fields
        if (!name || !email || !expertise || !password) {
            alert("Please fill in all required fields (Name, Email, Expertise, and Password).");
            return;
        }

        // Simple email validation
        if (!email.includes('@')) {
            alert("Please enter a valid email address.");
            return;
        }

        // Register the instructor
        const response = await fetch('http://localhost:3000/api/register/instructor', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name,
                email,
                phone,
                expertise,
                password
            })
        });

        let result;
        try {
            result = await response.json();
        } catch (jsonErr) {
            result = { error: 'Invalid server response' };
        }
        if (!response.ok) {
            alert(result.error || 'Registration failed. Please check your details and try again.');
            return;
        }

        // If registration successful, proceed with login
        const loginResponse = await fetch('http://localhost:3000/api/login/instructor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const loginData = await loginResponse.json();
        
        if (!loginResponse.ok) {
            throw new Error(loginData.error || 'Login failed after registration');
        }

        if (loginData.instructor) {
            // Store instructor data
            localStorage.setItem('instructorId', loginData.instructor.id);
            localStorage.setItem('instructorName', loginData.instructor.name);
            localStorage.setItem('instructorPhoto', loginData.instructor.photo || 'default-profile.png');
            localStorage.setItem('instructorEmail', loginData.instructor.email || email);
            localStorage.setItem('user', JSON.stringify({
                id: String(loginData.instructor.id),
                role: 'instructor',
                username: loginData.instructor.name || loginData.instructor.email || email,
                email: loginData.instructor.email || email
            }));
            
            // Show success message and redirect
            document.getElementById('success-message').style.display = 'block';
            setTimeout(() => {
                window.location.href = '/HTML/instructor_home.html';
            }, 2000);
        } else {
            throw new Error('Login successful but instructor data missing');
        }

    } catch (error) {
        console.error('Registration/Login error:', error);
        alert(error.message || 'Registration failed. Please try again.');
    }
});
