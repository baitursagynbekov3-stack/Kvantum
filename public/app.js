// ===== State =====
let currentUser = null;
let authToken = null;
let currentPayment = null;
let currentLang = localStorage.getItem('quantum_lang') || 'en';
let adminOverviewData = null;
let adminFilters = {
  search: '',
  bookingStatus: 'all'
};

// Use external API in static hosting (GitHub Pages) via public/config.js
const API_BASE_URL = (window.QUANTUM_API_BASE_URL || '').trim().replace(/\/$/, '');
const USE_DEMO_API = window.QUANTUM_USE_DEMO_API === true || (!API_BASE_URL && window.location.hostname.endsWith('github.io'));
const GOOGLE_CLIENT_ID = (window.QUANTUM_GOOGLE_CLIENT_ID || '').trim();
const TURNSTILE_SITE_KEY = (window.QUANTUM_TURNSTILE_SITE_KEY || '').trim();
const CHAT_SESSION_STORAGE_KEY = 'quantum_chat_session_id';
const turnstileWidgetByForm = new WeakMap();
let turnstileScriptPromise = null;
const chatSessionIdCache = Object.create(null);

function getChatIdentityKey() {
  if (currentUser && typeof currentUser === 'object') {
    if (currentUser.id !== undefined && currentUser.id !== null) {
      return 'user_' + String(currentUser.id);
    }

    if (currentUser.email) {
      return 'email_' + String(currentUser.email).trim().toLowerCase();
    }
  }

  try {
    const storedUser = localStorage.getItem('quantum_user');
    if (storedUser) {
      const parsedUser = JSON.parse(storedUser);
      if (parsedUser && typeof parsedUser === 'object') {
        if (parsedUser.id !== undefined && parsedUser.id !== null) {
          return 'user_' + String(parsedUser.id);
        }

        if (parsedUser.email) {
          return 'email_' + String(parsedUser.email).trim().toLowerCase();
        }
      }
    }
  } catch (err) {
    // Ignore parsing/storage errors and fallback to guest identity.
  }

  return 'guest';
}

function getChatSessionStorageKey() {
  return CHAT_SESSION_STORAGE_KEY + '_' + getChatIdentityKey();
}

// Kompot.ai CRM webhook — fire-and-forget, never blocks UI
function sendToKompotCRM(data) {
  fetch('https://kompot.ai/api/ws/konton/workflows/webhook/6sl6qjjfac', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: data.name || '',
      email: data.email || '',
      phone: data.phone || '',
      source: data.source || 'website',
      service: data.service || ''
    })
  }).catch(() => {});
}

function buildApiUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  return API_BASE_URL ? API_BASE_URL + normalizedPath : normalizedPath;
}

function loadTurnstileScript() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('window is not available'));
  }

  if (!TURNSTILE_SITE_KEY) {
    return Promise.resolve(null);
  }

  if (window.turnstile && typeof window.turnstile.render === 'function') {
    return Promise.resolve(window.turnstile);
  }

  if (turnstileScriptPromise) {
    return turnstileScriptPromise;
  }

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[data-turnstile-script="1"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.turnstile || null), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Turnstile script')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset.turnstileScript = '1';
    script.onload = () => resolve(window.turnstile || null);
    script.onerror = () => reject(new Error('Failed to load Turnstile script'));
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
}

function resetTurnstileForForm(form) {
  if (!form || !window.turnstile || typeof window.turnstile.reset !== 'function') return;

  const widgetId = turnstileWidgetByForm.get(form);
  if (widgetId !== undefined && widgetId !== null) {
    window.turnstile.reset(widgetId);
  }
}

function initTurnstileWidgets() {
  if (!TURNSTILE_SITE_KEY) return;

  const widgets = Array.from(document.querySelectorAll('[data-turnstile-widget]'));
  if (!widgets.length) return;

  loadTurnstileScript()
    .then((turnstile) => {
      if (!turnstile || typeof turnstile.render !== 'function') {
        return;
      }

      widgets.forEach((widgetEl) => {
        if (!widgetEl || widgetEl.dataset.turnstileRendered === '1') return;

        const form = widgetEl.closest('form');
        try {
          const widgetId = turnstile.render(widgetEl, {
            sitekey: TURNSTILE_SITE_KEY,
            theme: 'light'
          });
          widgetEl.dataset.turnstileRendered = '1';
          if (form) {
            turnstileWidgetByForm.set(form, widgetId);
          }
        } catch (err) {
          console.error('[turnstile] render failed:', err && err.message ? err.message : err);
        }
      });
    })
    .catch((err) => {
      console.error('[turnstile] load failed:', err && err.message ? err.message : err);
    });
}

function generateChatSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function getChatSessionId() {
  const storageKey = getChatSessionStorageKey();

  if (chatSessionIdCache[storageKey]) {
    return chatSessionIdCache[storageKey];
  }

  try {
    const existing = localStorage.getItem(storageKey);
    if (existing && /^[A-Za-z0-9_-]{8,80}$/.test(existing)) {
      chatSessionIdCache[storageKey] = existing;
      return chatSessionIdCache[storageKey];
    }

    // One-time migration from legacy key used before per-user chat sessions.
    const legacyKey = CHAT_SESSION_STORAGE_KEY;
    const legacy = localStorage.getItem(legacyKey);
    if (legacy && /^[A-Za-z0-9_-]{8,80}$/.test(legacy) && storageKey.endsWith('_guest')) {
      localStorage.setItem(storageKey, legacy);
      chatSessionIdCache[storageKey] = legacy;
      return chatSessionIdCache[storageKey];
    }

    const created = generateChatSessionId().slice(0, 80);
    localStorage.setItem(storageKey, created);
    chatSessionIdCache[storageKey] = created;
    return chatSessionIdCache[storageKey];
  } catch (err) {
    chatSessionIdCache[storageKey] = generateChatSessionId().slice(0, 80);
    return chatSessionIdCache[storageKey];
  }
}

function isValidEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function isStrongPassword(value) {
  const password = String(value || '');
  return password.length >= 8 && /[a-z]/i.test(password) && /\d/.test(password);
}

function normalizePhone(value, countryCode) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  let phone = raw.replace(/[^\d+]/g, '');
  if (phone.startsWith('00')) {
    phone = '+' + phone.slice(2);
  }

  // If phone doesn't start with '+', prepend the country code
  if (!phone.startsWith('+')) {
    const code = String(countryCode || '+996').replace(/[^\d+]/g, '');
    phone = code + phone;
  }

  if (!phone.startsWith('+')) {
    return '';
  }

  const digits = phone.slice(1).replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return '';
  return '+' + digits;
}

function parseJsonBody(options) {
  if (!options || !options.body) return {};
  try {
    return JSON.parse(options.body);
  } catch (err) {
    return {};
  }
}

function readHeader(headers, key) {
  if (!headers) return '';
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get(key) || headers.get(key.toLowerCase()) || '';
  }
  return headers[key] || headers[key.toLowerCase()] || '';
}

