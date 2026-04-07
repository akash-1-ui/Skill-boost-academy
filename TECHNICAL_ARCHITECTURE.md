# Technical Architecture - API Configuration System

## Overview

The Skill Boost Nexus frontend uses a sophisticated, environment-aware API configuration system that automatically adapts the API base URL based on the deployment context.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│          FRONTEND APPLICATION                           │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────────────────────────────────────────────┐         │
│  │  JavaScript Components (JS files)          │         │
│  │  - login.js, registration.js               │         │
│  │  - course_videos.js, payment.js            │         │
│  │  - notifications.js, etc.                  │         │
│  └──────────────────┬─────────────────────────┘         │
│                     │                                   │
│                     │ Uses                              │
│                     ▼                                   │
│  ┌────────────────────────────────────────────┐         │
│  │  window.SkillBoostApp.buildApiUrl()        │         │
│  │  window.SkillBoostApp.apiBase              │         │
│  └──────────────────┬─────────────────────────┘         │
│                     │                                   │
│                     │ References                        │
│                     ▼                                   │
│  ┌────────────────────────────────────────────┐         │
│  │  app-config.js                             │         │
│  │  (Configuration Resolution Engine)         │         │
│  └──────────────────┬─────────────────────────┘         │
│                     │                                   │
│                     │ Resolves                          │
│                     ▼                                   │
│  ┌────────────────────────────────────────────┐         │
│  │  1. Explicit API Base (meta tag)           │         │
│  │  2. localStorage['skillboost-api-base']    │         │
│  │  3. Environment Detection:                 │         │
│  │     - Localhost → localhost:3000           │         │
│  │     - Production → Render URL              │         │
│  │  4. Fallback → current origin              │         │
│  └────────────┬───────────────────────────────┘         │
│               │                                        │
└───────────────┼────────────────────────────────────────┘
                │
                │ HTTP Requests
                ▼
┌─────────────────────────────────────────────────────────┐
│          BACKEND API (Node.js/Express)                  │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  https://skill-boost-nexus.onrender.com                 │
│  (CORS Enabled - Accepts all origins)                   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## API Base URL Resolution Flow

### Step 1: Check Explicit Configuration
```javascript
// Highest priority - explicit API base from multiple sources
const candidates = [
  window.SKILL_BOOST_API_BASE,           // Global variable
  document.documentElement.getAttribute('data-api-base'),  // HTML attribute
  document.querySelector('meta[name="skillboost-api-base"]')?.getAttribute('content'),  // Meta tag
  readStoredApiBase()  // localStorage
];
```

### Step 2: Environment Detection
```javascript
// Detect if running on localhost
const isLocalHost = LOCAL_HOSTS.has(window.location.hostname);
// Set contains: ['localhost', '127.0.0.1', '::1']

const apiBase = explicitApiBase || 
  (isLocalHost ? LOCAL_BACKEND_ORIGIN : (deployedApiBase || currentOrigin));
```

### Step 3: Decision Tree

```
┌─ Is explicit API base set?
│  ├─ YES → Use it (highest priority)
│  └─ NO
│     │
│     ├─ Is localhost detected?
│     │  ├─ YES → Use LOCAL_BACKEND_ORIGIN (http://localhost:3000)
│     │  └─ NO
│     │     │
│     │     ├─ Is DEPLOYED_BACKEND_ORIGIN set?
│     │     │  ├─ YES → Use it (https://skill-boost-nexus.onrender.com)
│     │     │  └─ NO → Use current origin (fallback)
```

---

## Configuration Sources (Priority Order)

### 1. Explicit Configuration (Highest Priority)
```javascript
// Option A: Global variable
window.SKILL_BOOST_API_BASE = 'https://custom-api.com';

// Option B: HTML5 data attribute
<html data-api-base="https://custom-api.com">

// Option C: Meta tag
<meta name="skillboost-api-base" content="https://custom-api.com">

// Option D: LocalStorage
localStorage.setItem('skillboost-api-base', 'https://custom-api.com');
```

### 2. Environment Detection (Auto)
```javascript
// Development (localhost)
→ Automatically uses: http://localhost:3000

// Production (any other hostname)
→ Automatically uses: DEPLOYED_BACKEND_ORIGIN
```

### 3. Hardcoded DEPLOYED_BACKEND_ORIGIN (Production)
```javascript
// In app-config.js
const DEPLOYED_BACKEND_ORIGIN = 'https://skill-boost-nexus.onrender.com';
```

