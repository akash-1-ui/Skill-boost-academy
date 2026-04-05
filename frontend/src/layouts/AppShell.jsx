import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function RoleShell({ links, title }) {
    const { user, organization, logout } = useAuth();

    return (
        <div className="app-shell">
            <aside className="sidebar">
                <div className="brand-block">
                    <span className="eyebrow">Multi-Tenant Campus OS</span>
                    <h1>{title}</h1>
                    <p>{organization?.college_name || 'Organization'}</p>
                    <div className="chip-stack">
                        <div className="access-code-chip">Academy ID: {organization?.academy_id || '-'}</div>
                        <div className="access-code-chip">Access Code: {organization?.access_code || '-'}</div>
                    </div>
                </div>

                <nav className="nav-list">
                    {links.map((link) => (
                        <NavLink
                            key={link.to}
                            to={link.to}
                            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                        >
                            <span>{link.label}</span>
                            <small>{link.helper}</small>
                        </NavLink>
                    ))}
                </nav>

                <div className="sidebar-foot">
                    <div className="user-summary">
                        <span>{user?.username}</span>
                        <small>{user?.role}</small>
                    </div>
                    <button type="button" className="ghost-btn" onClick={logout}>
                        Sign Out
                    </button>
                </div>
            </aside>

            <div className="content-shell">
                <header className="topbar">
                    <div>
                        <span className="eyebrow">Role Workspace</span>
                        <h2>{title}</h2>
                    </div>
                    <div className="topbar-meta">
                        <span className={`status-pill ${organization?.subscription_expired ? 'danger' : 'success'}`}>
                            {organization?.subscription_expired ? 'Subscription Expired' : 'Subscription Active'}
                        </span>
                    </div>
                </header>

                <main className="page-content">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}

export function PageHeader({ eyebrow, title, description, action }) {
    return (
        <div className="page-header">
            <div>
                {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
                <h3>{title}</h3>
                {description ? <p>{description}</p> : null}
            </div>
            {action ? <div>{action}</div> : null}
        </div>
    );
}

export function SectionCard({ title, subtitle, children, className = '', aside }) {
    return (
        <section className={`surface ${className}`.trim()}>
            {(title || subtitle || aside) ? (
                <div className="section-head">
                    <div>
                        {title ? <h4>{title}</h4> : null}
                        {subtitle ? <p>{subtitle}</p> : null}
                    </div>
                    {aside ? <div>{aside}</div> : null}
                </div>
            ) : null}
            {children}
        </section>
    );
}

export function StatGrid({ items }) {
    return (
        <div className="stat-grid">
            {items.map((item) => (
                <div key={item.label} className="stat-card">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <small>{item.helper}</small>
                </div>
            ))}
        </div>
    );
}

export function Notice({ children, tone = 'info' }) {
    return <div className={`notice ${tone}`}>{children}</div>;
}

export function LoadingBlock({ label = 'Loading workspace...' }) {
    return (
        <div className="surface loading-block">
            <div className="loader-dot" />
            <p>{label}</p>
        </div>
    );
}

export function EmptyState({ title, message }) {
    return (
        <div className="empty-state">
            <h5>{title}</h5>
            <p>{message}</p>
        </div>
    );
}

export function DataTable({ columns, rows, emptyMessage = 'No records yet.' }) {
    if (!rows.length) {
        return <EmptyState title="Nothing to show" message={emptyMessage} />;
    }

    return (
        <div className="table-wrap">
            <table>
                <thead>
                    <tr>
                        {columns.map((column) => (
                            <th key={column.key}>{column.header}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, index) => (
                        <tr key={row.id || `${index}-${columns[0].key}`}>
                            {columns.map((column) => (
                                <td key={column.key}>
                                    {column.render ? column.render(row) : row[column.key]}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
