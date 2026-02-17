require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const prisma = global.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-to-a-long-random-string';
const SERVE_STATIC = process.env.SERVE_STATIC !== 'false';
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'baitursagynbekov3@gmail.com')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const ALLOWED_BOOKING_STATUSES = new Set(['pending', 'new', 'in_progress', 'done', 'cancelled']);
const CHAT_HISTORY_LIMIT = 12;
const CHAT_DB_HISTORY_LIMIT = CHAT_HISTORY_LIMIT * 2;
const CHAT_SESSIONS_LIMIT = 300;
const CHAT_SESSION_TTL_MS = 1000 * 60 * 60;
const CHAT_SESSION_STATUSES = new Set(['open', 'collecting', 'booked', 'closed', 'spam']);
const CHAT_KNOWLEDGE_CONTENT_TYPE = 'chatbot_kb';
const KNOWLEDGE_CACHE_TTL_MS = 1000 * 60;
const chatSessions = new Map();

const KNOWLEDGE_BASE_PATH = path.join(__dirname, 'data', 'chat-knowledge-base.md');

const KVANTUM_SYSTEM_PROMPT_BASE = [
  'You are the official assistant of KVANTUM website.',
  'Speak in Russian when user writes Russian; otherwise speak in English.',
  'Your goals: explain programs, pricing, consultation process, and guide users politely.',
  'If details are unclear, ask concise follow-up questions.',
  'Do not invent new products, prices, guarantees, or policies.',
  'Known programs and prices:',
  '- Brain Charge: 1,000 KGS/RUB',
  '- Resources Club: 5,000 KGS/month',
  '- Intensive "Mom & Dad - My 2 Wings": $300 / 26,300 KGS',
  '- REBOOT: $1,000',
  '- Mentorship: ask managers for pricing',
  'Founder: Altynai Eshinbekova.',
  'Entry to individual work goes through a free consultation.',
  'When users want to book consultation, ask for name + email + phone in international format (+country code).',
  'When a user is ready to leave a request, collect exactly these fields: name, email, phone (+country code), and optional service/message.'
].join('\n');

let knowledgeBaseCache = loadKnowledgeBaseFromFile();
let knowledgeBaseCacheUpdatedAt = Date.now();

const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

// CORS configuration
const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    // Always allow local dev frontends (e.g. localhost:3000, localhost:5500).
    if (LOCAL_ORIGIN_RE.test(origin)) {
      return callback(null, true);
    }

    if (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }

    return callback(null, false);
  }
};

// Middleware
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

if (SERVE_STATIC) {
  app.use(express.static(path.join(__dirname, 'public')));
}

app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, database: 'up' });
  } catch (err) {
    res.status(500).json({ ok: false, database: 'down' });
  }
});

// Auth middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

function isAdminEmail(email) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  if (!normalizedEmail) return false;
  return ADMIN_EMAILS.includes(normalizedEmail);
}

function authenticateAdmin(req, res, next) {
  return authenticateToken(req, res, () => {
    if (ADMIN_EMAILS.length === 0) {
      if (process.env.NODE_ENV !== 'production') return next();
      return res.status(503).json({ error: 'Admin access is not configured' });
    }

    if (!isAdminEmail(req.user && req.user.email)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    return next();
  });
}

function isValidEmail(email) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizedEmail);
}

function normalizePhone(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return '';

  let value = raw.replace(/[^\d+]/g, '');
  if (value.startsWith('00')) {
    value = '+' + value.slice(2);
  }

  if (!value.startsWith('+')) {
    return '';
  }

  const digits = value.slice(1).replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return '';
  return '+' + digits;
}

function normalizeKnowledgeText(value) {
  return String(value || '').trim().slice(0, 12000);
}

function loadKnowledgeBaseFromFile() {
  try {
    const content = fs.readFileSync(KNOWLEDGE_BASE_PATH, 'utf8');
    return normalizeKnowledgeText(content);
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.error('[chat] Failed to load knowledge base file:', err.message || err);
    }
    return '';
  }
}

function buildSystemPrompt(knowledgeText) {
  if (!knowledgeText) return KVANTUM_SYSTEM_PROMPT_BASE;

  return [
    KVANTUM_SYSTEM_PROMPT_BASE,
    'Use the following website knowledge base as ground truth for facts and wording priorities.',
    knowledgeText
  ].join('\n\n');
}

async function getKnowledgeBaseText(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && knowledgeBaseCache && now - knowledgeBaseCacheUpdatedAt < KNOWLEDGE_CACHE_TTL_MS) {
    return knowledgeBaseCache;
  }

  const fallback = normalizeKnowledgeText(knowledgeBaseCache || loadKnowledgeBaseFromFile());

  try {
    const item = await prisma.content.findFirst({
      where: { type: CHAT_KNOWLEDGE_CONTENT_TYPE },
      orderBy: { updatedAt: 'desc' }
    });

    if (item && item.data && typeof item.data === 'object' && !Array.isArray(item.data)) {
      const dbText = normalizeKnowledgeText(item.data.text);
      if (dbText) {
        knowledgeBaseCache = dbText;
        knowledgeBaseCacheUpdatedAt = now;
        return knowledgeBaseCache;
      }
    }
  } catch (err) {
    console.error('[chat] Failed to load knowledge base from DB:', err.message || err);
  }

  knowledgeBaseCache = fallback;
  knowledgeBaseCacheUpdatedAt = now;
  return knowledgeBaseCache;
}

async function setKnowledgeBaseText(nextText) {
  const text = normalizeKnowledgeText(nextText);

  const existing = await prisma.content.findFirst({
    where: { type: CHAT_KNOWLEDGE_CONTENT_TYPE },
    orderBy: { updatedAt: 'desc' }
  });

  if (existing) {
    await prisma.content.update({
      where: { id: existing.id },
      data: { data: { text }, sortOrder: 0 }
    });

    knowledgeBaseCache = text || loadKnowledgeBaseFromFile();
    knowledgeBaseCacheUpdatedAt = Date.now();
    return knowledgeBaseCache;
  }

  await prisma.content.create({
    data: {
      type: CHAT_KNOWLEDGE_CONTENT_TYPE,
      sortOrder: 0,
      data: { text }
    }
  });

  knowledgeBaseCache = text || loadKnowledgeBaseFromFile();
  knowledgeBaseCacheUpdatedAt = Date.now();
  return knowledgeBaseCache;
}

