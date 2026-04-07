# 🚨 URGENT: Fix Backend Database Connection

## The Issue
- **Error:** `ECONNREFUSED` (Connection Refused)
- **Cause:** Backend cannot connect to database
- **Solution:** Fix DATABASE_URL environment variable

---

## IMMEDIATE ACTION PLAN (5 minutes)

### ✅ Step 1: Check DATABASE_URL on Render (2 min)
```
1. Open https://dashboard.render.com
2. Click "skill-boost-nexus" service
3. Click "Environment" tab
4. Look for "DATABASE_URL" variable
```

**What you're looking for:**
```
DATABASE_URL=mysql://user:password@host:port/database
```

### ❓ Is DATABASE_URL set?

#### If YES → Go to Step 2
#### If NO → Set it now:

**Example for Railway MySQL:**
```
DATABASE_URL=mysql://root:PASSWORD@containers.railway.app:PORT/railway
```

Get these values from:
- Railway Dashboard → your MySQL service → Connect tab

---

### ✅ Step 2: Verify Format is Correct (1 min)

Check your DATABASE_URL has all parts:
```
mysql://
  ├─ USERNAME: user
  ├─ PASSWORD: password  
  ├─ HOST: host.com
  ├─ PORT: 3306
  └─ DATABASE: database_name
```

**❌ Wrong:**
```
mysql://localhost:3306/database
DATABASE_URL=mysql://password@/database
```

**✅ Correct:**
```
mysql://user:password@host.com:3306/database
```

---

### ✅ Step 3: Restart Service (1 min)
```
1. Render Dashboard → skill-boost-nexus
2. Top right → "Manual Deploy" button
3. Wait for green status ✓
```

---

### ✅ Step 4: Create Database Schema (1 min)

From your terminal, run:
```bash
cd "c:\Users\PUJITHA AKASH\OneDrive\Desktop\Skill Boost Nexus"

# Replace with your actual DATABASE credentials
mysql -h containers.railway.app \
      -u root \
      -p YOUR_PASSWORD \
      -P YOUR_PORT \
      railway < backend/SCHEMA_ACCESS.sql
```

Or use MySQL Workbench:
1. Open `backend/SCHEMA_ACCESS.sql`
2. Connect to your database
3. Run the script

---

### ✅ Step 5: Test Connection (1 min)

In browser console (F12):
```javascript
fetch('https://skill-boost-nexus.onrender.com/api/health')
  .then(r => r.json())
  .then(d => {
    if (d.backend === 'ok') {
      console.log('✅ BACKEND WORKING!', d);
    } else {
      console.error('❌ Error:', d);
    }
  })
  .catch(e => console.error('❌ Connection error:', e));
```

**Expected Result:**
```json
{
  "backend": "ok",
  "timestamp": "2026-04-07T...",
  "cloudinary": {
    "ready": true
  }
}
```

---

## If Still Not Working

### Check These:

**1. DATABASE_URL Format**
```bash
# In Render Environment tab, should look like:
mysql://user:password@host:port/database
# NOT: mysql://user:password
# NOT: localhost (Render can't reach localhost)
# NOT: missing @ or : or /
```

**2. Test Connection Locally**
```bash
mysql -h YOUR_HOST -u YOUR_USER -p PASSWORD DATABASE -e "SELECT 1;"
```

If fails locally → Credentials wrong  
If works locally but fails on Render → Network issue

**3. Check Database is Running**
```bash
# Via Railway or your provider's dashboard
# Make sure MySQL service is running and NOT in "pending" state
```

---

## After Database is Fixed

### 1. Register Access Owner
- Go to: `https://your-frontend/HTML/access.html`
- Click "Create New Academy"
- Fill in all fields
- Submit

### 2. Login
- Go to: `https://your-frontend/HTML/payment.html` 
- Or click "Already have an account? Sign in"
- Enter email and password you just registered

### 3. Verify Everything Working
- Backend should respond with 200 OK
- Network tab should show requests to `skill-boost-nexus.onrender.com`
- No CORS errors

---

## Quick Reference

| Issue | Solution |
|-------|----------|
| ECONNREFUSED | Fix DATABASE_URL environment variable |
| Table doesn't exist | Run SCHEMA_ACCESS.sql on database |
| Access denied | Check username/password in DATABASE_URL |
| Connection timeout | Check host is reachable, firewall settings |
| Still 500 error | Check Render logs after these fixes |

---

## Need Help?

If still stuck, provide:
1. [ ] Current DATABASE_URL value (hide password)
2. [ ] Error from Render logs
3. [ ] Result of: `SHOW TABLES;` on your database
4. [ ] Exact URL you're trying to access

---

**Time to Fix:** ⏱️ ~5 minutes  
**Difficulty:** 🟢 Easy  
**Status:** 🔴 Database connection broken

**Next Step:** Set DATABASE_URL and restart service!
