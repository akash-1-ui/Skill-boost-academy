import { useEffect, useState } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import {
    BarElement,
    CategoryScale,
    Chart as ChartJS,
    Legend,
    LineElement,
    LinearScale,
    PointElement,
    Tooltip
} from 'chart.js';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { DataTable, LoadingBlock, Notice, PageHeader, SectionCard, StatGrid } from '../layouts/AppShell';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend);

function formatCurrency(amount, currency = 'INR') {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency
    }).format((Number(amount) || 0) / 100);
}

function formatDateTime(value) {
    if (!value) {
        return '-';
    }

    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) {
        return String(value);
    }

    return new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(parsedDate);
}

function formatSeatValue(usage) {
    if (!usage) {
        return '-';
    }

    if (usage.limit === null || usage.limit === undefined) {
        return `${usage.current} / Unlimited`;
    }

    return `${usage.current} / ${usage.limit}`;
}

async function copyToClipboard(value) {
    if (!value) {
        throw new Error('Missing text to copy');
    }

    if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
}

function useProtectedLoader(path) {
    const { token } = useAuth();
    const [state, setState] = useState({ loading: true, data: null, error: '' });

    useEffect(() => {
        let active = true;

        setState({ loading: true, data: null, error: '' });
        apiRequest(path, { token })
            .then((data) => {
                if (active) {
                    setState({ loading: false, data, error: '' });
                }
            })
            .catch((error) => {
                if (active) {
                    setState({ loading: false, data: null, error: error.message });
                }
            });

        return () => {
            active = false;
        };
    }, [path, token]);

    return state;
}

function UsageCard({ usage }) {
    const toneClass = usage.exceeded ? ' exceeded' : (usage.near_limit ? ' warning' : '');
    const meterWidth = usage.limit === null || usage.limit === undefined
        ? '0%'
        : `${Math.min(usage.percentage || 0, 100)}%`;

    return (
        <div className={`usage-card${toneClass}`}>
            <div className="usage-card-head">
                <div>
                    <span>{usage.label} Seats</span>
                    <strong>{formatSeatValue(usage)}</strong>
                </div>
                <span className={`status-pill ${usage.exceeded ? 'danger' : (usage.near_limit ? 'neutral' : 'success')}`}>
                    {usage.exceeded ? 'Full' : (usage.near_limit ? 'Near Limit' : 'Available')}
                </span>
            </div>
            <div className="usage-meter" aria-hidden="true">
                <span style={{ width: meterWidth }} />
            </div>
            <p>
                {usage.limit === null || usage.limit === undefined
                    ? `${usage.current} ${usage.label.toLowerCase()} accounts are active on an unlimited plan.`
                    : `${usage.remaining} seats remaining before the ${usage.label.toLowerCase()} cap is reached.`}
            </p>
        </div>
    );
}

function InviteLinkCard({ label, description, url, copied, onCopy }) {
    return (
        <div className="invite-link-card">
            <div className="usage-card-head">
                <div>
                    <span>{label}</span>
                    <strong>{copied ? 'Copied' : 'Invite Link'}</strong>
                </div>
                <button type="button" className="secondary-btn" onClick={onCopy}>
                    {copied ? 'Copied' : 'Copy Link'}
                </button>
            </div>
            <p>{description}</p>
            <div className="invite-link-url">{url}</div>
        </div>
    );
}