async function getSystemPrompt() {
  const knowledgeText = await getKnowledgeBaseText();
  return buildSystemPrompt(knowledgeText);
}

function normalizeName(name) {
  const cleaned = String(name || '')
    .replace(/[^\p{L}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length < 2) return '';
  return cleaned.slice(0, 80);
}

function normalizeSessionId(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(normalized)) return '';
  return normalized;
}

function createEmptyLeadDraft() {
  return { name: '', email: '', phone: '', service: '', message: '' };
}

function cleanupChatSessions() {
  const now = Date.now();

  for (const [sessionId, session] of chatSessions.entries()) {
    if (!session || now - session.updatedAt > CHAT_SESSION_TTL_MS) {
      chatSessions.delete(sessionId);
    }
  }

  if (chatSessions.size <= CHAT_SESSIONS_LIMIT) return;

  const sorted = [...chatSessions.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  const overflow = chatSessions.size - CHAT_SESSIONS_LIMIT;
  for (let i = 0; i < overflow; i += 1) {
    chatSessions.delete(sorted[i][0]);
  }
}

function getChatSession(sessionId) {
  if (!sessionId) return null;

  let session = chatSessions.get(sessionId);
  if (!session) {
    session = {
      history: [],
      leadDraft: createEmptyLeadDraft(),
      updatedAt: Date.now()
    };
    chatSessions.set(sessionId, session);
  }

  session.updatedAt = Date.now();
  return session;
}

function appendChatHistory(session, role, content) {
  if (!session || !content) return;

  session.history.push({
    role,
    content: String(content).slice(0, 3000)
  });

  const maxHistoryItems = CHAT_HISTORY_LIMIT * 2;
  if (session.history.length > maxHistoryItems) {
    session.history = session.history.slice(-maxHistoryItems);
  }

  session.updatedAt = Date.now();
}

function leadDraftFromChatSession(record) {
  if (!record) return createEmptyLeadDraft();

  return {
    name: String(record.leadName || '').trim(),
    email: String(record.leadEmail || '').trim().toLowerCase(),
    phone: normalizePhone(record.leadPhone || ''),
    service: String(record.leadService || '').trim(),
    message: String(record.leadMessage || '').trim()
  };
}

async function ensureChatSessionRecord(sessionId, locale) {
  if (!sessionId) return null;

  return prisma.chatSession.upsert({
    where: { sessionId },
    update: { locale: locale || null },
    create: { sessionId, locale: locale || null },
    select: {
      id: true,
      sessionId: true,
      locale: true,
      leadName: true,
      leadEmail: true,
      leadPhone: true,
      leadService: true,
      leadMessage: true,
      leadStatus: true,
      bookingId: true,
      updatedAt: true
    }
  });
}

async function hydrateMemoryChatSession(session, chatSessionRecord) {
  if (!session || !chatSessionRecord) return;

  if (session.history.length === 0) {
    const dbMessages = await prisma.chatMessage.findMany({
      where: { chatSessionId: chatSessionRecord.id },
      orderBy: { createdAt: 'desc' },
      take: CHAT_DB_HISTORY_LIMIT,
      select: { role: true, content: true }
    });

    session.history = dbMessages
      .slice()
      .reverse()
      .map((message) => ({ role: message.role, content: String(message.content || '') }));
  }

  // Restore draft only while lead collection is in progress.
  if (chatSessionRecord.leadStatus === 'collecting') {
    const dbLead = leadDraftFromChatSession(chatSessionRecord);
    session.leadDraft = mergeLeadDraft(dbLead, session.leadDraft);
  } else if (hasLeadData(session.leadDraft)) {
    session.leadDraft = createEmptyLeadDraft();
  }
  session.updatedAt = Date.now();
}

async function saveChatMessageRecord(chatSessionId, role, content) {
  if (!chatSessionId || !content) return;

  await prisma.chatMessage.create({
    data: {
      chatSessionId,
      role,
      content: String(content).slice(0, 3000)
    }
  });
}

async function persistChatLeadDraft(chatSessionId, leadDraft, leadStatus) {
  if (!chatSessionId || !leadDraft) return;

  const nextStatus = CHAT_SESSION_STATUSES.has(leadStatus) ? leadStatus : undefined;

  await prisma.chatSession.update({
    where: { id: chatSessionId },
    data: {
      leadName: leadDraft.name || null,
      leadEmail: leadDraft.email || null,
      leadPhone: leadDraft.phone || null,
      leadService: leadDraft.service || null,
      leadMessage: leadDraft.message || null,
      ...(nextStatus ? { leadStatus: nextStatus } : {})
    }
  });
}

async function markChatSessionBooked(chatSessionId, bookingId, leadDraft) {
  if (!chatSessionId || !bookingId) return;

  await prisma.chatSession.update({
    where: { id: chatSessionId },
    data: {
      bookingId,
      leadStatus: 'booked',
      leadName: leadDraft && leadDraft.name ? leadDraft.name : null,
      leadEmail: leadDraft && leadDraft.email ? leadDraft.email : null,
      leadPhone: leadDraft && leadDraft.phone ? leadDraft.phone : null,
      leadService: leadDraft && leadDraft.service ? leadDraft.service : null,
      leadMessage: leadDraft && leadDraft.message ? leadDraft.message : null
    }
  });
}

function isRussianText(text) {
  return /[а-яё]/i.test(String(text || ''));
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractLabeledField(text, labels) {
  if (!text || !labels || labels.length === 0) return '';

  const labelPattern = labels.map((label) => escapeRegex(label)).join('|');
  const regex = new RegExp(`(?:^|\\n|,|;)\\s*(?:${labelPattern})\\s*[:=-]\\s*([^\\n,;]+)`, 'i');
  const match = String(text).match(regex);
  return match ? String(match[1]).trim() : '';
}

function extractEmailFromText(text) {
  const match = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? String(match[0]).trim().toLowerCase() : '';
}

function extractPhoneFromText(text) {
  const candidates = String(text || '').match(/(?:\+|00)[\d\s().-]{7,24}/g) || [];
  for (const candidate of candidates) {
    const normalized = normalizePhone(candidate);
    if (normalized) return normalized;
  }
  return '';
}

function extractNameFromText(text) {
  const source = String(text || '').trim();
  if (!source) return '';

  const pattern = /(?:меня зовут|my name is|i am|я\s*-|name is)\s+([\p{L}\s'-]{2,80})/iu;
  const match = source.match(pattern);
  if (!match) return '';

  return normalizeName(match[1]);
}

function detectServiceFromText(text) {
  const value = String(text || '').toLowerCase();
  if (!value) return '';

  if (value.includes('brain') || value.includes('зарядка') || value.includes('мозг')) return 'brain-charge';
  if (value.includes('resource') || value.includes('клуб') || value.includes('ресурс')) return 'resources-club';
  if (value.includes('intensive') || value.includes('интенсив') || value.includes('папа') || value.includes('мама')) return 'intensive-mom-dad';
  if (value.includes('reboot') || value.includes('перезагрузка')) return 'reboot';
  if (value.includes('mentor') || value.includes('наставнич')) return 'mentorship';
  if (value.includes('consult') || value.includes('консульта')) return 'consultation';

  return '';
}

function hasConsultationIntent(text) {
  const value = String(text || '').toLowerCase();
  if (!value) return false;

  return (
    value.includes('consult') ||
    value.includes('book') ||
    value.includes('appointment') ||
    value.includes('callback') ||
    value.includes('запис') ||
    value.includes('консульта') ||
    value.includes('оставить заявку') ||
    value.includes('перезвон') ||
    value.includes('связаться')
  );
}

function extractLeadFromText(text) {
  const source = String(text || '').trim();
  if (!source) return createEmptyLeadDraft();

  const labeledName = extractLabeledField(source, ['name', 'имя']);
  const labeledEmail = extractLabeledField(source, ['email', 'e-mail', 'почта', 'mail']);
  const labeledPhone = extractLabeledField(source, ['phone', 'телефон', 'номер', 'whatsapp', 'telegram']);
  const labeledService = extractLabeledField(source, ['service', 'program', 'программа', 'услуга', 'курс']);
  const labeledMessage = extractLabeledField(source, ['message', 'goal', 'comment', 'цель', 'сообщение', 'комментарий', 'запрос']);

  const email = String(labeledEmail || extractEmailFromText(source) || '').trim().toLowerCase();
  const phone = normalizePhone(labeledPhone || extractPhoneFromText(source));
  const name = normalizeName(labeledName || extractNameFromText(source));
  const service = String(labeledService || detectServiceFromText(source) || '').trim().toLowerCase();

  let message = String(labeledMessage || '').trim();
  if (!message && source.length <= 500 && (email || phone || name)) {
    message = source;
  }

  return {
    name,
    email,
    phone,
    service,
    message
  };
}

function mergeLeadDraft(baseDraft, patchDraft) {
  const base = baseDraft || createEmptyLeadDraft();
  const patch = patchDraft || createEmptyLeadDraft();

  return {
    name: patch.name || base.name || '',
    email: patch.email || base.email || '',
    phone: patch.phone || base.phone || '',
    service: patch.service || base.service || '',
    message: patch.message || base.message || ''
  };
}

function getMissingLeadFields(leadDraft) {
  const missing = [];

  if (!leadDraft.name) missing.push('name');
  if (!leadDraft.email || !isValidEmail(leadDraft.email)) missing.push('email');
  if (!leadDraft.phone) missing.push('phone');

  return missing;
}

function hasLeadData(leadDraft) {
  return Boolean(leadDraft && (leadDraft.name || leadDraft.email || leadDraft.phone));
}

function missingFieldsText(missing, useRu) {
  const labelsRu = {
    name: 'имя',
    email: 'email',
    phone: 'телефон в формате +1...'
  };

  const labelsEn = {
    name: 'name',
    email: 'email',
    phone: 'phone in +country-code format'
  };

  const labels = useRu ? labelsRu : labelsEn;
  return missing.map((item) => labels[item] || item).join(', ');
}

function buildLeadMessage(rawMessage, source) {
  const normalizedSource = source || 'website';
  const message = String(rawMessage || '').trim();
  if (!message) return `[${normalizedSource}]`;
  return `[${normalizedSource}] ${message}`;
}

const CHAT_KB_STOP_WORDS = new Set([
  'and', 'the', 'that', 'this', 'with', 'from', 'for', 'you', 'your', 'have', 'about', 'what', 'when', 'where',
  'как', 'что', 'это', 'для', 'или', 'если', 'нам', 'вас', 'вам', 'мне', 'моя', 'твой', 'ваш', 'они', 'она',
  'есть', 'быть', 'чтобы', 'когда', 'где', 'какой', 'какая', 'какие', 'можно', 'нужно', 'просто', 'очень', 'тема', 'сайт'
]);

function tokenizeKnowledgeQuery(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s-]/giu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !CHAT_KB_STOP_WORDS.has(token));
}

function parseKnowledgeSections(knowledgeText) {
  const source = String(knowledgeText || '').trim();
  if (!source) return [];

  const lines = source.split(/\r?\n/);
  const sections = [];
  let current = null;

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      if (current) sections.push(current);
      current = {
        title: String(headingMatch[1] || '').trim(),
        bodyLines: []
      };
      continue;
    }

    if (!current) continue;
    current.bodyLines.push(line);
  }

  if (current) sections.push(current);

  return sections.map((section) => {
    const body = section.bodyLines
      .map((line) => String(line || '').trim())
      .filter(Boolean)
      .join('\n');

    const bullets = section.bodyLines
      .map((line) => String(line || '').trim())
      .filter((line) => /^[-*]\s+/.test(line))
      .map((line) => line.replace(/^[-*]\s+/, '').trim())
      .filter(Boolean);

    return {
      title: section.title,
      body,
      bullets
    };
  }).filter((section) => section.title || section.body);
}

