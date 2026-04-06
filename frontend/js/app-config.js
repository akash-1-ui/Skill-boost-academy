(function () {
  const LOCAL_BACKEND_ORIGIN = 'http://localhost:3000';
  // Set this once after your Render backend is live, for example:
  // const DEPLOYED_BACKEND_ORIGIN = 'https://your-service.onrender.com';
  const DEPLOYED_BACKEND_ORIGIN = '';
  const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

  function normalizeOrigin(value) {
    return String(value || '').trim().replace(/\/+$/, '');
  }

  function readStoredApiBase() {
    try {
      return window.localStorage.getItem('skillboost-api-base') || '';
    } catch (error) {
      return '';
    }
  }

  function resolveExplicitApiBase() {
    const candidates = [
      window.SKILL_BOOST_API_BASE,
      document.documentElement?.getAttribute('data-api-base'),
      document.querySelector('meta[name="skillboost-api-base"]')?.getAttribute('content'),
      readStoredApiBase()
    ];

    for (const candidate of candidates) {
      const normalized = normalizeOrigin(candidate);
      if (normalized) {
        return normalized;
      }
    }

    return '';
  }

  function ensureLeadingSlash(path) {
    const normalizedPath = String(path || '').trim();
    if (!normalizedPath) {
      return '';
    }
    return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
  }

  const explicitApiBase = resolveExplicitApiBase();
  const currentOrigin = normalizeOrigin(window.location.origin);
  const isLocalHost = LOCAL_HOSTS.has(window.location.hostname);
  const deployedApiBase = normalizeOrigin(DEPLOYED_BACKEND_ORIGIN);
  const apiBase = explicitApiBase || (isLocalHost ? LOCAL_BACKEND_ORIGIN : (deployedApiBase || currentOrigin));

  function buildApiUrl(path = '') {
    if (/^https?:\/\//i.test(String(path || '').trim())) {
      return String(path).trim();
    }
    return `${apiBase}${ensureLeadingSlash(path)}`;
  }

  function buildPublicUrl(path = '') {
    if (/^https?:\/\//i.test(String(path || '').trim())) {
      return String(path).trim();
    }
    return `${currentOrigin}${ensureLeadingSlash(path)}`;
  }

  if (!explicitApiBase && !isLocalHost && !deployedApiBase) {
    console.warn(
      '[Skill Boost Nexus] Set DEPLOYED_BACKEND_ORIGIN in js/app-config.js or provide SKILL_BOOST_API_BASE before deploying the frontend.'
    );
  }

  window.SkillBoostApp = Object.freeze({
    apiBase,
    publicOrigin: currentOrigin,
    isLocalHost,
    buildApiUrl,
    buildPublicUrl
  });
})();
