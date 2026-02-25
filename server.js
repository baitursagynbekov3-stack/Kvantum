require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = global.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET_RAW = String(process.env.JWT_SECRET || '').trim();
if (!JWT_SECRET_RAW && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET is required in production');
}
const JWT_SECRET = JWT_SECRET_RAW || crypto.randomBytes(48).toString('hex');
if (!JWT_SECRET_RAW) {
  console.warn('[security] JWT_SECRET is not set; using ephemeral dev secret');
}

const SERVE_STATIC = process.env.SERVE_STATIC !== 'false';
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();

const DEFAULT_ALLOWED_ORIGINS = [
  'https://kvantum-api.vercel.app'
];
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS_SET = new Set(ALLOWED_ORIGINS);

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'baitursagynbekov3@gmail.com')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const USER_ROLES = new Set(['user', 'admin']);
const ALLOWED_BOOKING_STATUSES = new Set(['pending', 'new', 'in_progress', 'done', 'cancelled']);
const CHAT_HISTORY_LIMIT = 12;
const CHAT_DB_HISTORY_LIMIT = CHAT_HISTORY_LIMIT * 2;
const CHAT_SESSIONS_LIMIT = 300;
const CHAT_SESSION_TTL_MS = 1000 * 60 * 60;
const CHAT_SESSION_STATUSES = new Set(['open', 'collecting', 'booked', 'closed', 'spam']);
const CHAT_KNOWLEDGE_CONTENT_TYPE = 'chatbot_kb';
const KNOWLEDGE_CACHE_TTL_MS = 1000 * 60;

const AUTH_RATE_LIMIT = { windowMs: 15 * 60 * 1000, max: 30, message: 'Too many auth attempts. Please try later.' };
const RESET_RATE_LIMIT = { windowMs: 15 * 60 * 1000, max: 10, message: 'Too many reset attempts. Please try later.' };
const CHAT_RATE_LIMIT = { windowMs: 60 * 1000, max: 40, message: 'Too many chat requests. Slow down a bit.' };
const RESET_CODE_TTL_MS = 10 * 60 * 1000;
const RESET_CODE_MAX_ATTEMPTS = 5;
const ALLOW_INSECURE_RESET_CODE_RESPONSE = String(process.env.ALLOW_INSECURE_RESET_CODE_RESPONSE || '').trim() === 'true';

const chatSessions = new Map();
const rateLimitBuckets = new Map();
const passwordResetChallenges = new Map();

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

    if (ALLOWED_ORIGINS_SET.has(origin)) {
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

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.ip || req.socket.remoteAddress || 'unknown';
}

function cleanupRateLimitBuckets(now) {
  if (rateLimitBuckets.size < 5000) return;

  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (!bucket || now > bucket.resetAt) {
      rateLimitBuckets.delete(key);
    }
  }
}

function createRateLimiter(config) {
  const windowMs = Number(config.windowMs) || 60 * 1000;
  const max = Number(config.max) || 20;
  const message = String(config.message || 'Too many requests');
  const prefix = String(config.prefix || 'global');

  return (req, res, next) => {
    const now = Date.now();
    cleanupRateLimitBuckets(now);

    const key = `${prefix}:${getClientIp(req)}`;
    let bucket = rateLimitBuckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      rateLimitBuckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (bucket.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({ error: message });
    }

    return next();
  };
}

const authRateLimiter = createRateLimiter({ ...AUTH_RATE_LIMIT, prefix: 'auth' });
const resetRateLimiter = createRateLimiter({ ...RESET_RATE_LIMIT, prefix: 'reset' });
const chatRateLimiter = createRateLimiter({ ...CHAT_RATE_LIMIT, prefix: 'chat' });

function normalizeUserRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return USER_ROLES.has(normalized) ? normalized : 'user';
}

async function syncAdminRolesFromEnv() {
  if (!ADMIN_EMAILS.length) return;

  await prisma.user.updateMany({
    where: { email: { in: ADMIN_EMAILS } },
    data: { role: 'admin' }
  });
}

