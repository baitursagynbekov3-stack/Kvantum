// ===== Admin Panel Logic =====
const API_BASE_URL = (window.QUANTUM_API_BASE_URL || '').trim().replace(/\/$/, '');
const USE_DEMO_API = window.QUANTUM_USE_DEMO_API === true;

let authToken = localStorage.getItem('quantum_token');
let currentUser = null;

try {
  currentUser = JSON.parse(localStorage.getItem('quantum_user'));
} catch (e) {
  currentUser = null;
}

let leads = [];
let chats = [];
let activeChat = null;

let leadFilters = {
  search: '',
  status: 'all'
};

let chatFilters = {
  search: '',
  status: 'all'
};

let leadSearchTimer = null;
let chatSearchTimer = null;

const BOOKING_STATUSES = ['pending', 'new', 'in_progress', 'done', 'cancelled'];
const CHAT_STATUSES = ['open', 'collecting', 'booked', 'closed', 'spam'];

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

  if (path.startsWith('/api/admin/bookings/') && method === 'PATCH') {
    const role = getDemoUserRole();
    if (role !== 'admin') return createApiResponse(403, { error: 'Admin access required' });

    const id = parseInt(path.replace('/api/admin/bookings/', ''), 10);
    const status = String(body.status || '').trim().toLowerCase();
    const validStatuses = new Set(['pending', 'new', 'in_progress', 'done', 'cancelled']);
    if (!Number.isInteger(id) || id <= 0) return createApiResponse(400, { error: 'Invalid booking id' });
    if (!validStatuses.has(status)) return createApiResponse(400, { error: 'Invalid booking status' });

    const bookings = getStorageArray('quantum_demo_bookings');
    const idx = bookings.findIndex((item) => Number(item.id) === id);
    if (idx === -1) return createApiResponse(404, { error: 'Booking not found' });

    bookings[idx] = { ...bookings[idx], status };
    setStorageArray('quantum_demo_bookings', bookings);
    return createApiResponse(200, { message: 'Booking updated successfully', booking: bookings[idx] });
  }

  if (path.startsWith('/api/admin/leads') && method === 'GET') {
    const role = getDemoUserRole();
    if (role !== 'admin') return createApiResponse(403, { error: 'Admin access required' });

    const status = String((path.split('status=')[1] || '').split('&')[0] || '').trim();
    const search = decodeURIComponent(String((path.split('search=')[1] || '').split('&')[0] || '').trim()).toLowerCase();
    const bookings = getStorageArray('quantum_demo_bookings');

    const leads = bookings.filter((item) => {
      const statusOk = !status || status === 'all' || String(item.status || '').toLowerCase() === status;
      if (!statusOk) return false;
      if (!search) return true;

      const haystack = [item.name, item.email, item.phone, item.service, item.message]
        .map((v) => String(v || '').toLowerCase())
        .join(' ');
      return haystack.includes(search);
    });

    return createApiResponse(200, { leads });
  }

  if (path.startsWith('/api/admin/chats') && method === 'GET') {
    const role = getDemoUserRole();
    if (role !== 'admin') return createApiResponse(403, { error: 'Admin access required' });

    const sessions = getStorageArray('quantum_demo_chat_sessions');
    const messages = getStorageArray('quantum_demo_chat_messages');

    if (path.match(/^\/api\/admin\/chats\/\d+\/messages/)) {
      const id = parseInt(path.split('/')[4], 10);
      const chat = sessions.find((item) => Number(item.id) === id);
      if (!chat) return createApiResponse(404, { error: 'Chat not found' });
      const chatMessages = messages.filter((msg) => Number(msg.chatSessionId) === id);
      return createApiResponse(200, { chat, messages: chatMessages });
    }

    const status = String((path.split('status=')[1] || '').split('&')[0] || '').trim();
    const search = decodeURIComponent(String((path.split('search=')[1] || '').split('&')[0] || '').trim()).toLowerCase();

    const chats = sessions.filter((chat) => {
      const statusOk = !status || status === 'all' || String(chat.leadStatus || '').toLowerCase() === status;
      if (!statusOk) return false;
      if (!search) return true;

      const chatMessages = messages.filter((msg) => Number(msg.chatSessionId) === Number(chat.id));
      const lastMessage = chatMessages[chatMessages.length - 1];

      const haystack = [
        chat.sessionId,
        chat.leadName,
        chat.leadEmail,
        chat.leadPhone,
        chat.leadService,
        chat.leadMessage,
        lastMessage && lastMessage.content
      ].map((v) => String(v || '').toLowerCase()).join(' ');

      return haystack.includes(search);
    }).map((chat) => {
      const chatMessages = messages.filter((msg) => Number(msg.chatSessionId) === Number(chat.id));
      const lastMessage = chatMessages[chatMessages.length - 1] || null;
      return {
        ...chat,
        lead: {
          name: chat.leadName || '',
          email: chat.leadEmail || '',
          phone: chat.leadPhone || '',
          service: chat.leadService || '',
          message: chat.leadMessage || ''
        },
        messageCount: chatMessages.length,
        lastMessage
      };
    });

    return createApiResponse(200, { chats });
  }

  if (path.match(/^\/api\/admin\/chats\/\d+\/status$/) && method === 'PATCH') {
    const role = getDemoUserRole();
    if (role !== 'admin') return createApiResponse(403, { error: 'Admin access required' });

    const id = parseInt(path.split('/')[4], 10);
    const status = String(body.status || '').trim().toLowerCase();
    const validStatuses = new Set(['open', 'collecting', 'booked', 'closed', 'spam']);
    if (!Number.isInteger(id) || id <= 0) return createApiResponse(400, { error: 'Invalid chat id' });
    if (!validStatuses.has(status)) return createApiResponse(400, { error: 'Invalid chat status' });

    const sessions = getStorageArray('quantum_demo_chat_sessions');
    const idx = sessions.findIndex((item) => Number(item.id) === id);
    if (idx === -1) return createApiResponse(404, { error: 'Chat not found' });

    sessions[idx] = { ...sessions[idx], leadStatus: status, updatedAt: new Date().toISOString() };
    setStorageArray('quantum_demo_chat_sessions', sessions);
    return createApiResponse(200, { message: 'Chat status updated', chat: sessions[idx] });
  }

  if (path === '/api/admin/chatbot-knowledge' && method === 'GET') {
    const role = getDemoUserRole();
    if (role !== 'admin') return createApiResponse(403, { error: 'Admin access required' });

    const text = localStorage.getItem('quantum_demo_chatbot_knowledge') || '';
    return createApiResponse(200, { text, source: text ? 'database' : 'file' });
  }

  if (path === '/api/admin/chatbot-knowledge' && method === 'PUT') {
    const role = getDemoUserRole();
    if (role !== 'admin') return createApiResponse(403, { error: 'Admin access required' });

    const text = String(body.text || '');
    localStorage.setItem('quantum_demo_chatbot_knowledge', text);
    return createApiResponse(200, { message: 'Chatbot knowledge base saved', text });
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

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function truncateText(value, max) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

function statusPill(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return `<span class="status-pill ${esc(normalized)}">${esc(normalized || 'unknown')}</span>`;
}

function withQuery(path, params) {
  const query = new URLSearchParams();
  Object.keys(params || {}).forEach((key) => {
    const value = params[key];
    if (value === undefined || value === null) return;
    const stringValue = String(value).trim();
    if (!stringValue || stringValue === 'all') return;
    query.set(key, stringValue);
  });

  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
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
    const price = p.priceNumeric || 0;
    const cur = p.purchaseCurrency || 'KGS';
    const priceText = price > 0 ? (cur === 'USD' ? '$' + price.toLocaleString() : price.toLocaleString() + ' ' + cur) : 'Contact for price';
    const features = (p.features || []).slice(0, 3);
    return `<div class="admin-card">
      ${p.popular ? '<div class="card-badge">Featured</div>' : ''}
      <h3>${esc(p.name)}</h3>
      <p>${esc(p.tagline || '')}</p>
      <div class="card-meta">${priceText} · ${p.actionType === 'purchase' ? 'Buy Now' : 'Contact Us'}</div>
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
  document.getElementById('pTagline').value = item ? item.tagline || '' : '';
  document.getElementById('pPriceNumeric').value = item ? item.priceNumeric || 0 : 0;
  document.getElementById('pPurchaseCurrency').value = item ? item.purchaseCurrency || 'KGS' : 'KGS';
  document.getElementById('pFeatures').value = item ? (item.features || []).join('\n') : '';
  document.getElementById('pFeaturesRu').value = item ? (item.features_ru || []).join('\n') : '';
  document.getElementById('pActionType').value = item ? item.actionType || 'purchase' : 'purchase';
  document.getElementById('pPopular').value = item ? String(item.popular || false) : 'false';
  openAdminModal('programModal');
}

function editProgram(id) {
  const item = programs.find(p => p._id === id);
  if (item) openProgramForm(item);
}

async function saveProgram(e) {
  e.preventDefault();
  const id = document.getElementById('pId').value;
  const price = parseFloat(document.getElementById('pPriceNumeric').value) || 0;
  const currency = document.getElementById('pPurchaseCurrency').value;
  const popular = document.getElementById('pPopular').value === 'true';
  const actionType = document.getElementById('pActionType').value;

  // Auto-derive display fields from simplified inputs
  const priceDisplay = price > 0 ? (currency === 'USD' ? '$' + price.toLocaleString() : price.toLocaleString()) : '';
  const currencyLabel = currency === 'USD' ? '' : currency;

  const data = {
    name: document.getElementById('pName').value,
    name_ru: document.getElementById('pNameRu').value,
    tagline: document.getElementById('pTagline').value,
    tagline_ru: '',
    tier: popular ? 'popular' : 'standard',
    cssClass: popular ? 'popular' : '',
    tierLabel: '',
    tierLabel_ru: '',
    priceAmount: priceDisplay,
    priceCurrency: currencyLabel,
    priceNumeric: price,
    purchaseCurrency: currency,
    features: document.getElementById('pFeatures').value.split('\n').map(s => s.trim()).filter(Boolean),
    features_ru: document.getElementById('pFeaturesRu').value.split('\n').map(s => s.trim()).filter(Boolean),
    buttonText: actionType === 'purchase' ? 'Get Started' : 'Contact Us',
    buttonText_ru: actionType === 'purchase' ? 'Начать' : 'Связаться',
    actionType,
    popular,
    order: id ? (programs.find(p => p._id === id) || {}).order || 0 : programs.length + 1
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
// LEADS
// ================================================================
async function loadLeads(force) {
  try {
    const endpoint = withQuery('/api/admin/leads', {
      limit: 300,
      status: leadFilters.status,
      search: leadFilters.search
    });

    const res = await adminFetch(endpoint, { headers: authHeaders() });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to load leads', 'error');
      return;
    }

    leads = Array.isArray(data.leads) ? data.leads : [];
    renderLeads();

    if (force) showToast('Leads refreshed', 'info');
  } catch (e) {
    showToast('Failed to load leads', 'error');
  }
}

function onLeadFiltersChanged() {
  const searchInput = document.getElementById('leadSearchInput');
  const statusSelect = document.getElementById('leadStatusFilter');

  leadFilters.search = searchInput ? searchInput.value.trim() : '';
  leadFilters.status = statusSelect ? statusSelect.value : 'all';

  clearTimeout(leadSearchTimer);
  leadSearchTimer = setTimeout(() => loadLeads(false), 250);
}

function renderLeads() {
  const root = document.getElementById('leadsList');
  if (!root) return;

  if (!leads.length) {
    root.innerHTML = '<div class="empty-state"><p>No leads found for current filters.</p></div>';
    return;
  }

  root.innerHTML = leads.map((lead) => {
    const statusOptions = BOOKING_STATUSES
      .map((status) => `<option value="${esc(status)}" ${status === lead.status ? 'selected' : ''}>${esc(status)}</option>`)
      .join('');

    return `
      <div class="admin-list-item">
        <div class="admin-list-head">
          <strong>${esc(lead.name || '-')}</strong>
          ${statusPill(lead.status)}
        </div>
        <div class="admin-meta">${esc(lead.email || '-')}
${esc(lead.phone || '-')}
Service: ${esc(lead.service || '-')}
Created: ${esc(formatDateTime(lead.createdAt))}</div>
        ${lead.message ? `<div class="admin-meta">${esc(truncateText(lead.message, 320))}</div>` : ''}
        <div class="admin-toolbar" style="margin-bottom:0;">
          <select onchange="updateLeadStatus(${Number(lead.id)}, this.value)">${statusOptions}</select>
        </div>
      </div>
    `;
  }).join('');
}

async function updateLeadStatus(leadId, status) {
  try {
    const res = await adminFetch(`/api/admin/bookings/${leadId}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to update lead status', 'error');
      return;
    }

    leads = leads.map((item) => (Number(item.id) === Number(leadId) ? { ...item, status: data.booking.status } : item));
    renderLeads();
    showToast('Lead status updated', 'success');
  } catch (e) {
    showToast('Failed to update lead status', 'error');
  }
}