export function PrincipalDashboardPage() {
    const { data, loading, error } = useProtectedLoader('/principal/dashboard');
    const [copyState, setCopyState] = useState({ key: '', tone: 'info', message: '' });

    if (loading) {
        return <LoadingBlock label="Loading principal analytics..." />;
    }

    if (error) {
        return <Notice tone="danger">{error}</Notice>;
    }

    const lineOptions = {
        responsive: true,
        plugins: { legend: { display: false } }
    };
    const inviteLinks = data.invite_links || data.organization.invite_links || {};

    const handleCopyInvite = async (key, url) => {
        try {
            await copyToClipboard(url);
            setCopyState({
                key,
                tone: 'success',
                message: `${key === 'student' ? 'Student' : 'Instructor'} invite link copied successfully.`
            });
        } catch (copyError) {
            setCopyState({
                key,
                tone: 'danger',
                message: 'Unable to copy the invite link. Please copy it manually.'
            });
        }
    };

    return (
        <>
            <PageHeader
                eyebrow="Principal Dashboard"
                title="Organization analytics at a glance"
                description="Track campus adoption, enrollments, seat usage, and invite-based onboarding from one secure tenant workspace."
            />

            <SectionCard
                title={data.organization.college_name}
                subtitle={`Academy ID ${data.organization.academy_id || '-'} | Access code ${data.organization.access_code} | Expires ${data.organization.expiry_date || 'Not active yet'}`}
                aside={data.current_plan ? <span className="status-pill neutral">{data.current_plan.plan_name}</span> : null}
            >
                <StatGrid
                    items={[
                        { label: 'Students', value: data.statistics.total_students, helper: 'Active learner accounts' },
                        { label: 'Instructors', value: data.statistics.total_instructors, helper: 'Teaching seats used' },
                        { label: 'Courses', value: data.statistics.total_courses, helper: 'Courses in this academy' },
                        { label: 'Videos', value: data.statistics.total_videos, helper: 'Uploaded learning assets' }
                    ]}
                />
            </SectionCard>

            <SectionCard
                title="Seat Usage And Access Control"
                subtitle="Monitor seat consumption, warning thresholds, and academy invite readiness."
            >
                <div className="usage-grid">
                    <UsageCard usage={data.usage.instructors} />
                    <UsageCard usage={data.usage.students} />
                </div>

                {data.warnings.length ? (
                    data.warnings.map((warning) => (
                        <Notice key={warning} tone="warning">{warning}</Notice>
                    ))
                ) : (
                    <Notice tone="success">Instructor and student capacity are both available for new registrations.</Notice>
                )}
            </SectionCard>

            <SectionCard
                title="Invite Links"
                subtitle="Share academy-safe onboarding links that already include the correct access code and registration role."
            >
                <div className="invite-link-grid">
                    <InviteLinkCard
                        label="Instructor Invite"
                        description="Use this link when onboarding a new instructor into the academy."
                        url={inviteLinks.instructor || '-'}
                        copied={copyState.key === 'instructor' && copyState.tone === 'success'}
                        onCopy={() => handleCopyInvite('instructor', inviteLinks.instructor)}
                    />
                    <InviteLinkCard
                        label="Student Invite"
                        description="Use this link when sharing registration access with students."
                        url={inviteLinks.student || '-'}
                        copied={copyState.key === 'student' && copyState.tone === 'success'}
                        onCopy={() => handleCopyInvite('student', inviteLinks.student)}
                    />
                </div>

                {copyState.message ? <Notice tone={copyState.tone}>{copyState.message}</Notice> : null}
            </SectionCard>

            <SectionCard
                title="Registration Attempts"
                subtitle="Track rejected signups so you can react before seat limits become a support issue."
            >
                <StatGrid
                    items={[
                        {
                            label: 'Rejected Total',
                            value: data.exceeded_attempts.total,
                            helper: 'All failed registration attempts'
                        },
                        {
                            label: 'Instructor Blocks',
                            value: data.exceeded_attempts.instructor,
                            helper: 'Rejected because instructor seats were full'
                        },
                        {
                            label: 'Student Blocks',
                            value: data.exceeded_attempts.student,
                            helper: 'Rejected because student seats were full'
                        },
                        {
                            label: 'Current Plan',
                            value: data.current_plan?.plan_name || 'Pending',
                            helper: data.current_plan
                                ? `${formatCurrency(data.current_plan.amount)} latest charge`
                                : 'No paid plan recorded yet'
                        }
                    ]}
                />

                <DataTable
                    columns={[
                        {
                            key: 'requested_role',
                            header: 'Role',
                            render: (row) => String(row.requested_role || '').replace(/^./, (value) => value.toUpperCase())
                        },
                        { key: 'email', header: 'Email' },
                        {
                            key: 'reason',
                            header: 'Reason',
                            render: (row) => String(row.reason || '').replaceAll('_', ' ')
                        },
                        { key: 'message', header: 'Message' },
                        {
                            key: 'created_at',
                            header: 'Attempted',
                            render: (row) => formatDateTime(row.created_at)
                        }
                    ]}
                    rows={data.exceeded_attempts.recent}
                    emptyMessage="No rejected registration attempts have been recorded."
                />
            </SectionCard>

            <div className="panel-grid">
                <SectionCard title="Student Growth" subtitle="Monthly student account creation">
                    <Line
                        options={lineOptions}
                        data={{
                            labels: data.charts.student_growth.labels,
                            datasets: [
                                {
                                    label: 'Students',
                                    data: data.charts.student_growth.values,
                                    borderColor: '#1f6c63',
                                    backgroundColor: 'rgba(31,108,99,0.18)',
                                    tension: 0.35,
                                    fill: true
                                }
                            ]
                        }}
                    />
                </SectionCard>

                <SectionCard title="Course Enrollments" subtitle="Monthly enrollment movement">
                    <Bar
                        options={{ responsive: true, plugins: { legend: { display: false } } }}
                        data={{
                            labels: data.charts.course_enrollments.labels,
                            datasets: [
                                {
                                    label: 'Enrollments',
                                    data: data.charts.course_enrollments.values,
                                    backgroundColor: '#e37b5f'
                                }
                            ]
                        }}
                    />
                </SectionCard>
            </div>

            <SectionCard title="Video Views" subtitle="Monthly learner viewing activity">
                <Line
                    options={lineOptions}
                    data={{
                        labels: data.charts.video_views.labels,
                        datasets: [
                            {
                                label: 'Video Views',
                                data: data.charts.video_views.values,
                                borderColor: '#c9a343',
                                backgroundColor: 'rgba(201,163,67,0.22)',
                                tension: 0.35,
                                fill: true
                            }
                        ]
                    }}
                />
            </SectionCard>

            <SectionCard title="Recent Payments" subtitle="Latest subscription transactions">
                <DataTable
                    columns={[
                        { key: 'plan_name', header: 'Plan' },
                        { key: 'amount', header: 'Amount', render: (row) => formatCurrency(row.amount) },
                        { key: 'status', header: 'Status' },
                        { key: 'created_at', header: 'Created', render: (row) => formatDateTime(row.created_at) }
                    ]}
                    rows={data.recent_payments}
                    emptyMessage="No payments recorded yet."
                />
            </SectionCard>
        </>
    );
}

