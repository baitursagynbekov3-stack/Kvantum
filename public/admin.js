// ===== Admin Panel Logic =====
const API_BASE_URL = (window.QUANTUM_API_BASE_URL || '').trim().replace(/\/$/, '');
const USE_DEMO_API = window.QUANTUM_USE_DEMO_API === true || (!API_BASE_URL && window.location.hostname.endsWith('github.io'));

let authToken = localStorage.getItem('quantum_token');
let currentUser = null;

try {
  currentUser = JSON.parse(localStorage.getItem('quantum_user'));
} catch (e) {
  currentUser = null;
}

// ===== API helpers (reused from app.js pattern) =====
function buildApiUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  return API_BASE_URL ? API_BASE_URL + normalizedPath : normalizedPath;
}

function getStorageArray(key) {
  try {
    const value = localStorage.getItem(key);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}

function setStorageArray(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function createApiResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, async json() { return data; } };
}

function parseJsonBody(options) {
  if (!options || !options.body) return {};
  try { return JSON.parse(options.body); } catch (e) { return {}; }
}

function readHeader(headers, key) {
  if (!headers) return '';
  if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.get(key) || '';
  return headers[key] || headers[key.toLowerCase()] || '';
}

// Demo API for admin
function demoAdminApi(path, options) {
  const body = parseJsonBody(options);
  const method = (options && options.method || 'GET').toUpperCase();
  const auth = readHeader(options && options.headers, 'Authorization');

  function getDemoUserRole() {
    if (!auth || !auth.startsWith('Bearer demo-')) return null;
    try {
      const decoded = atob(auth.replace('Bearer demo-', ''));
      const email = decoded.split(':')[0];
      const users = getStorageArray('quantum_demo_users');
      const user = users.find(u => u.email === email);
      return user ? (user.role || 'user') : 'user';
    } catch (e) { return 'user'; }
  }

  const keyMap = {
    testimonials: 'quantum_demo_testimonials',
    programs: 'quantum_demo_programs',
    services: 'quantum_demo_services'
  };

  if (path === '/api/admin/check') {
    const role = getDemoUserRole();
    if (role !== 'admin') return createApiResponse(403, { error: 'Admin access required' });
    return createApiResponse(200, { isAdmin: true });
  }

  // Match /api/admin/{type} or /api/admin/{type}/{id}
  const match = path.match(/^\/api\/admin\/(testimonials|programs|services)(?:\/(.+))?$/);
  if (match) {
    const role = getDemoUserRole();
    if (role !== 'admin') return createApiResponse(403, { error: 'Admin access required' });

    const type = match[1];
    const id = match[2];
    const storageKey = keyMap[type];
    let items = getStorageArray(storageKey);

    if (!id) {
      if (method === 'GET') return createApiResponse(200, items);
      if (method === 'POST') {
        const item = { _id: 'd' + Date.now(), ...body, order: items.length + 1 };
        items.push(item);
        setStorageArray(storageKey, items);
        return createApiResponse(201, item);
      }
    } else {
      const idx = items.findIndex(i => i._id === id);
      if (method === 'PUT') {
        if (idx === -1) return createApiResponse(404, { error: 'Not found' });
        items[idx] = { ...items[idx], ...body, _id: id };
        setStorageArray(storageKey, items);
        return createApiResponse(200, items[idx]);
      }
      if (method === 'DELETE') {
        if (idx === -1) return createApiResponse(404, { error: 'Not found' });
        items.splice(idx, 1);
        setStorageArray(storageKey, items);
        return createApiResponse(200, { message: 'Deleted' });
      }
    }
  }

  // Services public route (for admin service list when backend uses /api/services)
  if (path === '/api/services' && method === 'GET') {
    return createApiResponse(200, getStorageArray(keyMap.services));
  }
  if (path.startsWith('/api/services/') && method === 'PUT') {
    const role = getDemoUserRole();
    if (role !== 'admin') return createApiResponse(403, { error: 'Admin access required' });
    const id = path.replace('/api/services/', '');
    let items = getStorageArray(keyMap.services);
    const idx = items.findIndex(i => i._id === id);
    if (idx === -1) return createApiResponse(404, { error: 'Not found' });
    items[idx] = { ...items[idx], ...body, _id: id };
    setStorageArray(keyMap.services, items);
    return createApiResponse(200, { message: 'Service updated', service: items[idx] });
  }
  if (path.startsWith('/api/services/') && method === 'DELETE') {
    const role = getDemoUserRole();
    if (role !== 'admin') return createApiResponse(403, { error: 'Admin access required' });
    const id = path.replace('/api/services/', '');
    let items = getStorageArray(keyMap.services);
    const idx = items.findIndex(i => i._id === id);
    if (idx === -1) return createApiResponse(404, { error: 'Not found' });
    items.splice(idx, 1);
    setStorageArray(keyMap.services, items);
    return createApiResponse(200, { message: 'Service deleted' });
  }
  if (path === '/api/services' && method === 'POST') {
    const role = getDemoUserRole();
    if (role !== 'admin') return createApiResponse(403, { error: 'Admin access required' });
    let items = getStorageArray(keyMap.services);
    const item = { _id: 'ds' + Date.now(), ...body };
    items.push(item);
    setStorageArray(keyMap.services, items);
    return createApiResponse(201, { message: 'Service created', service: item });
  }

  return createApiResponse(404, { error: 'Not found' });
}