function getStorageArray(key) {
  try {
    const value = localStorage.getItem(key);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function setStorageArray(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function createApiResponse(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return data;
    }
  };
}

function demoApi(path, options) {
  const body = parseJsonBody(options);
  const usersKey = 'quantum_demo_users';
  const bookingsKey = 'quantum_demo_bookings';
  const paymentsKey = 'quantum_demo_payments';

  if (path === '/api/health') {
    return createApiResponse(200, { ok: true, demo: true });
  }


  if (path === '/api/register') {
    const name = (body.name || '').trim();
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';
    const phone = normalizePhone(body.phone);

    if (!name || !email || !password || !phone) {
      return createApiResponse(400, { error: 'Name, valid email, password and phone with country code are required' });
    }

    if (!isValidEmail(email)) {
      return createApiResponse(400, { error: 'Invalid email format' });
    }

    if (!isStrongPassword(password)) {
      return createApiResponse(400, { error: 'Password must be at least 8 characters and include letters and numbers' });
    }

    const users = getStorageArray(usersKey);
    if (users.some((u) => u.email === email)) {
      return createApiResponse(400, { error: 'User already exists' });
    }

    const demoAdmins = (window.QUANTUM_DEMO_ADMIN_EMAILS || []).map(e => e.toLowerCase());
    const role = demoAdmins.includes(email) ? 'admin' : 'user';
    const user = {
      id: Date.now(),
      name,
      email,
      phone,
      password,
      role,
      createdAt: new Date().toISOString()
    };

    users.push(user);
    setStorageArray(usersKey, users);

    const token = 'demo-' + btoa(email + ':' + Date.now());
    return createApiResponse(200, {
      message: 'Registration successful (demo mode)',
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  }

  if (path === '/api/login') {
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';
    const users = getStorageArray(usersKey);
    const user = users.find((u) => u.email === email);

    if (!user || user.password !== password) {
      return createApiResponse(400, { error: 'Invalid credentials' });
    }

    const token = 'demo-' + btoa(email + ':' + Date.now());
    return createApiResponse(200, {
      message: 'Login successful (demo mode)',
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role || 'user' }
    });
  }

  if (path === '/api/reset-password/request-code') {
    const email = (body.email || '').trim().toLowerCase();
    const phone = normalizePhone(body.phone);

    if (!email || !phone || !isValidEmail(email)) {
      return createApiResponse(400, { error: 'Valid email and phone are required' });
    }

    const users = getStorageArray(usersKey);
    const user = users.find((u) => u.email === email && normalizePhone(u.phone) === phone);
    const generic = { message: 'If this account exists, verification code has been sent. (demo mode)' };

    if (!user) {
      return createApiResponse(200, generic);
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const key = email + '|' + phone;

    let challenges = {};
    try {
      const raw = localStorage.getItem('quantum_demo_reset_codes');
      challenges = raw ? JSON.parse(raw) : {};
    } catch (err) {
      challenges = {};
    }

    challenges[key] = {
      code,
      expiresAt: Date.now() + 10 * 60 * 1000,
      attemptsLeft: 5
    };
    localStorage.setItem('quantum_demo_reset_codes', JSON.stringify(challenges));

    return createApiResponse(200, {
      message: 'Verification code generated (demo mode)',
      devCode: code,
      expiresInSec: 600
    });
  }

  if (path === '/api/reset-password') {
    const email = (body.email || '').trim().toLowerCase();
    const phone = normalizePhone(body.phone);
    const newPassword = body.newPassword || '';
    const resetCode = String(body.resetCode || '').trim();

    if (!email || !phone || !newPassword || !resetCode) {
      return createApiResponse(400, { error: 'Email, phone, reset code and new password are required' });
    }

    if (String(newPassword).length < 8 || !/[a-z]/i.test(newPassword) || !/\d/.test(newPassword)) {
      return createApiResponse(400, { error: 'Password must be at least 8 characters and include letters and numbers' });
    }

    const users = getStorageArray(usersKey);
    const index = users.findIndex((u) => {
      const userPhone = normalizePhone(u.phone);
      return u.email === email && userPhone && userPhone === phone;
    });

    if (index === -1) {
      return createApiResponse(400, { error: 'Invalid reset request' });
    }

    let challenges = {};
    try {
      const raw = localStorage.getItem('quantum_demo_reset_codes');
      challenges = raw ? JSON.parse(raw) : {};
    } catch (err) {
      challenges = {};
    }

    const key = email + '|' + phone;
    const challenge = challenges[key];

    if (!challenge || Date.now() > Number(challenge.expiresAt || 0)) {
      delete challenges[key];
      localStorage.setItem('quantum_demo_reset_codes', JSON.stringify(challenges));
      return createApiResponse(400, { error: 'Invalid or expired verification code' });
    }

    challenge.attemptsLeft = Number(challenge.attemptsLeft || 0) - 1;
    if (challenge.code !== resetCode) {
      if (challenge.attemptsLeft <= 0) {
        delete challenges[key];
      } else {
        challenges[key] = challenge;
      }
      localStorage.setItem('quantum_demo_reset_codes', JSON.stringify(challenges));
      return createApiResponse(400, { error: 'Invalid or expired verification code' });
    }

    delete challenges[key];
    localStorage.setItem('quantum_demo_reset_codes', JSON.stringify(challenges));

    users[index].password = String(newPassword);
    setStorageArray(usersKey, users);

    return createApiResponse(200, { message: 'Password reset successful (demo mode)' });
  }

  if (path === '/api/book-consultation') {
    const name = (body.name || '').trim();
    const email = (body.email || '').trim().toLowerCase();
    const phone = normalizePhone(body.phone);

    if (!name || !email || !phone) {
      return createApiResponse(400, { error: 'Name, valid email and phone with country code are required' });
    }

    if (!isValidEmail(email)) {
      return createApiResponse(400, { error: 'Invalid email format' });
    }

    const bookings = getStorageArray(bookingsKey);
    const booking = {
      id: bookings.length + 1,
      name,
      email,
      phone,
      service: body.service || 'consultation',
      message: body.message || '',
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    bookings.push(booking);
    setStorageArray(bookingsKey, bookings);

    return createApiResponse(200, {
      message: 'Consultation booked successfully (demo mode)',
      booking: { id: booking.id, status: booking.status }
    });
  }

  if (path === '/api/payment') {
    const auth = readHeader(options && options.headers, 'Authorization');
    if (!auth || !auth.startsWith('Bearer demo-')) {
      return createApiResponse(401, { error: 'Access denied' });
    }

    const payments = getStorageArray(paymentsKey);
    const payment = {
      id: 'PAY-' + Date.now(),
      productId: body.productId,
      productName: body.productName,
      amount: body.amount,
      currency: body.currency || 'KGS',
      status: 'completed',
      createdAt: new Date().toISOString()
    };
    payments.push(payment);
    setStorageArray(paymentsKey, payments);

    return createApiResponse(200, {
      message: 'Payment processed successfully (demo mode)',
      payment: {
        id: payment.id,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency
      },
      notification: 'Demo mode notification sent'
    });
  }

  if (path.startsWith('/api/admin/overview')) {
    const auth = readHeader(options && options.headers, 'Authorization');
    if (!auth || !auth.startsWith('Bearer demo-')) {
      return createApiResponse(401, { error: 'Access denied' });
    }

    const users = getStorageArray(usersKey)
      .map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        createdAt: user.createdAt || new Date().toISOString()
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const bookings = getStorageArray(bookingsKey)
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const payments = getStorageArray(paymentsKey)
      .map((payment) => ({
        ...payment,
        user: null
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return createApiResponse(200, {
      totals: {
        users: users.length,
        bookings: bookings.length,
        payments: payments.length
      },
      users: users.slice(0, 200),
      bookings: bookings.slice(0, 200),
      payments: payments.slice(0, 200)
    });
  }

  if (path.startsWith('/api/admin/bookings/') && String((options && options.method) || 'GET').toUpperCase() === 'PATCH') {
    const auth = readHeader(options && options.headers, 'Authorization');
    if (!auth || !auth.startsWith('Bearer demo-')) {
      return createApiResponse(401, { error: 'Access denied' });
    }

    const bookingId = Number(path.split('?')[0].split('/').pop());
    const status = String(body.status || '').trim().toLowerCase();
    const note = String(body.note || '').trim();
    const allowedStatuses = ['pending', 'new', 'in_progress', 'done', 'cancelled'];

    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return createApiResponse(400, { error: 'Invalid booking id' });
    }

    if (!allowedStatuses.includes(status)) {
      return createApiResponse(400, { error: 'Invalid booking status' });
    }

    const bookings = getStorageArray(bookingsKey);
    const index = bookings.findIndex((booking) => Number(booking.id) === bookingId);

    if (index === -1) {
      return createApiResponse(404, { error: 'Booking not found' });
    }

    const existingMessage = String(bookings[index].message || '');
    const nextMessage = note
      ? (existingMessage ? `${existingMessage}
[ADMIN ${new Date().toISOString()}] ${note}` : `[ADMIN ${new Date().toISOString()}] ${note}`)
      : existingMessage;

    bookings[index] = {
      ...bookings[index],
      status,
      message: nextMessage
    };

    setStorageArray(bookingsKey, bookings);

    return createApiResponse(200, {
      message: 'Booking updated successfully (demo mode)',
      booking: bookings[index]
    });
  }

  if (path === '/api/notify') {
    return createApiResponse(200, { message: 'Notification sent (demo mode)' });
  }

  if (path === '/api/chat') {
    const text = (body.message || '').toString().trim();
    const reply = text
      ? 'Demo mode: thank you for your message. Backend chat will work after API deployment.'
      : 'Demo mode: ask me anything about programs.';
    return createApiResponse(200, { reply });
  }

  // ===== Demo content endpoints =====
  const testimonialsKey = 'quantum_demo_testimonials';
  const programsKey = 'quantum_demo_programs';
  const servicesDataKey = 'quantum_demo_services';

  if (path === '/api/content/testimonials') {
    return createApiResponse(200, getStorageArray(testimonialsKey));
  }
  if (path === '/api/content/programs') {
    return createApiResponse(200, getStorageArray(programsKey));
  }
  if (path === '/api/services' && (!options || !options.method || options.method === 'GET')) {
    return createApiResponse(200, getStorageArray(servicesDataKey));
  }

  // ===== Demo admin endpoints =====
  const method = (options && options.method || 'GET').toUpperCase();
  const auth = readHeader(options && options.headers, 'Authorization');

  function getDemoUserRole() {
    if (!auth || !auth.startsWith('Bearer demo-')) return null;
    try {
      const decoded = atob(auth.replace('Bearer demo-', ''));
      const email = decoded.split(':')[0];
      const users = getStorageArray(usersKey);
      const user = users.find(u => u.email === email);
      return user ? (user.role || 'user') : 'user';
    } catch (e) { return 'user'; }
  }

  if (path === '/api/admin/check') {
    const role = getDemoUserRole();
    if (role !== 'admin') return createApiResponse(403, { error: 'Admin access required' });
    return createApiResponse(200, { isAdmin: true });
  }

  // Admin CRUD helper
  function adminCrud(storageKey, idPrefix) {
    const role = getDemoUserRole();
    if (role !== 'admin') return createApiResponse(403, { error: 'Admin access required' });
    const items = getStorageArray(storageKey);

    if (method === 'GET') return createApiResponse(200, items);
    if (method === 'POST') {
      const item = { _id: idPrefix + Date.now(), ...body, order: items.length + 1 };
      items.push(item);
      setStorageArray(storageKey, items);
      return createApiResponse(201, item);
    }
    return createApiResponse(404, { error: 'Not found' });
  }

  if (path === '/api/admin/testimonials') return adminCrud(testimonialsKey, 'dt');
  if (path === '/api/admin/programs') return adminCrud(programsKey, 'dp');
  if (path === '/api/admin/services') return adminCrud(servicesDataKey, 'ds');

  // Admin CRUD with ID parameter
  const adminMatch = path.match(/^\/api\/admin\/(testimonials|programs|services)\/(.+)$/);
  if (adminMatch) {
    const role = getDemoUserRole();
    if (role !== 'admin') return createApiResponse(403, { error: 'Admin access required' });
    const type = adminMatch[1];
    const id = adminMatch[2];
    const keyMap = { testimonials: testimonialsKey, programs: programsKey, services: servicesDataKey };
    const storageKey = keyMap[type];
    let items = getStorageArray(storageKey);
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

  return createApiResponse(404, { error: 'Endpoint not available in demo mode' });
}

function apiFetch(path, options) {
  const normalizedPath = path.startsWith('/') ? path : '/' + path;

  if (API_BASE_URL) {
    return fetch(buildApiUrl(normalizedPath), options);
  }

  if (USE_DEMO_API) {
    return Promise.resolve(demoApi(normalizedPath, options));
  }

  return fetch(normalizedPath, options);
}

// ===== Translations =====
const translations = {
  ru: {
    'logo.icon': 'К',
    'logo.text': 'КВАНТУМ',
    'nav.about': 'О нас',
    'nav.services': 'Услуги',
    'nav.programs': 'Программы',
    'nav.testimonials': 'Отзывы',
    'nav.contact': 'Контакты',
    'nav.login': 'Войти',
    'nav.consult': 'Начать',
    'hero.badge': 'Работа с подсознанием и квантовым полем',
    'hero.title': 'Трансформируйте<br><span class="text-gradient">Внутреннюю Реальность</span><br>Постройте Жизнь Мечты',
    'hero.description': 'КВАНТУМ от Алтынай Эшинбековой — специалист по работе с подсознанием и квантовым полем. Мастер НЛП. Трансформируйте мысли, чувства и состояние — трансформируйте жизнь, отношения и финансы.',
    'hero.cta': 'Записаться на консультацию',
    'hero.programs': 'Смотреть программы',
    'stats.clients': 'Клиентов трансформировано',
    'stats.satisfaction': 'Удовлетворённость клиентов',
    'stats.years': 'Лет опыта',
    'stats.growth': 'Средний рост',
    'about.label': 'Об основателе',
    'about.title': 'Алтынай Эшинбекова — <span class="text-gradient">Ваш проводник к трансформации</span>',
    'about.text': 'Я работаю глубоко, экологично и с реальным результатом. Я лично сопровождаю каждого клиента к его цели. Мой подход сочетает работу с подсознанием, выравнивание энергетического поля и развитие состояния лидера.',
    'about.cred1.title': 'Специалист по подсознанию и квантовому полю',
    'about.cred2.title': 'Мастер НЛП',
    'about.cred3.title': 'Мастер глубинных разборов',
    'about.quote': '«Вы в нужном месте и в нужное время.»',
    'work.label': 'Что мы делаем',
    'work.title': 'Как мы <span class="text-gradient">работаем</span>',
    'work.subtitle': 'Работаем индивидуально и в группе — глубоко, экологично, с реальным результатом',
    'work.card1.title': 'Подсознание',
    'work.card1.desc': 'Глубокая работа с паттернами подсознания, убеждениями и ментальными блоками',
    'work.card2.title': 'Энергетическое поле',
    'work.card2.desc': 'Выравнивание и усиление вашего энергетического поля для привлечения желаемого',
    'work.card3.title': 'Состояние лидера',
    'work.card3.desc': 'Развитие внутреннего состояния лидера для роста бизнеса и личного мастерства',
    'work.card4.title': 'Сопровождаем до результата',
    'work.card4.desc': 'Личное сопровождение до достижения ваших целей — мы не просто учим, мы идём с вами',
    'services.title': 'Индивидуальная работа',
    'services.s1.title': 'Консультации',
    'services.s1.desc': 'Индивидуальные сессии для диагностики текущего состояния и определения пути вперёд',
    'services.s2.title': 'Трансформационные сессии',
    'services.s2.desc': 'Глубокая трансформационная работа с мыслями, чувствами и внутренними состояниями',
    'services.s3.title': 'Сопровождение к цели',
    'services.s3.desc': 'Индивидуальная поддержка на пути к вашим личным или бизнес-целям',
    'services.book': 'Записаться',
    'programs.label': 'Наши программы',
    'programs.title': 'Выберите путь к <span class="text-gradient">трансформации</span>',
    'programs.subtitle': 'От начального уровня до элитного наставничества — найдите свою программу',
    'programs.bc.badge': 'Точка входа',
    'programs.bc.name': 'Зарядка мозга',
    'programs.bc.tagline': 'Перепрограммирование реальности',
    'programs.bc.currency': 'сом / рублей',
    'programs.bc.f1': 'Программа 21 день',
    'programs.bc.f2': '15 минут в день',
    'programs.bc.f3': 'Сессии в 6:00 утра (КР)',
    'programs.bc.f4': 'Работа с мыслями и чувствами',
    'programs.bc.f5': 'Трансформация состояния',
    'programs.bc.f6': 'Изменения в жизни, отношениях и финансах',
    'programs.bc.btn': 'Начать',
    'programs.rc.name': 'Клуб «Ресурсы»',
    'programs.rc.tagline': 'Усиление состояния',
    'programs.rc.currency': 'сом / месяц',
    'programs.rc.f1': 'Программа 4 недели',
    'programs.rc.f2': '2 встречи с Алтынай',
    'programs.rc.f3': '2 встречи с куратором',
    'programs.rc.f4': 'Защищённость и уверенность',
    'programs.rc.f5': 'Ценность и любовь к себе',
    'programs.rc.f6': 'Свобода и внутренняя опора',
    'programs.rc.btn': 'Вступить в клуб',
    'programs.int.badge': 'Популярная',
    'programs.int.name': 'Интенсив «Папа, Мама»',
    'programs.int.tagline': 'Проработка корней',
    'programs.int.f1': '1 месяц, 10 уроков',
    'programs.int.f2': '20 практических упражнений',
    'programs.int.f3': '3 Zoom встречи',
    'programs.int.f4': 'Сепарация и независимость',
    'programs.int.f5': 'Выход из чужих сценариев',
    'programs.int.f6': 'Восстановление иерархии',
    'programs.int.f7': 'Снятие детских блоков',
    'programs.int.btn': 'Записаться',
    'programs.rb.badge': 'Премиум',
    'programs.rb.tagline': 'Осознанное управление реальностью',
    'programs.rb.f1': '8 недель, 24 встречи',
    'programs.rb.f2': '20 уроков и 20 практик',
    'programs.rb.f3': '1 встреча с Алтынай',
    'programs.rb.f4': '2 встречи с кураторами',
    'programs.rb.f5': 'Ценности и личные принципы',
    'programs.rb.f6': 'Управление состоянием',
    'programs.rb.f7': 'Отношения без зависимости',
    'programs.rb.f8': 'Финансы под вашим контролем',
    'programs.rb.btn': 'Трансформироваться',
    'programs.ms.badge': 'Элитная',
    'programs.ms.name': 'Наставничество',
    'programs.ms.tagline': 'Университет в самопознании',
    'programs.ms.price': 'Уточните',
    'programs.ms.currency': 'у менеджеров',
    'programs.ms.f1': 'Считывание поля',
    'programs.ms.f2': 'Эмоции и блоки подсознания',
    'programs.ms.f3': 'Работа с квантовым полем',
    'programs.ms.f4': '30 практик НЛП',
    'programs.ms.f5': 'Основы расстановок',
    'programs.ms.f6': 'Живая практика с кураторами',
    'programs.ms.f7': 'Полная передача знаний',
    'programs.ms.btn': 'Узнать подробнее',
    'testimonials.label': 'Отзывы',
    'testimonials.title': 'Что говорят наши <span class="text-gradient">клиенты</span>',
    'testimonials.t1.text': '«Всего за 21 день Зарядки мозга мой взгляд на жизнь полностью изменился. Мой доход вырос в 2 раза в следующем месяце.»',
    'testimonials.t1.role': 'Предприниматель',
    'testimonials.t2.text': '«Программа ПЕРЕЗАГРУЗКА полностью изменила то, как я справляюсь с отношениями и финансами. Я наконец чувствую контроль над своей жизнью.»',
    'testimonials.t2.role': 'Владелец бизнеса',
    'testimonials.t3.text': '«Работа с Алтынай через программу наставничества дала мне инструменты, которые я использую каждый день. Мой бизнес вырос в 3 раза за 6 месяцев.»',
    'testimonials.t3.role': 'Консультант',
    'cta.title': 'Готовы трансформировать реальность?',
    'cta.desc': 'Запишитесь на бесплатную консультацию и найдите свой путь к трансформации.',
    'cta.btn': 'Бесплатная консультация',
    'contact.label': 'Контакты',
    'contact.title': 'Свяжитесь <span class="text-gradient">с нами</span>',
    'contact.subtitle': 'Готовы начать трансформацию? Запишитесь на бесплатную консультацию.',
    'contact.form.name': 'Ваше имя',
    'contact.form.name_ph': 'Введите ваше имя',
    'contact.form.phone': 'Телефон (WhatsApp)',
    'contact.form.interest': 'Интересует',
    'contact.form.opt1': 'Бесплатная консультация',
    'contact.form.opt2': 'Зарядка мозга',
    'contact.form.opt3': 'Клуб «Ресурсы»',
    'contact.form.opt4': 'Интенсив «Папа, Мама»',
    'contact.form.opt6': 'Наставничество',
    'contact.form.message': 'Сообщение (необязательно)',
    'contact.form.message_ph': 'Расскажите о ваших целях...',
    'contact.form.submit': 'Отправить заявку',
    'contact.connect': 'Свяжитесь с нами',
    'contact.entry.title': 'Условия входа',
    'contact.entry.text': 'Вход в индивидуальную работу после <strong>бесплатной консультации</strong>. Беру не всех — мы обеспечиваем правильный подбор для обеих сторон.',
    'footer.desc': 'Переход в реальность мечты. Трансформируйте жизнь через работу с подсознанием, НЛП и мастерство квантового поля.',
    'footer.quick': 'Быстрые ссылки',
    'footer.intensive': 'Интенсив',
    'footer.copy': '© 2025 КВАНТУМ Алтынай Эшинбекова. Все права защищены.',
    'bonuses.b2.name': 'Клуб «Ресурсы»',
    'modal.login': 'Войти',
    'modal.register': 'Регистрация',
    'modal.welcome': 'С возвращением',
    'modal.password': 'Пароль',
    'modal.pass_ph': 'Введите пароль',
    'modal.phone_ph': '+1 555 123 4567',
    'modal.forgot': 'Забыли пароль?',
    'modal.remember_me': 'Запомнить меня',
    'reset.title': 'Восстановление пароля',
    'reset.desc': 'Введите email и телефон из регистрации. Мы установим новый пароль.',
    'reset.email': 'Email',
    'reset.phone': 'Телефон из регистрации',
    'reset.new_password': 'Новый пароль',
    'reset.new_password_ph': 'Минимум 8 символов',
    'reset.confirm_password': 'Повторите новый пароль',
    'reset.confirm_password_ph': 'Повторите пароль',
    'reset.submit': 'Сбросить пароль',
    'reset.back_login': 'Назад ко входу',
    'modal.no_account': 'Нет аккаунта? <a href="#" onclick="switchTab(\'register\')">Зарегистрируйтесь</a>',
    'modal.create': 'Создать аккаунт',
    'modal.fullname': 'Полное имя',
    'modal.fullname_ph': 'Ваше полное имя',
    'modal.create_pass_ph': 'Придумайте пароль',
    'modal.has_account': 'Уже есть аккаунт? <a href="#" onclick="switchTab(\'login\')">Войдите</a>',
    'modal.continue': 'Продолжить',
    'consult.title': 'Записаться на бесплатную консультацию',
    'consult.desc': 'Заполните данные, и мы свяжемся с вами через WhatsApp или Telegram.',
    'consult.phone': 'Телефон (WhatsApp/Telegram)',
    'consult.opt1': 'Общая консультация',
    'consult.preferred': 'Предпочтительный способ связи',
    'consult.submit': 'Записаться на консультацию',
    'payment.title': 'Завершить оплату',
    'payment.card': 'Номер карты',
    'payment.expiry': 'Срок',
    'payment.name': 'Имя на карте',
    'payment.confirm_via': 'Отправить подтверждение через:',
    'payment.both': 'Оба',
    'payment.pay': 'Оплатить',
    'payment.secure': '🔒 Безопасная оплата — Демо режим',
    'chat.name': 'Ассистент КВАНТУМ',
    'chat.online': 'В сети',
    'chat.welcome': 'Добро пожаловать в КВАНТУМ! Я ваш AI-ассистент. Я могу помочь с:<br><br>• Информация о программах и ценах<br>• Запись на бесплатную консультацию<br>• Узнать об услугах<br><br>Чем могу помочь?',
    'chat.qr1': 'Цены',
    'chat.qr2': 'Зарядка мозга',
    'chat.qr3': 'Записаться',
    'chat.placeholder': 'Введите сообщение...',
    'user.greeting': 'Привет, <strong id="userName">Пользователь</strong>',
    'user.profile': 'Мой профиль',
    'user.purchases': 'Мои покупки',
    'user.admin': 'Админ панель',
    'user.logout': 'Выйти',
    'profile.edit_title': 'Редактировать данные',
    'profile.save': 'Сохранить изменения',
    'profile.bookings_title': 'Мои записи',
    'profile.password_note': 'Для смены пароля воспользуйтесь функцией <a href="#" onclick="closeModal(\'profileModal\'); openModal(\'loginModal\');">Забыли пароль?</a> на экране входа.',
    'admin.title': 'Админ панель',
    'admin.desc': 'Последние регистрации, заявки и оплаты.',
    'admin.loading': 'Загрузка данных...',
  }
};

// ===== i18n Engine =====
function applyTranslations(lang) {
  if (lang === 'en') {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      if (el._originalText !== undefined) el.textContent = el._originalText;
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      if (el._originalHTML !== undefined) el.innerHTML = el._originalHTML;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      if (el._originalPlaceholder !== undefined) el.placeholder = el._originalPlaceholder;
    });
    document.documentElement.lang = 'en';
    return;
  }

  const dict = translations[lang];
  if (!dict) return;

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) {
      if (el._originalText === undefined) el._originalText = el.textContent;
      el.textContent = dict[key];
    }
  });

  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    if (dict[key]) {
      if (el._originalHTML === undefined) el._originalHTML = el.innerHTML;
      el.innerHTML = dict[key];
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (dict[key]) {
      if (el._originalPlaceholder === undefined) el._originalPlaceholder = el.placeholder;
      el.placeholder = dict[key];
    }
  });

  document.documentElement.lang = lang;
}

function storeOriginals() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el._originalText = el.textContent;
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el._originalHTML = el.innerHTML;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el._originalPlaceholder = el.placeholder;
  });
}