// ================================================================
// CHATS
// ================================================================
async function loadChats(force) {
  try {
    const endpoint = withQuery('/api/admin/chats', {
      limit: 200,
      status: chatFilters.status,
      search: chatFilters.search
    });

    const res = await adminFetch(endpoint, { headers: authHeaders() });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to load chats', 'error');
      return;
    }

    chats = Array.isArray(data.chats) ? data.chats : [];
    renderChats();

    if (activeChat && activeChat.id) {
      const refreshed = chats.find((item) => Number(item.id) === Number(activeChat.id));
      if (refreshed) {
        activeChat = refreshed;
      }
    }

    if (force) showToast('Chats refreshed', 'info');
  } catch (e) {
    showToast('Failed to load chats', 'error');
  }
}

function onChatFiltersChanged() {
  const searchInput = document.getElementById('chatSearchInput');
  const statusSelect = document.getElementById('chatStatusFilter');

  chatFilters.search = searchInput ? searchInput.value.trim() : '';
  chatFilters.status = statusSelect ? statusSelect.value : 'all';

  clearTimeout(chatSearchTimer);
  chatSearchTimer = setTimeout(() => loadChats(false), 250);
}

function renderChats() {
  const root = document.getElementById('chatsList');
  if (!root) return;

  if (!chats.length) {
    root.innerHTML = '<div class="empty-state"><p>No chats found for current filters.</p></div>';
    return;
  }

  root.innerHTML = chats.map((chat) => {
    const statusOptions = CHAT_STATUSES
      .map((status) => `<option value="${esc(status)}" ${status === chat.leadStatus ? 'selected' : ''}>${esc(status)}</option>`)
      .join('');

    const leadMeta = [
      chat.lead && chat.lead.name ? `Lead: ${chat.lead.name}` : '',
      chat.lead && chat.lead.email ? chat.lead.email : '',
      chat.lead && chat.lead.phone ? chat.lead.phone : '',
      chat.lead && chat.lead.service ? `Service: ${chat.lead.service}` : ''
    ].filter(Boolean).join('\n');

    const lastMessage = chat.lastMessage && chat.lastMessage.content ? truncateText(chat.lastMessage.content, 220) : '';

    return `
      <div class="admin-list-item">
        <div class="admin-list-head">
          <strong>Session ${esc(chat.sessionId || String(chat.id))}</strong>
          ${statusPill(chat.leadStatus)}
        </div>
        <div class="admin-meta">${esc(leadMeta || 'No lead data yet')}
Messages: ${esc(String(chat.messageCount || 0))}
Updated: ${esc(formatDateTime(chat.updatedAt))}</div>
        ${lastMessage ? `<div class="admin-meta">Last: ${esc(lastMessage)}</div>` : ''}
        <div class="admin-toolbar" style="margin-bottom:0;">
          <select id="chat-status-${Number(chat.id)}">${statusOptions}</select>
          <button class="btn btn-secondary btn-sm" onclick="saveInlineChatStatus(${Number(chat.id)})">Save</button>
          <button class="btn btn-primary btn-sm" onclick="openChatViewer(${Number(chat.id)})">Open Chat</button>
        </div>
      </div>
    `;
  }).join('');
}

