# Skill-boost-academy

Multi-tenant course platform with:

- `backend/`: Node.js + Express + MySQL API
- `frontend/`: React + Vite dashboard app

Core SaaS additions:

- organization-based tenant isolation using `organization_id`
- access-code login flow
- principal, instructor, and student role workspaces
- subscription plans with Stripe-ready checkout flow and local simulation fallback
- instructor messaging, student progress tracking, notifications, and analytics

Run locally:

1. Backend
   `cd backend`
   `npm install`
   `npm start`

2. Frontend
   `cd frontend`
   `npm install`
   `npm run dev`

Key routes:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/principal/dashboard`
- `POST /api/principal/create-instructor`
- `POST /api/principal/create-student`
- `GET/POST /api/principal/subscription`
- `GET /api/instructor/courses`
- `POST /api/instructor/upload-video`
- `POST /api/student/enroll`
- `GET/POST /api/student/progress`
