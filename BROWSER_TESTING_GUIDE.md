# Browser Console API Testing Guide

## Quick Test: Copy & Paste in Browser Console (F12)

### 1. Check Current API Base URL
```javascript
console.log('Current API Base:', window.SkillBoostApp?.apiBase);
console.log('Is Localhost:', window.SkillBoostApp?.isLocalHost);
console.log('Public Origin:', window.SkillBoostApp?.publicOrigin);
```

Expected output for production:
```
Current API Base: https://skill-boost-nexus.onrender.com
Is Localhost: false
Public Origin: https://your-deployed-frontend.com
```

---

### 2. Test Health Endpoint
```javascript
fetch(`${window.SkillBoostApp?.apiBase}/api/health`)
  .then(res => res.json())
  .then(data => console.log('Backend Status:', data))
  .catch(err => console.error('Backend Error:', err));
```

Expected response:
```javascript
{
  backend: "ok",
  timestamp: "2026-04-07T12:34:56.789Z",
  cloudinary: {
    ready: true,
    reason: "Cloudinary is properly configured"
  },
  environmentVariables: {
    hasCloudinaryCloudName: true,
    hasCloudinaryApiKey: true,
    hasCloudinaryApiSecret: true,
    databaseUrl: true
  }
}
```

---

### 3. Test Courses Endpoint
```javascript
fetch(`${window.SkillBoostApp?.apiBase}/api/courses`)
  .then(res => res.json())
  .then(data => console.log('Courses:', data))
  .catch(err => console.error('Error:', err));
```

Expected: Array of course objects or empty array

---

### 4. Test with Authentication Token
```javascript
const token = localStorage.getItem('token'); // or your auth token
fetch(`${window.SkillBoostApp?.apiBase}/api/profile`, {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
})
  .then(res => res.json())
  .then(data => console.log('Profile:', data))
  .catch(err => console.error('Error:', err));
```

---

### 5. Test All Key Endpoints
```javascript
const apiBase = window.SkillBoostApp?.apiBase;

const endpoints = [
  '/api/health',
  '/api/courses',
  '/api/notifications',
  '/api/payment-status'
];

async function testAll() {
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`${apiBase}${endpoint}`, {
        timeout: 5000
      });
      console.log(`${endpoint}: ${res.status} ${res.statusText}`);
    } catch (err) {
      console.error(`${endpoint}: ${err.message}`);
    }
  }
}

testAll();
```

---

### 6. View All API Requests in Network Tab
1. Open DevTools (F12)
2. Click "Network" tab
3. Reload page
4. Look for requests to: `https://skill-boost-nexus.onrender.com`
5. If you see `localhost` requests, check configuration

---

### 7. Switch API Base at Runtime (Development)
```javascript
// To test against local backend
localStorage.setItem('skillboost-api-base', 'http://localhost:3000');
location.reload();

// To test against Render backend
localStorage.setItem('skillboost-api-base', 'https://skill-boost-nexus.onrender.com');
location.reload();

// To clear and use default
localStorage.removeItem('skillboost-api-base');
location.reload();
```

---

## Expected Results

### Successful Configuration ✅
- API Base shows: `https://skill-boost-nexus.onrender.com`
- Health check returns 200 OK
- No CORS errors in console
- Courses endpoint returns data
- Network tab shows requests to `skill-boost-nexus.onrender.com`

### Failed Configuration ❌
- API Base shows: `http://localhost` (should be overridden)
- Health check times out or returns error
- CORS errors in console
- Network tab shows failed requests

---

## Common Issues & Solutions

### Issue: "Failed to fetch" error
**Possible causes:**
- Backend is down
- CORS not enabled
- Network connectivity issue
- Timeout (backend is slow)

**Test:**
```javascript
fetch('https://skill-boost-nexus.onrender.com/api/health')
  .then(r => r.json())
  .then(d => console.log('OK:', d))
  .catch(e => console.error('ERROR:', e.message));
```

### Issue: "Access to XMLHttpRequest... blocked by CORS"
**Solution:**
- Backend has CORS enabled ✅ Already configured
- Check if browser allows cross-origin
- Try different endpoint
- Check credentials header if needed

### Issue: API calls still going to localhost
**Solution:**
```javascript
// Check stored API base
localStorage.getItem('skillboost-api-base');

// Clear it
localStorage.removeItem('skillboost-api-base');

// Hard refresh
location.reload();
```

### Issue: Mixed content warning
**Make sure:**
- Frontend URL is HTTPS
- API URL is HTTPS
- No `http://` calls from HTTPS page

---

## Integration Testing Workflow

1. **Deploy frontend**
2. **Open browser DevTools**
3. **Run health check:**
   ```javascript
   fetch(`${window.SkillBoostApp?.apiBase}/api/health`)
     .then(r => r.json())
     .then(d => alert(`Backend Status: ${d.backend}`));
   ```
4. **Test login:**
   - Fill login form
   - Open Network tab
   - Submit form
   - Look for response from `/api/login`
5. **Check Network tab**
   - All requests should go to `skill-boost-nexus.onrender.com`
   - No `localhost` requests
   - No CORS errors

---

## Performance Tips

- Health check should respond in <500ms
- Course list should load within 1-2 seconds
- If requests timeout, check Render service status
- Use Network tab to identify slow endpoints

---

Document Version: 1.0  
Last Updated: April 7, 2026  
API URL: https://skill-boost-nexus.onrender.com
