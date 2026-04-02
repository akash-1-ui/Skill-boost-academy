import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { DataTable, LoadingBlock, Notice, PageHeader, SectionCard, StatGrid } from '../layouts/AppShell';

function useInstructorData(path) {
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

export function InstructorDashboardPage() {
    const { loading, data, error } = useInstructorData('/instructor/dashboard');

    if (loading) {
        return <LoadingBlock label="Loading instructor dashboard..." />;
    }

    if (error) {
        return <Notice tone="danger">{error}</Notice>;
    }

    return (
        <>
            <PageHeader
                eyebrow="Instructor Dashboard"
                title="Track teaching activity"
                description="See how many courses you own, how many students are learning, and how engaged your content is."
            />

            <SectionCard title="Teaching Metrics" subtitle="Organization-filtered instructor performance">
                <StatGrid
                    items={[
                        { label: 'Courses', value: data.metrics.total_courses, helper: 'Courses created by you' },
                        { label: 'Students Enrolled', value: data.metrics.total_students_enrolled, helper: 'Distinct learners across your catalog' },
                        { label: 'Video Views', value: data.metrics.total_video_views, helper: 'Tracked course view records' },
                        { label: 'Messages', value: data.metrics.total_messages, helper: 'Broadcast messages sent' }
                    ]}
                />
            </SectionCard>

            <SectionCard title="Recent Courses" subtitle="Your latest course activity">
                <DataTable
                    columns={[
                        { key: 'title', header: 'Course' },
                        { key: 'category', header: 'Category' },
                        { key: 'total_videos', header: 'Videos' },
                        { key: 'total_enrollments', header: 'Enrollments' },
                        { key: 'created_at', header: 'Created' }
                    ]}
                    rows={data.recent_courses}
                    emptyMessage="You have not created any courses yet."
                />
            </SectionCard>
        </>
    );
}

export function InstructorCoursesPage() {
    const { loading, data, error } = useInstructorData('/instructor/courses');

    if (loading) {
        return <LoadingBlock label="Loading instructor courses..." />;
    }

    if (error) {
        return <Notice tone="danger">{error}</Notice>;
    }

    return (
        <>
            <PageHeader
                eyebrow="Courses"
                title="Manage your course catalog"
                description="Every course listed here is scoped to your instructor account and organization."
            />

            <SectionCard title="Course Library" subtitle="Current instructor-owned courses">
                <DataTable
                    columns={[
                        { key: 'title', header: 'Title' },
                        { key: 'category', header: 'Category' },
                        { key: 'duration_label', header: 'Duration' },
                        { key: 'total_videos', header: 'Videos' },
                        { key: 'total_enrollments', header: 'Enrollments' }
                    ]}
                    rows={data.courses}
                    emptyMessage="No courses available yet."
                />
            </SectionCard>
        </>
    );
}

export function InstructorCreateCoursePage() {
    const { token } = useAuth();
    const [form, setForm] = useState({ title: '', category: '', description: '', coverPath: '', durationDays: 90 });
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = async (event) => {
        event.preventDefault();
        setMessage('');
        setError('');

        try {
            await apiRequest('/instructor/courses', { method: 'POST', token, body: form });
            setMessage('Course created successfully.');
            setForm({ title: '', category: '', description: '', coverPath: '', durationDays: 90 });
        } catch (submitError) {
            setError(submitError.message);
        }
    };

    return (
        <>
            <PageHeader
                eyebrow="Create Course"
                title="Design a new learning experience"
                description="Instructors can create courses without leaking across organizations."
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {message ? <Notice tone="success">{message}</Notice> : null}

            <SectionCard title="Course Builder" subtitle="Add the core course metadata first, then upload videos.">
                <form className="form-grid" onSubmit={handleSubmit}>
                    <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Course title" required />
                    <input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Category" required />
                    <select value={form.durationDays} onChange={(event) => setForm({ ...form, durationDays: Number(event.target.value) })}>
                        <option value={30}>30 days</option>
                        <option value={60}>60 days</option>
                        <option value={90}>90 days</option>
                        <option value={180}>180 days</option>
                    </select>
                    <input value={form.coverPath} onChange={(event) => setForm({ ...form, coverPath: event.target.value })} placeholder="Cover image URL (optional)" />
                    <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Course description" rows={5} />
                    <button type="submit" className="primary-btn">Create Course</button>
                </form>
            </SectionCard>
        </>
    );
}

export function InstructorUploadVideoPage() {
    const { token } = useAuth();
    const [courses, setCourses] = useState([]);
    const [form, setForm] = useState({ courseId: '', title: '', videoUrl: '' });
    const [file, setFile] = useState(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    useEffect(() => {
        apiRequest('/instructor/courses', { token })
            .then((payload) => setCourses(payload.courses))
            .catch((loadError) => setError(loadError.message));
    }, [token]);

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError('');
        setMessage('');

        const formData = new FormData();
        formData.append('courseId', form.courseId);
        formData.append('title', form.title);
        if (form.videoUrl) {
            formData.append('videoUrl', form.videoUrl);
        }
        if (file) {
            formData.append('video', file);
        }

        try {
            await apiRequest('/instructor/upload-video', {
                method: 'POST',
                token,
                body: formData,
                isForm: true
            });
            setMessage('Video uploaded successfully.');
            setForm({ courseId: '', title: '', videoUrl: '' });
            setFile(null);
        } catch (submitError) {
            setError(submitError.message);
        }
    };

    return (
        <>
            <PageHeader
                eyebrow="Upload Video"
                title="Add course content"
                description="Upload a file or reference an external video URL for a course you own."
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {message ? <Notice tone="success">{message}</Notice> : null}

            <SectionCard title="Video Upload" subtitle="Videos can use Cloudinary when configured or local storage as fallback.">
                <form className="form-grid" onSubmit={handleSubmit}>
                    <select value={form.courseId} onChange={(event) => setForm({ ...form, courseId: event.target.value })} required>
                        <option value="">Select course</option>
                        {courses.map((course) => (
                            <option key={course.id} value={course.id}>
                                {course.title}
                            </option>
                        ))}
                    </select>
                    <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Video title" required />
                    <input value={form.videoUrl} onChange={(event) => setForm({ ...form, videoUrl: event.target.value })} placeholder="External video URL (optional)" />
                    <input type="file" accept="video/*" onChange={(event) => setFile(event.target.files?.[0] || null)} />
                    <button type="submit" className="primary-btn">Upload Video</button>
                </form>
            </SectionCard>
        </>
    );
}

export function InstructorStudentsPage() {
    const { loading, data, error } = useInstructorData('/instructor/students');

    if (loading) {
        return <LoadingBlock label="Loading student progress..." />;
    }

    if (error) {
        return <Notice tone="danger">{error}</Notice>;
    }

    return (
        <>
            <PageHeader
                eyebrow="Student Progress"
                title="Watch learner completion rates"
                description="See how students are advancing through your enrolled courses."
            />

            <SectionCard title="Progress Overview" subtitle="Tenant-filtered enrollment and watch progress">
                <DataTable
                    columns={[
                        { key: 'student_name', header: 'Student' },
                        { key: 'course_title', header: 'Course' },
                        { key: 'watched_videos', header: 'Watched' },
                        { key: 'total_videos', header: 'Total Videos' },
                        { key: 'progress_percentage', header: 'Progress %' },
                        { key: 'total_time_spent', header: 'Time Spent (s)' }
                    ]}
                    rows={data.students}
                    emptyMessage="No student progress records yet."
                />
            </SectionCard>
        </>
    );
}

export function InstructorMessagesPage() {
    const { token } = useAuth();
    const [courses, setCourses] = useState([]);
    const [feed, setFeed] = useState({ broadcasts: [], chats: [] });
    const [broadcastForm, setBroadcastForm] = useState({ title: '', content: '', priority: 'normal', courseId: '' });
    const [chatForm, setChatForm] = useState({ message: '', audience: 'instructors' });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const loadPage = async () => {
        setLoading(true);
        setError('');
        try {
            const [messagesPayload, coursePayload] = await Promise.all([
                apiRequest('/instructor/messages', { token }),
                apiRequest('/instructor/courses', { token })
            ]);
            setFeed(messagesPayload);
            setCourses(coursePayload.courses);
        } catch (loadError) {
            setError(loadError.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadPage();
    }, [token]);

    const sendBroadcast = async (event) => {
        event.preventDefault();
        setError('');
        try {
            await apiRequest('/instructor/messages', { method: 'POST', token, body: broadcastForm });
            setBroadcastForm({ title: '', content: '', priority: 'normal', courseId: '' });
            await loadPage();
        } catch (submitError) {
            setError(submitError.message);
        }
    };

    const sendChat = async (event) => {
        event.preventDefault();
        setError('');
        try {
            await apiRequest('/instructor/messages/chat', { method: 'POST', token, body: chatForm });
            setChatForm({ message: '', audience: 'instructors' });
            await loadPage();
        } catch (submitError) {
            setError(submitError.message);
        }
    };

    if (loading) {
        return <LoadingBlock label="Loading messages workspace..." />;
    }

    return (
        <>
            <PageHeader
                eyebrow="Messages"
                title="Communicate with students and peers"
                description="Broadcast course-wide updates or use the instructor chat channel."
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}

            <div className="panel-grid">
                <SectionCard title="Broadcast to Students" subtitle="Send an instructor notification to enrolled learners.">
                    <form className="form-grid" onSubmit={sendBroadcast}>
                        <input value={broadcastForm.title} onChange={(event) => setBroadcastForm({ ...broadcastForm, title: event.target.value })} placeholder="Title" required />
                        <select value={broadcastForm.priority} onChange={(event) => setBroadcastForm({ ...broadcastForm, priority: event.target.value })}>
                            <option value="low">Low</option>
                            <option value="normal">Normal</option>
                            <option value="high">High</option>
                        </select>
                        <select value={broadcastForm.courseId} onChange={(event) => setBroadcastForm({ ...broadcastForm, courseId: event.target.value })}>
                            <option value="">All my enrolled courses</option>
                            {courses.map((course) => (
                                <option key={course.id} value={course.id}>
                                    {course.title}
                                </option>
                            ))}
                        </select>
                        <textarea value={broadcastForm.content} onChange={(event) => setBroadcastForm({ ...broadcastForm, content: event.target.value })} placeholder="Message content" rows={4} required />
                        <button type="submit" className="primary-btn">Send Broadcast</button>
                    </form>
                </SectionCard>

                <SectionCard title="Instructor Chat" subtitle="Collaborate with instructors or talk to students.">
                    <form className="form-grid" onSubmit={sendChat}>
                        <select value={chatForm.audience} onChange={(event) => setChatForm({ ...chatForm, audience: event.target.value })}>
                            <option value="instructors">Instructors</option>
                            <option value="students">Students</option>
                        </select>
                        <textarea value={chatForm.message} onChange={(event) => setChatForm({ ...chatForm, message: event.target.value })} placeholder="Write a chat message" rows={4} required />
                        <button type="submit" className="primary-btn">Send Chat</button>
                    </form>
                </SectionCard>
            </div>

            <div className="panel-grid">
                <SectionCard title="Broadcast History" subtitle="Messages stored in the messages table.">
                    <DataTable
                        columns={[
                            { key: 'title', header: 'Title' },
                            { key: 'priority', header: 'Priority' },
                            { key: 'sent_count', header: 'Recipients' },
                            { key: 'created_at', header: 'Created' }
                        ]}
                        rows={feed.broadcasts}
                        emptyMessage="No broadcasts sent yet."
                    />
                </SectionCard>

                <SectionCard title="Chat Feed" subtitle="Organization-safe instructor chat stream.">
                    <div className="message-feed">
                        {feed.chats.map((chat) => (
                            <div key={chat.id} className="message-bubble">
                                <strong>{chat.sender_name}</strong>
                                <p>{chat.message}</p>
                                <small>{chat.group_type} • {chat.timestamp}</small>
                            </div>
                        ))}
                    </div>
                </SectionCard>
            </div>
        </>
    );
}