async function updateChatStatus(chatId, status, silent) {
  try {
    const res = await adminFetch(`/api/admin/chats/${chatId}/status`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status })
    });

    const data = await res.json();
    if (!res.ok) {
      if (!silent) showToast(data.error || 'Failed to update chat status', 'error');
      return false;
    }

    chats = chats.map((item) => (Number(item.id) === Number(chatId) ? { ...item, leadStatus: status } : item));
    if (activeChat && Number(activeChat.id) === Number(chatId)) {
      activeChat = { ...activeChat, leadStatus: status };
    }

    renderChats();
    if (!silent) showToast('Chat status updated', 'success');
    return true;
  } catch (e) {
    if (!silent) showToast('Failed to update chat status', 'error');
    return false;
  }
}

async function saveInlineChatStatus(chatId) {
  const select = document.getElementById(`chat-status-${chatId}`);
  if (!select) return;
  await updateChatStatus(chatId, select.value, false);
}

async function openChatViewer(chatId) {
  const chat = chats.find((item) => Number(item.id) === Number(chatId));
  if (!chat) {
    showToast('Chat not found', 'error');
    return;
  }

  activeChat = chat;

  const meta = document.getElementById('chatViewerMeta');
  const statusSelect = document.getElementById('chatViewerStatus');
  const transcript = document.getElementById('chatTranscript');

  if (meta) {
    const leadText = [
      chat.lead && chat.lead.name ? `Lead: ${chat.lead.name}` : 'Lead: -',
      chat.lead && chat.lead.email ? `Email: ${chat.lead.email}` : 'Email: -',
      chat.lead && chat.lead.phone ? `Phone: ${chat.lead.phone}` : 'Phone: -',
      chat.lead && chat.lead.service ? `Service: ${chat.lead.service}` : 'Service: -',
      `Session: ${chat.sessionId || chat.id}`,
      `Updated: ${formatDateTime(chat.updatedAt)}`
    ].join('\n');

    meta.textContent = leadText;
  }

  if (statusSelect) {
    statusSelect.value = CHAT_STATUSES.includes(chat.leadStatus) ? chat.leadStatus : 'open';
  }

  if (transcript) {
    transcript.innerHTML = '<div class="admin-meta">Loading messages...</div>';
  }

  openAdminModal('chatViewerModal');

  try {
    const res = await adminFetch(`/api/admin/chats/${chatId}/messages?limit=400`, { headers: authHeaders() });
    const data = await res.json();

    if (!res.ok) {
      if (transcript) transcript.innerHTML = `<div class="admin-meta">${esc(data.error || 'Failed to load chat messages')}</div>`;
      return;
    }

    const messages = Array.isArray(data.messages) ? data.messages : [];
    renderChatTranscript(messages);
  } catch (e) {
    if (transcript) transcript.innerHTML = '<div class="admin-meta">Failed to load chat messages</div>';
  }
}

