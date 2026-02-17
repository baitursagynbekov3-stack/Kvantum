// Frontend runtime config.
// Localhost -> local API, other hosts -> same-origin API by default.
(function () {
  var host = window.location.hostname || '';
  var isLocal = host === 'localhost' || host === '127.0.0.1';
  var queryOverride = '';
  try {
    queryOverride = (new URLSearchParams(window.location.search).get('apiBase') || '').trim();
  } catch (err) {
    queryOverride = '';
  }

  var storageOverride = '';
  try {
    storageOverride = (localStorage.getItem('quantum_api_base_url_override') || '').trim();
  } catch (err) {
    storageOverride = '';
  }

  var runtimeOverride = (window.QUANTUM_API_BASE_URL_OVERRIDE || '').trim();
  var override = queryOverride || runtimeOverride || storageOverride;

  if (override) {
    window.QUANTUM_API_BASE_URL = override.replace(/\/$/, '');
  } else if (isLocal) {
    window.QUANTUM_API_BASE_URL = 'http://localhost:3000';
  } else {
    // Vercel/custom domain where frontend and API are served by same app.
    window.QUANTUM_API_BASE_URL = '';
  }

  window.QUANTUM_USE_DEMO_API = false;

  // Demo admin emails — these accounts get admin access in demo mode.
  // In production, admin is determined by DB role + ADMIN_EMAILS bootstrap on backend.
  window.QUANTUM_DEMO_ADMIN_EMAILS = ['admin@quantum.com'];
})();