function toggleLanguage() {
  currentLang = currentLang === 'en' ? 'ru' : 'en';
  localStorage.setItem('quantum_lang', currentLang);
  applyTranslations(currentLang);
  updateLangButton();
  if (cachedTestimonials) renderTestimonials(cachedTestimonials);
  if (cachedPrograms) renderPrograms(cachedPrograms);
}

function updateLangButton() {
  const flag = document.getElementById('langFlag');
  if (flag) flag.textContent = currentLang === 'en' ? 'RU' : 'EN';
}

// ===== Dynamic Content =====
let cachedTestimonials = null;
let cachedPrograms = null;

async function loadSiteContent() {
  try {
    const [tRes, pRes] = await Promise.all([
      apiFetch('/api/content/testimonials'),
      apiFetch('/api/content/programs')
    ]);
    const testimonials = await tRes.json();
    const programs = await pRes.json();
    if (Array.isArray(testimonials) && testimonials.length > 0) {
      cachedTestimonials = testimonials;
      renderTestimonials(testimonials);
    }
    if (Array.isArray(programs) && programs.length > 0) {
      cachedPrograms = programs;
      renderPrograms(programs);
    }
  } catch (err) {
    // Fallback: keep hardcoded HTML
  }
}

function renderTestimonials(items) {
  const grid = document.querySelector('.testimonials-grid');
  if (!grid || !items.length) return;
  const lang = currentLang;
  grid.innerHTML = items.map(t => {
    const text = lang === 'ru' && t.text_ru ? t.text_ru : t.text;
    const role = lang === 'ru' && t.role_ru ? t.role_ru : t.role;
    const initial = t.authorInitial || (t.authorName || '?').charAt(0);
    return `<div class="testimonial-card anim-fade-up anim-visible">
      <div class="testimonial-quote">&ldquo;</div>
      <p>"${escapeHtml(text)}"</p>
      <div class="testimonial-author">
        <div class="author-avatar">${escapeHtml(initial)}</div>
        <div class="author-info">
          <strong>${escapeHtml(t.authorName)}</strong>
          <span>${escapeHtml(role)}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderPrograms(items) {
  const grid = document.querySelector('.pricing-grid');
  if (!grid || !items.length) return;
  const lang = currentLang;
  grid.innerHTML = items.map(p => {
    const name = lang === 'ru' && p.name_ru ? p.name_ru : p.name;
    const tagline = lang === 'ru' && p.tagline_ru ? p.tagline_ru : p.tagline;
    const tierLabel = lang === 'ru' && p.tierLabel_ru ? p.tierLabel_ru : p.tierLabel;
    const priceCurrency = lang === 'ru' && p.priceCurrency_ru ? p.priceCurrency_ru : p.priceCurrency;
    const priceAmount = lang === 'ru' && p.priceAmount_ru ? p.priceAmount_ru : p.priceAmount;
    const btnText = lang === 'ru' && p.buttonText_ru ? p.buttonText_ru : p.buttonText;
    const features = lang === 'ru' && p.features_ru && p.features_ru.length ? p.features_ru : (p.features || []);
    const cssClass = p.cssClass || '';
    const popularBadge = p.popular ? `<div class="pricing-popular-badge">${lang === 'ru' ? tierLabel : tierLabel}</div>` : '';
    const tierBadge = !p.popular && tierLabel ? `<div class="pricing-tier">${escapeHtml(tierLabel)}</div>` : '';

    let btnHtml;
    if (p.actionType === 'consult') {
      btnHtml = `<button class="btn btn-primary btn-block" onclick="openModal('consultModal')">${escapeHtml(btnText)}</button>`;
    } else {
      btnHtml = `<button class="btn btn-primary btn-block" onclick="handlePurchase('${escapeHtml(p._id || p.id)}', '${escapeHtml(p.name)}', ${p.priceNumeric || 0}, '${escapeHtml(p.purchaseCurrency || 'KGS')}')">${escapeHtml(btnText)}</button>`;
    }

    return `<div class="pricing-card anim-fade-up anim-visible ${cssClass}" data-tier="${escapeHtml(p.tier || '')}">
      ${popularBadge}${tierBadge}
      <h3 class="pricing-name">${escapeHtml(name)}</h3>
      <p class="pricing-tagline">${escapeHtml(tagline)}</p>
      <div class="pricing-price">
        <span class="price-amount">${escapeHtml(priceAmount)}</span>
        <span class="price-currency">${escapeHtml(priceCurrency)}</span>
      </div>
      <ul class="pricing-features">
        ${features.map(f => `<li>${escapeHtml(f)}</li>`).join('')}
      </ul>
      ${btnHtml}
    </div>`;
  }).join('');
}

// ===== Dark Mode =====
function toggleDarkMode() {
  document.body.classList.toggle('dark-mode');
  const isDark = document.body.classList.contains('dark-mode');
  localStorage.setItem('quantum_dark', isDark ? 'true' : 'false');
}

function initDarkMode() {
  if (localStorage.getItem('quantum_dark') === 'true') {
    document.body.classList.add('dark-mode');
  }
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  initDarkMode();
  storeOriginals();
  initNavbar();
  initScrollAnimations();
  initCounterAnimations();
  checkAuth();
  updateLangButton();
  if (currentLang !== 'en') applyTranslations(currentLang);
  loadSiteContent();
  initTurnstileWidgets();

  // Trigger hero animations immediately
  setTimeout(() => {
    document.querySelectorAll('.hero .anim-fade-up').forEach(el => {
      el.classList.add('anim-visible');
    });
  }, 100);
});

// ===== Navbar =====
function initNavbar() {
  let lastScroll = 0;
  window.addEventListener('scroll', () => {
    const navbar = document.getElementById('navbar');
    const scrollY = window.scrollY;

    if (scrollY > 50) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
    lastScroll = scrollY;
  });

  // Smooth scroll for nav links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        const navHeight = document.getElementById('navbar').offsetHeight;
        const targetPos = target.getBoundingClientRect().top + window.scrollY - navHeight;
        window.scrollTo({ top: targetPos, behavior: 'smooth' });

        // Close mobile menu
        document.getElementById('navLinks').classList.remove('active');
      }
    });
  });
}

function toggleMobileMenu() {
  document.getElementById('navLinks').classList.toggle('active');
}

// ===== Scroll Animations =====
function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('anim-visible');
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -40px 0px'
  });

  document.querySelectorAll('.anim-fade-up, .anim-fade-right, .anim-fade-left').forEach(el => {
    // Skip hero elements (handled separately)
    if (!el.closest('.hero') && !el.closest('.scroll-indicator')) {
      observer.observe(el);
    }
  });
}

// ===== Counter Animations =====
function initCounterAnimations() {
  const counters = document.querySelectorAll('[data-count]');
  let animated = false;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !animated) {
        animated = true;
        counters.forEach(counter => {
          const target = parseInt(counter.getAttribute('data-count'));
          animateCounter(counter, target);
        });
      }
    });
  }, { threshold: 0.3 });

  if (counters.length > 0) {
    observer.observe(counters[0].closest('.stats-strip'));
  }
}

function animateCounter(el, target) {
  const duration = 2000;
  const start = performance.now();
  const startVal = 0;

  function update(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.floor(startVal + (target - startVal) * eased);

    el.textContent = current.toLocaleString();

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      el.textContent = target.toLocaleString();
    }
  }

  requestAnimationFrame(update);
}

// ===== Auth =====
function checkAuth() {
  const token = localStorage.getItem('quantum_token');
  const user = localStorage.getItem('quantum_user');
  if (token && user) {
    authToken = token;
    currentUser = JSON.parse(user);
    updateUIForLoggedIn();
  }
}

function updateUIForLoggedIn() {
  const loginBtn = document.getElementById('loginBtn');
  const navCtaBtn = document.querySelector('.nav-cta');
  const userMenu = document.getElementById('userMenu');
  const userName = document.getElementById('userName');
  const userInitials = document.getElementById('userInitials');
  const adminLink = document.getElementById('adminLink');

  if (currentUser) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (navCtaBtn) navCtaBtn.style.display = 'none';
    if (userMenu) userMenu.style.display = 'block';
    if (userName) userName.textContent = currentUser.name;
    if (userInitials) userInitials.textContent = currentUser.name.charAt(0).toUpperCase();
    const isAdmin = currentUser.role === 'admin';
    if (adminLink) adminLink.style.display = isAdmin ? 'block' : 'none';
    const adminDashboardLink = document.getElementById('adminDashboardLink');
    if (adminDashboardLink) adminDashboardLink.style.display = isAdmin ? 'block' : 'none';
  } else {
    if (loginBtn) loginBtn.style.display = '';
    if (navCtaBtn) navCtaBtn.style.display = '';
    if (userMenu) userMenu.style.display = 'none';
    if (adminLink) adminLink.style.display = 'none';
    const adminDashboardLink = document.getElementById('adminDashboardLink');
    if (adminDashboardLink) adminDashboardLink.style.display = 'none';
  }
}

function toggleUserMenu() {
  const dropdown = document.getElementById('userDropdown');
  dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
}

async function handleLogin(e) {
  e.preventDefault();
  const form = e.target;
  const data = {
    email: form.email.value,
    password: form.password.value,
    rememberMe: form.rememberMe ? form.rememberMe.checked : false
  };

  try {
    const res = await apiFetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();

    if (res.ok) {
      authToken = result.token;
      currentUser = result.user;
      localStorage.setItem('quantum_token', authToken);
      localStorage.setItem('quantum_user', JSON.stringify(currentUser));
      updateUIForLoggedIn();
      closeModal('loginModal');
      showToast('Welcome back, ' + currentUser.name + '!', 'success');
      form.reset();
    } else {
      showToast(result.error || 'Login failed', 'error');
    }
  } catch (err) {
    showToast('Connection error. Please try again.', 'error');
  }
}


async function handleRegister(e) {
  e.preventDefault();
  const form = e.target;
  const normalizedEmail = String(form.email.value || '').trim().toLowerCase();
  const countryCode = form.countryCode ? form.countryCode.value : '+996';
  const normalizedPhone = normalizePhone(form.phone.value, countryCode);

  if (!isValidEmail(normalizedEmail)) {
    showToast(currentLang === 'ru' ? 'Введите корректный email.' : 'Please enter a valid email.', 'error');
    return;
  }

  if (!normalizedPhone) {
    showToast(currentLang === 'ru' ? 'Введите корректный номер телефона.' : 'Please enter a valid phone number.', 'error');
    return;
  }

  if (!isStrongPassword(form.password.value)) {
    showToast(currentLang === 'ru' ? 'Пароль: минимум 8 символов, буквы и цифры.' : 'Password must be at least 8 characters and include letters and numbers.', 'error');
    return;
  }

  const data = {
    name: form.name.value,
    email: normalizedEmail,
    phone: normalizedPhone,
    password: form.password.value
  };

  try {
    const res = await apiFetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();

    if (res.ok) {
      authToken = result.token;
      currentUser = result.user;
      localStorage.setItem('quantum_token', authToken);
      localStorage.setItem('quantum_user', JSON.stringify(currentUser));
      sendToKompotCRM({ name: data.name, email: data.email, phone: data.phone, source: 'registration' });
      updateUIForLoggedIn();
      closeModal('loginModal');
      showToast('Account created! Welcome, ' + currentUser.name + '!', 'success');
      form.reset();
    } else {
      showToast(result.error || 'Registration failed', 'error');
    }
  } catch (err) {
    showToast('Connection error. Please try again.', 'error');
  }
}

function openResetModal() {
  closeModal('loginModal');
  openModal('resetModal');
}

async function requestPasswordResetCode() {
  const form = document.getElementById('resetForm');
  if (!form) return;

  const email = String(form.email.value || '').trim().toLowerCase();
  const countryCode = form.countryCode ? form.countryCode.value : '+996';
  const normalizedPhone = normalizePhone(form.phone.value, countryCode);

  if (!isValidEmail(email)) {
    showToast(currentLang === 'ru' ? 'Введите корректный email.' : 'Please enter a valid email.', 'error');
    return;
  }

  if (!normalizedPhone) {
    showToast(currentLang === 'ru' ? 'Введите корректный номер телефона.' : 'Please enter a valid phone number.', 'error');
    return;
  }

  try {
    const res = await apiFetch('/api/reset-password/request-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, phone: normalizedPhone })
    });

    const result = await res.json();
    if (!res.ok) {
      showToast(result.error || (currentLang === 'ru' ? 'Не удалось отправить код.' : 'Failed to send verification code.'), 'error');
      return;
    }

    if (result.devCode) {
      const resetCodeInput = form.resetCode;
      if (resetCodeInput) resetCodeInput.value = result.devCode;
      showToast((currentLang === 'ru' ? 'Код получен (dev): ' : 'Verification code (dev): ') + result.devCode, 'info');
      return;
    }

    showToast(currentLang === 'ru' ? 'Код подтверждения отправлен.' : 'Verification code sent.', 'success');
  } catch (err) {
    showToast(currentLang === 'ru' ? 'Ошибка соединения. Попробуйте снова.' : 'Connection error. Please try again.', 'error');
  }
}

async function handlePasswordReset(e) {
  e.preventDefault();
  const form = e.target;
  const newPassword = form.newPassword.value;
  const confirmPassword = form.confirmPassword.value;
  const resetCode = String(form.resetCode ? form.resetCode.value : '').trim();

  if (newPassword !== confirmPassword) {
    showToast(currentLang === 'ru' ? 'Пароли не совпадают.' : 'Passwords do not match.', 'error');
    return;
  }

  if (!isStrongPassword(newPassword)) {
    showToast(currentLang === 'ru' ? 'Пароль: минимум 8 символов, буквы и цифры.' : 'Password must be at least 8 characters and include letters and numbers.', 'error');
    return;
  }

  if (!resetCode) {
    showToast(currentLang === 'ru' ? 'Введите код подтверждения.' : 'Enter verification code.', 'error');
    return;
  }

  const countryCode = form.countryCode ? form.countryCode.value : '+996';
  const normalizedPhone = normalizePhone(form.phone.value, countryCode);
  if (!normalizedPhone) {
    showToast(currentLang === 'ru' ? 'Введите корректный номер телефона.' : 'Please enter a valid phone number.', 'error');
    return;
  }

  const data = {
    email: form.email.value,
    phone: normalizedPhone,
    newPassword,
    resetCode
  };

  try {
    const res = await apiFetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();

    if (res.ok) {
      showToast(currentLang === 'ru' ? 'Пароль обновлен. Теперь войдите.' : 'Password updated. Please login.', 'success');
      closeModal('resetModal');
      openModal('loginModal');
      switchTab('login');
      form.reset();
    } else {
      showToast(result.error || (currentLang === 'ru' ? 'Ошибка сброса пароля' : 'Password reset failed'), 'error');
    }
  } catch (err) {
    showToast(currentLang === 'ru' ? 'Ошибка соединения. Попробуйте снова.' : 'Connection error. Please try again.', 'error');
  }
}

function handleLogout() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('quantum_token');
  localStorage.removeItem('quantum_user');
  updateUIForLoggedIn();
  document.getElementById('userDropdown').style.display = 'none';
  showToast('You have been logged out.', 'info');
}

function fillProfilePhone(phone) {
  const form = document.getElementById('profileForm');
  if (!form || !phone) return;
  const phoneInput = form.querySelector('[name="phone"]');
  const countrySelect = form.querySelector('[name="countryCode"]');
  if (!phoneInput || !countrySelect) return;
  const fullPhone = phone.trim();
  const codes = ['+971', '+996', '+44', '+49', '+81', '+82', '+86', '+90', '+91', '+33', '+34', '+39', '+61', '+7', '+1'];
  let matched = '';
  for (const code of codes) {
    if (fullPhone.startsWith(code)) { matched = code; break; }
  }
  if (matched) {
    countrySelect.value = matched;
    phoneInput.value = fullPhone.slice(matched.length).replace(/^\s+/, '');
  } else {
    phoneInput.value = fullPhone;
  }
}

async function showProfile() {
  document.getElementById('userDropdown').style.display = 'none';

  // Pre-populate from cached currentUser immediately so modal isn't empty
  const avatarEl = document.getElementById('profileAvatar');
  const nameEl = document.getElementById('profileDisplayName');
  const sinceEl = document.getElementById('profileMemberSince');
  const form = document.getElementById('profileForm');

  if (currentUser) {
    const initial = (currentUser.name || '?').charAt(0).toUpperCase();
    if (avatarEl) avatarEl.textContent = initial;
    if (nameEl) nameEl.textContent = currentUser.name || '';
    if (sinceEl) sinceEl.textContent = '';
    if (form) {
      form.querySelector('[name="name"]').value = currentUser.name || '';
      form.querySelector('[name="email"]').value = currentUser.email || '';
    }
  }

  renderProfileBookings([]);
  openModal('profileModal');

  if (!authToken) return;

  try {
    const headers = { 'Authorization': 'Bearer ' + authToken };
    const [profRes, bookRes] = await Promise.all([
      apiFetch('/api/profile', { headers }),
      apiFetch('/api/profile/bookings', { headers })
    ]);

    // If token expired/invalid, clear session and tell user to log in again
    if (profRes.status === 401 || profRes.status === 403) {
      authToken = null;
      currentUser = null;
      localStorage.removeItem('quantum_token');
      localStorage.removeItem('quantum_user');
      updateUIForLoggedIn();
      closeModal('profileModal');
      openModal('loginModal');
      showToast(currentLang === 'ru' ? 'Сессия истекла, войдите снова.' : 'Session expired, please log in again.', 'info');
      return;
    }

    if (profRes.ok) {
      const profile = await profRes.json();
      if (avatarEl) avatarEl.textContent = (profile.name || '?').charAt(0).toUpperCase();
      if (nameEl) nameEl.textContent = profile.name || '';
      if (sinceEl && profile.createdAt) {
        const d = new Date(profile.createdAt);
        const locale = currentLang === 'ru' ? 'ru-RU' : 'en-US';
        const label = currentLang === 'ru' ? 'Участник с ' : 'Member since ';
        sinceEl.textContent = label + d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
      }
      if (form) {
        form.querySelector('[name="name"]').value = profile.name || '';
        form.querySelector('[name="email"]').value = profile.email || '';
        fillProfilePhone(profile.phone);
      }
    }

    const bookings = bookRes.ok ? await bookRes.json() : [];
    renderProfileBookings(bookings);
  } catch (err) {
    // Network error — modal is still open with cached data, silently skip
    renderProfileBookings([]);
  }
}

async function handleProfileSave(e) {
  e.preventDefault();
  const form = e.target;
  const phone = normalizePhone(form.phone.value, form.countryCode.value);
  const submitBtn = form.querySelector('[type="submit"]');
  submitBtn.disabled = true;

  try {
    const res = await apiFetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
      body: JSON.stringify({ name: form.name.value, email: form.email.value, phone })
    });
    const result = await res.json();

    if (res.ok) {
      currentUser = result.user;
      authToken = result.token;
      localStorage.setItem('quantum_user', JSON.stringify(result.user));
      localStorage.setItem('quantum_token', result.token);
      updateUIForLoggedIn();
      document.getElementById('profileDisplayName').textContent = result.user.name;
      document.getElementById('profileAvatar').textContent = result.user.name.charAt(0).toUpperCase();
      showToast(currentLang === 'ru' ? 'Профиль обновлён!' : 'Profile updated!', 'success');
    } else {
      showToast(result.error || 'Update failed', 'error');
    }
  } catch (err) {
    showToast('Could not save profile', 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

function renderProfileBookings(bookings) {
  const container = document.getElementById('profileBookingsList');
  if (!container) return;

  if (!bookings || bookings.length === 0) {
    container.innerHTML = '<p class="profile-no-bookings">' + (currentLang === 'ru' ? 'Нет записей.' : 'No bookings yet.') + '</p>';
    return;
  }

  const statusLabels = {
    pending: currentLang === 'ru' ? 'Ожидает' : 'Pending',
    new: currentLang === 'ru' ? 'Новая' : 'New',
    in_progress: currentLang === 'ru' ? 'В работе' : 'In progress',
    done: currentLang === 'ru' ? 'Завершена' : 'Done',
    cancelled: currentLang === 'ru' ? 'Отменена' : 'Cancelled'
  };

  const serviceLabels = {
    consultation: currentLang === 'ru' ? 'Консультация' : 'Consultation',
    'brain-charge': 'Brain Charge',
    'resources-club': currentLang === 'ru' ? 'Клуб «Ресурс»' : 'Club "Resources"',
    intensive: currentLang === 'ru' ? 'Интенсив' : 'Intensive',
    reboot: 'REBOOT',
    mentorship: currentLang === 'ru' ? 'Менторство' : 'Mentorship'
  };

  container.innerHTML = bookings.map(b => {
    const locale = currentLang === 'ru' ? 'ru-RU' : 'en-US';
    const date = new Date(b.createdAt).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
    const service = serviceLabels[b.service] || b.service;
    const status = statusLabels[b.status] || b.status;
    return `<div class="profile-booking-item">
      <div class="profile-booking-info">
        <span class="profile-booking-service">${escapeHtml(service)}</span>
        <span class="profile-booking-date">${escapeHtml(date)}</span>
      </div>
      <span class="booking-status booking-status--${escapeHtml(b.status)}">${escapeHtml(status)}</span>
    </div>`;
  }).join('');
}

function showPurchases() {
  showToast('Purchases page coming soon!', 'info');
  document.getElementById('userDropdown').style.display = 'none';
}

function formatAdminDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(currentLang === 'ru' ? 'ru-RU' : 'en-US');
}

function normalizeAdminValue(value) {
  return String(value || '').toLowerCase().trim();
}

function getAdminLabels() {
  if (currentLang === 'ru') {
    return {
      users: 'Пользователи',
      bookings: 'Заявки',
      payments: 'Оплаты',
      usersTitle: 'Последние регистрации',
      bookingsTitle: 'Последние заявки',
      paymentsTitle: 'Последние оплаты',
      userName: 'Имя',
      userEmail: 'Email',
      userPhone: 'Телефон',
      createdAt: 'Дата',
      bookingService: 'Услуга',
      bookingStatus: 'Статус',
      bookingManage: 'Управление',
      paymentProduct: 'Продукт',
      paymentAmount: 'Сумма',
      paymentClient: 'Клиент',
      emptyUsers: 'Регистраций пока нет',
      emptyBookings: 'Заявок пока нет',
      emptyPayments: 'Оплат пока нет',
      searchPlaceholder: 'Поиск: имя, email, телефон, продукт',
      bookingStatusFilter: 'Фильтр статуса',
      statusAll: 'Все статусы',
      notePlaceholder: 'Заметка менеджера (опционально)',
      save: 'Сохранить',
      refresh: 'Обновить',
      clear: 'Сбросить',
      saved: 'Заявка обновлена',
      saveError: 'Не удалось обновить заявку',
      status: {
        pending: 'Ожидание',
        new: 'Новая',
        in_progress: 'В работе',
        done: 'Готово',
        cancelled: 'Отменено'
      }
    };
  }

  return {
    users: 'Users',
    bookings: 'Bookings',
    payments: 'Payments',
    usersTitle: 'Latest Registrations',
    bookingsTitle: 'Latest Requests',
    paymentsTitle: 'Latest Payments',
    userName: 'Name',
    userEmail: 'Email',
    userPhone: 'Phone',
    createdAt: 'Created',
    bookingService: 'Service',
    bookingStatus: 'Status',
    bookingManage: 'Manage',
    paymentProduct: 'Product',
    paymentAmount: 'Amount',
    paymentClient: 'Client',
    emptyUsers: 'No registrations yet',
    emptyBookings: 'No requests yet',
    emptyPayments: 'No payments yet',
    searchPlaceholder: 'Search: name, email, phone, product',
    bookingStatusFilter: 'Status filter',
    statusAll: 'All statuses',
    notePlaceholder: 'Manager note (optional)',
    save: 'Save',
    refresh: 'Refresh',
    clear: 'Clear',
    saved: 'Booking updated',
    saveError: 'Failed to update booking',
    status: {
      pending: 'Pending',
      new: 'New',
      in_progress: 'In Progress',
      done: 'Done',
      cancelled: 'Cancelled'
    }
  };
}

function getBookingStatusLabel(status, labels) {
  const normalized = normalizeAdminValue(status);
  return labels.status[normalized] || status || '-';
}

function buildAdminRows(items, mapRow, colSpan, emptyText) {
  if (!Array.isArray(items) || items.length === 0) {
    return `<tr><td colspan="${colSpan}" class="admin-empty-row">${escapeHtml(emptyText)}</td></tr>`;
  }
  return items.map(mapRow).join('');
}

function matchesAdminSearch(query, values) {
  if (!query) return true;
  return values.some((value) => normalizeAdminValue(value).includes(query));
}

function setAdminSearch(value) {
  adminFilters.search = String(value || '');
  if (adminOverviewData) renderAdminOverview(adminOverviewData);
}

function setAdminBookingStatus(value) {
  adminFilters.bookingStatus = normalizeAdminValue(value) || 'all';
  if (adminOverviewData) renderAdminOverview(adminOverviewData);
}

function clearAdminFilters() {
  adminFilters.search = '';
  adminFilters.bookingStatus = 'all';
  if (adminOverviewData) renderAdminOverview(adminOverviewData);
}

async function saveBookingAdmin(bookingId) {
  const labels = getAdminLabels();

  if (!authToken) {
    showToast(currentLang === 'ru' ? 'Сначала войдите в аккаунт.' : 'Please login first.', 'info');
    return;
  }

  const statusEl = document.getElementById(`adminBookingStatus-${bookingId}`);
  const noteEl = document.getElementById(`adminBookingNote-${bookingId}`);
  if (!statusEl) return;

  const status = normalizeAdminValue(statusEl.value);
  const note = noteEl ? noteEl.value.trim() : '';

  try {
    const res = await apiFetch(`/api/admin/bookings/${bookingId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + authToken
      },
      body: JSON.stringify({ status, note })
    });

    const result = await res.json();
    if (!res.ok) {
      showToast(result.error || labels.saveError, 'error');
      return;
    }

    if (adminOverviewData && Array.isArray(adminOverviewData.bookings) && result.booking) {
      const index = adminOverviewData.bookings.findIndex((booking) => Number(booking.id) === Number(bookingId));
      if (index !== -1) {
        adminOverviewData.bookings[index] = {
          ...adminOverviewData.bookings[index],
          ...result.booking
        };
      }
    }

    if (noteEl) noteEl.value = '';
    renderAdminOverview(adminOverviewData);
    showToast(labels.saved, 'success');
  } catch (err) {
    showToast(labels.saveError, 'error');
  }
}