async function resolveUserRoleFromDb(user) {
  if (!user) return 'user';

  if (user.id) {
    const byId = await prisma.user.findUnique({
      where: { id: Number(user.id) },
      select: { role: true, email: true }
    });

    if (byId) {
      if (normalizeUserRole(byId.role) === 'admin') return 'admin';
      if (isAdminEmail(byId.email)) return 'admin';
      return 'user';
    }
  }

  if (user.email) {
    const byEmail = await prisma.user.findUnique({
      where: { email: String(user.email).trim().toLowerCase() },
      select: { role: true, email: true }
    });

    if (byEmail) {
      if (normalizeUserRole(byEmail.role) === 'admin') return 'admin';
      if (isAdminEmail(byEmail.email)) return 'admin';
      return 'user';
    }
  }

  return isAdminEmail(user.email) ? 'admin' : 'user';
}

function getResetChallengeKey(email, phone) {
  return `${String(email || '').trim().toLowerCase()}|${normalizePhone(phone)}`;
}

function hashResetCode(code) {
  return crypto.createHash('sha256').update(String(code || '')).digest('hex');
}

function generateResetCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function createResetChallenge(email, phone) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedEmail || !normalizedPhone) {
    return null;
  }

  const code = generateResetCode();
  const challenge = {
    codeHash: hashResetCode(code),
    expiresAt: Date.now() + RESET_CODE_TTL_MS,
    attemptsLeft: RESET_CODE_MAX_ATTEMPTS
  };

  passwordResetChallenges.set(getResetChallengeKey(normalizedEmail, normalizedPhone), challenge);
  return code;
}

function validateResetCode(email, phone, code) {
  const key = getResetChallengeKey(email, phone);
  const challenge = passwordResetChallenges.get(key);

  if (!challenge) return false;
  if (Date.now() > challenge.expiresAt) {
    passwordResetChallenges.delete(key);
    return false;
  }

  if (challenge.attemptsLeft <= 0) {
    passwordResetChallenges.delete(key);
    return false;
  }

  challenge.attemptsLeft -= 1;

  if (challenge.codeHash !== hashResetCode(code)) {
    if (challenge.attemptsLeft <= 0) passwordResetChallenges.delete(key);
    return false;
  }

  passwordResetChallenges.delete(key);
  return true;
}

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
  return authenticateToken(req, res, async () => {
    try {
      if (normalizeUserRole(req.user && req.user.role) === 'admin') {
        return next();
      }

      const roleFromDb = await resolveUserRoleFromDb(req.user);
      if (roleFromDb === 'admin') {
        return next();
      }

      return res.status(403).json({ error: 'Admin access required' });
    } catch (err) {
      return res.status(500).json({ error: 'Server error' });
    }
  });
}

function isValidEmail(email) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizedEmail);
}

