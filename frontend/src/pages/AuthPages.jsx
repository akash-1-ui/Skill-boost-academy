import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { getHomePathForRole, useAuth } from '../context/AuthContext';

function AuthShowcase() {
    return (
        <div className="auth-showcase">
            <span className="eyebrow">SkillBoost Academy SaaS</span>
            <h1>One platform for principals, instructors, and students.</h1>
            <p>
                Run course delivery across multiple colleges with access-code login,
                subscription controls, analytics, and role-specific workspaces.
            </p>
            <div className="showcase-grid">
                <div className="showcase-card">
                    <strong>Principal Controls</strong>
                    <span>Seat limits, subscription tracking, payment history, and growth charts.</span>
                </div>
                <div className="showcase-card">
                    <strong>Instructor Tools</strong>
                    <span>Create courses, upload videos, watch learner progress, and message cohorts.</span>
                </div>
                <div className="showcase-card">
                    <strong>Student View</strong>
                    <span>Enroll, stream videos, track completion, and follow notifications in one place.</span>
                </div>
            </div>
        </div>
    );
}

export function LoginPage() {
    const { token, user, login } = useAuth();
    const navigate = useNavigate();
    const [form, setForm] = useState({
        email: '',
        password: '',
        accessCode: ''
    });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    if (token && user) {
        return <Navigate to={getHomePathForRole(user.role)} replace />;
    }

    const updateField = (key, value) => {
        setForm((current) => ({ ...current, [key]: value }));
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setSubmitting(true);
        setError('');

        try {
            const session = await login(form);
            navigate(getHomePathForRole(session.user.role), { replace: true });
        } catch (submitError) {
            setError(submitError.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="auth-shell">
            <AuthShowcase />
            <div className="auth-panel surface">
                <span className="eyebrow">Login</span>
                <h2>Enter your college workspace</h2>
                <p>Use your access code to ensure your data stays inside the right organization.</p>

                <form className="form-stack" onSubmit={handleSubmit}>
                    <label>
                        Email
                        <input
                            type="email"
                            value={form.email}
                            onChange={(event) => updateField('email', event.target.value)}
                            placeholder="principal@college.edu"
                            required
                        />
                    </label>

                    <label>
                        Password
                        <input
                            type="password"
                            value={form.password}
                            onChange={(event) => updateField('password', event.target.value)}
                            placeholder="Enter your password"
                            required
                        />
                    </label>

                    <label>
                        Access Code
                        <input
                            type="text"
                            value={form.accessCode}
                            onChange={(event) => updateField('accessCode', event.target.value.toUpperCase())}
                            placeholder="CAMPUS2026"
                            required
                        />
                    </label>

                    {error ? <div className="notice danger">{error}</div> : null}

                    <button type="submit" className="primary-btn" disabled={submitting}>
                        {submitting ? 'Signing in...' : 'Login'}
                    </button>
                </form>

                <p className="auth-foot">
                    Need a principal workspace? <Link to="/register">Create your organization</Link>
                </p>
            </div>
        </div>
    );
}

export function RegisterPage() {
    const { token, user, register } = useAuth();
    const navigate = useNavigate();
    const [form, setForm] = useState({
        collegeName: '',
        accessCode: '',
        username: '',
        email: '',
        phone: '',
        password: ''
    });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    if (token && user) {
        return <Navigate to={getHomePathForRole(user.role)} replace />;
    }

    const updateField = (key, value) => {
        setForm((current) => ({ ...current, [key]: value }));
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setSubmitting(true);
        setError('');

        try {
            const session = await register(form);
            navigate(getHomePathForRole(session.user.role), { replace: true });
        } catch (submitError) {
            setError(submitError.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="auth-shell">
            <AuthShowcase />
            <div className="auth-panel surface">
                <span className="eyebrow">Principal Registration</span>
                <h2>Launch a college workspace</h2>
                <p>
                    Registration creates a principal account plus an isolated organization ready for subscription setup.
                </p>

                <form className="form-stack" onSubmit={handleSubmit}>
                    <label>
                        College Name
                        <input
                            type="text"
                            value={form.collegeName}
                            onChange={(event) => updateField('collegeName', event.target.value)}
                            placeholder="SkillBoost Engineering College"
                            required
                        />
                    </label>

                    <label>
                        Access Code
                        <input
                            type="text"
                            value={form.accessCode}
                            onChange={(event) => updateField('accessCode', event.target.value.toUpperCase())}
                            placeholder="SKILLBOOST2026"
                            required
                        />
                    </label>

                    <label>
                        Principal Name
                        <input
                            type="text"
                            value={form.username}
                            onChange={(event) => updateField('username', event.target.value)}
                            placeholder="Dr. Meera Iyer"
                            required
                        />
                    </label>

                    <label>
                        Email
                        <input
                            type="email"
                            value={form.email}
                            onChange={(event) => updateField('email', event.target.value)}
                            placeholder="principal@college.edu"
                            required
                        />
                    </label>

                    <label>
                        Phone
                        <input
                            type="tel"
                            value={form.phone}
                            onChange={(event) => updateField('phone', event.target.value)}
                            placeholder="+91 9876543210"
                        />
                    </label>

                    <label>
                        Password
                        <input
                            type="password"
                            value={form.password}
                            onChange={(event) => updateField('password', event.target.value)}
                            placeholder="Create a strong password"
                            required
                        />
                    </label>

                    {error ? <div className="notice danger">{error}</div> : null}

                    <button type="submit" className="primary-btn" disabled={submitting}>
                        {submitting ? 'Creating workspace...' : 'Create Organization'}
                    </button>
                </form>

                <p className="auth-foot">
                    Already have an account? <Link to="/login">Sign in here</Link>
                </p>
            </div>
        </div>
    );
}
