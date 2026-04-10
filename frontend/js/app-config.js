(function () {
  const LOCAL_BACKEND_ORIGIN = 'http://localhost:3000';
  // Set this once after your Render backend is live, for example:
  // const DEPLOYED_BACKEND_ORIGIN = 'https://your-service.onrender.com';
  const DEPLOYED_BACKEND_ORIGIN = 'https://skill-boost-nexus.onrender.com';
  const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
  const SAME_ORIGIN_API_HOST_SUFFIXES = ['.vercel.app'];

  function normalizeOrigin(value) {
    return String(value || '').trim().replace(/\/+$/, '');
  }

  function hasHostnameSuffix(hostname, suffixes) {
    const normalizedHostname = String(hostname || '').trim().toLowerCase();
    return suffixes.some((suffix) => normalizedHostname.endsWith(String(suffix || '').trim().toLowerCase()));
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

  function ensureTrailingSlash(path) {
    const normalizedPath = String(path || '').trim();
    if (!normalizedPath) {
      return '/';
    }
    return normalizedPath.endsWith('/') ? normalizedPath : `${normalizedPath}/`;
  }

  function resolveCurrentDirectoryPath() {
    const pathname = String(window.location.pathname || '/').split(/[?#]/, 1)[0];
    if (!pathname || pathname === '/') {
      return '/';
    }

    const lastSlashIndex = pathname.lastIndexOf('/');
    if (lastSlashIndex < 0) {
      return '/';
    }

    return ensureTrailingSlash(pathname.slice(0, lastSlashIndex + 1));
  }

  function resolveHtmlBasePath() {
    const pathname = String(window.location.pathname || '/').split(/[?#]/, 1)[0];
    const htmlMarker = '/HTML/';
    const htmlMarkerIndex = pathname.lastIndexOf(htmlMarker);

    if (htmlMarkerIndex >= 0) {
      return ensureTrailingSlash(pathname.slice(0, htmlMarkerIndex + htmlMarker.length));
    }

    return resolveCurrentDirectoryPath();
  }

  const explicitApiBase = resolveExplicitApiBase();
  const currentOrigin = normalizeOrigin(window.location.origin);
  const isLocalHost = LOCAL_HOSTS.has(window.location.hostname);
  const deployedApiBase = normalizeOrigin(DEPLOYED_BACKEND_ORIGIN);
  const shouldProxyApiThroughCurrentOrigin = !isLocalHost
    && hasHostnameSuffix(window.location.hostname, SAME_ORIGIN_API_HOST_SUFFIXES)
    && (!explicitApiBase || explicitApiBase === deployedApiBase || explicitApiBase === currentOrigin);
  const apiBase = explicitApiBase || (isLocalHost ? LOCAL_BACKEND_ORIGIN : (deployedApiBase || currentOrigin));
  const htmlBasePath = resolveHtmlBasePath();

  function buildApiUrl(path = '') {
    const normalizedPath = String(path || '').trim();
    if (/^https?:\/\//i.test(normalizedPath)) {
      return normalizedPath;
    }

    const resolvedPath = ensureLeadingSlash(normalizedPath);
    if (shouldProxyApiThroughCurrentOrigin && resolvedPath.startsWith('/api/')) {
      return `${currentOrigin}${resolvedPath}`;
    }

    return `${apiBase}${resolvedPath}`;
  }

  function buildPublicUrl(path = '') {
    if (/^https?:\/\//i.test(String(path || '').trim())) {
      return String(path).trim();
    }
    return `${currentOrigin}${ensureLeadingSlash(path)}`;
  }

  function buildHtmlUrl(path = '') {
    const normalizedPath = String(path || '').trim();
    if (/^https?:\/\//i.test(normalizedPath)) {
      return normalizedPath;
    }

    return new URL(normalizedPath || '.', `${currentOrigin}${htmlBasePath}`).toString();
  }

  function warmApiConnection() {
    if (isLocalHost || !deployedApiBase || typeof window.fetch !== 'function') {
      return;
    }

    window.setTimeout(() => {
      fetch(buildApiUrl('/api/health'), {
        method: 'GET',
        cache: 'no-store',
        mode: 'cors'
      }).catch(() => {
        // Keep the warm-up silent so page rendering is never blocked.
      });
    }, 0);
  }

  if (!explicitApiBase && !isLocalHost && !deployedApiBase) {
    console.warn(
      '[Skill Boost Nexus] Set DEPLOYED_BACKEND_ORIGIN in js/app-config.js or provide SKILL_BOOST_API_BASE before deploying the frontend.'
    );
  }

  window.SkillBoostApp = Object.freeze({
    apiBase,
    htmlBasePath,
    publicOrigin: currentOrigin,
    isLocalHost,
    buildApiUrl,
    buildHtmlUrl,
    buildPublicUrl
  });

  warmApiConnection();
})();
