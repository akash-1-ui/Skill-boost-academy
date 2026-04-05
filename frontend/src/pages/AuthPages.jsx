import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../api/client';
import { getHomePathForRole, useAuth } from '../context/AuthContext';

function formatLimit(limit) {
    return limit === null || limit === undefined ? 'Unlimited' : limit;
}

function AuthShowcase({ inviteRole = '' }) {
    const inviteMode = inviteRole === 'student' || inviteRole === 'instructor';

    return (
        <div className="auth-showcase">
            <span className="eyebrow">Skill Boost Nexus SaaS</span>
            <h1>
                {inviteMode
                    ? `Join your academy as a ${inviteRole}.`
                    : 'One platform for principals, instructors, and students.'}
            </h1>
            <p>
                {inviteMode
                    ? 'Secure invite-based onboarding keeps every learner and teacher inside the correct academy workspace.'
                    : 'Run course delivery across multiple academies with access-code login, subscription controls, analytics, and role-specific workspaces.'}
            </p>
            <div className="showcase-grid">
                <div className="showcase-card">
                    <strong>Customer Controls</strong>
                    <span>Register an academy, buy a plan, and track how many seats are already in use.</span>
                </div>
                <div className="showcase-card">
                    <strong>Invite Access</strong>
                    <span>Share secure registration links for instructors and students with one academy code.</span>
                </div>
                <div className="showcase-card">
                    <strong>Usage Warnings</strong>
                    <span>See nearing-limit alerts and rejected signup attempts before growth turns into friction.</span>
                </div>
            </div>
        </div>
    );
}

function InviteSummary({ context, role, inviteCode }) {
    if (!context) {
        return null;
    }

    return (
        <div className="invite-summary">
            <span className="eyebrow">Invite Details</span>
            <h2>{context.academy.college_name}</h2>
            <p>
                Academy ID {context.academy.academy_id} and access code {inviteCode} are linked to this {role} invite.
            </p>
            <div className="invite-stat-grid">
                <div className="invite-stat-card">
                    <strong>{context.usage.instructors.current}</strong>
                    <span>Instructors Used</span>
                    <small>{formatLimit(context.usage.instructors.limit)} total seats</small>
                </div>
                <div className="invite-stat-card">
                    <strong>{context.usage.students.current}</strong>
                    <span>Students Used</span>
                    <small>{formatLimit(context.usage.students.limit)} total seats</small>
                </div>
            </div>
        </div>
    );
}

export function LoginPage() {
    const { token, user, organization, login } = useAuth();
    const navigate = useNavigate();
    const [form, setForm] = useState({
        email: '',
        password: '',
        accessCode: ''
    });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    if (token && user) {
        return <Navigate to={getHomePathForRole(user.role, organization)} replace />;
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
            navigate(getHomePathForRole(session.user.role, session.organization), { replace: true });
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
                <h2>Enter your academy workspace</h2>
                <p>Use your access code to ensure your data stays inside the right academy.</p>

                <form className="form-stack" onSubmit={handleSubmit}>
                    <label>
                        Email
                        <input
                            type="email"
                            value={form.email}
                            onChange={(event) => updateField('email', event.target.value)}
                            placeholder="owner@academy.edu"
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
                            placeholder="SB-ACADEMY"
                            required
                        />
                    </label>

                    {error ? <div className="notice danger">{error}</div> : null}

                    <button type="submit" className="primary-btn" disabled={submitting}>
                        {submitting ? 'Signing in...' : 'Login'}
                    </button>
                </form>

                <p className="auth-foot">
                    Need an academy workspace? <Link to="/register">Create your customer account</Link>
                </p>
            </div>
        </div>
    );
}

