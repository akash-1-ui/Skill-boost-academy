# Quick Start: Testing the Video Upload Fix

## Step 1: Verify Backend is Running

```bash
# Navigate to backend directory
cd backend

# Check if .env file exists with Cloudinary credentials
cat .env | grep CLOUDINARY

# You should see:
# CLOUDINARY_CLOUD_NAME=...
# CLOUDINARY_API_KEY=...
# CLOUDINARY_API_SECRET=...
```

If missing, add these to `backend/.env`:
```
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

Get credentials from: https://cloudinary.com/console/settings/api-keys

## Step 2: Start the Backend Server

```bash
# In the backend directory
npm install  # if dependencies not installed
node server.js
```

Expected output:
```
listening on http://localhost:3000
Upload directories created/verified
```

## Step 3: Verify Cloudinary Configuration

```bash
# In another terminal, test the health endpoint
curl http://localhost:3000/api/health
```

Should return:
```json
{
  "backend": "ok",
  "cloudinary": {
    "ready": true,
    "reason": "Cloudinary is properly configured"
  }
}
```

If `"ready": false`, check your Cloudinary credentials.

## Step 4: Test Video Upload

1. Open `HTML/addcoursevideo.html` in your browser
2. Log in as an instructor (if required)
3. Select a course from the dropdown
4. Optional: Enter a lesson title (or it defaults to "Lesson Video")
5. Click "Choose a video" and select a video file (max 100MB)
6. Click "Upload Video"

## Step 5: Monitor the Upload

**In your browser:**
- Watch the progress bar fill up
- See percentage increase in steps
- Watch status message change: "Uploading..." → "Processing..." → "Complete"
- Success message should stay visible for 3 seconds

**In terminal (backend console):**
- Should see logs like:
```
Video upload request received: { courseId: 1, instructorId: 2, title: 'Lesson Title', hasFile: true }
File received: { originalName: 'video.mp4', size: 52428800, mimetype: 'video/mp4', ... }
Starting Cloudinary upload for file: ...
Cloudinary upload successful: { videoUrl: 'https://res.cloudinary.com/...', publicId: '...' }
Video record inserted: { videoId: 3, courseId: 1 }
Video upload completed successfully: { videoId: 3, courseId: 1 }
```

**In browser console (F12):**
- Should see logs like:
```
Upload started for video: video.mp4 Size: 52428800
Sending video upload request to http://localhost:3000/videos/upload
Upload response received, status: 201 data: {...}
```

## Troubleshooting

### Issue: "Cloudinary upload is unavailable"

**Check 1:** Verify Cloudinary credentials in `backend/.env`
```bash
# Should show three Cloudinary variables
cat backend/.env | grep CLOUDINARY_
```

**Check 2:** Test `/api/health` endpoint
```bash
curl http://localhost:3000/api/health
```

If `"ready": false`, the credentials are incorrect or missing.

**Check 3:** Verify Cloudinary account
- Go to https://console.cloudinary.com
- Get your Cloud Name, API Key, and API Secret
- Update `backend/.env`
- Restart Node.js server

### Issue: "Video file is required"

Make sure you:
1. Selected a video file (not image/audio)
2. File is less than 100MB
3. Browser correctly received the file in the `<input type="file">` element

### Issue: "Course not found"

Means you selected a course that doesn't exist. Try:
1. Create a new course first using the course creation form
2. Then try uploading a video to it

### Issue: "Permission denied"

Means the instructor_id in the form doesn't match the course owner.
Check that:
1. You're logged in as the correct instructor
2. The instructor_id is saved to localStorage
3. You're trying to upload to your own course (not someone else's)

### Issue: "Upload timeout"

The upload took longer than 60 seconds. This might mean:
1. Your internet connection is slow
2. The video file is very large (consider compressing it)
3. Server is overloaded
4. Try uploading a smaller video first

## Expected Behavior Checklist

- [ ] File size validation: "Maximum file size: 100MB" hint visible
- [ ] Progress bar appears and fills during upload
- [ ] Percentage updates in real-time
- [ ] Status message changes as upload progresses
- [ ] Upload button becomes disabled during upload
- [ ] Success message appears and stays visible for 3 seconds
- [ ] Browser console shows detailed logs
- [ ] Backend console shows detailed logs
- [ ] Video appears in the course's video list after upload

## Debugging Tips

1. **Open browser console** (F12) and check for any JavaScript errors
2. **Check backend console** for upload processing logs
3. **Test API health** endpoint to verify Cloudinary setup
4. **Start with small file** (< 10MB) to isolate issues
5. **Check network tab** (F12) to see the POST request details
6. **Verify Cloudinary account** is active and not over quota

## Success Indicators

✅ Progress bar appears and updates
✅ Status messages are clear and visible (not flashing)
✅ Backend logs show file received and Cloudinary upload started
✅ Success message shows with video count
✅ Download speed doesn't interrupt the upload UI
