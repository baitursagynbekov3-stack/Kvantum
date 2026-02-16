// Frontend runtime config.
// Production API endpoint
window.QUANTUM_API_BASE_URL = 'https://quantum-api.vercel.app';
window.QUANTUM_USE_DEMO_API = false;

// Demo admin emails — these accounts get admin access in demo mode.
// In production, admin is determined by ADMIN_EMAILS env var on the backend.
window.QUANTUM_DEMO_ADMIN_EMAILS = ['admin@quantum.com'];