### 4. Fallback (Last Resort)
```javascript
// Uses current origin if all else fails
const currentOrigin = window.location.origin;
```

---

## Component: window.SkillBoostApp

### API Surface
```javascript
window.SkillBoostApp = {
  apiBase: String,           // The resolved API base URL
  publicOrigin: String,      // Current frontend origin
  isLocalHost: Boolean,      // Whether running on localhost
  buildApiUrl(path): String, // Helper to build complete URLs
  buildPublicUrl(path): String // Helper for frontend URLs
}
```

### Usage Examples

#### Example 1: Simple GET Request
```javascript
const courses = await fetch(
  `${window.SkillBoostApp.apiBase}/api/courses`
).then(r => r.json());

// Production: 
// → GET https://skill-boost-nexus.onrender.com/api/courses

// Development:
// → GET http://localhost:3000/api/courses
```

#### Example 2: Using buildApiUrl Helper
```javascript
const loginResponse = await fetch(
  window.SkillBoostApp.buildApiUrl('/api/login'),
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  }
).then(r => r.json());

// Automatically handles:
// - Adding leading slash if needed
// - Prepending apiBase
// - Avoiding double slashes
```

#### Example 3: With LocalStorage Override
```javascript
// For testing against Render in development
localStorage.setItem('skillboost-api-base', 
  'https://skill-boost-nexus.onrender.com');

// Now `window.SkillBoostApp.apiBase` returns the Render URL
// even though localhost detected
```

---

## File Dependencies

### Core Configuration
```
├── js/app-config.js (MAIN - does resolution)
│   └── Exposes window.SkillBoostApp
│
├── HTML/index.html
│   └── <script src="js/app-config.js"></script>
```

### Components Using Configuration
```
├── js/login.js
│   ├── Uses window.SkillBoostApp.buildApiUrl()
│   └── Posts to /api/login
│
├── js/registration.js
│   ├── Uses window.SkillBoostApp.buildApiUrl()
│   └── Posts to /api/register
│
├── js/course_videos.js
│   ├── Uses window.SkillBoostApp.apiBase
│   └── Fetches courses and videos
│
├── js/payment.js
│   ├── Uses window.SkillBoostApp.buildApiUrl('/api/access')
│   └── Payment processing
│
└── ... (all other JS files follow same pattern)
```

---

## Environment Variables (.env Files)

### Development (.env)
```bash
VITE_API_BASE_URL=http://localhost:3000
```
- Used when running `npm run dev`
- Frontend on http://localhost:5173
- API on http://localhost:3000

### Production (.env.production)
```bash
VITE_API_BASE_URL=https://skill-boost-nexus.onrender.com
```
- Used when running `npm run build`
- Frontend deployed to hosting
- API on Render instance

### Build Process
```
npm run build
  ├── Reads .env.production
  ├── Builds dist/ folder
  ├── Copies static assets (HTML, CSS, JS)
  ├── app-config.js uses DEPLOYED_BACKEND_ORIGIN
  └── Result: Frontend ready for production
```

---

## HTTP Request Flow

### 1. JavaScript Code
```javascript
// In login.js
const res = await fetch(buildApiUrl('/api/login'), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
```

### 2. buildApiUrl() Processing
```javascript
// In app-config.js
function buildApiUrl(path = '') {
  // Avoid double HTTPS URLs
  if (/^https?:\/\//i.test(String(path || '').trim())) {
    return String(path).trim();
  }
  // Prepend apiBase and ensure leading slash
  return `${apiBase}${ensureLeadingSlash(path)}`;
}

// Result: https://skill-boost-nexus.onrender.com/api/login
```

### 3. HTTP Request
```
POST /api/login HTTP/1.1
Host: skill-boost-nexus.onrender.com
Content-Type: application/json
Origin: https://your-frontend-domain.com

{
  "email": "user@example.com",
  "password": "password123"
}
```

### 4. CORS Headers (Backend Response)
```
HTTP/1.1 200 OK
Access-Control-Allow-Origin: * (or actual origin)
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Content-Type: application/json

{
  "token": "jwt-token-here",
  "user": { ... }
}
```

### 5. Browser CORS Check
```
✓ Origin: https://your-frontend-domain.com
✓ Method: POST
✓ Headers: Content-Type (allowed)
✓ Response headers include Access-Control-Allow-*
→ Request succeeds, data processed by JavaScript
```