function pickKnowledgeSection(message, knowledgeText) {
  const sections = parseKnowledgeSections(knowledgeText);
  if (!sections.length) return null;

  const tokens = tokenizeKnowledgeQuery(message);
  if (!tokens.length) return sections[0] || null;

  let bestSection = null;
  let bestScore = 0;

  for (const section of sections) {
    const title = String(section.title || '').toLowerCase();
    const body = String(section.body || '').toLowerCase();

    let score = 0;
    for (const token of tokens) {
      if (title.includes(token)) score += 3;
      if (body.includes(token)) score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestSection = section;
    }
  }

  return bestScore > 0 ? bestSection : null;
}

function formatKnowledgeFallback(section, useRu) {
  if (!section) return '';

  const lines = (section.bullets.length ? section.bullets : section.body.split('\n'))
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .slice(0, 5);

  if (!lines.length) return '';

  if (useRu) {
    return [
      `По теме "${section.title}" у нас так:`,
      ...lines.map((line) => `- ${line}`),
      '',
      'Если хотите, помогу выбрать программу и сразу оформлю бесплатную консультацию в чате.'
    ].join('\n');
  }

  return [
    `Here is what we have on "${section.title}":`,
    ...lines.map((line) => `- ${line}`),
    '',
    'If you want, I can help you choose a program and create a free consultation request in chat.'
  ].join('\n');
}