function isStrongPassword(password) {
  const value = String(password || '');
  if (value.length < 8) return false;
  if (!/[a-z]/i.test(value)) return false;
  if (!/\d/.test(value)) return false;
  return true;
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

  if (bestScore > 0) return bestSection;

  const fallbackSection = sections.find((section) => /brand|program|consultation|communication/i.test(String(section.title || '')));
  return fallbackSection || sections[0] || null;
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

  // Greeting
  if (/(^|\s)(hello|hey|hi|good\s*(morning|evening|day|afternoon)|привет|здравствуйте|салам|добрый\s*(день|вечер|утро)|здрасте)(\s|$)/i.test(lowerMsg)) {
    return useRu
      ? 'Здравствуйте! Добро пожаловать в КВАНТУМ! Я ваш AI-ассистент. Могу помочь с:\n\n• Информация о программах и ценах\n• Запись на бесплатную консультацию\n• Как проходят сессии\n• Способы оплаты\n\nЧто вас интересует?'
      : 'Hello! Welcome to QUANTUM! I\'m your AI assistant. I can help you with:\n\n• Program info & pricing\n• Booking a free consultation\n• How our sessions work\n• Payment methods\n\nWhat would you like to know?';
  }

  // Pricing
  if (/(price|pricing|cost|how much|tariff|тариф|цен[аыу]|стоимост|сколько стоит|прайс|расценк)/i.test(lowerMsg)) {
    return useRu
      ? 'Наши программы и цены:\n\n1. Зарядка мозга (вход) — 1,000 сом/руб\n2. Клуб «Ресурсы» — 5,000 сом/мес\n3. Интенсив «Папа, Мама» — $300 / 26,300 сом\n4. ПЕРЕЗАГРУЗКА (премиум) — $1,000\n5. Наставничество (элит) — уточняйте у менеджеров\n\nВсе программы включают личное сопровождение. Хотите подробнее о какой-то программе или записаться на бесплатную консультацию?'
      : 'Our programs & pricing:\n\n1. Brain Charge (entry) — 1,000 KGS/RUB\n2. Club "Resources" — 5,000 KGS/month\n3. Intensive "Mom & Dad" — $300 / 26,300 KGS\n4. REBOOT (premium) — $1,000 USD\n5. Mentorship (elite) — contact us for pricing\n\nAll programs include personal support. Would you like details on any specific program, or shall I help you book a free consultation?';
  }

  // Brain Charge
  if (/(brain\s*charge|зарядк[аиу]\s*мозг|мозг.*зарядк|brain.*program|первая программ)/i.test(lowerMsg)) {
    return useRu
      ? 'Зарядка мозга — Перепрограммирование реальности:\n\n• Длительность: 21 день\n• Формат: 15 минут в день, онлайн\n• Расписание: 6:00 утра по времени КР\n• Цена: 1,000 сом / 1,000 руб\n\nЧто входит:\n— Работа с мыслями и чувствами\n— Техники трансформации состояния\n— Изменения в жизни, отношениях и финансах\n\nИдеальная точка входа для трансформации! Хотите записаться?'
      : 'Brain Charge — Reality Reprogramming:\n\n• Duration: 21 days\n• Format: 15 minutes per day, online\n• Schedule: 6:00 AM Kyrgyzstan time\n• Price: 1,000 KGS / 1,000 RUB\n\nWhat you get:\n— Work with thoughts & feelings\n— State transformation techniques\n— Shifts in life, relationships & finances\n\nThis is the perfect starting point for your transformation! Want to enroll?';
  }

  // Resources Club
  if (/(resource|club|клуб|ресурс)/i.test(lowerMsg)) {
    return useRu
      ? 'Клуб «Ресурсы» — Усиление состояния:\n\n• Длительность: 4 недели\n• 2 встречи с Алтынай лично\n• 2 встречи с куратором\n• Формат: онлайн групповые сессии\n• Цена: 5,000 сом/мес\n\nНаправления работы:\n— Защищённость и уверенность\n— Ценность и любовь к себе\n— Свобода и внутренняя опора\n\nГотовы усилить своё состояние?'
      : 'Club "Resources" — State Enhancement:\n\n• Duration: 4 weeks\n• 2 sessions with Altynai personally\n• 2 sessions with a curator\n• Format: online group sessions\n• Price: 5,000 KGS/month\n\nFocus areas:\n— Building confidence & security\n— Self-worth & self-love\n— Freedom & inner foundation\n\nReady to strengthen your inner state?';
  }

  // Intensive
  if (/(intensive|интенсив|mom\s*(and|&|,)?\s*dad|papa|mama|папа|мама|родител|крыл|wings)/i.test(lowerMsg)) {
    return useRu
      ? 'Интенсив «Папа, Мама — мои 2 крыла»:\n\n• Длительность: 1 месяц\n• 10 уроков + 20 практических упражнений\n• 3 Zoom встречи с Алтынай\n• Формат: онлайн, в своём темпе + живые сессии\n• Цена: $300 / 26,300 сом\n\nТемы:\n— Сепарация и независимость от родителей\n— Выход из унаследованных сценариев\n— Восстановление семейной иерархии\n— Снятие детских блоков\n\nЭто наша самая популярная программа!'
      : 'Intensive "Mom & Dad — My 2 Wings":\n\n• Duration: 1 month\n• 10 lessons + 20 practical exercises\n• 3 Zoom sessions with Altynai\n• Format: online, self-paced + live sessions\n• Price: $300 / 26,300 KGS\n\nTopics covered:\n— Separation & independence from parents\n— Breaking inherited patterns & scenarios\n— Restoring family hierarchy\n— Releasing childhood blocks\n\nThis is our most popular program!';
  }

  // REBOOT
  if (/(reboot|перезагрузк|ребут|управлени.*реальност|reality.*manage)/i.test(lowerMsg)) {
    return useRu
      ? 'ПЕРЕЗАГРУЗКА — Осознанное управление реальностью:\n\n• Длительность: 8 недель, 24 встречи\n• 20 уроков + 20 практик\n• 1 личная встреча с Алтынай\n• 2 встречи с кураторами\n• Формат: онлайн, структурированные еженедельные модули\n• Цена: $1,000\n\nТемы:\n— Ценности и личные принципы\n— Мастерство управления состоянием\n— Отношения без зависимости\n— Финансы под вашим контролем\n\nГлубокая трансформация всей вашей реальности.'
      : 'REBOOT — Conscious Reality Management:\n\n• Duration: 8 weeks, 24 sessions\n• 20 lessons + 20 practices\n• 1 personal session with Altynai\n• 2 curator sessions\n• Format: online, structured weekly modules\n• Price: $1,000 USD\n\nTopics:\n— Values & personal principles\n— State management mastery\n— Relationships without dependency\n— Financial control & abundance mindset\n\nA deep transformation of your entire reality.';
  }

  // Mentorship
  if (/(mentor|наставничеств|университет|самопознан|elite|элит|premium.*program|продвинут)/i.test(lowerMsg)) {
    return useRu
      ? 'Наставничество — Университет самопознания:\n\nЭлитная программа для тех, кто хочет освоить эти навыки профессионально:\n\n• Считывание поля\n• Работа с эмоциями и блоками подсознания\n• Мастерство квантового поля\n• 30 практик НЛП\n• Основы расстановок\n• Живая практика с кураторами\n• Полная передача знаний\n\nФормат: онлайн + живые практики\nЦена: индивидуально — уточняйте у менеджеров\n\nЗачисление только после личной консультации с Алтынай.'
      : 'Mentorship — University of Self-Knowledge:\n\nOur elite program for those who want to master these skills professionally:\n\n• Field reading skills\n• Emotions & subconscious block work\n• Quantum field mastery\n• 30 NLP practices\n• Constellation fundamentals\n• Live practice with curators\n• Full knowledge transfer\n\nFormat: online + live practice sessions\nPrice: individual — contact our managers\n\nThis program is by application only after a personal consultation with Altynai.';
  }

  // Booking / Consultation
  if (/(consult|book|appointment|sign\s*up|enroll|register|записат|регистр|запис|консультац|хочу\s*(начать|записат|попасть)|как\s*(начать|записат|попасть))/i.test(lowerMsg)) {
    return useRu
      ? 'Чтобы записаться на бесплатную консультацию:\n\n1. Нажмите «Записаться на консультацию» на сайте\n2. Заполните имя, email и телефон\n3. Мы свяжемся с вами через WhatsApp или Telegram в течение 24 часов\n\nВход в индивидуальную работу только после бесплатной консультации — мы обеспечиваем правильный подбор.\n\nТакже можно написать нам напрямую в WhatsApp или Telegram!'
      : 'To book a free consultation:\n\n1. Click "Book Free Consultation" on our website\n2. Fill in your name, email, and phone\n3. We\'ll contact you via WhatsApp or Telegram within 24 hours\n\nEntry to individual work is only after a free consultation — we ensure the right fit for both sides.\n\nYou can also message us directly on WhatsApp or Telegram!';
  }

  // Founder
  if (/(altynai|алтынай|эшинбеков|eshinbekov|founder|основател|кто\s*(вед[её]т|провод|автор)|who\s*(is|runs|leads|created))/i.test(lowerMsg)) {
    return useRu
      ? 'Алтынай Эшинбекова — Основатель КВАНТУМ:\n\n• Специалист по работе с подсознанием и квантовым полем\n• Мастер НЛП\n• Мастер глубинных разборов\n• 500+ трансформированных клиентов\n• 5+ лет опыта\n\nЕё подход: глубокая, экологичная работа с реальными, измеримыми результатами. Лично сопровождает каждого клиента к его цели.\n\n«Вы в нужном месте и в нужное время.»'
      : 'Altynai Eshinbekova — Founder of QUANTUM:\n\n• Specialist in subconscious and quantum field work\n• NLP Master practitioner\n• Master of deep analysis sessions\n• 500+ clients transformed\n• 5+ years of experience\n\nHer approach: deep, ecological work with real, measurable results. She personally accompanies each client to their goal.\n\n"You are in the right place at the right time."';
  }

  // Contact
  if (/(whatsapp|telegram|instagram|youtube|contact|связ[аьи]|контакт|соц.*сет|social|написат|позвонит|reach|phone number|номер)/i.test(lowerMsg)) {
    return useRu
      ? 'Как с нами связаться:\n\n• WhatsApp — нажмите кнопку WhatsApp на сайте\n• Telegram — нажмите кнопку Telegram\n• Instagram — подписывайтесь на обновления и контент\n• YouTube — смотрите бесплатные материалы и истории клиентов\n\nТакже можно заполнить форму на сайте — мы свяжемся в течение 24 часов.\n\nКакой способ связи предпочитаете? Мы подстроимся!'
      : 'How to reach us:\n\n• WhatsApp — click the WhatsApp button on the website\n• Telegram — click the Telegram button\n• Instagram — follow us for updates & content\n• YouTube — watch free materials & client stories\n\nYou can also fill out the contact form on the website and we\'ll reach out to you within 24 hours.\n\nPreferred contact method? We\'ll adapt to you!';
  }

  // Payment
  if (/(pay|payment|оплат|заплатит|карт[аоу]|card|transfer|перевод|как\s*оплатит|how\s*to\s*pay|способ.*оплат|method.*pay|visa|mastercard|банк|bank)/i.test(lowerMsg)) {
    return useRu
      ? 'Способы оплаты:\n\n• Банковская карта (Visa/MasterCard) через безопасную форму на сайте\n• Банковский перевод\n• Свяжитесь с нами для альтернативных способов\n\nОплата проходит безопасно. После оплаты вы получите подтверждение через WhatsApp/Telegram.\n\nЦены указаны в сомах (KGS), рублях или долларах в зависимости от программы. Помочь выбрать программу?'
      : 'Payment methods:\n\n• Bank card (Visa/MasterCard) via our secure payment form\n• Bank transfer\n• Contact us for alternative methods\n\nPayments are processed securely. After payment, you\'ll receive confirmation via WhatsApp/Telegram.\n\nAll prices are listed in KGS (Kyrgyz Som), RUB, or USD depending on the program. Need help choosing a program?';
  }

  // Schedule
  if (/(schedule|when|what time|timing|расписани|когда|во сколько|время|график|утр[оа]|вечер|session.*time|время.*сесси)/i.test(lowerMsg)) {
    return useRu
      ? 'Расписание сессий:\n\n• Зарядка мозга: ежедневно в 6:00 утра (время КР, UTC+6)\n• Клуб «Ресурсы»: еженедельные сессии, расписание с группой\n• Интенсив и ПЕРЕЗАГРУЗКА: гибкий график, уроки доступны в любое время + живые Zoom по договорённости\n• Наставничество: индивидуальный график с Алтынай\n\nВсе живые сессии проходят онлайн через Zoom. Записи доступны, если пропустили.\n\nХотите узнать расписание конкретной программы?'
      : 'Session schedule:\n\n• Brain Charge: daily at 6:00 AM (Kyrgyzstan time, UTC+6)\n• Club "Resources": weekly sessions, schedule set with your group\n• Intensive & REBOOT: flexible scheduling, lessons available anytime + live Zoom sessions by appointment\n• Mentorship: individual schedule agreed with Altynai\n\nAll live sessions are conducted online via Zoom. Recordings are available if you miss a session.\n\nWant to know the schedule for a specific program?';
  }

  // Format / How sessions work
  if (/(how.*work|how.*session|format|online|offline|zoom|очно|онлайн|формат|как\s*проход|как\s*работа[ею]|дистанционн|in\s*person|face\s*to\s*face|лично)/i.test(lowerMsg)) {
    return useRu
      ? 'Как проходят наши сессии:\n\n• Все программы проходят ОНЛАЙН — присоединиться можно из любой точки мира\n• Живые сессии через Zoom\n• Материалы курса доступны 24/7 в личном кабинете\n• Личная поддержка через WhatsApp/Telegram между сессиями\n• Индивидуальные сессии — 1 на 1 с Алтынай или куратором\n• Групповые сессии — маленькие группы для максимального внимания\n\nВам нужен только телефон или ноутбук и интернет. Всё создано для вашего комфорта и удобства.'
      : 'How our sessions work:\n\n• All programs are conducted ONLINE — you can join from anywhere in the world\n• Live sessions via Zoom\n• Course materials available 24/7 in your personal account\n• Personal support via WhatsApp/Telegram between sessions\n• Individual sessions are 1-on-1 with Altynai or a curator\n• Group sessions are small groups for maximum attention\n\nYou only need a phone or laptop and internet connection. Everything is designed for your comfort and convenience.';
  }

  // Results / Testimonials
  if (/(result|guarantee|outcome|эффект|результат|гаранти|помогает|помож|does it work|работает|поможет|что\s*дает|what.*get|what.*expect|чего\s*ожидат|отзыв|review|testimonial)/i.test(lowerMsg)) {
    return useRu
      ? 'Каких результатов ожидать:\n\n• 500+ клиентов прошли трансформацию\n• 99% удовлетворённость клиентов\n• Средний рост в ключевых сферах в 3 раза\n\nРеальные результаты клиентов:\n— «Мой доход вырос в 2 раза в следующем месяце» — Айсулуу К.\n— «Я наконец чувствую контроль над своей жизнью» — Марат Б.\n— «Мой бизнес вырос в 3 раза за 6 месяцев» — Нуриза Т.\n\nМы работаем с реальными, измеримыми результатами. Каждый клиент получает личное внимание и поддержку до достижения цели.'
      : 'What results can you expect:\n\n• 500+ clients have been transformed\n• 99% client satisfaction rate\n• Average 3x growth in key life areas\n\nReal client results:\n— "My income grew 2x in the following month" — Aisuluu K.\n— "I finally feel in control of my life" — Marat B.\n— "My business grew 3x in 6 months" — Nuriza T.\n\nWe work with real, measurable outcomes. Every client gets personal attention and support until they reach their goal.';
  }

  // Refund
  if (/(refund|money\s*back|cancel|возврат|вернут.*деньг|отмен|отказат|деньги\s*назад|не\s*подо[йш]|not\s*right\s*for\s*me)/i.test(lowerMsg)) {
    return useRu
      ? 'Политика возврата и отмены:\n\n• Мы проводим бесплатную первую консультацию именно для того, чтобы вы убедились, что программа вам подходит\n• Если программа не начнётся — полный возврат\n• Частичный возврат возможен в зависимости от программы и прогресса\n• Свяжитесь с нами через WhatsApp или Telegram для обсуждения вашей ситуации\n\nМы хотим, чтобы вы были уверены в своём вложении. Именно для этого есть бесплатная консультация — без давления, без обязательств.'
      : 'Refund & cancellation policy:\n\n• We offer a free initial consultation specifically so you can make sure the program is right for you before committing\n• If a program doesn\'t start, you receive a full refund\n• Partial refund may be available depending on the program and progress\n• Contact us directly via WhatsApp or Telegram to discuss your individual situation\n\nWe want you to feel confident in your investment. That\'s why the free consultation exists — no pressure, no commitment until you\'re ready.';
  }

  // Location
  if (/(where|location|city|country|office|locat|город|страна|где.*находит|где.*расположен|где.*офис|откуда|бишкек|bishkek|kyrgyzstan|кыргызстан|кирги|находит)/i.test(lowerMsg)) {
    return useRu
      ? 'Расположение и охват:\n\n• Мы находимся в Бишкеке, Кыргызстан\n• Все программы полностью онлайн — клиенты присоединяются со всего мира\n• Сессии через Zoom, поддержка через WhatsApp/Telegram\n• Наши клиенты из Кыргызстана, России, Казахстана, Турции, Европы, США и других стран\n\nГде бы вы ни находились — вы можете участвовать в любой программе!'
      : 'Location & reach:\n\n• We are based in Bishkek, Kyrgyzstan\n• All programs are fully online — clients join from all over the world\n• Sessions via Zoom, support via WhatsApp/Telegram\n• We have clients from Kyrgyzstan, Russia, Kazakhstan, Turkey, Europe, USA, and more\n\nNo matter where you are, you can participate in any of our programs!';
  }

  // Help choosing a program
  if (/(which|what.*program|recommend|suggest|какую|какой|подскаж|что.*выбрат|порекоменд|посовет|не\s*знаю.*выбрат|help\s*me\s*choose|best.*for\s*me|что\s*подойд[её]т)/i.test(lowerMsg)) {
    return useRu
      ? 'Помогу выбрать!\n\n• Только начинаете? → Зарядка мозга (1,000 сом) — 21 день для сдвига мышления\n• Хотите поддержку? → Клуб «Ресурсы» (5,000 сом/мес) — ежемесячная групповая работа\n• Проблемы с родителями/семьёй? → Интенсив «Папа, Мама» ($300) — глубокая проработка корней\n• Готовы к полной трансформации? → ПЕРЕЗАГРУЗКА ($1,000) — 8 недель полного обновления\n• Хотите стать практиком? → Наставничество — профессиональное мастерство\n\nЛучший способ найти своё — бесплатная консультация. Алтынай лично оценит вашу ситуацию и порекомендует путь. Хотите записаться?'
      : 'Let me help you choose!\n\n• Just starting out? → Brain Charge (1,000 KGS) — 21 days to shift your thinking\n• Want ongoing support? → Club "Resources" (5,000 KGS/mo) — monthly group work\n• Issues with parents/family? → Intensive "Mom & Dad" ($300) — deep root work\n• Ready for full transformation? → REBOOT ($1,000) — 8-week total overhaul\n• Want to become a practitioner? → Mentorship — professional mastery\n\nThe best way to find your fit is a free consultation. Altynai will personally assess your situation and recommend the right path. Want to book one?';
  }

  // NLP / Methods
  if (/(nlp|нлп|neuro.*linguistic|нейро.*лингвист|what.*method|метод|техник|подход|approach|technique)/i.test(lowerMsg)) {
    return useRu
      ? 'Методы и техники, которые мы используем:\n\n• НЛП (Нейро-Лингвистическое Программирование) — перепрограммирование паттернов мышления\n• Работа с паттернами подсознания — выявление и снятие глубоких блоков\n• Техники квантового поля — выравнивание энергии и намерений\n• Основы расстановок — понимание семейных систем\n• Глубинные разборы — выявление первопричин\n\nВсе методы применяются экологично и безопасно, с учётом уникальной ситуации каждого клиента.'
      : 'Methods & techniques we use:\n\n• NLP (Neuro-Linguistic Programming) — reprogramming thought patterns\n• Subconscious pattern work — identifying and releasing deep blocks\n• Quantum field techniques — energy alignment and intention setting\n• Constellation work fundamentals — understanding family systems\n• Deep analysis sessions — uncovering root causes\n\nAll methods are applied ecologically and safely, tailored to each client\'s unique situation.';
  }

  // Thanks
  if (/(thank|thanks|спасибо|благодар|appreciate|thx)/i.test(lowerMsg)) {
    return useRu
      ? 'Пожалуйста! Если у вас есть ещё вопросы — я всегда здесь. Также можно записаться на бесплатную консультацию — просто нажмите кнопку на сайте. Отличного дня!'
      : 'You\'re welcome! If you have any more questions, I\'m here to help. You can also book a free consultation anytime — just click the button on the website. Have a wonderful day!';
  }

  // Bye
  if (/(bye|goodbye|see you|до свидания|пока|до встречи|удачи|good\s*luck)/i.test(lowerMsg)) {
    return useRu
      ? 'Спасибо за общение! Помните, вы всегда можете вернуться или записаться на бесплатную консультацию, когда будете готовы. Желаем вам всего наилучшего на пути трансформации!'
      : 'Thank you for chatting with us! Remember, you can always come back or book a free consultation when you\'re ready. Wishing you the best on your transformation journey!';
  }

  // Knowledge base fallback
  const section = pickKnowledgeSection(message, knowledgeText);
  const knowledgeReply = formatKnowledgeFallback(section, useRu);
  if (knowledgeReply) return knowledgeReply;

  // General fallback
  return useRu
    ? 'Спасибо за сообщение! Я могу помочь вам с:\n\n• Информация о программах и ценах\n• Запись на бесплатную консультацию\n• Об основателе Алтынай\n• Как проходят сессии\n• Способы оплаты\n• Результаты и отзывы\n• Политика возврата\n\nПросто спросите о чём угодно или нажмите «Записаться» чтобы начать!'
    : 'Thank you for your message! I can help you with:\n\n• Program information & pricing\n• Booking a free consultation\n• About founder Altynai\n• How sessions work\n• Payment methods\n• Results & testimonials\n• Refund policy\n\nJust ask me anything, or click "Book Consultation" to get started!';
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

function buildAuthToken(user, role) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function buildPublicUser(user, role) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role
  };
}