function adminFetch(path, options) {
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  if (API_BASE_URL) return fetch(buildApiUrl(normalizedPath), options);
  if (USE_DEMO_API) return Promise.resolve(demoAdminApi(normalizedPath, options));
  return fetch(normalizedPath, options);
}

function authHeaders(extra) {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken, ...extra };
}

// ===== Toast =====
function showToast(message, type) {
  const toast = document.createElement('div');
  toast.className = 'admin-toast ' + (type || 'info');
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ===== Section switching =====
let currentSection = 'testimonials';

function switchSection(section, e) {
  if (e) e.preventDefault();
  currentSection = section;
  document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));
  document.querySelector(`[data-section="${section}"]`).classList.add('active');
  document.querySelectorAll('[id^="section-"]').forEach(el => el.style.display = 'none');
  document.getElementById('section-' + section).style.display = 'block';
}

// ===== Modals =====
function openAdminModal(id) {
  document.getElementById(id).classList.add('active');
}
function closeAdminModal(id) {
  document.getElementById(id).classList.remove('active');
}

// ===== Escape HTML =====
function esc(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// ================================================================
// TESTIMONIALS
// ================================================================
let testimonials = [];

async function loadTestimonials() {
  try {
    const res = await adminFetch('/api/admin/testimonials', { headers: authHeaders() });
    if (res.ok) {
      testimonials = await res.json();
      renderTestimonialCards();
    }
  } catch (e) {
    showToast('Failed to load testimonials', 'error');
  }
}

function renderTestimonialCards() {
  const el = document.getElementById('testimonialsList');
  if (!testimonials.length) {
    el.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
      <p>No testimonials yet. Add your first one!</p>
    </div>`;
    return;
  }
  el.innerHTML = testimonials.map(t => `
    <div class="admin-card">
      <div class="card-badge">Order: ${t.order || 0}</div>
      <h3>${esc(t.authorName)}</h3>
      <p>"${esc(t.text)}"</p>
      ${t.role ? `<div class="card-meta">${esc(t.role)}</div>` : ''}
      <div class="card-actions">
        <button class="btn btn-secondary btn-sm" onclick="editTestimonial('${t._id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTestimonial('${t._id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

function openTestimonialForm(item) {
  document.getElementById('testimonialModalTitle').textContent = item ? 'Edit Testimonial' : 'Add Testimonial';
  document.getElementById('testimonialId').value = item ? item._id : '';
  document.getElementById('tText').value = item ? item.text : '';
  document.getElementById('tTextRu').value = item ? item.text_ru || '' : '';
  document.getElementById('tAuthor').value = item ? item.authorName : '';
  document.getElementById('tInitial').value = item ? item.authorInitial || '' : '';
  document.getElementById('tRole').value = item ? item.role || '' : '';
  document.getElementById('tRoleRu').value = item ? item.role_ru || '' : '';
  document.getElementById('tOrder').value = item ? item.order || 0 : testimonials.length + 1;
  openAdminModal('testimonialModal');
}

function editTestimonial(id) {
  const item = testimonials.find(t => t._id === id);
  if (item) openTestimonialForm(item);
}

async function saveTestimonial(e) {
  e.preventDefault();
  const id = document.getElementById('testimonialId').value;
  const data = {
    text: document.getElementById('tText').value,
    text_ru: document.getElementById('tTextRu').value,
    authorName: document.getElementById('tAuthor').value,
    authorInitial: document.getElementById('tInitial').value || document.getElementById('tAuthor').value.charAt(0),
    role: document.getElementById('tRole').value,
    role_ru: document.getElementById('tRoleRu').value,
    order: parseInt(document.getElementById('tOrder').value) || 0
  };

  try {
    const url = id ? '/api/admin/testimonials/' + id : '/api/admin/testimonials';
    const method = id ? 'PUT' : 'POST';
    const res = await adminFetch(url, { method, headers: authHeaders(), body: JSON.stringify(data) });
    if (res.ok) {
      showToast(id ? 'Testimonial updated' : 'Testimonial created', 'success');
      closeAdminModal('testimonialModal');
      loadTestimonials();
    } else {
      const err = await res.json();
      showToast(err.error || 'Save failed', 'error');
    }
  } catch (e) {
    showToast('Save failed', 'error');
  }
}

async function deleteTestimonial(id) {
  if (!confirm('Delete this testimonial?')) return;
  try {
    const res = await adminFetch('/api/admin/testimonials/' + id, { method: 'DELETE', headers: authHeaders() });
    if (res.ok) {
      showToast('Testimonial deleted', 'success');
      loadTestimonials();
    }
  } catch (e) {
    showToast('Delete failed', 'error');
  }
}

// ================================================================
// PROGRAMS
// ================================================================
let programs = [];

async function loadPrograms() {
  try {
    const res = await adminFetch('/api/admin/programs', { headers: authHeaders() });
    if (res.ok) {
      programs = await res.json();
      renderProgramCards();
    }
  } catch (e) {
    showToast('Failed to load programs', 'error');
  }
}

function renderProgramCards() {
  const el = document.getElementById('programsList');
  if (!programs.length) {
    el.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
      <p>No programs yet. Add your first one!</p>
    </div>`;
    return;
  }
  el.innerHTML = programs.map(p => {
    const features = (p.features || []).slice(0, 3);
    return `<div class="admin-card">
      <div class="card-badge">${esc(p.tier || 'standard')} | Order: ${p.order || 0}</div>
      <h3>${esc(p.name)}</h3>
      <p>${esc(p.tagline || '')}</p>
      <div class="card-meta">${esc(p.priceAmount || '0')} ${esc(p.priceCurrency || '')}</div>
      ${features.length ? `<div class="features-preview">${features.map(f => `<span>${esc(f)}</span>`).join('')}${(p.features || []).length > 3 ? `<span>+${(p.features || []).length - 3} more</span>` : ''}</div>` : ''}
      <div class="card-actions">
        <button class="btn btn-secondary btn-sm" onclick="editProgram('${p._id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteProgram('${p._id}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}

function openProgramForm(item) {
  document.getElementById('programModalTitle').textContent = item ? 'Edit Program' : 'Add Program';
  document.getElementById('pId').value = item ? item._id : '';
  document.getElementById('pName').value = item ? item.name : '';
  document.getElementById('pNameRu').value = item ? item.name_ru || '' : '';
  document.getElementById('pTier').value = item ? item.tier || 'standard' : 'standard';
  document.getElementById('pCssClass').value = item ? item.cssClass || '' : '';
  document.getElementById('pTierLabel').value = item ? item.tierLabel || '' : '';
  document.getElementById('pTierLabelRu').value = item ? item.tierLabel_ru || '' : '';
  document.getElementById('pTagline').value = item ? item.tagline || '' : '';
  document.getElementById('pTaglineRu').value = item ? item.tagline_ru || '' : '';
  document.getElementById('pPriceAmount').value = item ? item.priceAmount || '' : '';
  document.getElementById('pPriceCurrency').value = item ? item.priceCurrency || '' : '';
  document.getElementById('pPriceNumeric').value = item ? item.priceNumeric || 0 : 0;
  document.getElementById('pPurchaseCurrency').value = item ? item.purchaseCurrency || 'KGS' : 'KGS';
  document.getElementById('pFeatures').value = item ? (item.features || []).join('\n') : '';
  document.getElementById('pFeaturesRu').value = item ? (item.features_ru || []).join('\n') : '';
  document.getElementById('pBtnText').value = item ? item.buttonText || '' : 'Get Started';
  document.getElementById('pBtnTextRu').value = item ? item.buttonText_ru || '' : '';
  document.getElementById('pActionType').value = item ? item.actionType || 'purchase' : 'purchase';
  document.getElementById('pPopular').value = item ? String(item.popular || false) : 'false';
  document.getElementById('pOrder').value = item ? item.order || 0 : programs.length + 1;
  openAdminModal('programModal');
}

function editProgram(id) {
  const item = programs.find(p => p._id === id);
  if (item) openProgramForm(item);
}

async function saveProgram(e) {
  e.preventDefault();
  const id = document.getElementById('pId').value;
  const data = {
    name: document.getElementById('pName').value,
    name_ru: document.getElementById('pNameRu').value,
    tier: document.getElementById('pTier').value,
    cssClass: document.getElementById('pCssClass').value,
    tierLabel: document.getElementById('pTierLabel').value,
    tierLabel_ru: document.getElementById('pTierLabelRu').value,
    tagline: document.getElementById('pTagline').value,
    tagline_ru: document.getElementById('pTaglineRu').value,
    priceAmount: document.getElementById('pPriceAmount').value,
    priceCurrency: document.getElementById('pPriceCurrency').value,
    priceNumeric: parseFloat(document.getElementById('pPriceNumeric').value) || 0,
    purchaseCurrency: document.getElementById('pPurchaseCurrency').value,
    features: document.getElementById('pFeatures').value.split('\n').map(s => s.trim()).filter(Boolean),
    features_ru: document.getElementById('pFeaturesRu').value.split('\n').map(s => s.trim()).filter(Boolean),
    buttonText: document.getElementById('pBtnText').value,
    buttonText_ru: document.getElementById('pBtnTextRu').value,
    actionType: document.getElementById('pActionType').value,
    popular: document.getElementById('pPopular').value === 'true',
    order: parseInt(document.getElementById('pOrder').value) || 0
  };

  try {
    const url = id ? '/api/admin/programs/' + id : '/api/admin/programs';
    const method = id ? 'PUT' : 'POST';
    const res = await adminFetch(url, { method, headers: authHeaders(), body: JSON.stringify(data) });
    if (res.ok) {
      showToast(id ? 'Program updated' : 'Program created', 'success');
      closeAdminModal('programModal');
      loadPrograms();
    } else {
      const err = await res.json();
      showToast(err.error || 'Save failed', 'error');
    }
  } catch (e) {
    showToast('Save failed', 'error');
  }
}

async function deleteProgram(id) {
  if (!confirm('Delete this program?')) return;
  try {
    const res = await adminFetch('/api/admin/programs/' + id, { method: 'DELETE', headers: authHeaders() });
    if (res.ok) {
      showToast('Program deleted', 'success');
      loadPrograms();
    }
  } catch (e) {
    showToast('Delete failed', 'error');
  }
}

// ================================================================
// SERVICES
// ================================================================
let services = [];

async function loadServices() {
  try {
    // Admin services route returns all (including unavailable)
    const res = await adminFetch('/api/admin/services', { headers: authHeaders() });
    if (res.ok) {
      services = await res.json();
      renderServiceCards();
    }
  } catch (e) {
    showToast('Failed to load services', 'error');
  }
}

function renderServiceCards() {
  const el = document.getElementById('servicesList');
  if (!services.length) {
    el.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33"/></svg>
      <p>No services yet. Add your first one!</p>
    </div>`;
    return;
  }
  el.innerHTML = services.map(s => `
    <div class="admin-card">
      <div class="card-badge">${esc(s.currency || 'KGS')} | ${s.availability !== false ? 'Available' : 'Unavailable'}</div>
      <h3>${esc(s.title)}</h3>
      <p>${esc(s.description || '')}</p>
      <div class="card-meta">${s.price != null ? s.price.toLocaleString() + ' ' + (s.currency || 'KGS') : ''}${s.duration ? ' | ' + esc(s.duration) : ''}</div>
      <div class="card-actions">
        <button class="btn btn-secondary btn-sm" onclick="editService('${s._id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteService('${s._id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

function openServiceForm(item) {
  document.getElementById('serviceModalTitle').textContent = item ? 'Edit Service' : 'Add Service';
  document.getElementById('sId').value = item ? item._id : '';
  document.getElementById('sTitle').value = item ? item.title : '';
  document.getElementById('sDescription').value = item ? item.description || '' : '';
  document.getElementById('sPrice').value = item ? item.price || 0 : 0;
  document.getElementById('sCurrency').value = item ? item.currency || 'KGS' : 'KGS';
  document.getElementById('sDuration').value = item ? item.duration || '' : '';
  document.getElementById('sAvailability').value = item ? String(item.availability !== false) : 'true';
  openAdminModal('serviceModal');
}

function editService(id) {
  const item = services.find(s => s._id === id);
  if (item) openServiceForm(item);
}

async function saveService(e) {
  e.preventDefault();
  const id = document.getElementById('sId').value;
  const data = {
    title: document.getElementById('sTitle').value,
    description: document.getElementById('sDescription').value,
    price: parseFloat(document.getElementById('sPrice').value) || 0,
    currency: document.getElementById('sCurrency').value,
    duration: document.getElementById('sDuration').value,
    availability: document.getElementById('sAvailability').value === 'true'
  };

  try {
    const url = id ? '/api/services/' + id : '/api/services';
    const method = id ? 'PUT' : 'POST';
    const res = await adminFetch(url, { method, headers: authHeaders(), body: JSON.stringify(data) });
    if (res.ok) {
      showToast(id ? 'Service updated' : 'Service created', 'success');
      closeAdminModal('serviceModal');
      loadServices();
    } else {
      const err = await res.json();
      showToast(err.error || 'Save failed', 'error');
    }
  } catch (e) {
    showToast('Save failed', 'error');
  }
}

async function deleteService(id) {
  if (!confirm('Delete this service?')) return;
  try {
    const res = await adminFetch('/api/services/' + id, { method: 'DELETE', headers: authHeaders() });
    if (res.ok) {
      showToast('Service deleted', 'success');
      loadServices();
    }
  } catch (e) {
    showToast('Delete failed', 'error');
  }
}

// ================================================================
// INIT
// ================================================================
async function initAdmin() {
  // Check if logged in
  if (!authToken || !currentUser) {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('deniedState').style.display = 'block';
    return;
  }

  // Check admin access
  try {
    const res = await adminFetch('/api/admin/check', { headers: authHeaders() });
    if (!res.ok) {
      document.getElementById('loadingState').style.display = 'none';
      document.getElementById('deniedState').style.display = 'block';
      return;
    }
  } catch (e) {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('deniedState').style.display = 'block';
    return;
  }

  // Show admin panel
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('adminLayout').style.display = 'flex';

  // Load all data
  loadTestimonials();
  loadPrograms();
  loadServices();
}

document.addEventListener('DOMContentLoaded', initAdmin);
