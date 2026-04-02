import { createContext, startTransition, useContext, useEffect, useState } from 'react';
import { apiRequest } from '../api/client';

const AUTH_STORAGE_KEY = 'skillboostacademy-saas-auth';
const AuthContext = createContext(null);

function readStoredSession() {
    try {
        const rawValue = localStorage.getItem(AUTH_STORAGE_KEY);
        return rawValue ? JSON.parse(rawValue) : { token: '', user: null, organization: null };
    } catch (error) {
        return { token: '', user: null, organization: null };
    }
}

function persistSession(session) {
    if (!session?.token) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        return;
    }

    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function getHomePathForRole(role) {
    if (role === 'principal') {
        return '/principal/dashboard';
    }
    if (role === 'instructor') {
        return '/instructor/dashboard';
    }
    return '/student/dashboard';
}

export function AuthProvider({ children }) {
    const [session, setSession] = useState(readStoredSession);
    const [booting, setBooting] = useState(Boolean(readStoredSession().token));

    useEffect(() => {
        if (!session.token) {
            setBooting(false);
            return undefined;
        }

        let active = true;

        apiRequest('/auth/me', { token: session.token })
            .then((payload) => {
                if (!active) {
                    return;
                }

                startTransition(() => {
                    const nextSession = {
                        token: session.token,
                        user: payload.user,
                        organization: payload.organization
                    };
                    persistSession(nextSession);
                    setSession(nextSession);
                });
            })
            .catch(() => {
                if (!active) {
                    return;
                }

                startTransition(() => {
                    persistSession(null);
                    setSession({ token: '', user: null, organization: null });
                });
            })
            .finally(() => {
                if (active) {
                    setBooting(false);
                }
            });

        return () => {
            active = false;
        };
    }, [session.token]);

    const saveSession = (nextSession) => {
        persistSession(nextSession);
        setSession(nextSession);
    };

    const login = async (credentials) => {
        const payload = await apiRequest('/auth/login', {
            method: 'POST',
            body: credentials
        });

        const nextSession = {
            token: payload.token,
            user: payload.user,
            organization: payload.organization
        };

        startTransition(() => {
            saveSession(nextSession);
        });

        return nextSession;
    };

    const register = async (details) => {
        const payload = await apiRequest('/auth/register', {
            method: 'POST',
            body: details
        });

        const nextSession = {
            token: payload.token,
            user: payload.user,
            organization: payload.organization
        };

        startTransition(() => {
            saveSession(nextSession);
        });

        return nextSession;
    };

    const refreshSession = async () => {
        if (!session.token) {
            return null;
        }

        const payload = await apiRequest('/auth/me', { token: session.token });
        const nextSession = {
            token: session.token,
            user: payload.user,
            organization: payload.organization
        };

        startTransition(() => {
            saveSession(nextSession);
        });

        return nextSession;
    };

    const logout = () => {
        startTransition(() => {
            persistSession(null);
            setSession({ token: '', user: null, organization: null });
        });
    };

    return (
        <AuthContext.Provider
            value={{
                token: session.token,
                user: session.user,
                organization: session.organization,
                booting,
                login,
                register,
                refreshSession,
                logout
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used inside AuthProvider');
    }

    return context;
}