function getRuleBasedReply(message, useRu, knowledgeText) {
  const lowerMsg = String(message || '').toLowerCase();

  if (lowerMsg.includes('hello') || lowerMsg.includes('hi') || lowerMsg.includes('привет') || lowerMsg.includes('здравствуйте')) {
    return useRu
      ? 'Добро пожаловать в KVANTUM! Я могу рассказать о программах, ценах и сразу оформить бесплатную консультацию.'
      : 'Welcome to KVANTUM! I can explain programs, pricing, and create a free consultation request right in chat.';
  }

  if (lowerMsg.includes('price') || lowerMsg.includes('cost') || lowerMsg.includes('цена') || lowerMsg.includes('стоимость') || lowerMsg.includes('сколько')) {
    return useRu
      ? 'Актуальные программы и цены:\n\n1. Brain Charge — 1,000 KGS/RUB\n2. Resources Club — 5,000 KGS/месяц\n3. Intensive "Mom & Dad - My 2 Wings" — $300 / 26,300 KGS\n4. REBOOT — $1,000\n5. Mentorship — цену уточняет менеджер\n\nМогу помочь выбрать под вашу задачу и сразу оформить бесплатную консультацию.'
      : 'Current programs and pricing:\n\n1. Brain Charge — 1,000 KGS/RUB\n2. Resources Club — 5,000 KGS/month\n3. Intensive "Mom & Dad - My 2 Wings" — $300 / 26,300 KGS\n4. REBOOT — $1,000\n5. Mentorship — pricing via manager\n\nI can help you choose the best option and create a free consultation request now.';
  }

  if (lowerMsg.includes('brain') || lowerMsg.includes('зарядка') || lowerMsg.includes('мозг')) {
    return useRu
      ? 'Brain Charge — входная программа: 21 день, по ~15 минут в день, стоимость 1,000 KGS/RUB. Подходит, чтобы мягко начать трансформацию состояния и привычек.'
      : 'Brain Charge is our entry program: 21 days, about 15 minutes daily, price 1,000 KGS/RUB. It is the easiest way to start your transformation.';
  }

  if (lowerMsg.includes('resource') || lowerMsg.includes('club') || lowerMsg.includes('клуб') || lowerMsg.includes('ресурс')) {
    return useRu
      ? 'Resources Club: 4 недели, 2 сессии с Алтынай и 2 с куратором, фокус на внутреннем состоянии, уверенности и самоценности. Цена — 5,000 KGS/месяц.'
      : 'Resources Club: 4 weeks, 2 sessions with Altynai and 2 with a curator, focused on confidence, self-worth, and inner state. Price is 5,000 KGS/month.';
  }

  if (lowerMsg.includes('intensive') || lowerMsg.includes('интенсив') || lowerMsg.includes('papa') || lowerMsg.includes('mama') || lowerMsg.includes('папа') || lowerMsg.includes('мама')) {
    return useRu
      ? 'Интенсив "Mom & Dad - My 2 Wings": формат 1 месяц, 10 уроков, 20 практик, 3 Zoom-сессии. Тема — работа с родовыми паттернами. Стоимость: $300 / 26,300 KGS.'
      : 'The "Mom & Dad - My 2 Wings" intensive runs for 1 month with 10 lessons, 20 practices, and 3 Zoom sessions. Focus is family-pattern work. Price: $300 / 26,300 KGS.';
  }

  if (lowerMsg.includes('reboot') || lowerMsg.includes('перезагрузка')) {
    return useRu
      ? 'REBOOT — 8 недель, 24 занятия: ценности, состояние, отношения, финансы. Включает глубокую практическую работу. Стоимость — $1,000.'
      : 'REBOOT is an 8-week program with 24 sessions covering values, state management, relationships, and finances. Price is $1,000.';
  }

  if (lowerMsg.includes('mentor') || lowerMsg.includes('наставнич')) {
    return useRu
      ? 'Mentorship (University of Self-Knowledge) — премиальный формат, цена по запросу через менеджера. Могу сразу оформить заявку на бесплатную консультацию для подбора.'
      : 'Mentorship (University of Self-Knowledge) is our premium format, with pricing provided by managers. I can create a free consultation request right now.';
  }

  if (lowerMsg.includes('consult') || lowerMsg.includes('консультац') || lowerMsg.includes('записаться') || lowerMsg.includes('book')) {
    return useRu
      ? 'Для бесплатной консультации отправьте: имя, email и телефон в международном формате (+код страны). Я сразу оформлю заявку.'
      : 'To book a free consultation, please send your name, email, and phone in international format (+country code). I will create your request immediately.';
  }

  if (lowerMsg.includes('altynai') || lowerMsg.includes('алтынай') || lowerMsg.includes('founder') || lowerMsg.includes('основатель')) {
    return useRu
      ? 'Алтынай Ешинбекова — основатель KVANTUM. Фокус: работа с подсознанием, NLP-инструменты и трансформация состояния.'
      : 'Altynai Eshinbekova is the founder of KVANTUM. Her focus includes subconscious work, NLP tools, and deep state transformation.';
  }

  if (lowerMsg.includes('whatsapp') || lowerMsg.includes('telegram') || lowerMsg.includes('contact') || lowerMsg.includes('связ') || lowerMsg.includes('контакт')) {
    return useRu
      ? 'Связаться можно через WhatsApp и Telegram-кнопки на сайте, либо через заявку в форме/чате. Команда свяжется с вами после заявки.'
      : 'You can contact us via the WhatsApp and Telegram buttons on the website, or leave a request in the form/chat. Our team will follow up.';
  }

  const section = pickKnowledgeSection(message, knowledgeText);
  const knowledgeReply = formatKnowledgeFallback(section, useRu);
  if (knowledgeReply) return knowledgeReply;

  return useRu
    ? 'Могу помочь по темам KVANTUM: программы, цены, консультация и подбор формата. Напишите вашу цель, и я предложу лучший вариант.'
    : 'I can help with KVANTUM topics: programs, pricing, consultation, and choosing the right format. Share your goal, and I will suggest the best option.';
}

