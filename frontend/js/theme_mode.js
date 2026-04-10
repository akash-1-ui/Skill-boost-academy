(function themeModeBootstrap() {
  const DEFAULT_THEME = 'light';
  const STORAGE_PREFIX = 'skillboost-theme-';

  function normalizeTheme(theme) {
    const resolved = String(theme || '').toLowerCase().trim();
    return (resolved === 'light' || resolved === 'dark') ? resolved : DEFAULT_THEME;
  }

  function normalizeRole(role) {
    return role === 'instructor' ? 'instructor' : 'student';
  }

  function getQueryRole() {
    try {
      const role = new URLSearchParams(window.location.search).get('role');
      return role === 'student' || role === 'instructor' ? role : '';
    } catch (error) {
      return '';
    }
  }

  function inferRole() {
    const bodyRole = document.body?.dataset?.appRole;
    if (bodyRole === 'student' || bodyRole === 'instructor') {
      return bodyRole;
    }

    const queryRole = getQueryRole();
    if (queryRole) {
      return queryRole;
    }

    const pathname = String(window.location.pathname || '').toLowerCase();
    if (pathname.includes('instructor')) {
      return 'instructor';
    }

    if (document.body?.classList.contains('student-dashboard')) {
      return 'student';
    }

    try {
      if (localStorage.getItem('instructorId') && !localStorage.getItem('studentId')) {
        return 'instructor';
      }
    } catch (error) {
      // Ignore localStorage access failures and fall back to the student theme.
    }

    return 'student';
  }

  function getStorageKey(role) {
    return `${STORAGE_PREFIX}${normalizeRole(role)}`;
  }

  function getStoredTheme(role) {
    try {
      return normalizeTheme(localStorage.getItem(getStorageKey(role)));
    } catch (error) {
      return DEFAULT_THEME;
    }
  }

  function persistTheme(role, theme) {
    try {
      localStorage.setItem(getStorageKey(role), normalizeTheme(theme));
    } catch (error) {
      // Ignore localStorage write failures so the UI can still switch for this session.
    }
  }

  function applyTheme(theme, role) {
    const resolvedTheme = normalizeTheme(theme);
    const resolvedRole = normalizeRole(role);

    document.documentElement.setAttribute('data-theme', resolvedTheme);
    document.documentElement.setAttribute('data-theme-role', resolvedRole);

    if (document.body) {
      document.body.setAttribute('data-theme', resolvedTheme);
      document.body.setAttribute('data-theme-role', resolvedRole);
    }

    return resolvedTheme;
  }

  function updateButton(button, theme) {
    if (!button) return;

    const isLight = theme === 'light';
    const nextThemeLabel = isLight ? 'dark' : 'day';
    const currentLabel = isLight ? 'Day Mode' : 'Dark Mode';

    button.dataset.themeValue = theme;
    button.setAttribute('aria-pressed', String(isLight));
    button.setAttribute('aria-label', `Switch to ${nextThemeLabel} mode`);
    button.setAttribute('title', `Switch to ${nextThemeLabel} mode`);

    const label = button.querySelector('[data-theme-label]');
    if (label) {
      label.textContent = currentLabel;
    }
  }

  function initializeToggle(button, pageRole) {
    if (!button || button.dataset.themeInitialized === 'true') {
      return;
    }

    const buttonRole = normalizeRole(button.dataset.themeRole || pageRole);
    // Get stored theme if it exists, otherwise default to light
    let theme = getStoredTheme(buttonRole);
    applyTheme(theme, buttonRole);
    updateButton(button, theme);

    button.addEventListener('click', () => {
      theme = theme === 'light' ? 'dark' : 'light';
      persistTheme(buttonRole, theme);
      applyTheme(theme, buttonRole);
      // Update ALL theme toggle buttons across the page
      document.querySelectorAll('[data-theme-toggle]').forEach((toggleButton) => {
        updateButton(toggleButton, theme);
      });
    });

    button.dataset.themeInitialized = 'true';
  }

  document.addEventListener('DOMContentLoaded', () => {
    const pageRole = inferRole();
    // Get stored theme for this role, or default to light
    const storedTheme = getStoredTheme(pageRole);
    const theme = applyTheme(storedTheme, pageRole);

    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      initializeToggle(button, pageRole);
      updateButton(button, theme);
    });
  });

  window.SkillBoostTheme = {
    applyStoredTheme(role) {
      const resolvedRole = normalizeRole(role || inferRole());
      return applyTheme(DEFAULT_THEME, resolvedRole);
    }
  };
})();
