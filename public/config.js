// Frontend runtime config.
// Localhost -> local API, GitHub Pages -> production API, other hosts -> same-origin API by default.
(function () {
  var host = window.location.hostname || '';
  var isLocal = host === 'localhost' || host === '127.0.0.1';
  var isGitHubPages = host.endsWith('github.io');

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
  } else if (isGitHubPages) {
    window.QUANTUM_API_BASE_URL = 'https://kvantum-api.vercel.app';
  } else {
    // Vercel/custom domain where frontend and API are served by same app.
    window.QUANTUM_API_BASE_URL = '';
  }

  window.QUANTUM_USE_DEMO_API = false;

  // Google OAuth Client ID for Google Sign-In (Web application type).
  // Example: 1234567890-abc123def456.apps.googleusercontent.com
  window.QUANTUM_GOOGLE_CLIENT_ID = '145410914930-2n3ccc2otdud4hds5ob54fu7utubonl3.apps.googleusercontent.com';

  // Demo admin emails — these accounts get admin access in demo mode.
  // In production, admin is determined by DB role + ADMIN_EMAILS bootstrap on backend.
  window.QUANTUM_DEMO_ADMIN_EMAILS = ['admin@quantum.com'];
})();