function renderAdminOverview(data) {
  const panelBody = document.getElementById('adminPanelBody');
  if (!panelBody) return;

  const labels = getAdminLabels();
  const totals = data && data.totals ? data.totals : {};
  const usersRaw = Array.isArray(data && data.users) ? data.users : [];
  const bookingsRaw = Array.isArray(data && data.bookings) ? data.bookings : [];
  const paymentsRaw = Array.isArray(data && data.payments) ? data.payments : [];

  const searchQuery = normalizeAdminValue(adminFilters.search);
  const bookingStatusFilter = normalizeAdminValue(adminFilters.bookingStatus || 'all');

  const users = usersRaw.filter((user) => matchesAdminSearch(searchQuery, [user.name, user.email, user.phone]));

  const bookings = bookingsRaw.filter((booking) => {
    const statusOk = bookingStatusFilter === 'all' || normalizeAdminValue(booking.status) === bookingStatusFilter;
    if (!statusOk) return false;
    return matchesAdminSearch(searchQuery, [booking.name, booking.email, booking.phone, booking.service, booking.status, booking.message]);
  });

  const payments = paymentsRaw.filter((payment) => matchesAdminSearch(searchQuery, [
    payment.id,
    payment.productId,
    payment.productName,
    payment.currency,
    payment.user && payment.user.email,
    payment.user && payment.user.name
  ]));

  const recentPayments = payments.slice(0, 6);
  const statusOptions = ['pending', 'new', 'in_progress', 'done', 'cancelled'];

  panelBody.innerHTML = `
    <div class="admin-filter-bar">
      <input
        type="text"
        class="admin-filter-input"
        value="${escapeHtml(adminFilters.search)}"
        placeholder="${escapeHtml(labels.searchPlaceholder)}"
        oninput="setAdminSearch(this.value)"
      >
      <select class="admin-filter-select" onchange="setAdminBookingStatus(this.value)">
        <option value="all" ${bookingStatusFilter === 'all' ? 'selected' : ''}>${escapeHtml(labels.statusAll)}</option>
        ${statusOptions.map((statusKey) => `<option value="${statusKey}" ${bookingStatusFilter === statusKey ? 'selected' : ''}>${escapeHtml(getBookingStatusLabel(statusKey, labels))}</option>`).join('')}
      </select>
      <button class="btn btn-outline btn-sm" onclick="refreshAdminOverview()">${escapeHtml(labels.refresh)}</button>
      <button class="btn btn-outline btn-sm" onclick="clearAdminFilters()">${escapeHtml(labels.clear)}</button>
    </div>

    <div class="admin-stats-grid">
      <div class="admin-stat-card"><span class="admin-stat-label">${labels.users}</span><strong>${Number(users.length).toLocaleString()}</strong></div>
      <div class="admin-stat-card"><span class="admin-stat-label">${labels.bookings}</span><strong>${Number(bookings.length).toLocaleString()}</strong></div>
      <div class="admin-stat-card"><span class="admin-stat-label">${labels.payments}</span><strong>${Number(payments.length).toLocaleString()}</strong></div>
    </div>

    <section class="admin-section admin-section-card admin-payments-block">
      <div class="admin-section-head">
        <h3>${labels.paymentsTitle} (${Number(totals.payments || paymentsRaw.length).toLocaleString()})</h3>
      </div>
      <div class="admin-payments-grid">
        ${recentPayments.length
          ? recentPayments.map((payment) => {
              const amount = Number(payment.amount);
              const amountLabel = Number.isFinite(amount) ? amount.toLocaleString() : (payment.amount || '-');
              const userLabel = payment.user && (payment.user.name || payment.user.email) ? (payment.user.name || payment.user.email) : '-';
              const productLabel = payment.productName || payment.productId || '-';
              return `<article class="admin-payment-card"><strong>${escapeHtml(String(amountLabel))} ${escapeHtml(payment.currency || '')}</strong><span>${escapeHtml(productLabel)}</span><small>${escapeHtml(userLabel)} • ${escapeHtml(formatAdminDate(payment.createdAt))}</small></article>`;
            }).join('')
          : `<p class="admin-empty">${escapeHtml(labels.emptyPayments)}</p>`}
      </div>
    </section>

    <section class="admin-section">
      <h3>${labels.usersTitle} (${Number(totals.users || usersRaw.length).toLocaleString()})</h3>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>${labels.userName}</th>
              <th>${labels.userEmail}</th>
              <th>${labels.userPhone}</th>
              <th>${labels.createdAt}</th>
            </tr>
          </thead>
          <tbody>
            ${buildAdminRows(
              users,
              (user) => `<tr><td>${escapeHtml(user.name || '-')}</td><td>${escapeHtml(user.email || '-')}</td><td>${escapeHtml(user.phone || '-')}</td><td>${escapeHtml(formatAdminDate(user.createdAt))}</td></tr>`,
              4,
              labels.emptyUsers
            )}
          </tbody>
        </table>
      </div>
    </section>

    <section class="admin-section">
      <h3>${labels.bookingsTitle} (${Number(totals.bookings || bookingsRaw.length).toLocaleString()})</h3>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>${labels.userName}</th>
              <th>${labels.userEmail}</th>
              <th>${labels.bookingService}</th>
              <th>${labels.bookingStatus}</th>
              <th>${labels.createdAt}</th>
              <th>${labels.bookingManage}</th>
            </tr>
          </thead>
          <tbody>
            ${buildAdminRows(
              bookings,
              (booking) => {
                const bookingId = Number(booking.id);
                const statusValue = normalizeAdminValue(booking.status) || 'pending';

                return `<tr>
                  <td>${escapeHtml(booking.name || '-')}</td>
                  <td>${escapeHtml(booking.email || '-')}</td>
                  <td>${escapeHtml(booking.service || '-')}</td>
                  <td>${escapeHtml(getBookingStatusLabel(booking.status, labels))}</td>
                  <td>${escapeHtml(formatAdminDate(booking.createdAt))}</td>
                  <td>
                    <div class="admin-booking-actions">
                      <select id="adminBookingStatus-${bookingId}" class="admin-status-select">
                        ${statusOptions.map((statusKey) => `<option value="${statusKey}" ${statusValue === statusKey ? 'selected' : ''}>${escapeHtml(getBookingStatusLabel(statusKey, labels))}</option>`).join('')}
                      </select>
                      <input id="adminBookingNote-${bookingId}" class="admin-note-input" type="text" placeholder="${escapeHtml(labels.notePlaceholder)}">
                      <button class="btn btn-primary btn-sm" onclick="saveBookingAdmin(${bookingId})">${escapeHtml(labels.save)}</button>
                    </div>
                  </td>
                </tr>`;
              },
              6,
              labels.emptyBookings
            )}
          </tbody>
        </table>
      </div>
    </section>

  `;
}

