# Backend 500 Error Diagnostic Guide

## Issue Found
**Endpoint:** `POST /api/access/login`  
**Status:** 500 Internal Server Error  
**Root Cause:** Backend error during login - need to check logs

---

## Step 1: Check Render Backend Logs

### Via Render Dashboard
1. Go to https://dashboard.render.com
2. Select your backend service (skill-boost-nexus)
3. Click **Logs** tab
4. Search for recent errors around the time of login attempt
5. Look for: `Access owner login error: ...`

### What to Look For
```
Access owner login error: [ERROR MESSAGE HERE]
```

This error message will tell us exactly what's failing.

---

## Common Causes & Solutions

### 1. Database Connection Failed
**Error Message:** 
```
Access owner login error: Connection refused / ECONNREFUSED
```

**Solution:**
- [ ] Verify DATABASE_URL is set on Render
- [ ] Check database is running on your provider
- [ ] Test connection: `mysql -h HOST -u USER -p < schema.sql`

---

### 2. CUSTOMERS Table Doesn't Exist
**Error Message:**
```
Access owner login error: ER_NO_SUCH_TABLE: Table 'database.customers' doesn't exist
```

**Solution:**
- [ ] Run the schema file to create tables:
  ```bash
  mysql -h YOUR_HOST -u USER -p PASSWORD < backend/SCHEMA_ACCESS.sql
  ```

---

### 3. No Academy Found for Customer
**Error Message:**
```
null
```

**Solution (Expected 404, not 500):**
- [ ] Customer exists in database
- [ ] Customer has an academy linked in the `academies` table
- [ ] Check with: 
  ```sql
  SELECT * FROM customers WHERE email = 'your@email.com';
  -- Get customer ID, then check:
  SELECT * FROM academies WHERE customer_id = YOUR_CUSTOMER_ID;
  ```

---

### 4. JWT Signing Failed
**Error Message:**
```
Access owner login error: secret is required
```

**Solution:**
- [ ] Set ACCESS_OWNER_JWT_SECRET environment variable on Render:
  ```
  ACCESS_OWNER_JWT_SECRET=your-secret-key-here
  ```

---

### 5. Required Environment Variables Missing
**Error Message:**
```
Access owner login error: Cannot read property 'CLOUDINARY_...' of undefined
```

**Solution:**
Check you have set ALL of these on Render:
- [ ] DATABASE_URL
- [ ] ACCESS_OWNER_JWT_SECRET
- [ ] CLOUDINARY_CLOUD_NAME
- [ ] CLOUDINARY_API_KEY
- [ ] CLOUDINARY_API_SECRET
- [ ] PASSWORD_RESET_JWT_SECRET
- [ ] Email/Nodemailer settings (if configured)

---

## Quick Diagnostic Steps

### 1. Check if Database Schema Exists
```sql
-- Connect to your database and run:
SHOW TABLES;
-- Should show: academies, customers, plans, instructors, students, etc.

-- If not, run:
mysql -h YOUR_HOST -u USER -p PASSWORD < backend/SCHEMA_ACCESS.sql
```

### 2. Check if Customer Exists
```sql
SELECT id, email, password_hash FROM customers LIMIT 5;
-- Customer should have a password_hash (not NULL)
```

### 3. Check if Customer Has Academy
```sql
SELECT * FROM academies WHERE customer_id = CUSTOMER_ID;
-- Should return at least one academy
```

### 4. Test Database Connection Directly
From your local terminal:
```bash
# Replace with your actual credentials
mysql -h your-database-host.com \
      -u your-username \
      -p your-password \
      -e "SELECT DATABASE(); SHOW TABLES;"
```

---

## Debug the Exact Error

### Option A: Check Render Logs (Recommended)
1. Dashboard → Your Service → Logs
2. Scroll to the time of the error
3. Find the line: `Access owner login error: ...`
4. Post the full error message here

### Option B: Add Debug Logging
Edit `backend/server.js` at line 4843:

```javascript
app.post('/api/access/login', async (req, res) => {
    const customerEmail = normalizeCustomerEmail(req.body.customer_email || req.body.email);
    const password = String(req.body.password || '');

    console.log('[DEBUG] Login attempt for:', customerEmail);

    if (!customerEmail || !password) {
        return res.status(400).json({...});
    }

    try {
        const [customerRows] = await db.query(
            'SELECT id, password_hash FROM customers WHERE email = ? LIMIT 1',
            [customerEmail]
        );

        console.log('[DEBUG] Customer found:', customerRows.length > 0);

        if (customerRows.length === 0 || !customerRows[0].password_hash) {
            return res.status(401).json({...});
        }

        const passwordMatches = await bcrypt.compare(password, customerRows[0].password_hash);
        console.log('[DEBUG] Password matches:', passwordMatches);

        if (!passwordMatches) {
            return res.status(401).json({...});
        }

        const context = await getAccessOwnerContext(customerRows[0].id);
        console.log('[DEBUG] Context found:', !!context);

        if (!context) {
            return res.status(404).json({...});
        }

        return res.json({...});
    } catch (error) {
        console.error('[CRITICAL ERROR] Access owner login:', error);
        console.error('[CRITICAL ERROR] Stack:', error.stack);
        return res.status(500).json({...});
    }
});
```

---

## Quick Test: Verify API is Working

### In Browser Console
```javascript
// Test if backend is reachable
fetch('https://skill-boost-nexus.onrender.com/api/health')
  .then(r => r.json())
  .then(d => console.log('Backend OK:', d))
  .catch(e => console.error('Backend Error:', e));

// Result should show backend status
```

If health check fails → Backend is down  
If health check works → Backend is up, issue is with login endpoint

---

## Next Steps

**Right now:**
1. [ ] Open Render logs
2. [ ] Find the exact error message
3. [ ] Match it to a solution above
4. [ ] Apply the fix

**Once fixed:**
1. [ ] Restart the Render service
2. [ ] Try login again
3. [ ] Clear browser cache (Ctrl+F5)

---

## Still Stuck?

Post your findings:
- [ ] Exact error from Render logs
- [ ] Result of `SHOW TABLES;` query
- [ ] Customer record: `SELECT * FROM customers WHERE email = 'your@email';`
- [ ] Academy records: `SELECT * FROM academies WHERE customer_id = YOUR_ID;`

With this information, I can pinpoint the exact issue!

---

**Document Version:** 1.0  
**Date:** April 7, 2026  
**Status:** Debugging backend 500 error
