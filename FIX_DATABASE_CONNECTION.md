# Fix Database Connection on Render

## Problem
```
code: 'ECONNREFUSED'
```

The backend can't connect to the database. This is a connectivity/configuration issue.

---

## Root Causes (Most Likely)
1. **DATABASE_URL environment variable not set or wrong**
2. **Database host is incorrect**
3. **Database credentials are wrong**
4. **Database service is not running**
5. **Network/firewall blocking connection**

---

## IMMEDIATE FIX: Check & Fix DATABASE_URL on Render

### Step 1: Go to Render Dashboard
1. Open https://dashboard.render.com
2. Click on your **skill-boost-nexus** service
3. Click **Environment** tab
4. Look for `DATABASE_URL` variable

### Step 2: Verify DATABASE_URL Format

#### If using MySQL:
```
DATABASE_URL=mysql://username:password@host:3306/database_name
```

Example:
```
DATABASE_URL=mysql://user123:pass456@db.example.com:3306/skillboost_db
```

#### If using Railway MySQL:
```
DATABASE_URL=mysql://root:password@containers.railway.app:6842/railway
```

#### If using another provider (Aiven, PlanetScale, etc):
```
DATABASE_URL=mysql://[user]:[password]@[host]:[port]/[database]
```

### Step 3: Verify Connection Parameters

Run this query to confirm your database is accessible:

**From your Render service logs**, if you see connection attempts, it means the URL format is correct but credentials are wrong.

### Step 4: Test Locally

Try connecting from your local terminal:
```bash
# Replace with your actual DATABASE_URL values
mysql -h your-host.com -u your-user -p your-password database_name -e "SHOW TABLES;"
```

If it fails locally → credentials are wrong  
If it works locally but fails on Render → firewall/network issue

---

## Database Setup Checklist

### Option A: Railway MySQL ✅ Recommended
1. [ ] Create Railway MySQL service
2. [ ] Get connection string from Railway dashboard
3. [ ] Set DATABASE_URL on Render to:
   ```
   DATABASE_URL=mysql://[user]:[password]@[host]:[port]/[database]
   ```
4. [ ] Restart Render service

### Option B: Existing MySQL Database
1. [ ] Confirm host, port, username, password
2. [ ] Set DATABASE_URL on Render:
   ```
   DATABASE_URL=mysql://username:password@host:port/database_name
   ```
3. [ ] Ensure firewall allows Render IP
4. [ ] Restart Render service

---

## Quick Diagnosis

### Check What's Set on Render
1. Render Dashboard → Environment
2. Look for `DATABASE_URL`
3. Is it set? YES or NO?
   - [ ] YES → Check format (above)
   - [ ] NO → Set it now

### Common Mistakes
- ❌ Using `mysql://` without password
- ❌ Special characters in password not URL-encoded
- ❌ Wrong port number (should be 3306 for MySQL)
- ❌ Database name missing
- ❌ Host is local `localhost` (won't work on Render)

---

## If DATABASE_URL is Already Set

### Debug Connection
```javascript
// Add this to backend/server.js temporarily
const mysql = require('mysql2/promise');
const pool = mysql.createPool(process.env.DATABASE_URL);

pool.getConnection()
  .then(conn => {
    console.log('✅ DATABASE CONNECTED');
    conn.release();
  })
  .catch(err => {
    console.error('❌ DATABASE ERROR:', err.message);
    console.error('DATABASE_URL:', process.env.DATABASE_URL);
  });
```

Then check Render logs to see the error.

---

## After Fixing Connection

### Step 1: Restart Service
1. Render Dashboard → skill-boost-nexus
2. Click **Manual Deploy**
3. Wait for re-deployment

### Step 2: Create Database Schema
Once connected, run SCHEMA_ACCESS.sql:

```bash
# From your local machine
mysql -h YOUR_HOST -u YOUR_USER -p YOUR_PASSWORD YOUR_DATABASE < backend/SCHEMA_ACCESS.sql
```

Or from Render CLI:
```bash
render api db exec YOUR_SERVICE_ID < backend/SCHEMA_ACCESS.sql
```

### Step 3: Test Connection Again
```javascript
// Browser console
fetch('https://skill-boost-nexus.onrender.com/api/health')
  .then(r => r.json())
  .then(d => console.log('✅ Backend OK:', d))
  .catch(e => console.error('❌ Error:', e));
```

Expected response:
```json
{
  "backend": "ok",
  "timestamp": "2026-04-07T...",
  "cloudinary": {...}
}
```

---

## Next: Register Access Owner

Once database is connected and schema is created:

1. Go to your frontend: `https://your-frontend/HTML/access.html`
2. Click **"Create New Academy"**
3. Fill registration form
4. This creates your customer + academy in database
5. Then login should work!

---

## Troubleshooting

### Still Getting ECONNREFUSED?
- [ ] Is DATABASE_URL set on Render? (check Environment tab)
- [ ] Is the format correct? (should be mysql://...)
- [ ] Are credentials correct? (test locally)
- [ ] Is database host reachable? (ping if possible)
- [ ] Port correct? (usually 3306 for MySQL)

### Getting "Table doesn't exist"?
- [ ] Run: `mysql ... < backend/SCHEMA_ACCESS.sql`
- [ ] This creates all required tables

### Getting "Access denied"?
- [ ] Check username and password in DATABASE_URL
- [ ] Make sure user has permissions to create tables
- [ ] For Railway: use the provided database string exactly

---

## Reference: What ECONNREFUSED Means

```
ECONNREFUSED = Connection Refused
├─ Endpoint not reachable
├─ Database server not running
├─ Wrong host/port
├─ Wrong credentials (doesn't reach server)
└─ Firewall blocking
```

**Action:** Fix DATABASE_URL on Render → Restart → Test

---

**Status:** 🔴 Database connection not working  
**Next Action:** Set/fix DATABASE_URL environment variable  
**Time to Fix:** ~5 minutes