function ensureAdminModalExists() {
  let modal = document.getElementById('adminModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'adminModal';
    modal.innerHTML = `
      <div class="modal admin-modal">
        <button class="modal-close" onclick="closeModal('adminModal')">&times;</button>
        <h2 data-i18n="admin.title">Admin Dashboard</h2>
        <p class="modal-description" data-i18n="admin.desc">Latest registrations, consultations, and payments.</p>
        <div id="adminPanelBody" class="admin-panel-body">
          <p class="admin-empty">${currentLang === 'ru' ? 'Загрузка данных...' : 'Loading data...'}</p>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const panelBody = document.getElementById('adminPanelBody');
  if (!panelBody) return null;
  return panelBody;
}

async function refreshAdminOverview() {
  const panelBody = ensureAdminModalExists();
  if (!panelBody || !authToken) return;

  panelBody.innerHTML = `<p class="admin-empty">${currentLang === 'ru' ? 'Загрузка данных...' : 'Loading data...'}</p>`;

  try {
    const res = await apiFetch('/api/admin/overview?limit=200', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + authToken
      }
    });

    const result = await res.json();
    if (!res.ok) {
      panelBody.innerHTML = `<p class="admin-empty">${escapeHtml(result.error || (currentLang === 'ru' ? 'Нет доступа' : 'Access denied'))}</p>`;
      return;
    }

    adminOverviewData = result;
    renderAdminOverview(result);
  } catch (err) {
    panelBody.innerHTML = `<p class="admin-empty">${currentLang === 'ru' ? 'Ошибка соединения. Попробуйте снова.' : 'Connection error. Please try again.'}</p>`;
  }
}

async function openAdminDashboard() {
  const dropdown = document.getElementById('userDropdown');
  if (dropdown) dropdown.style.display = 'none';

  if (!authToken) {
    showToast(currentLang === 'ru' ? 'Сначала войдите в аккаунт.' : 'Please login first.', 'info');
    openModal('loginModal');
    switchTab('login');
    return;
  }

  if (!currentUser || currentUser.role !== 'admin') {
    showToast(currentLang === 'ru' ? 'Доступ только для администраторов.' : 'Admin access only.', 'error');
    return;
  }

  const panelBody = ensureAdminModalExists();
  if (!panelBody) {
    showToast(currentLang === 'ru' ? 'Не удалось открыть дашборд.' : 'Unable to open dashboard.', 'error');
    return;
  }

  openModal('adminModal');
  await refreshAdminOverview();
}

// ===== Modals =====
function openModal(id) {
  document.getElementById(id).classList.add('active');
  document.body.style.overflow = 'hidden';

  if (id === 'consultModal' && currentUser) {
    const form = document.getElementById('consultForm');
    if (!form) return;

    const nameInput = form.querySelector('[name="name"]');
    const emailInput = form.querySelector('[name="email"]');
    const phoneInput = form.querySelector('[name="phone"]');
    const countrySelect = form.querySelector('[name="countryCode"]');

    if (nameInput && !nameInput.value) nameInput.value = currentUser.name || '';
    if (emailInput && !emailInput.value) emailInput.value = currentUser.email || '';

    if (phoneInput && countrySelect && currentUser.phone && !phoneInput.value) {
      const fullPhone = currentUser.phone.trim();
      const codes = ['+971', '+996', '+44', '+49', '+81', '+82', '+86', '+90', '+91', '+33', '+34', '+39', '+61', '+7', '+1'];
      let matched = '';
      for (const code of codes) {
        if (fullPhone.startsWith(code)) { matched = code; break; }
      }
      if (matched) {
        countrySelect.value = matched;
        phoneInput.value = fullPhone.slice(matched.length).replace(/^\s+/, '');
      } else {
        phoneInput.value = fullPhone;
      }
    }
  }
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  document.body.style.overflow = '';
}

function switchTab(tab) {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const tabs = document.querySelectorAll('.tab-btn');


  if (tab === 'login') {
    loginForm.style.display = 'block';
    registerForm.style.display = 'none';
    tabs[0].classList.add('active');
    tabs[1].classList.remove('active');
  } else {
    loginForm.style.display = 'none';
    registerForm.style.display = 'block';
    tabs[0].classList.remove('active');
    tabs[1].classList.add('active');
  }
}

let _mouseDownInsideModal = false;
document.addEventListener('mousedown', (e) => {
  _mouseDownInsideModal = !!e.target.closest('.modal');
});
document.addEventListener('click', (e) => {
  const overlay = e.target.closest('.modal-overlay');
  if (overlay && !e.target.closest('.modal') && !_mouseDownInsideModal) {
    overlay.classList.remove('active');
    document.body.style.overflow = '';
  }
});

// ===== Consultation Booking =====
function getFormCaptchaToken(form) {
  if (!form || typeof form.querySelector !== 'function') return '';

  const turnstileInput = form.querySelector('input[name="cf-turnstile-response"]');
  if (turnstileInput && turnstileInput.value) {
    return String(turnstileInput.value).trim();
  }

  return '';
}

async function handleConsultation(e) {
  e.preventDefault();
  const form = e.target;
  const countryCode = form.countryCode ? form.countryCode.value : '+996';
  const phone = normalizePhone(form.phone.value, countryCode);
  const data = {
    name: form.name.value,
    email: form.email.value,
    phone: phone,
    service: form.service.value,
    message: '',
    captchaToken: getFormCaptchaToken(form)
  };

  try {
    const res = await apiFetch('/api/book-consultation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();

    if (res.ok) {
      sendToKompotCRM({ name: data.name, email: data.email, phone: data.phone, source: 'consultation', service: data.service });
      closeModal('consultModal');
      showSuccessModal(
        'Consultation Booked!',
        'Thank you, ' + data.name + '! We will contact you via ' +
        (form.contact_method.value === 'whatsapp' ? 'WhatsApp' : 'Telegram') +
        ' to schedule your free consultation.'
      );
      form.reset();
      resetTurnstileForForm(form);
    } else {
      showToast(result.error || 'Booking failed', 'error');
    }
  } catch (err) {
    showToast('Connection error. Please try again.', 'error');
  }
}

async function handleContact(e) {
  e.preventDefault();
  const form = e.target;
  const countryCode = form.countryCode ? form.countryCode.value : '+996';
  const phone = normalizePhone(form.phone.value, countryCode);
  const data = {
    name: form.name.value,
    email: form.email.value,
    phone: phone,
    service: form.service.value,
    message: form.message.value,
    captchaToken: getFormCaptchaToken(form)
  };

  try {
    const res = await apiFetch('/api/book-consultation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();

    if (res.ok) {
      sendToKompotCRM({ name: data.name, email: data.email, phone: data.phone, source: 'contact', service: data.service });
      showSuccessModal(
        'Request Sent!',
        'Thank you, ' + data.name + '! We will contact you shortly via WhatsApp or Telegram.'
      );
      form.reset();
      resetTurnstileForForm(form);
    } else {
      showToast(result.error || 'Submission failed', 'error');
    }
  } catch (err) {
    showToast('Connection error. Please try again.', 'error');
  }
}

// ===== Payment =====
async function handlePurchase(productId, productName, amount, currency) {
  if (!currentUser) {
    showToast('Please login or register first to make a purchase.', 'info');
    openModal('loginModal');
    return;
  }

  const stripeSupported = ['USD', 'EUR', 'GBP', 'KZT'];
  if (stripeSupported.includes((currency || '').toUpperCase())) {
    showToast('Redirecting to secure checkout...', 'info');
    try {
      const res = await apiFetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
        body: JSON.stringify({ productId, productName, amount, currency })
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        showToast(data.error || 'Could not start checkout. Please try again.', 'error');
      }
    } catch (err) {
      showToast('Could not connect to payment service. Please try again.', 'error');
    }
    return;
  }

  // Fallback: demo payment modal for non-Stripe currencies (KGS, RUB)
  currentPayment = { productId, productName, amount, currency };

  const summary = document.getElementById('paymentSummary');
  summary.innerHTML = `
    <h3>${productName}</h3>
    <div class="payment-amount">${currency === 'USD' ? '$' : ''}${amount.toLocaleString()} ${currency !== 'USD' ? currency : ''}</div>
  `;

  const payBtn = document.getElementById('payBtn');
  payBtn.textContent = `Pay ${currency === 'USD' ? '$' : ''}${amount.toLocaleString()} ${currency !== 'USD' ? currency : ''}`;

  openModal('paymentModal');
}

async function handlePayment(e) {
  e.preventDefault();
  if (!currentPayment || !authToken) return;

  const form = e.target;
  const notifyMethod = form.notify.value;
  const payBtn = document.getElementById('payBtn');

  payBtn.innerHTML = '<span class="loading"><span class="spinner"></span> Processing...</span>';
  payBtn.disabled = true;

  try {
    const res = await apiFetch('/api/payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + authToken
      },
      body: JSON.stringify(currentPayment)
    });
    const result = await res.json();

    if (res.ok) {
      closeModal('paymentModal');

      const notifyMessage = `Payment confirmed for ${currentPayment.productName}! Amount: ${currentPayment.amount} ${currentPayment.currency}. Order: ${result.payment.id}`;
      const notifyChannels = notifyMethod === 'both' ? ['whatsapp', 'telegram'] : [notifyMethod];

      for (const channel of notifyChannels) {
        const notifyRes = await apiFetch('/api/notify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + authToken
          },
          body: JSON.stringify({
            type: channel,
            phone: channel === 'whatsapp' ? '+996550412941' : '',
            message: notifyMessage
          })
        });

        const notifyResult = await notifyRes.json().catch(() => ({}));
        if (channel === 'whatsapp' && notifyResult && notifyResult.url) {
          window.open(notifyResult.url, '_blank', 'noopener');
        }
      }

      showSuccessModal(
        'Payment Successful!',
        `Thank you for purchasing ${currentPayment.productName}! Your order ID is ${result.payment.id}. A confirmation has been sent via ${notifyMethod === 'both' ? 'WhatsApp and Telegram' : notifyMethod}.`
      );
      form.reset();
      currentPayment = null;
    } else {
      showToast(result.error || 'Payment failed', 'error');
    }
  } catch (err) {
    showToast('Payment processing error. Please try again.', 'error');
  } finally {
    payBtn.textContent = 'Pay Now';
    payBtn.disabled = false;
  }
}

// ===== Chatbot =====
function toggleChatbot() {
  const window_ = document.getElementById('chatbotWindow');
  const icon = document.querySelector('.chatbot-icon');
  const closeIcon = document.querySelector('.chatbot-close');

  window_.classList.toggle('active');

  if (window_.classList.contains('active')) {
    icon.style.display = 'none';
    closeIcon.style.display = 'block';
  } else {
    icon.style.display = 'block';
    closeIcon.style.display = 'none';
  }
}

async function sendChatMessage(e) {
  e.preventDefault();
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;

  addChatMessage(message, 'user');
  input.value = '';

  const typingId = showTyping();
  const sessionId = getChatSessionId();

  try {
    const res = await apiFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sessionId })
    });
    const result = await res.json();

    removeTyping(typingId);

    if (!res.ok) {
      addChatMessage(result.error || 'Sorry, I am having trouble connecting. Please try again.', 'bot');
      return;
    }

    addChatMessage(result.reply || '...', 'bot');

    if (result.booking && result.booking.id) {
      const toastMessage = currentLang === 'ru'
        ? `Заявка #${result.booking.id} создана. Мы скоро свяжемся с вами.`
        : `Booking #${result.booking.id} created. We will contact you shortly.`;
      showToast(toastMessage, 'success');
    }
  } catch (err) {
    removeTyping(typingId);
    addChatMessage('Sorry, I am having trouble connecting. Please try again.', 'bot');
  }
}

