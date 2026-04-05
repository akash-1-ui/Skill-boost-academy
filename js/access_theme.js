(function accessThemeBootstrap() {
  const DEFAULT_THEME = 'light';
  const STORAGE_KEY = 'skillboost-theme-access';

  function normalizeTheme(theme) {
    return theme === 'dark' ? 'dark' : DEFAULT_THEME;
  }

  function getStoredTheme() {
    try {
      return normalizeTheme(localStorage.getItem(STORAGE_KEY));
    } catch (error) {
      return DEFAULT_THEME;
    }
  }

  function persistTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, normalizeTheme(theme));
    } catch (error) {
      // Ignore storage failures so the current session can still switch themes.
    }
  }

  function applyTheme(theme) {
    const resolvedTheme = normalizeTheme(theme);

    document.documentElement.setAttribute('data-theme', resolvedTheme);
    document.documentElement.setAttribute('data-theme-role', 'access');

    if (document.body) {
      document.body.setAttribute('data-theme', resolvedTheme);
      document.body.setAttribute('data-theme-role', 'access');
    }

    return resolvedTheme;
  }

  function updateButton(button, theme) {
    if (!button) return;

    const isDark = theme === 'dark';
    const nextThemeLabel = isDark ? 'day' : 'night';
    const currentLabel = isDark ? 'Night Mode' : 'Day Mode';

    button.dataset.themeValue = theme;
    button.setAttribute('aria-pressed', String(isDark));
    button.setAttribute('aria-label', `Switch to ${nextThemeLabel} mode`);
    button.setAttribute('title', `Switch to ${nextThemeLabel} mode`);

    const label = button.querySelector('[data-theme-label]');
    if (label) {
      label.textContent = currentLabel;
    }
  }

  function initializeToggle(button) {
    if (!button || button.dataset.themeInitialized === 'true') {
      return;
    }

    let theme = applyTheme(getStoredTheme());
    updateButton(button, theme);

    button.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      persistTheme(theme);
      applyTheme(theme);

      document.querySelectorAll('[data-theme-toggle]').forEach((toggleButton) => {
        updateButton(toggleButton, theme);
      });
    });

    button.dataset.themeInitialized = 'true';
  }

  document.addEventListener('DOMContentLoaded', () => {
    const theme = applyTheme(getStoredTheme());

    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      initializeToggle(button);
      updateButton(button, theme);
    });
  });

  window.SkillBoostAccessTheme = {
    applyStoredTheme() {
      return applyTheme(getStoredTheme());
    }
  };
})();
