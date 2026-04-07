# Frontend-to-Backend Integration Guide
## Skill Boost Nexus - Render Deployment Configuration

**Backend URL:** https://skill-boost-nexus.onrender.com  
**Status:** ✅ Configuration Complete

---

## Changes Made

### 1. Updated Backend URL in Configuration
- **File:** `frontend/js/app-config.js`
- **Change:** Set `DEPLOYED_BACKEND_ORIGIN = 'https://skill-boost-nexus.onrender.com'`
- **Effect:** All API calls from non-localhost environments now point to the Render backend

### 2. Created Environment Variables Setup
Created three environment variable files for flexible configuration:

#### `.env` (Development)
```
VITE_API_BASE_URL=http://localhost:3000
```

#### `.env.production` (Production)
```
VITE_API_BASE_URL=https://skill-boost-nexus.onrender.com
```

#### `.env.example` (Template for reference)
```
VITE_API_BASE_URL=https://skill-boost-nexus.onrender.com
```

### 3. Verified CORS Configuration
**File:** `backend/server.js` (lines 100-111)

The backend CORS settings are correctly configured:
```javascript
app.use(cors({
    origin: function (origin, callback) {
        // Allow all origins (including no origin for development)
        callback(null, true);
    },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin'],
    exposedHeaders: ['Content-Type'],
    maxAge: 86400
}));
```

✅ **Status:** CORS is fully enabled for cross-origin requests

---

## How API Configuration Works

### Smart API Base URL Resolution
The frontend uses a sophisticated resolution system in `app-config.js`:

```
1. Check for explicit API base (window.SKILL_BOOST_API_BASE or meta tag)
2. Check localStorage for stored API base
3. If on localhost → use http://localhost:3000
4. If DEPLOYED_BACKEND_ORIGIN is set → use it
5. Fallback → use current origin
```

### Files Using the API Configuration
The following files automatically use `window.SkillBoostApp.apiBase`:

- ✅ `frontend/js/addcourse.js`
- ✅ `frontend/js/course_videos.js`
- ✅ `frontend/js/instructor_course_videos.js`
- ✅ `frontend/js/notifications.js`
- ✅ `frontend/js/login.js` (uses `buildApiUrl()`)
- ✅ `frontend/js/registration.js` (uses `buildApiUrl()`)

All these files are properly configured for production!

---

## API Endpoints Being Used

### Authentication
- `POST /api/register` - Student registration
- `POST /api/login` - Student/Instructor login
- `POST /api/reset-password-request` - Password reset request
- `POST /api/verify-reset-code` - Verify OTP
- `POST /api/reset-password` - Complete password reset

### Courses
- `GET /api/courses` - Get all courses
- `GET /api/courses/by-access-code/:accessCode` - Get courses by access code
- `POST /api/courses` - Create new course (Instructor)
- `PUT /api/courses/:id` - Update course (Instructor)

### Videos
- `POST /api/videos` - Upload video
- `GET /api/videos/:courseId` - Get course videos
- `DELETE /api/videos/:id` - Delete video

### Notifications
- `GET /api/notifications` - Get notifications
- `POST /api/notifications` - Create notification
- `PUT /api/notifications/:id/read` - Mark as read

### Payment
- `POST /api/payment` - Process payment

### Health Check
- `GET /api/health` - Backend health status

---

## Testing Checklist

### 1. Backend Health Check
```bash
curl https://skill-boost-nexus.onrender.com/api/health
```

Expected response:
```json
{
  "backend": "ok",
  "timestamp": "2026-04-07T...",
  "cloudinary": {
    "ready": true,
    "reason": "Cloudinary is properly configured"
  }
}
```

### 2. Test on Production Frontend
When deployed, verify these endpoints work:

**Student Login:**
- URL: `https://your-deployed-frontend/HTML/login.html`
- Test: Try logging in with existing credentials
- Expected: Should connect to `https://skill-boost-nexus.onrender.com/api/login`