function sendQuickReply(message) {
  document.getElementById('chatInput').value = message;
  sendChatMessage(new Event('submit'));
}

function addChatMessage(text, sender) {
  const messages = document.getElementById('chatbotMessages');
  const div = document.createElement('div');
  div.className = `chat-message ${sender}`;
  div.innerHTML = `<div class="message-bubble">${escapeHtml(text)}</div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function showTyping() {
  const messages = document.getElementById('chatbotMessages');
  const div = document.createElement('div');
  div.className = 'chat-message bot typing-indicator';
  div.id = 'typing-' + Date.now();
  div.innerHTML = '<div class="message-bubble"><span class="loading"><span class="spinner"></span> Typing...</span></div>';
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div.id;
}

function removeTyping(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/\n/g, '<br>');
}

// ===== Social Links =====
function openWhatsApp() {
  window.open('https://wa.me/?text=' + encodeURIComponent('Hello! I am interested in QUANTUM programs.'), '_blank');
}

function openTelegram() {
  window.open('https://t.me/Altynaimashtab_bot', '_blank');
}

// ===== Helpers =====
function showSuccessModal(title, message) {
  document.getElementById('successTitle').textContent = title;
  document.getElementById('successMessage').textContent = message;
  openModal('successModal');
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastIn 0.3s cubic-bezier(0.4, 0, 0.2, 1) reverse';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Card number formatting
document.addEventListener('input', (e) => {
  if (e.target.name === 'cardNumber') {
    let v = e.target.value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    let matches = v.match(/\d{4,16}/g);
    let match = matches && matches[0] || '';
    let parts = [];
    for (let i = 0, len = match.length; i < len; i += 4) {
      parts.push(match.substring(i, i + 4));
    }
    e.target.value = parts.length ? parts.join(' ') : v;
  }
  if (e.target.name === 'expiry') {
    let v = e.target.value.replace(/[^0-9]/g, '');
    if (v.length >= 2) v = v.slice(0, 2) + '/' + v.slice(2);
    e.target.value = v.slice(0, 5);
  }
});