function extractAssistantText(content) {
  if (typeof content === 'string') return content.trim();

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (typeof part.text === 'string') return part.text;
        if (part.type === 'text' && typeof part.value === 'string') return part.value;
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();

    return text;
  }

  return '';
}

async function getOpenAIReply(message, history) {
  if (!OPENAI_API_KEY) return '';

  const systemPrompt = await getSystemPrompt();
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-CHAT_HISTORY_LIMIT),
    { role: 'user', content: String(message || '').trim() }
  ];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.5,
        messages
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI error ${response.status}: ${errorText}`);
    }

    const payload = await response.json();
    const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message
      ? payload.choices[0].message.content
      : '';

    return extractAssistantText(content);
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildLeadNotificationText(booking, source) {
  const createdAt = booking && booking.createdAt ? new Date(booking.createdAt).toISOString() : new Date().toISOString();
  return [
    `New KVANTUM lead (${source})`,
    `ID: ${booking.id}`,
    `Name: ${booking.name}`,
    `Email: ${booking.email}`,
    `Phone: ${booking.phone}`,
    `Service: ${booking.service || '-'}`,
    `Status: ${booking.status || 'pending'}`,
    `Message: ${booking.message || '-'}`,
    `Created: ${createdAt}`
  ].join('\n');
}

async function sendTelegramText(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return { ok: false, skipped: true };
  }

  const endpoint = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: String(text || '').slice(0, 4000)
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Telegram error ${response.status}: ${errorText}`);
  }

  return { ok: true };
}

