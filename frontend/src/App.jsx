import { Navigate, Route, Routes } from 'react-router-dom';
import { getHomePathForRole, useAuth } from './context/AuthContext';
import { RoleShell, LoadingBlock } from './layouts/AppShell';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import {
    PrincipalDashboardPage,
    PrincipalInstructorsPage,
    PrincipalStudentsPage,
    PrincipalSubscriptionPage,
    PrincipalPaymentsPage,
    PrincipalSettingsPage
} from './pages/PrincipalPages';
import {
    InstructorDashboardPage,
    InstructorCoursesPage,
    InstructorCreateCoursePage,
    InstructorUploadVideoPage,
    InstructorStudentsPage,
    InstructorMessagesPage
} from './pages/InstructorPages';
import {
    StudentDashboardPage,
    StudentCoursesPage,
    StudentWatchVideoPage,
    StudentMessagesPage,
    StudentNotificationsPage
} from './pages/StudentPages';

const principalLinks = [
    { to: '/principal/dashboard', label: 'Dashboard', helper: 'Analytics and cards' },
    { to: '/principal/instructors', label: 'Instructors', helper: 'Manage faculty seats' },
    { to: '/principal/students', label: 'Students', helper: 'Manage learner seats' },
    { to: '/principal/subscription', label: 'Subscription', helper: 'Plans and renewal' },
    { to: '/principal/payments', label: 'Payments', helper: 'Transaction history' },
    { to: '/principal/settings', label: 'Settings', helper: 'Workspace identity' }
];

const instructorLinks = [
    { to: '/instructor/dashboard', label: 'Dashboard', helper: 'Teaching metrics' },
    { to: '/instructor/courses', label: 'Courses', helper: 'Your catalog' },
    { to: '/instructor/create-course', label: 'Create Course', helper: 'New course builder' },
    { to: '/instructor/upload-video', label: 'Upload Video', helper: 'Add lesson content' },
    { to: '/instructor/students', label: 'Students', helper: 'Progress tracking' },
    { to: '/instructor/messages', label: 'Messages', helper: 'Broadcast and chat' }
];

const studentLinks = [
    { to: '/student/dashboard', label: 'Dashboard', helper: 'Progress summary' },
    { to: '/student/courses', label: 'My Courses', helper: 'Enroll and review' },
    { to: '/student/watch-video', label: 'Watch Video', helper: 'Lesson streaming' },
    { to: '/student/messages', label: 'Messages', helper: 'Talk to instructors' },
    { to: '/student/notifications', label: 'Notifications', helper: 'Alerts and reminders' }
];

function HomeRedirect() {
    const { token, user, booting } = useAuth();

    if (booting) {
        return <LoadingBlock label="Opening workspace..." />;
    }

    if (!token || !user) {
        return <Navigate to="/login" replace />;
    }

    return <Navigate to={getHomePathForRole(user.role)} replace />;
}

function RoleGate({ roles, title, links }) {
    const { token, user, booting } = useAuth();

    if (booting) {
        return <LoadingBlock label="Preparing workspace..." />;
    }

    if (!token || !user) {
        return <Navigate to="/login" replace />;
    }

    if (!roles.includes(user.role)) {
        return <Navigate to={getHomePathForRole(user.role)} replace />;
    }

    return <RoleShell links={links} title={title} />;
}

export default function App() {
    return (
        <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            <Route element={<RoleGate roles={['principal']} title="Principal Workspace" links={principalLinks} />}>
                <Route path="/principal/dashboard" element={<PrincipalDashboardPage />} />
                <Route path="/principal/instructors" element={<PrincipalInstructorsPage />} />
                <Route path="/principal/students" element={<PrincipalStudentsPage />} />
                <Route path="/principal/subscription" element={<PrincipalSubscriptionPage />} />
                <Route path="/principal/payments" element={<PrincipalPaymentsPage />} />
                <Route path="/principal/settings" element={<PrincipalSettingsPage />} />
            </Route>

            <Route element={<RoleGate roles={['instructor']} title="Instructor Workspace" links={instructorLinks} />}>
                <Route path="/instructor/dashboard" element={<InstructorDashboardPage />} />
                <Route path="/instructor/courses" element={<InstructorCoursesPage />} />
                <Route path="/instructor/create-course" element={<InstructorCreateCoursePage />} />
                <Route path="/instructor/upload-video" element={<InstructorUploadVideoPage />} />
                <Route path="/instructor/students" element={<InstructorStudentsPage />} />
                <Route path="/instructor/messages" element={<InstructorMessagesPage />} />
            </Route>

            <Route element={<RoleGate roles={['student']} title="Student Workspace" links={studentLinks} />}>
                <Route path="/student/dashboard" element={<StudentDashboardPage />} />
                <Route path="/student/courses" element={<StudentCoursesPage />} />
                <Route path="/student/watch-video" element={<StudentWatchVideoPage />} />
                <Route path="/student/messages" element={<StudentMessagesPage />} />
                <Route path="/student/notifications" element={<StudentNotificationsPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}
