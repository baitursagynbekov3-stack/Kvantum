// Frontend runtime config.
// Uses local API in local development, production API on deployed domains.
(function () {
  var isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  window.QUANTUM_API_BASE_URL = isLocal
    ? 'http://localhost:3000'
    : 'https://quantum-self.vercel.app';

  window.QUANTUM_USE_DEMO_API = false;

  // Demo admin emails — these accounts get admin access in demo mode.
  // In production, admin is determined by ADMIN_EMAILS env var on the backend.
  window.QUANTUM_DEMO_ADMIN_EMAILS = ['admin@quantum.com'];
})();
