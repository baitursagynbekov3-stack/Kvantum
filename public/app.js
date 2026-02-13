// ===== State =====
let currentUser = null;
let authToken = null;
let currentPayment = null;
let currentLang = localStorage.getItem('kvantum_lang') || 'en';
let adminOverviewData = null;
let adminFilters = {
  search: '',
  bookingStatus: 'all'
};

// Use external API in static hosting (GitHub Pages) via public/config.js
const API_BASE_URL = (window.KVANTUM_API_BASE_URL || '').trim().replace(/\/$/, '');
const USE_DEMO_API = window.KVANTUM_USE_DEMO_API === true || (!API_BASE_URL && window.location.hostname.endsWith('github.io'));

function buildApiUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  return API_BASE_URL ? API_BASE_URL + normalizedPath : normalizedPath;
}

function isValidEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  let phone = raw.replace(/[^\d+]/g, '');
  if (phone.startsWith('00')) {
    phone = '+' + phone.slice(2);
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
  const usersKey = 'kvantum_demo_users';
  const bookingsKey = 'kvantum_demo_bookings';
  const paymentsKey = 'kvantum_demo_payments';

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

    if (String(password).length < 6) {
      return createApiResponse(400, { error: 'Password must be at least 6 characters' });
    }

    const users = getStorageArray(usersKey);
    if (users.some((u) => u.email === email)) {
      return createApiResponse(400, { error: 'User already exists' });
    }

    const user = {
      id: Date.now(),
      name,
      email,
      phone,
      password,
      createdAt: new Date().toISOString()
    };

    users.push(user);
    setStorageArray(usersKey, users);

    const token = 'demo-' + btoa(email + ':' + Date.now());
    return createApiResponse(200, {
      message: 'Registration successful (demo mode)',
      token,
      user: { id: user.id, name: user.name, email: user.email }
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
      user: { id: user.id, name: user.name, email: user.email }
    });
  }

  if (path === '/api/reset-password') {
    const email = (body.email || '').trim().toLowerCase();
    const phone = normalizePhone(body.phone);
    const newPassword = body.newPassword || '';

    if (!email || !phone || !newPassword) {
      return createApiResponse(400, { error: 'Email, phone and new password are required' });
    }

    if (String(newPassword).length < 6) {
      return createApiResponse(400, { error: 'Password must be at least 6 characters' });
    }

    const users = getStorageArray(usersKey);
    const index = users.findIndex((u) => {
      const userPhone = normalizePhone(u.phone);
      return u.email === email && userPhone && userPhone === phone;
    });

    if (index === -1) {
      return createApiResponse(400, { error: 'Invalid email or phone' });
    }

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
    'reset.title': 'Восстановление пароля',
    'reset.desc': 'Введите email и телефон из регистрации. Мы установим новый пароль.',
    'reset.email': 'Email',
    'reset.phone': 'Телефон из регистрации',
    'reset.new_password': 'Новый пароль',
    'reset.new_password_ph': 'Минимум 6 символов',
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
  localStorage.setItem('kvantum_lang', currentLang);
  applyTranslations(currentLang);
  updateLangButton();
}