**Student Registration:**
- URL: `https://your-deployed-frontend/HTML/registration.html`
- Test: Try registering new student
- Expected: Should post to `https://skill-boost-nexus.onrender.com/api/register`

**View Courses:**
- URL: `https://your-deployed-frontend/HTML/course_videos.html`
- Test: Courses should load
- Expected: API call to `https://skill-boost-nexus.onrender.com/api/courses`

**Notifications:**
- URL: `https://your-deployed-frontend/HTML/notifications.html`
- Test: Verify notifications display
- Expected: API call to `https://skill-boost-nexus.onrender.com/api/notifications`

**Payment:**
- URL: `https://your-deployed-frontend/HTML/payment.html`
- Test: Payment flow completes
- Expected: CORS-enabled call to backend payment endpoint

### 3. Check Browser Console
- Open DevTools (F12)
- Go to Network tab
- Check that API calls go to: `https://skill-boost-nexus.onrender.com`
- Verify no CORS errors appear

---

## Environment-Specific Behavior

### Local Development
1. Frontend served from `http://localhost:5173` (Vite dev server)
2. API calls go to `http://localhost:3000` (LOCAL_BACKEND_ORIGIN)
3. Uses `.env` file

### Local with Remote Backend
1. Frontend served locally
2. To test against Render backend, manually set in browser console:
   ```javascript
   localStorage.setItem('skillboost-api-base', 'https://skill-boost-nexus.onrender.com');
   location.reload();
   ```

### Production Deployment
1. Frontend served from deployed URL
2. API calls automatically go to `https://skill-boost-nexus.onrender.com`
3. Uses `.env.production` file during build
4. No localhost detection, DEPLOYED_BACKEND_ORIGIN kicks in

---

## Troubleshooting

### Issue: API calls still going to localhost
**Solution:**
1. Check that `app-config.js` has the Render URL set
2. Hard refresh browser (Ctrl+F5)
3. Check Network tab to confirm API calls
4. Clear localStorage: `localStorage.clear()`

### Issue: CORS errors in Network tab
**Solution:**
1. Verify backend CORS is enabled (already done ✅)
2. Check that frontend URL is allowed (all origins allowed ✅)
3. Verify backend is running: `curl https://skill-boost-nexus.onrender.com/api/health`

### Issue: Mixed content warning (https frontend, http API)
**Solution:**
- Make sure frontend uses HTTPS URL
- Make sure backend URL in config is HTTPS (already set ✅)
- This warning should NOT appear with current config

### Issue: Backend responds with 500 error
**Solution:**
1. Check Render logs: `curl -H "Authorization: Bearer YOUR_API_KEY" https://api.render.com/v1/services`
2. Verify environment variables are set on Render
3. Verify database connection string
4. Check that Cloudinary credentials are configured

---

## Files Modified

| File | Change | Status |
|------|--------|--------|
| `frontend/js/app-config.js` | Set DEPLOYED_BACKEND_ORIGIN to Render URL | ✅ |
| `frontend/dist/js/app-config.js` | Updated built version | ✅ |
| `frontend/.env` | Created dev environment config | ✅ |
| `frontend/.env.production` | Created production environment config | ✅ |
| `frontend/.env.example` | Created template for reference | ✅ |

---

## Next Steps

1. **Build for production:**
   ```bash
   npm run build
   ```

2. **Test locally:**
   ```bash
   npm run preview
   ```

3. **Deploy frontend:**
   - Push to your frontend repository
   - Trigger deployment on your hosting platform (Vercel, Render, etc.)

4. **Monitor in production:**
   - Open DevTools Network tab
   - Verify API calls to `https://skill-boost-nexus.onrender.com`
   - Check for any CORS or connectivity errors

---

## Notes

- The frontend uses a smart API resolution system that detects environment automatically
- No hardcoding needed - configuration is centralized in `app-config.js`
- All API calls use the `buildApiUrl()` or `SkillBoostApp.apiBase` helper
- CORS is fully enabled on backend for production
- Environment variables are ready for both dev and production

**Backend API is now fully integrated with the frontend configuration system!** 🚀