async function notifyLeadCreated(booking, source) {
  if (!booking) return { ok: false, skipped: true };

  try {
    const text = buildLeadNotificationText(booking, source);
    return await sendTelegramText(text);
  } catch (err) {
    console.error('[lead-notify] failed:', err && err.message ? err.message : err);
    return { ok: false, skipped: false };
  }
}

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();
    const normalizedPhone = normalizePhone(phone);

    if (!name || !normalizedEmail || !password || !normalizedPhone) {
      return res.status(400).json({ error: 'Name, valid email, password and phone with country code are required' });
    }

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(String(password), 10);
    const user = await prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        password: hashedPassword,
        phone: normalizedPhone
      }
    });

    const role = isAdminEmail(normalizedEmail) ? 'admin' : 'user';
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Registration successful',
      token,
      user: { id: user.id, name: user.name, email: user.email, role }
    });
  } catch (err) {
    if (err && err.code === 'P2002') {
      return res.status(400).json({ error: 'User already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const role = isAdminEmail(normalizedEmail) ? 'admin' : 'user';
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, name: user.name, email: user.email, role }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Reset password (email + phone verification)
app.post('/api/reset-password', async (req, res) => {
  try {
    const { email, phone, newPassword } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedEmail || !normalizedPhone || !newPassword) {
      return res.status(400).json({ error: 'Email, phone and new password are required' });
    }

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or phone' });
    }

    const storedPhone = normalizePhone(user.phone);
    if (!storedPhone || storedPhone !== normalizedPhone) {
      return res.status(400).json({ error: 'Invalid email or phone' });
    }

    const hashedPassword = await bcrypt.hash(String(newPassword), 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword }
    });

    res.json({ message: 'Password reset successful' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user profile
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, email: true, phone: true }
    });

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Book consultation
app.post('/api/book-consultation', async (req, res) => {
  try {
    const { name, email, phone, service, message } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();
    const normalizedPhone = normalizePhone(phone);

    if (!name || !normalizedEmail || !normalizedPhone) {
      return res.status(400).json({ error: 'Name, valid email and phone with country code are required' });
    }

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const booking = await prisma.booking.create({
      data: {
        name,
        email: normalizedEmail,
        phone: normalizedPhone,
        service: service || 'consultation',
        message: message || '',
        status: 'pending'
      }
    });

    await notifyLeadCreated(booking, 'website-form');

    res.json({
      message: 'Consultation booked successfully! We will contact you via WhatsApp/Telegram.',
      booking: { id: booking.id, status: booking.status }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Process payment (demo)
app.post('/api/payment', authenticateToken, async (req, res) => {
  try {
    const { productId, productName, amount, currency } = req.body;
    const normalizedAmount = Number(amount);

    if (!Number.isFinite(normalizedAmount)) {
      return res.status(400).json({ error: 'Invalid payment amount' });
    }

    const payment = await prisma.payment.create({
      data: {
        id: 'PAY-' + Date.now(),
        userId: req.user.id,
        productId: productId || null,
        productName: productName || null,
        amount: normalizedAmount,
        currency: currency || 'KGS',
        status: 'completed'
      }
    });

    res.json({
      message: 'Payment processed successfully!',
      payment: {
        id: payment.id,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency
      },
      notification: 'Confirmation sent via WhatsApp/Telegram'
    });
  } catch (err) {
    if (err && err.code === 'P2003') {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(500).json({ error: 'Payment processing error' });
  }
});

// Admin booking status update
app.patch('/api/admin/bookings/:id', authenticateAdmin, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id, 10);
    const status = String(req.body.status || '').trim().toLowerCase();
    const note = String(req.body.note || '').trim();

    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return res.status(400).json({ error: 'Invalid booking id' });
    }

    if (!ALLOWED_BOOKING_STATUSES.has(status)) {
      return res.status(400).json({ error: 'Invalid booking status' });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        service: true,
        status: true,
        message: true,
        createdAt: true
      }
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    let nextMessage = booking.message || '';
    if (note) {
      const noteLine = `[ADMIN ${new Date().toISOString()}] ${note}`;
      nextMessage = nextMessage ? `${nextMessage}\n${noteLine}` : noteLine;
    }

    const updatedBooking = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status,
        message: nextMessage
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        service: true,
        status: true,
        message: true,
        createdAt: true
      }
    });

    res.json({
      message: 'Booking updated successfully',
      booking: updatedBooking
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin dashboard data
app.get('/api/admin/overview', authenticateAdmin, async (req, res) => {
  try {
    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 25;

    const [
      totalUsers,
      totalBookings,
      totalPayments,
      users,
      bookings,
      payments
    ] = await prisma.$transaction([
      prisma.user.count(),
      prisma.booking.count(),
      prisma.payment.count(),
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          createdAt: true
        }
      }),
      prisma.booking.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          service: true,
          status: true,
          message: true,
          createdAt: true
        }
      }),
      prisma.payment.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          userId: true,
          productId: true,
          productName: true,
          amount: true,
          currency: true,
          status: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      })
    ]);

    res.json({
      totals: {
        users: totalUsers,
        bookings: totalBookings,
        payments: totalPayments
      },
      users,
      bookings,
      payments
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== Content Management (Admin Panel) =====

function formatContentItem(item) {
  const data = typeof item.data === 'string' ? JSON.parse(item.data) : (item.data || {});
  return { _id: String(item.id), ...data, order: item.sortOrder };
}

// Public content endpoints
app.get('/api/content/testimonials', async (req, res) => {
  try {
    const items = await prisma.content.findMany({
      where: { type: 'testimonial' },
      orderBy: { sortOrder: 'asc' }
    });
    res.json(items.map(formatContentItem));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/content/programs', async (req, res) => {
  try {
    const items = await prisma.content.findMany({
      where: { type: 'program' },
      orderBy: { sortOrder: 'asc' }
    });
    res.json(items.map(formatContentItem));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin check
app.get('/api/admin/check', authenticateAdmin, (req, res) => {
  res.json({ isAdmin: true });
});

// Admin leads list (bookings with search and status filter)
app.get('/api/admin/leads', authenticateAdmin, async (req, res) => {
  try {
    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;
    const status = String(req.query.status || '').trim().toLowerCase();
    const search = String(req.query.search || '').trim();

    const where = {};

    if (status && status !== 'all') {
      if (!ALLOWED_BOOKING_STATUSES.has(status)) {
        return res.status(400).json({ error: 'Invalid booking status' });
      }
      where.status = status;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { service: { contains: search, mode: 'insensitive' } },
        { message: { contains: search, mode: 'insensitive' } }
      ];
    }

    const leads = await prisma.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        service: true,
        status: true,
        message: true,
        createdAt: true
      }
    });

    res.json({ leads });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin chat sessions list
app.get('/api/admin/chats', authenticateAdmin, async (req, res) => {
  try {
    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 300) : 100;
    const status = String(req.query.status || '').trim().toLowerCase();
    const search = String(req.query.search || '').trim();

    const where = {};

    if (status && status !== 'all') {
      if (!CHAT_SESSION_STATUSES.has(status)) {
        return res.status(400).json({ error: 'Invalid chat status' });
      }
      where.leadStatus = status;
    }

    if (search) {
      where.OR = [
        { sessionId: { contains: search, mode: 'insensitive' } },
        { leadName: { contains: search, mode: 'insensitive' } },
        { leadEmail: { contains: search, mode: 'insensitive' } },
        { leadPhone: { contains: search, mode: 'insensitive' } },
        { leadService: { contains: search, mode: 'insensitive' } },
        { leadMessage: { contains: search, mode: 'insensitive' } },
        { messages: { some: { content: { contains: search, mode: 'insensitive' } } } }
      ];
    }

    const chatRows = await prisma.chatSession.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        sessionId: true,
        locale: true,
        leadName: true,
        leadEmail: true,
        leadPhone: true,
        leadService: true,
        leadMessage: true,
        leadStatus: true,
        bookingId: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            role: true,
            content: true,
            createdAt: true
          }
        }
      }
    });

    const chats = chatRows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      locale: row.locale,
      leadStatus: row.leadStatus,
      lead: {
        name: row.leadName,
        email: row.leadEmail,
        phone: row.leadPhone,
        service: row.leadService,
        message: row.leadMessage
      },
      bookingId: row.bookingId,
      messageCount: row._count.messages,
      lastMessage: row.messages[0] || null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));

    res.json({ chats });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin chat messages by chat session id