function updateLangButton() {
  const flag = document.getElementById('langFlag');
  if (flag) flag.textContent = currentLang === 'en' ? 'RU' : 'EN';
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  storeOriginals();
  initNavbar();
  initScrollAnimations();
  initCounterAnimations();
  checkAuth();
  updateLangButton();
  if (currentLang !== 'en') applyTranslations(currentLang);


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
  const token = localStorage.getItem('kvantum_token');
  const user = localStorage.getItem('kvantum_user');
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

  if (currentUser) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (navCtaBtn) navCtaBtn.style.display = 'none';
    if (userMenu) userMenu.style.display = 'block';
    if (userName) userName.textContent = currentUser.name;
    if (userInitials) userInitials.textContent = currentUser.name.charAt(0).toUpperCase();
  } else {
    if (loginBtn) loginBtn.style.display = '';
    if (navCtaBtn) navCtaBtn.style.display = '';
    if (userMenu) userMenu.style.display = 'none';
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
    password: form.password.value
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
      localStorage.setItem('kvantum_token', authToken);
      localStorage.setItem('kvantum_user', JSON.stringify(currentUser));
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
  const normalizedPhone = normalizePhone(form.phone.value);

  if (!isValidEmail(normalizedEmail)) {
    showToast(currentLang === 'ru' ? 'Введите корректный email.' : 'Please enter a valid email.', 'error');
    return;
  }

  if (!normalizedPhone) {
    showToast(currentLang === 'ru' ? 'Введите телефон в международном формате, например +1 202 555 0123.' : 'Use international phone format, e.g. +1 202 555 0123.', 'error');
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
      localStorage.setItem('kvantum_token', authToken);
      localStorage.setItem('kvantum_user', JSON.stringify(currentUser));
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

async function handlePasswordReset(e) {
  e.preventDefault();
  const form = e.target;
  const newPassword = form.newPassword.value;
  const confirmPassword = form.confirmPassword.value;

  if (newPassword !== confirmPassword) {
    showToast(currentLang === 'ru' ? 'Пароли не совпадают.' : 'Passwords do not match.', 'error');
    return;
  }

  const normalizedPhone = normalizePhone(form.phone.value);
  if (!normalizedPhone) {
    showToast(currentLang === 'ru' ? 'Введите корректный телефон в международном формате.' : 'Please enter a valid international phone number.', 'error');
    return;
  }

  const data = {
    email: form.email.value,
    phone: normalizedPhone,
    newPassword
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
  localStorage.removeItem('kvantum_token');
  localStorage.removeItem('kvantum_user');
  updateUIForLoggedIn();
  document.getElementById('userDropdown').style.display = 'none';
  showToast('You have been logged out.', 'info');
}

function showProfile() {
  showToast('Profile page coming soon!', 'info');
  document.getElementById('userDropdown').style.display = 'none';
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

    <section class="admin-section">
      <h3>${labels.paymentsTitle} (${Number(totals.payments || paymentsRaw.length).toLocaleString()})</h3>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>${labels.paymentProduct}</th>
              <th>${labels.paymentAmount}</th>
              <th>${labels.paymentClient}</th>
              <th>${labels.createdAt}</th>
            </tr>
          </thead>
          <tbody>
            ${buildAdminRows(
              payments,
              (payment) => {
                const amount = Number(payment.amount);
                const amountLabel = Number.isFinite(amount) ? amount.toLocaleString() : (payment.amount || '-');
                const userLabel = payment.user && payment.user.email ? payment.user.email : '-';
                return `<tr><td>${escapeHtml(payment.id || '-')}</td><td>${escapeHtml(payment.productName || payment.productId || '-')}</td><td>${escapeHtml(String(amountLabel))} ${escapeHtml(payment.currency || '')}</td><td>${escapeHtml(userLabel)}</td><td>${escapeHtml(formatAdminDate(payment.createdAt))}</td></tr>`;
              },
              5,
              labels.emptyPayments
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

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
    document.body.style.overflow = '';
  }
});

// ===== Consultation Booking =====
async function handleConsultation(e) {
  e.preventDefault();
  const form = e.target;
  const data = {
    name: form.name.value,
    email: form.email.value,
    phone: form.phone.value,
    service: form.service.value,
    message: ''
  };

  try {
    const res = await apiFetch('/api/book-consultation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();

    if (res.ok) {
      closeModal('consultModal');
      showSuccessModal(
        'Consultation Booked!',
        'Thank you, ' + data.name + '! We will contact you via ' +
        (form.contact_method.value === 'whatsapp' ? 'WhatsApp' : 'Telegram') +
        ' to schedule your free consultation.'
      );
      form.reset();
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
  const data = {
    name: form.name.value,
    email: form.email.value,
    phone: form.phone.value,
    service: form.service.value,
    message: form.message.value
  };

  try {
    const res = await apiFetch('/api/book-consultation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();

    if (res.ok) {
      showSuccessModal(
        'Request Sent!',
        'Thank you, ' + data.name + '! We will contact you shortly via WhatsApp or Telegram.'
      );
      form.reset();
    } else {
      showToast(result.error || 'Submission failed', 'error');
    }
  } catch (err) {
    showToast('Connection error. Please try again.', 'error');
  }
}

// ===== Payment =====
function handlePurchase(productId, productName, amount, currency) {
  if (!currentUser) {
    showToast('Please login or register first to make a purchase.', 'info');
    openModal('loginModal');
    return;
  }

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

      await apiFetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: notifyMethod === 'both' ? 'whatsapp' : notifyMethod,
          phone: '',
          message: `Payment confirmed for ${currentPayment.productName}! Amount: ${currentPayment.amount} ${currentPayment.currency}. Order: ${result.payment.id}`
        })
      });

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

  try {
    const res = await apiFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const result = await res.json();

    removeTyping(typingId);
    addChatMessage(result.reply, 'bot');
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
  window.open('https://wa.me/?text=' + encodeURIComponent('Hello! I am interested in KVANTUM programs.'), '_blank');
}

function openTelegram() {
  window.open('https://t.me/', '_blank');
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