export function RegisterPage() {
    const { token, user, organization, register, establishSession } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inviteType = useMemo(() => {
        const candidate = String(searchParams.get('type') || '').trim().toLowerCase();
        return candidate === 'student' || candidate === 'instructor' ? candidate : '';
    }, [searchParams]);
    const inviteCode = useMemo(
        () => String(searchParams.get('code') || '').trim().toUpperCase(),
        [searchParams]
    );
    const inviteMode = Boolean(inviteType && inviteCode);

    const [principalForm, setPrincipalForm] = useState({
        collegeName: '',
        username: '',
        email: '',
        phone: '',
        password: ''
    });
    const [inviteForm, setInviteForm] = useState({
        username: '',
        email: '',
        phone: '',
        password: '',
        expertise: '',
        branch: ''
    });
    const [contextState, setContextState] = useState({ loading: inviteMode, data: null, error: '' });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!inviteMode) {
            setContextState({ loading: false, data: null, error: '' });
            return;
        }

        let active = true;
        setContextState({ loading: true, data: null, error: '' });

        apiRequest(`/public/register-context?accessCode=${encodeURIComponent(inviteCode)}&role=${inviteType}`)
            .then((payload) => {
                if (active) {
                    setContextState({ loading: false, data: payload, error: '' });
                }
            })
            .catch((loadError) => {
                if (active) {
                    setContextState({ loading: false, data: null, error: loadError.message });
                }
            });

        return () => {
            active = false;
        };
    }, [inviteCode, inviteMode, inviteType]);

    if (token && user) {
        return <Navigate to={getHomePathForRole(user.role, organization)} replace />;
    }

    const handlePrincipalSubmit = async (event) => {
        event.preventDefault();
        setSubmitting(true);
        setError('');

        try {
            const session = await register(principalForm);
            navigate(getHomePathForRole(session.user.role, session.organization), { replace: true });
        } catch (submitError) {
            setError(submitError.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleInviteSubmit = async (event) => {
        event.preventDefault();
        setSubmitting(true);
        setError('');

        try {
            const payload = await apiRequest(`/public/register/${inviteType}`, {
                method: 'POST',
                body: {
                    accessCode: inviteCode,
                    username: inviteForm.username,
                    email: inviteForm.email,
                    phone: inviteForm.phone,
                    password: inviteForm.password,
                    expertise: inviteForm.expertise,
                    branch: inviteForm.branch
                }
            });
            const session = establishSession(payload);
            navigate(getHomePathForRole(session.user.role, session.organization), { replace: true });
        } catch (submitError) {
            setError(submitError.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (inviteMode) {
        return (
            <div className="auth-shell">
                <AuthShowcase inviteRole={inviteType} />
                <div className="auth-panel surface">
                    <span className="eyebrow">{inviteType === 'student' ? 'Student Invite' : 'Instructor Invite'}</span>
                    <h2>Join your academy</h2>
                    <p>
                        This invite is protected by academy access code {inviteCode}. Complete the form below to activate your account.
                    </p>

                    {contextState.loading ? <div className="notice info">Loading academy invite details...</div> : null}
                    {contextState.error ? <div className="notice danger">{contextState.error}</div> : null}
                    {contextState.data ? <InviteSummary context={contextState.data} role={inviteType} inviteCode={inviteCode} /> : null}
                    {contextState.data?.message ? (
                        <div className={`notice ${contextState.data.can_register ? 'info' : 'warning'}`}>
                            {contextState.data.message}
                        </div>
                    ) : null}
                    {error ? <div className="notice danger">{error}</div> : null}

                    <form className="form-stack" onSubmit={handleInviteSubmit}>
                        <label>
                            Full Name
                            <input
                                type="text"
                                value={inviteForm.username}
                                onChange={(event) => setInviteForm((current) => ({ ...current, username: event.target.value }))}
                                placeholder={inviteType === 'student' ? 'Student name' : 'Instructor name'}
                                required
                            />
                        </label>

                        <label>
                            Email
                            <input
                                type="email"
                                value={inviteForm.email}
                                onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))}
                                placeholder="you@academy.edu"
                                required
                            />
                        </label>

                        <label>
                            Phone
                            <input
                                type="tel"
                                value={inviteForm.phone}
                                onChange={(event) => setInviteForm((current) => ({ ...current, phone: event.target.value }))}
                                placeholder="+91 9876543210"
                            />
                        </label>

                        {inviteType === 'instructor' ? (
                            <label>
                                Expertise
                                <input
                                    type="text"
                                    value={inviteForm.expertise}
                                    onChange={(event) => setInviteForm((current) => ({ ...current, expertise: event.target.value }))}
                                    placeholder="Data Structures, Java, AI"
                                />
                            </label>
                        ) : (
                            <label>
                                Branch
                                <input
                                    type="text"
                                    value={inviteForm.branch}
                                    onChange={(event) => setInviteForm((current) => ({ ...current, branch: event.target.value }))}
                                    placeholder="CSE, ECE, BCA"
                                />
                            </label>
                        )}

                        <label>
                            Password
                            <input
                                type="password"
                                value={inviteForm.password}
                                onChange={(event) => setInviteForm((current) => ({ ...current, password: event.target.value }))}
                                placeholder="Create your password"
                                required
                            />
                        </label>

                        <button
                            type="submit"
                            className="primary-btn"
                            disabled={submitting || contextState.loading || !contextState.data?.can_register}
                        >
                            {submitting ? 'Creating account...' : `Register as ${inviteType}`}
                        </button>
                    </form>

                    <p className="auth-foot">
                        Already have an account? <Link to="/login">Login here</Link>
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="auth-shell">
            <AuthShowcase />
            <div className="auth-panel surface">
                <span className="eyebrow">Customer Registration</span>
                <h2>Create a new academy workspace</h2>
                <p>
                    We will generate a unique academy ID and access code for you automatically, then you can activate a plan and invite instructors or students.
                </p>

                <form className="form-stack" onSubmit={handlePrincipalSubmit}>
                    <label>
                        Academy Name
                        <input
                            type="text"
                            value={principalForm.collegeName}
                            onChange={(event) => setPrincipalForm((current) => ({ ...current, collegeName: event.target.value }))}
                            placeholder="Skill Boost Nexus"
                            required
                        />
                    </label>

                    <label>
                        Customer Name
                        <input
                            type="text"
                            value={principalForm.username}
                            onChange={(event) => setPrincipalForm((current) => ({ ...current, username: event.target.value }))}
                            placeholder="Owner or principal name"
                            required
                        />
                    </label>

                    <label>
                        Email
                        <input
                            type="email"
                            value={principalForm.email}
                            onChange={(event) => setPrincipalForm((current) => ({ ...current, email: event.target.value }))}
                            placeholder="owner@academy.edu"
                            required
                        />
                    </label>

                    <label>
                        Phone
                        <input
                            type="tel"
                            value={principalForm.phone}
                            onChange={(event) => setPrincipalForm((current) => ({ ...current, phone: event.target.value }))}
                            placeholder="+91 9876543210"
                        />
                    </label>

                    <label>
                        Password
                        <input
                            type="password"
                            value={principalForm.password}
                            onChange={(event) => setPrincipalForm((current) => ({ ...current, password: event.target.value }))}
                            placeholder="Create a strong password"
                            required
                        />
                    </label>

                    {error ? <div className="notice danger">{error}</div> : null}

                    <button type="submit" className="primary-btn" disabled={submitting}>
                        {submitting ? 'Creating workspace...' : 'Create Academy Workspace'}
                    </button>
                </form>

                <p className="auth-foot">
                    Already have an account? <Link to="/login">Sign in here</Link>
                </p>
            </div>
        </div>
    );
}