function renderChatTranscript(messages) {
  const transcript = document.getElementById('chatTranscript');
  if (!transcript) return;

  if (!messages.length) {
    transcript.innerHTML = '<div class="admin-meta">No messages in this chat yet.</div>';
    return;
  }

  transcript.innerHTML = messages.map((message) => {
    const role = String(message.role || '').toLowerCase() === 'assistant' ? 'assistant' : 'user';
    return `
      <div class="chat-bubble ${role}">
        <div class="chat-bubble-meta">${esc(role)} · ${esc(formatDateTime(message.createdAt))}</div>
        ${esc(message.content || '')}
      </div>
    `;
  }).join('');

  transcript.scrollTop = transcript.scrollHeight;
}

async function saveActiveChatStatus() {
  if (!activeChat) return;
  const select = document.getElementById('chatViewerStatus');
  if (!select) return;

  const ok = await updateChatStatus(activeChat.id, select.value, false);
  if (ok) {
    const updated = chats.find((item) => Number(item.id) === Number(activeChat.id));
    if (updated) activeChat = updated;
  }
}

// ================================================================
// CHATBOT KNOWLEDGE BASE
// ================================================================
async function loadChatbotKnowledge(force) {
  try {
    const res = await adminFetch('/api/admin/chatbot-knowledge', { headers: authHeaders() });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to load chatbot knowledge', 'error');
      return;
    }

    const input = document.getElementById('chatbotKnowledgeInput');
    const source = document.getElementById('kbSourceLabel');

    if (input) input.value = data.text || '';
    if (source) source.textContent = `Source: ${data.source || 'unknown'}`;

    if (force) showToast('Knowledge base loaded', 'info');
  } catch (e) {
    showToast('Failed to load chatbot knowledge', 'error');
  }
}

async function saveChatbotKnowledge() {
  const input = document.getElementById('chatbotKnowledgeInput');
  if (!input) return;

  try {
    const res = await adminFetch('/api/admin/chatbot-knowledge', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ text: input.value })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to save chatbot knowledge', 'error');
      return;
    }

    showToast('Knowledge base saved', 'success');
    loadChatbotKnowledge(false);
  } catch (e) {
    showToast('Failed to save chatbot knowledge', 'error');
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

  // Initialize filter UI state
  const leadStatusSelect = document.getElementById('leadStatusFilter');
  const chatStatusSelect = document.getElementById('chatStatusFilter');
  if (leadStatusSelect) leadStatusSelect.value = leadFilters.status;
  if (chatStatusSelect) chatStatusSelect.value = chatFilters.status;

  // Load all data
  loadTestimonials();
  loadPrograms();
  loadServices();
  loadLeads(false);
  loadChats(false);
  loadChatbotKnowledge(false);
}

document.addEventListener('DOMContentLoaded', initAdmin);