app.get('/api/admin/chats/:id/messages', authenticateAdmin, async (req, res) => {
  try {
    const chatId = parseInt(req.params.id, 10);
    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 200;

    if (!Number.isInteger(chatId) || chatId <= 0) {
      return res.status(400).json({ error: 'Invalid chat id' });
    }

    const chat = await prisma.chatSession.findUnique({
      where: { id: chatId },
      select: {
        id: true,
        sessionId: true,
        locale: true,
        leadStatus: true,
        leadName: true,
        leadEmail: true,
        leadPhone: true,
        leadService: true,
        leadMessage: true,
        bookingId: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const rows = await prisma.chatMessage.findMany({
      where: { chatSessionId: chatId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true
      }
    });

    const messages = rows.slice().reverse();

    res.json({ chat, messages });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin chat status update
app.patch('/api/admin/chats/:id/status', authenticateAdmin, async (req, res) => {
  try {
    const chatId = parseInt(req.params.id, 10);
    const status = String(req.body.status || '').trim().toLowerCase();

    if (!Number.isInteger(chatId) || chatId <= 0) {
      return res.status(400).json({ error: 'Invalid chat id' });
    }

    if (!CHAT_SESSION_STATUSES.has(status)) {
      return res.status(400).json({ error: 'Invalid chat status' });
    }

    const updated = await prisma.chatSession.update({
      where: { id: chatId },
      data: { leadStatus: status },
      select: {
        id: true,
        sessionId: true,
        leadStatus: true,
        updatedAt: true
      }
    });

    res.json({ message: 'Chat status updated', chat: updated });
  } catch (err) {
    if (err && err.code === 'P2025') {
      return res.status(404).json({ error: 'Chat not found' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin chatbot knowledge base editor
app.get('/api/admin/chatbot-knowledge', authenticateAdmin, async (req, res) => {
  try {
    const fallback = loadKnowledgeBaseFromFile();
    const item = await prisma.content.findFirst({
      where: { type: CHAT_KNOWLEDGE_CONTENT_TYPE },
      orderBy: { updatedAt: 'desc' }
    });

    const dbText = item && item.data && typeof item.data === 'object' && !Array.isArray(item.data)
      ? normalizeKnowledgeText(item.data.text)
      : '';

    const text = dbText || fallback;
    knowledgeBaseCache = text;
    knowledgeBaseCacheUpdatedAt = Date.now();

    res.json({
      text,
      source: dbText ? 'database' : 'file'
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/admin/chatbot-knowledge', authenticateAdmin, async (req, res) => {
  try {
    const text = typeof req.body.text === 'string' ? req.body.text : '';
    const savedText = await setKnowledgeBaseText(text);

    res.json({
      message: 'Chatbot knowledge base saved',
      text: savedText
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin content CRUD (generic for testimonials, programs, services)
function registerContentCrud(contentType, routePrefix) {
  app.get(routePrefix, authenticateAdmin, async (req, res) => {
    try {
      const items = await prisma.content.findMany({
        where: { type: contentType },
        orderBy: { sortOrder: 'asc' }
      });
      res.json(items.map(formatContentItem));
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post(routePrefix, authenticateAdmin, async (req, res) => {
    try {
      const order = typeof req.body.order === 'number' ? req.body.order : 0;
      const data = { ...req.body };
      delete data.order;
      delete data._id;
      const item = await prisma.content.create({
        data: { type: contentType, data, sortOrder: order }
      });
      res.status(201).json(formatContentItem(item));
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.put(routePrefix + '/:id', authenticateAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid ID' });
      }
      const existing = await prisma.content.findFirst({ where: { id, type: contentType } });
      if (!existing) return res.status(404).json({ error: 'Not found' });

      const order = typeof req.body.order === 'number' ? req.body.order : existing.sortOrder;
      const data = { ...req.body };
      delete data.order;
      delete data._id;

      const updated = await prisma.content.update({
        where: { id },
        data: { data, sortOrder: order }
      });
      res.json(formatContentItem(updated));
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.delete(routePrefix + '/:id', authenticateAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid ID' });
      }
      const existing = await prisma.content.findFirst({ where: { id, type: contentType } });
      if (!existing) return res.status(404).json({ error: 'Not found' });

      await prisma.content.delete({ where: { id } });
      res.json({ message: 'Deleted' });
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });
}

registerContentCrud('testimonial', '/api/admin/testimonials');
registerContentCrud('program', '/api/admin/programs');
registerContentCrud('service', '/api/admin/services');

// Services also accessible via /api/services (used by admin.js for some operations)
app.get('/api/services', async (req, res) => {
  try {
    const items = await prisma.content.findMany({
      where: { type: 'service' },
      orderBy: { sortOrder: 'asc' }
    });
    res.json(items.map(formatContentItem));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/services', authenticateAdmin, async (req, res) => {
  try {
    const data = { ...req.body };
    const order = typeof data.order === 'number' ? data.order : 0;
    delete data.order;
    delete data._id;
    const item = await prisma.content.create({
      data: { type: 'service', data, sortOrder: order }
    });
    res.status(201).json({ message: 'Service created', service: formatContentItem(item) });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/services/:id', authenticateAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid ID' });
    }
    const existing = await prisma.content.findFirst({ where: { id, type: 'service' } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const data = { ...req.body };
    const order = typeof data.order === 'number' ? data.order : existing.sortOrder;
    delete data.order;
    delete data._id;

    const updated = await prisma.content.update({
      where: { id },
      data: { data, sortOrder: order }
    });
    res.json({ message: 'Service updated', service: formatContentItem(updated) });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/services/:id', authenticateAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid ID' });
    }
    const existing = await prisma.content.findFirst({ where: { id, type: 'service' } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    await prisma.content.delete({ where: { id } });
    res.json({ message: 'Service deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// AI Chatbot endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    const sessionId = normalizeSessionId(req.body.sessionId);

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    cleanupChatSessions();

    const useRu = isRussianText(message);
    const session = getChatSession(sessionId);
    const chatSessionRecord = await ensureChatSessionRecord(sessionId, useRu ? 'ru' : 'en');

    if (session && chatSessionRecord) {
      await hydrateMemoryChatSession(session, chatSessionRecord);
    }

    const persistedLeadDraft = chatSessionRecord && chatSessionRecord.leadStatus === 'collecting'
      ? leadDraftFromChatSession(chatSessionRecord)
      : null;

    const currentLeadDraft = mergeLeadDraft(
      persistedLeadDraft,
      session ? session.leadDraft : null
    );

    const extractedLead = extractLeadFromText(message);
    const consultIntent = hasConsultationIntent(message);

    if (consultIntent || hasLeadData(extractedLead) || hasLeadData(currentLeadDraft)) {
      const mergedLead = mergeLeadDraft(currentLeadDraft, extractedLead);
      if (!mergedLead.service) {
        mergedLead.service = detectServiceFromText(message) || 'chat-consultation';
      }

      if (!mergedLead.message) {
        mergedLead.message = message;
      }

      if (session) {
        session.leadDraft = mergedLead;
      }

      appendChatHistory(session, 'user', message);
      await saveChatMessageRecord(chatSessionRecord && chatSessionRecord.id, 'user', message);

      const missing = getMissingLeadFields(mergedLead);

      if (missing.length === 0) {
        const booking = await prisma.booking.create({
          data: {
            name: mergedLead.name,
            email: mergedLead.email,
            phone: mergedLead.phone,
            service: mergedLead.service || 'chat-consultation',
            message: buildLeadMessage(mergedLead.message, 'chatbot'),
            status: 'pending'
          }
        });

        await notifyLeadCreated(booking, 'chatbot');

        if (session) {
          session.leadDraft = createEmptyLeadDraft();
        }

        await markChatSessionBooked(chatSessionRecord && chatSessionRecord.id, booking.id, mergedLead);

        const reply = useRu
          ? `Готово! Я записал вас на консультацию. Номер заявки: #${booking.id}. Мы свяжемся с вами в WhatsApp/Telegram.`
          : `Done! Your consultation request is created. Booking ID: #${booking.id}. Our team will contact you via WhatsApp/Telegram.`;

        appendChatHistory(session, 'assistant', reply);
        await saveChatMessageRecord(chatSessionRecord && chatSessionRecord.id, 'assistant', reply);

        return res.json({
          reply,
          booking: {
            id: booking.id,
            status: booking.status
          }
        });
      }

      await persistChatLeadDraft(chatSessionRecord && chatSessionRecord.id, mergedLead, 'collecting');

      const missingText = missingFieldsText(missing, useRu);
      const reply = useRu
        ? `Чтобы записать вас из чата, пришлите недостающие данные: ${missingText}. Можно одним сообщением в формате: Имя, Email, Телефон (+код страны).`
        : `To book from chat, please send missing details: ${missingText}. You can send all in one message: Name, Email, Phone (+country code).`;

      appendChatHistory(session, 'assistant', reply);
      await saveChatMessageRecord(chatSessionRecord && chatSessionRecord.id, 'assistant', reply);

      return res.json({ reply, missingFields: missing });
    }

    const history = session ? session.history : [];

    let reply = '';
    try {
      reply = await getOpenAIReply(message, history);
    } catch (err) {
      console.error('[chat] OpenAI request failed:', err && err.message ? err.message : err);
    }

    if (!reply) {
      const knowledgeText = await getKnowledgeBaseText();
      reply = getRuleBasedReply(message, useRu, knowledgeText);
    }

    appendChatHistory(session, 'user', message);
    appendChatHistory(session, 'assistant', reply);

    await saveChatMessageRecord(chatSessionRecord && chatSessionRecord.id, 'user', message);
    await saveChatMessageRecord(chatSessionRecord && chatSessionRecord.id, 'assistant', reply);

    return res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Send notification
app.post('/api/notify', async (req, res) => {
  const { type, phone, message } = req.body;

  if (type === 'whatsapp') {
    const whatsappUrl = `https://wa.me/${(phone || '').replace(/[^0-9]/g, '')}?text=${encodeURIComponent(message || 'Thank you for your purchase at QUANTUM!')}`;
    return res.json({ message: 'WhatsApp notification ready', url: whatsappUrl });
  }

  if (type === 'telegram') {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      return res.json({ message: 'Telegram notification skipped', note: 'Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to enable delivery' });
    }

    const payload = [
      'QUANTUM notification',
      `Phone: ${phone || '-'}`,
      `Message: ${message || 'Notification from website'}`
    ].join('\n');

    try {
      await sendTelegramText(payload);
      return res.json({ message: 'Telegram notification sent' });
    } catch (err) {
      return res.status(502).json({ error: 'Failed to send Telegram notification' });
    }
  }

  return res.json({ message: 'Notification sent' });
});

if (SERVE_STATIC) {
  app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  });
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
}

let server;
if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log(`QUANTUM server running at http://localhost:${PORT}`);
    if (ALLOWED_ORIGINS.length) {
      console.log(`CORS enabled for: ${ALLOWED_ORIGINS.join(', ')}`);
    } else {
      console.log('CORS enabled for all origins (ALLOWED_ORIGINS is empty)');
    }
    if (OPENAI_API_KEY) {
      console.log(`OpenAI chat enabled with model: ${OPENAI_MODEL}`);
    } else {
      console.log('OpenAI chat disabled (OPENAI_API_KEY is not set); using fallback bot logic');
    }

    if (knowledgeBaseCache) {
      console.log('Chat knowledge base loaded (file/database)');
    } else {
      console.log('Chat knowledge base not found; using built-in prompt only');
    }
    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
      console.log('Telegram lead notifications enabled');
    } else {
      console.log('Telegram lead notifications disabled (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)');
    }
  });

  const shutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    if (server) {
      server.close(async () => {
        await prisma.$disconnect();
        process.exit(0);
      });
      return;
    }

    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Export for Vercel serverless
module.exports = app;