export function PrincipalInstructorsPage() {
    const { token, organization } = useAuth();
    const [rows, setRows] = useState([]);
    const [form, setForm] = useState({ username: '', email: '', phone: '', expertise: '', password: '' });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const loadRows = async () => {
        setLoading(true);
        setError('');
        try {
            const payload = await apiRequest('/principal/instructors', { token });
            setRows(payload.instructors);
        } catch (loadError) {
            setError(loadError.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadRows();
    }, [token]);

    const handleCreate = async (event) => {
        event.preventDefault();
        setSubmitting(true);
        setError('');
        try {
            await apiRequest('/principal/create-instructor', { method: 'POST', token, body: form });
            setForm({ username: '', email: '', phone: '', expertise: '', password: '' });
            await loadRows();
        } catch (submitError) {
            setError(submitError.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <>
            <PageHeader
                eyebrow="Instructor Management"
                title="Control teaching accounts"
                description={`Limit available: ${organization?.instructor_limit ?? 'Unlimited'} instructors.`}
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}

            <div className="panel-grid">
                <SectionCard title="Create Instructor" subtitle="Principals can provision instructor accounts centrally.">
                    <form className="form-grid" onSubmit={handleCreate}>
                        <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="Instructor name" required />
                        <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Email" required />
                        <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Phone" />
                        <input value={form.expertise} onChange={(event) => setForm({ ...form, expertise: event.target.value })} placeholder="Expertise" />
                        <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Temporary password" required />
                        <button type="submit" className="primary-btn" disabled={submitting}>
                            {submitting ? 'Creating...' : 'Create Instructor'}
                        </button>
                    </form>
                </SectionCard>

                <SectionCard title="Current Instructors" subtitle="All records stay isolated to this organization.">
                    {loading ? (
                        <LoadingBlock label="Loading instructors..." />
                    ) : (
                        <DataTable
                            columns={[
                                { key: 'username', header: 'Name' },
                                { key: 'email', header: 'Email' },
                                { key: 'phone', header: 'Phone' },
                                { key: 'expertise', header: 'Expertise' }
                            ]}
                            rows={rows}
                            emptyMessage="No instructors created yet."
                        />
                    )}
                </SectionCard>
            </div>
        </>
    );
}

export function PrincipalStudentsPage() {
    const { token, organization } = useAuth();
    const [rows, setRows] = useState([]);
    const [form, setForm] = useState({ username: '', email: '', phone: '', branch: '', password: '' });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const loadRows = async () => {
        setLoading(true);
        setError('');
        try {
            const payload = await apiRequest('/principal/students', { token });
            setRows(payload.students);
        } catch (loadError) {
            setError(loadError.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadRows();
    }, [token]);

    const handleCreate = async (event) => {
        event.preventDefault();
        setSubmitting(true);
        setError('');
        try {
            await apiRequest('/principal/create-student', { method: 'POST', token, body: form });
            setForm({ username: '', email: '', phone: '', branch: '', password: '' });
            await loadRows();
        } catch (submitError) {
            setError(submitError.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <>
            <PageHeader
                eyebrow="Student Management"
                title="Scale learner onboarding"
                description={`Seat limit available: ${organization?.student_limit ?? 'Unlimited'} students.`}
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}

            <div className="panel-grid">
                <SectionCard title="Create Student" subtitle="Provision learners directly inside the tenant.">
                    <form className="form-grid" onSubmit={handleCreate}>
                        <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="Student name" required />
                        <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Email" required />
                        <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Phone" />
                        <input value={form.branch} onChange={(event) => setForm({ ...form, branch: event.target.value })} placeholder="Branch" />
                        <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Temporary password" required />
                        <button type="submit" className="primary-btn" disabled={submitting}>
                            {submitting ? 'Creating...' : 'Create Student'}
                        </button>
                    </form>
                </SectionCard>

                <SectionCard title="Current Students" subtitle="Organization-scoped student records">
                    {loading ? (
                        <LoadingBlock label="Loading students..." />
                    ) : (
                        <DataTable
                            columns={[
                                { key: 'username', header: 'Name' },
                                { key: 'email', header: 'Email' },
                                { key: 'phone', header: 'Phone' },
                                { key: 'branch', header: 'Branch' }
                            ]}
                            rows={rows}
                            emptyMessage="No students created yet."
                        />
                    )}
                </SectionCard>
            </div>
        </>
    );
}

export function PrincipalSubscriptionPage() {
    const { token, refreshSession } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [state, setState] = useState({ loading: true, data: null, error: '', message: '' });
    const [payingPlanId, setPayingPlanId] = useState('');

    const loadData = async () => {
        setState((current) => ({ ...current, loading: true, error: '' }));
        try {
            const payload = await apiRequest('/principal/subscription', { token });
            setState((current) => ({ ...current, loading: false, data: payload, error: '' }));
        } catch (loadError) {
            setState((current) => ({ ...current, loading: false, error: loadError.message }));
        }
    };

    useEffect(() => {
        loadData();
    }, [token]);

    useEffect(() => {
        const sessionId = searchParams.get('session_id');
        if (!sessionId) {
            return;
        }

        let active = true;

        apiRequest('/principal/subscription/confirm', {
            method: 'POST',
            token,
            body: { sessionId }
        })
            .then(async () => {
                if (!active) {
                    return;
                }

                await refreshSession();
                await loadData();
                navigate('/principal/subscription', { replace: true });
            })
            .catch((error) => {
                if (active) {
                    setState((current) => ({ ...current, error: error.message }));
                }
            });

        return () => {
            active = false;
        };
    }, [navigate, refreshSession, searchParams, token]);

    const handleSelectPlan = async (planId) => {
        setPayingPlanId(planId);
        setState((current) => ({ ...current, error: '', message: '' }));

        try {
            const payload = await apiRequest('/principal/subscription', {
                method: 'POST',
                token,
                body: { planId }
            });

            if (payload.checkout_url) {
                window.location.href = payload.checkout_url;
                return;
            }

            await refreshSession();
            await loadData();
            setState((current) => ({ ...current, message: payload.message || 'Subscription activated.' }));
        } catch (paymentError) {
            setState((current) => ({ ...current, error: paymentError.message }));
        } finally {
            setPayingPlanId('');
        }
    };

    if (state.loading) {
        return <LoadingBlock label="Loading subscription workspace..." />;
    }

    return (
        <>
            <PageHeader
                eyebrow="Subscription"
                title="Choose and manage a plan"
                description="Principals can renew an expired tenant or upgrade to a higher capacity plan."
            />

            {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
            {state.message ? <Notice tone="success">{state.message}</Notice> : null}
            {searchParams.get('canceled') ? <Notice tone="warning">Payment was canceled before completion.</Notice> : null}

            <SectionCard
                title={state.data.organization.college_name}
                subtitle={`Status: ${state.data.organization.subscription_status} | Expiry: ${state.data.organization.expiry_date || 'Not active yet'}`}
            >
                <StatGrid
                    items={[
                        { label: 'Student Limit', value: state.data.organization.student_limit ?? 'Unlimited', helper: 'Current organization capacity' },
                        { label: 'Instructor Limit', value: state.data.organization.instructor_limit ?? 'Unlimited', helper: 'Current teaching capacity' }
                    ]}
                />
            </SectionCard>

            <div className="plan-grid">
                {state.data.plans.map((plan) => (
                    <SectionCard
                        key={plan.id}
                        className="plan-card"
                        title={plan.name}
                        subtitle={`${formatCurrency(plan.amount, plan.currency)} | ${plan.duration_label}`}
                        aside={<span className="status-pill neutral">{plan.id}</span>}
                    >
                        <div className="plan-meta">
                            <p>Students: {plan.student_limit_label}</p>
                            <p>Instructors: {plan.instructor_limit_label}</p>
                        </div>
                        <button
                            type="button"
                            className="primary-btn"
                            onClick={() => handleSelectPlan(plan.id)}
                            disabled={payingPlanId === plan.id}
                        >
                            {payingPlanId === plan.id ? 'Redirecting...' : `Choose ${plan.name}`}
                        </button>
                    </SectionCard>
                ))}
            </div>

            <SectionCard title="Payment History" subtitle="Every renewal or upgrade is stored in the subscriptions table.">
                <DataTable
                    columns={[
                        { key: 'plan_name', header: 'Plan' },
                        { key: 'amount', header: 'Amount', render: (row) => formatCurrency(row.amount, row.currency) },
                        { key: 'status', header: 'Status' },
                        { key: 'payment_id', header: 'Payment ID' },
                        { key: 'created_at', header: 'Created', render: (row) => formatDateTime(row.created_at) }
                    ]}
                    rows={state.data.payments}
                    emptyMessage="No subscription payments recorded yet."
                />
            </SectionCard>
        </>
    );
}

export function PrincipalPaymentsPage() {
    const { data, loading, error } = useProtectedLoader('/principal/payments');

    if (loading) {
        return <LoadingBlock label="Loading payment ledger..." />;
    }

    if (error) {
        return <Notice tone="danger">{error}</Notice>;
    }

    return (
        <>
            <PageHeader
                eyebrow="Payments"
                title="Subscription payment history"
                description="Review provider details, plan changes, and transaction timestamps."
            />
            <SectionCard title="Transactions" subtitle="Stored in the subscriptions table by organization.">
                <DataTable
                    columns={[
                        { key: 'plan_name', header: 'Plan' },
                        { key: 'amount', header: 'Amount', render: (row) => formatCurrency(row.amount, row.currency) },
                        { key: 'provider', header: 'Provider' },
                        { key: 'status', header: 'Status' },
                        { key: 'payment_id', header: 'Payment ID' },
                        { key: 'created_at', header: 'Created', render: (row) => formatDateTime(row.created_at) }
                    ]}
                    rows={data.payments}
                    emptyMessage="No payments have been recorded."
                />
            </SectionCard>
        </>
    );
}

export function PrincipalSettingsPage() {
    const { token, refreshSession } = useAuth();
    const [form, setForm] = useState({ collegeName: '', accessCode: '', username: '', phone: '' });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    useEffect(() => {
        let active = true;
        apiRequest('/principal/settings', { token })
            .then((payload) => {
                if (!active) {
                    return;
                }

                setForm({
                    collegeName: payload.organization.college_name,
                    accessCode: payload.organization.access_code,
                    username: payload.principal.username,
                    phone: payload.principal.phone || ''
                });
                setLoading(false);
            })
            .catch((loadError) => {
                if (active) {
                    setError(loadError.message);
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [token]);

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError('');
        setMessage('');
        try {
            await apiRequest('/principal/settings', { method: 'PUT', token, body: form });
            await refreshSession();
            setMessage('Settings updated successfully.');
        } catch (submitError) {
            setError(submitError.message);
        }
    };

    if (loading) {
        return <LoadingBlock label="Loading organization settings..." />;
    }

    return (
        <>
            <PageHeader
                eyebrow="Settings"
                title="Update organization identity"
                description="Access code changes affect how all members log in, so share updates carefully."
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {message ? <Notice tone="success">{message}</Notice> : null}

            <SectionCard title="Workspace Settings" subtitle="Edit principal and organization details.">
                <form className="form-grid" onSubmit={handleSubmit}>
                    <input value={form.collegeName} onChange={(event) => setForm({ ...form, collegeName: event.target.value })} placeholder="College name" required />
                    <input value={form.accessCode} onChange={(event) => setForm({ ...form, accessCode: event.target.value.toUpperCase() })} placeholder="Access code" required />
                    <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="Principal name" required />
                    <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Phone" />
                    <button type="submit" className="primary-btn">Save Settings</button>
                </form>
            </SectionCard>
        </>
    );
}