---

## CORS Configuration Details

### Backend Setup (server.js)
```javascript
app.use(cors({
  origin: function (origin, callback) {
    // Accept all origins - suitable for development
    // For production, restrict to: ['https://your-domain.com']
    callback(null, true);
  },
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Type'],
  maxAge: 86400
}));
```

### What Each Setting Does
| Setting | Value | Effect |
|---------|-------|--------|
| `origin` | `true` | Accept requests from any origin |
| `credentials` | `false` | Don't include cookies/auth in CORS preflight |
| `methods` | All standard methods | Support all HTTP methods |
| `allowedHeaders` | Content-Type, Authorization, etc. | Allow these headers in requests |
| `exposedHeaders` | Content-Type | Expose this header to frontend |
| `maxAge` | 86400 | Cache preflight for 24 hours |

### Preflight Request (OPTIONS)
```javascript
// Browser auto-sends this before POST/PUT/DELETE
OPTIONS /api/login HTTP/1.1
Origin: https://your-frontend-domain.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: Content-Type

// Backend responds
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://your-frontend-domain.com
Access-Control-Allow-Methods: POST
Access-Control-Allow-Headers: Content-Type

// Browser then allows actual request
```

---

## Security Considerations

### Current Setup (Development)
✅ HTTP traffic encrypted (HTTPS)  
✅ CORS properly configured  
⚠️ Allows all origins (too permissive for production)  
⚠️ No rate limiting  
✅ JWT authorization for protected endpoints  

### Production Recommendations
1. **Restrict CORS to specific domains**
   ```javascript
   origin: ['https://your-frontend.com', 'https://www.your-frontend.com']
   ```

2. **Implement rate limiting**
   ```javascript
   const rateLimit = require('express-rate-limit');
   // Max 100 requests per 15 minutes
   ```

3. **Add request logging**
   ```javascript
   // Track all API calls
   ```

4. **Implement API versioning**
   ```javascript
   /api/v1/login
   /api/v2/login (newer version)
   ```

---

## Debugging & Troubleshooting

### Check Configuration in Browser Console
```javascript
// View resolved API base
console.log(window.SkillBoostApp.apiBase);

// View all config properties
console.log(window.SkillBoostApp);

// Test API call
fetch(`${window.SkillBoostApp.apiBase}/api/health`)
  .then(r => r.json())
  .then(d => console.log('Backend OK:', d));
```

### View Network Requests
1. Open DevTools (F12)
2. Network tab
3. Perform action (login, load courses, etc.)
4. Look for requests to `skill-boost-nexus.onrender.com`
5. Click request to see details:
   - URL
   - Headers
   - Request/Response body
   - Timing

### Check localStorage
```javascript
// View all stored keys
console.log(localStorage);

// Check API base override
console.log(localStorage.getItem('skillboost-api-base'));

// Clear all
localStorage.clear();
```

---

## Performance Optimization

### DNS Resolution
- Render URL: `skill-boost-nexus.onrender.com` (DNS cached)

### Connection Reuse
- HTTP Keep-Alive enabled
- Connection pooling in backend

### Request Size
- JSON payloads optimized
- Gzip compression enabled

### Response Caching
- Static assets cached by frontend
- API responses cached where appropriate

---

## Migration Path

### Phase 1: Local Development
```
Frontend (http://localhost:5173) 
  → Backend (http://localhost:3000)
```

### Phase 2: Local with Remote API (Testing)
```
Frontend (http://localhost:5173)
  → Backend (https://skill-boost-nexus.onrender.com)
  
// Set with:
localStorage.setItem('skillboost-api-base', 
  'https://skill-boost-nexus.onrender.com');
```

### Phase 3: Deployed Frontend & Backend
```
Frontend (https://your-frontend.com)
  → Backend (https://skill-boost-nexus.onrender.com)
  
// Automatic - app-config.js detects production environment
```

---

## Conclusion

The API configuration system provides:
✅ **Flexibility** - Multiple configuration sources  
✅ **Intelligence** - Automatic environment detection  
✅ **Maintainability** - Centralized in one file  
✅ **Debuggability** - Clear resolution process  
✅ **Production Ready** - Handles all deployment scenarios  

This architecture allows seamless transitions between development, testing, and production environments without code changes.

---

**Document Version:** 1.0  
**Last Updated:** April 7, 2026  
**Architecture Status:** Production Ready ✅
