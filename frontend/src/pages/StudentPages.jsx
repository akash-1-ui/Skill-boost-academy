import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { DataTable, LoadingBlock, Notice, PageHeader, SectionCard, StatGrid } from '../layouts/AppShell';

function useStudentData(path) {
    const { token } = useAuth();
    const [state, setState] = useState({ loading: true, data: null, error: '' });

    useEffect(() => {
        let active = true;
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

export function StudentDashboardPage() {
    const { loading, data, error } = useStudentData('/student/dashboard');

    if (loading) {
        return <LoadingBlock label="Loading student dashboard..." />;
    }

    if (error) {
        return <Notice tone="danger">{error}</Notice>;
    }

    return (
        <>
            <PageHeader
                eyebrow="Student Dashboard"
                title="See your course momentum"
                description="Review enrolled courses, progress, message volume, and unread notifications."
            />

            <SectionCard title="Progress Snapshot" subtitle="Only your organization and enrollments are visible here.">
                <StatGrid
                    items={[
                        { label: 'Enrolled Courses', value: data.metrics.enrolled_courses, helper: 'Courses you have joined' },
                        { label: 'Average Progress', value: `${data.metrics.average_progress}%`, helper: 'Average completion across enrolled courses' },
                        { label: 'Messages', value: data.metrics.new_messages, helper: 'Student-visible group messages' },
                        { label: 'Unread Notifications', value: data.metrics.unread_notifications, helper: 'Pending reminders and updates' }
                    ]}
                />
            </SectionCard>

            <SectionCard title="Current Learning" subtitle="Your enrolled course progress">
                <DataTable
                    columns={[
                        { key: 'title', header: 'Course' },
                        { key: 'instructor_name', header: 'Instructor' },
                        { key: 'progress_percentage', header: 'Progress %' },
                        { key: 'watched_videos', header: 'Watched Videos' },
                        { key: 'total_videos', header: 'Total Videos' }
                    ]}
                    rows={data.enrolled_courses}
                    emptyMessage="You have not enrolled in any courses yet."
                />
            </SectionCard>
        </>
    );
}

export function StudentCoursesPage() {
    const { token } = useAuth();
    const [loading, setLoading] = useState(true);
    const [rows, setRows] = useState([]);
    const [error, setError] = useState('');

    const loadCourses = async () => {
        setLoading(true);
        setError('');
        try {
            const payload = await apiRequest('/student/courses', { token });
            setRows(payload.courses);
        } catch (loadError) {
            setError(loadError.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadCourses();
    }, [token]);

    const handleEnroll = async (courseId) => {
        setError('');
        try {
            await apiRequest('/student/enroll', { method: 'POST', token, body: { courseId } });
            await loadCourses();
        } catch (enrollError) {
            setError(enrollError.message);
        }
    };

    return (
        <>
            <PageHeader
                eyebrow="My Courses"
                title="Browse your organization catalog"
                description="Enroll in courses created inside your tenant and pick up where you left off."
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}

            {loading ? (
                <LoadingBlock label="Loading course catalog..." />
            ) : (
                <SectionCard title="Course Catalog" subtitle="Enrollment and progress are tied to your student account.">
                    <div className="course-grid">
                        {rows.map((course) => (
                            <article key={course.id} className="course-card">
                                <img src={course.cover_path} alt={course.title} />
                                <div>
                                    <span className="eyebrow">{course.category}</span>
                                    <h4>{course.title}</h4>
                                    <p>{course.description || 'No description provided yet.'}</p>
                                    <small>{course.instructor_name} • {course.duration_label}</small>
                                </div>
                                <div className="course-card-foot">
                                    <span className="status-pill neutral">{course.progress_percentage}% progress</span>
                                    <button
                                        type="button"
                                        className={course.is_enrolled ? 'secondary-btn' : 'primary-btn'}
                                        onClick={() => handleEnroll(course.id)}
                                    >
                                        {course.is_enrolled ? 'Enrolled' : 'Enroll'}
                                    </button>
                                </div>
                            </article>
                        ))}
                    </div>
                </SectionCard>
            )}
        </>
    );
}

export function StudentWatchVideoPage() {
    const { token } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const [courses, setCourses] = useState([]);
    const [state, setState] = useState({ loading: true, data: null, error: '' });
    const selectedCourseId = searchParams.get('courseId');

    useEffect(() => {
        apiRequest('/student/courses', { token })
            .then((payload) => setCourses(payload.courses.filter((course) => course.is_enrolled)))
            .catch((error) => setState((current) => ({ ...current, error: error.message, loading: false })));
    }, [token]);

    useEffect(() => {
        if (!selectedCourseId) {
            setState({ loading: false, data: null, error: '' });
            return;
        }

        let active = true;
        setState({ loading: true, data: null, error: '' });

        apiRequest(`/student/watch-video?courseId=${selectedCourseId}`, { token })
            .then((payload) => {
                if (active) {
                    setState({ loading: false, data: payload, error: '' });
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
    }, [selectedCourseId, token]);

    const markWatched = async (videoId) => {
        await apiRequest('/student/progress', {
            method: 'POST',
            token,
            body: { videoId, watched: true, timeSpent: 60 }
        });

        if (selectedCourseId) {
            const payload = await apiRequest(`/student/watch-video?courseId=${selectedCourseId}`, { token });
            setState({ loading: false, data: payload, error: '' });
        }
    };

    return (
        <>
            <PageHeader
                eyebrow="Watch Videos"
                title="Stream course lessons"
                description="Select an enrolled course and track completion video by video."
            />

            <SectionCard title="Choose Course" subtitle="Only enrolled courses appear here.">
                <select
                    value={selectedCourseId || ''}
                    onChange={(event) => setSearchParams(event.target.value ? { courseId: event.target.value } : {})}
                >
                    <option value="">Select an enrolled course</option>
                    {courses.map((course) => (
                        <option key={course.id} value={course.id}>
                            {course.title}
                        </option>
                    ))}
                </select>
            </SectionCard>

            {state.error ? <Notice tone="danger">{state.error}</Notice> : null}

            {state.loading ? (
                <LoadingBlock label="Loading course videos..." />
            ) : state.data ? (
                <SectionCard title={state.data.course.title} subtitle={state.data.course.instructor_name}>
                    <div className="video-list">
                        {state.data.videos.map((video) => (
                            <article key={video.id} className="video-card">
                                <div className="video-frame">
                                    <video controls src={video.video_path} />
                                </div>
                                <div className="video-copy">
                                    <h4>{video.title}</h4>
                                    <small>{video.created_at}</small>
                                    <span className={`status-pill ${video.is_watched ? 'success' : 'neutral'}`}>
                                        {video.is_watched ? 'Watched' : 'Pending'}
                                    </span>
                                    {!video.is_watched ? (
                                        <button type="button" className="secondary-btn" onClick={() => markWatched(video.id)}>
                                            Mark as Watched
                                        </button>
                                    ) : null}
                                </div>
                            </article>
                        ))}
                    </div>
                </SectionCard>
            ) : null}
        </>
    );
}

export function StudentMessagesPage() {
    const { token } = useAuth();
    const [rows, setRows] = useState([]);
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const loadMessages = async () => {
        setLoading(true);
        setError('');
        try {
            const payload = await apiRequest('/student/messages', { token });
            setRows(payload.messages);
        } catch (loadError) {
            setError(loadError.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadMessages();
    }, [token]);

    const handleSend = async (event) => {
        event.preventDefault();
        setError('');
        try {
            await apiRequest('/student/messages', { method: 'POST', token, body: { message } });
            setMessage('');
            await loadMessages();
        } catch (sendError) {
            setError(sendError.message);
        }
    };

    return (
        <>
            <PageHeader
                eyebrow="Messages"
                title="Talk to your instructors"
                description="Ask questions in an organization-safe messaging stream."
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}

            <div className="panel-grid">
                <SectionCard title="Send Message" subtitle="Messages reach instructors connected to your enrolled courses.">
                    <form className="form-grid" onSubmit={handleSend}>
                        <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Write your question or update" rows={5} required />
                        <button type="submit" className="primary-btn">Send Message</button>
                    </form>
                </SectionCard>

                <SectionCard title="Conversation Feed" subtitle="Recent student-visible messages">
                    {loading ? (
                        <LoadingBlock label="Loading messages..." />
                    ) : (
                        <div className="message-feed">
                            {rows.map((row) => (
                                <div key={row.id} className="message-bubble">
                                    <strong>{row.sender_name}</strong>
                                    <p>{row.message}</p>
                                    <small>{row.group_type} • {row.timestamp}</small>
                                </div>
                            ))}
                        </div>
                    )}
                </SectionCard>
            </div>
        </>
    );
}

export function StudentNotificationsPage() {
    const { token } = useAuth();
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const loadNotifications = async () => {
        setLoading(true);
        setError('');
        try {
            const payload = await apiRequest('/student/notifications', { token });
            setRows(payload.notifications);
        } catch (loadError) {
            setError(loadError.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadNotifications();
    }, [token]);

    const markRead = async (notificationId) => {
        try {
            await apiRequest(`/student/notifications/${notificationId}/read`, {
                method: 'POST',
                token
            });
            await loadNotifications();
        } catch (markError) {
            setError(markError.message);
        }
    };

    return (
        <>
            <PageHeader
                eyebrow="Notifications"
                title="Review alerts and reminders"
                description="Mark updates as read once you have seen them."
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}

            <SectionCard title="Notification Center" subtitle="All notifications are isolated to your organization and account.">
                {loading ? (
                    <LoadingBlock label="Loading notifications..." />
                ) : (
                    <DataTable
                        columns={[
                            { key: 'message', header: 'Message' },
                            { key: 'type', header: 'Type' },
                            { key: 'created_at', header: 'Created' },
                            {
                                key: 'is_read',
                                header: 'Action',
                                render: (row) => (
                                    row.is_read
                                        ? <span className="status-pill success">Read</span>
                                        : <button type="button" className="secondary-btn" onClick={() => markRead(row.id)}>Mark Read</button>
                                )
                            }
                        ]}
                        rows={rows}
                        emptyMessage="No notifications yet."
                    />
                )}
            </SectionCard>
        </>
    );
}