// Register
app.post('/api/register', authRateLimiter, async (req, res) => {
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

    if (!isStrongPassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and include letters and numbers' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const role = isAdminEmail(normalizedEmail) ? 'admin' : 'user';
    const hashedPassword = await bcrypt.hash(String(password), 10);
    const user = await prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        password: hashedPassword,
        phone: normalizedPhone,
        role
      }
    });

    const token = buildAuthToken(user, role);

    // Notify n8n of new registration (awaited so Vercel doesn't kill it before it fires)
    try {
      await fetch('https://n8n-production-5753.up.railway.app/webhook/0c651492-633f-4c72-abe0-17720b8fb6f2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: role,
          timestamp: new Date().toISOString()
        })
      });
    } catch (err) {
      console.error('[n8n webhook] failed:', err.message);
    }

    res.json({
      message: 'Registration successful',
      token,
      user: buildPublicUser(user, role)
    });
  } catch (err) {
    if (err && err.code === 'P2002') {
      return res.status(400).json({ error: 'User already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
app.post('/api/login', authRateLimiter, async (req, res) => {
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

    let role = normalizeUserRole(user.role);
    if (isAdminEmail(normalizedEmail)) {
      role = 'admin';
    }

    if (role !== normalizeUserRole(user.role)) {
      await prisma.user.update({
        where: { id: user.id },
        data: { role }
      });
    }

    const token = buildAuthToken(user, role);

    res.json({
      message: 'Login successful',
      token,
      user: buildPublicUser(user, role)
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Request reset code (email + phone verification)
app.post('/api/reset-password/request-code', resetRateLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = normalizePhone(req.body.phone);

    if (!email || !phone || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Valid email and phone are required' });
    }

    const genericMessage = 'If this account exists, verification code has been sent.';
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || normalizePhone(user.phone) !== phone) {
      return res.json({ message: genericMessage });
    }

    const resetCode = createResetChallenge(email, phone);
    if (!resetCode) {
      return res.status(500).json({ error: 'Failed to create reset code' });
    }

    let delivered = false;
    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
      const note = [
        'KVANTUM password reset verification code',
        `Email: ${email}`,
        `Phone: ${phone}`,
        `Code: ${resetCode}`,
        `Expires in: ${Math.floor(RESET_CODE_TTL_MS / 60000)} minutes`
      ].join('\n');


      try {
        await sendTelegramText(note);
        delivered = true;
      } catch (err) {
        delivered = false;
      }
    }

    if (process.env.NODE_ENV !== 'production' || ALLOW_INSECURE_RESET_CODE_RESPONSE) {
      return res.json({
        message: 'Verification code generated',
        devCode: resetCode,
        expiresInSec: Math.floor(RESET_CODE_TTL_MS / 1000)
      });
    }

    if (delivered) {
      return res.json({ message: genericMessage });
    }

    return res.status(503).json({ error: 'Reset code delivery is not configured' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Reset password (email + phone + verification code)
app.post('/api/reset-password', resetRateLimiter, async (req, res) => {
  try {
    const { email, phone, newPassword, resetCode } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();
    const normalizedPhone = normalizePhone(phone);
    const normalizedResetCode = String(resetCode || '').trim();

    if (!normalizedEmail || !normalizedPhone || !newPassword || !normalizedResetCode) {
      return res.status(400).json({ error: 'Email, phone, reset code and new password are required' });
    }

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and include letters and numbers' });
    }

    if (!validateResetCode(normalizedEmail, normalizedPhone, normalizedResetCode)) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(400).json({ error: 'Invalid reset request' });
    }

    const storedPhone = normalizePhone(user.phone);
    if (!storedPhone || storedPhone !== normalizedPhone) {
      return res.status(400).json({ error: 'Invalid reset request' });
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
      select: { id: true, name: true, email: true, phone: true, role: true }
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
app.post('/api/chat', chatRateLimiter, async (req, res) => {
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
  server = app.listen(PORT, async () => {
    try {
      await syncAdminRolesFromEnv();
    } catch (err) {
      console.error('[startup] failed to sync admin roles:', err && err.message ? err.message : err);
    }

    console.log(`QUANTUM server running at http://localhost:${PORT}`);
    console.log(`CORS allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);

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
