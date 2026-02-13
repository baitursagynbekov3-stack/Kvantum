const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = global.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'kvantum-secret-key-change-in-production';
const SERVE_STATIC = process.env.SERVE_STATIC !== 'false';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'baitursagynbekov3@gmail.com')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
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

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();

    if (!name || !normalizedEmail || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        password: hashedPassword,
        phone: phone || ''
      }
    });

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Registration successful',
      token,
      user: { id: user.id, name: user.name, email: user.email }
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

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, name: user.name, email: user.email }
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
    const normalizedPhone = String(phone || '').replace(/\D/g, '');

    if (!normalizedEmail || !normalizedPhone || !newPassword) {
      return res.status(400).json({ error: 'Email, phone and new password are required' });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or phone' });
    }

    const storedPhone = String(user.phone || '').replace(/\D/g, '');
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

    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'Name, email and phone are required' });
    }

    const booking = await prisma.booking.create({
      data: {
        name,
        email,
        phone,
        service: service || 'consultation',
        message: message || '',
        status: 'pending'
      }
    });

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

// AI Chatbot endpoint
app.post('/api/chat', (req, res) => {
  const { message } = req.body;
  const lowerMsg = (message || '').toLowerCase();

  let reply = '';

  if (lowerMsg.includes('hello') || lowerMsg.includes('hi') || lowerMsg.includes('привет') || lowerMsg.includes('здравствуйте')) {
    reply = 'Welcome to KVANTUM! I am your AI assistant. How can I help you today? You can ask about our programs, pricing, or book a free consultation.';
  } else if (lowerMsg.includes('price') || lowerMsg.includes('cost') || lowerMsg.includes('цена') || lowerMsg.includes('стоимость') || lowerMsg.includes('сколько')) {
    reply = 'Our programs:\n\n1. Brain Charge (entry level) - 1,000 KGS/RUB\n2. Resources Club - 5,000 KGS/month\n3. Intensive "Mom & Dad - My 2 Wings" - $300 / 26,300 KGS\n4. REBOOT course - $1,000\n5. Mentorship - contact our managers for pricing\n\nWould you like to book a free consultation to find the best program for you?';
  } else if (lowerMsg.includes('brain') || lowerMsg.includes('зарядка') || lowerMsg.includes('мозг')) {
    reply = 'Brain Charge is our entry-level program:\n- 21 days\n- 15 minutes per day\n- Starts at 6:00 AM (Kyrgyzstan time)\n- Price: 1,000 KGS/RUB\n\nIt is the simplest way to start your transformation journey!';
  } else if (lowerMsg.includes('resource') || lowerMsg.includes('club') || lowerMsg.includes('клуб') || lowerMsg.includes('ресурс')) {
    reply = 'Resources Club helps strengthen your inner state:\n- 4 weeks\n- 2 sessions with Altynai\n- 2 sessions with a curator\n- Focus: confidence, self-worth, inner freedom\n- Price: 5,000 KGS/month\n\nWant to join?';
  } else if (lowerMsg.includes('intensive') || lowerMsg.includes('интенсив') || lowerMsg.includes('papa') || lowerMsg.includes('mama') || lowerMsg.includes('папа') || lowerMsg.includes('мама')) {
    reply = 'The Intensive "Mom & Dad - My 2 Wings" works with ancestral roots:\n- 1 month, 10 lessons, 20 practices\n- 3 Zoom sessions\n- Topics: separation, breaking free from inherited patterns, restoring hierarchy\n- Price: $300 / 26,300 KGS';
  } else if (lowerMsg.includes('reboot') || lowerMsg.includes('перезагрузка')) {
    reply = 'REBOOT - Conscious Reality Management:\n- 8 weeks, 24 sessions\n- 20 lessons, 20 practices\n- 1 personal session with Altynai + 2 curator sessions\n- Topics: values, state management, relationships, finances\n- Price: $1,000';
  } else if (lowerMsg.includes('mentor') || lowerMsg.includes('наставничество')) {
    reply = 'Mentorship (University of Self-Knowledge) is our premium program:\n- Field reading, emotions & subconscious blocks\n- Quantum field work\n- 30 NLP practices\n- Constellation fundamentals\n- Live practice with curators\n\nContact our managers for pricing!';
  } else if (lowerMsg.includes('consult') || lowerMsg.includes('консультац') || lowerMsg.includes('записаться') || lowerMsg.includes('book')) {
    reply = 'To book a free consultation, click the "Book Consultation" button on our website, or message us on WhatsApp/Telegram. Entry to individual work is only after a free consultation. We look forward to working with you!';
  } else if (lowerMsg.includes('altynai') || lowerMsg.includes('алтынай') || lowerMsg.includes('founder') || lowerMsg.includes('основатель')) {
    reply = 'Altynai Eshinbekova is the founder of KVANTUM:\n- Specialist in subconscious and quantum field work\n- NLP Master\n- Master of deep analysis sessions\n\nShe works deeply, ecologically, and delivers real results. She personally accompanies clients to their goals.';
  } else if (lowerMsg.includes('whatsapp') || lowerMsg.includes('telegram') || lowerMsg.includes('contact') || lowerMsg.includes('связ') || lowerMsg.includes('контакт')) {
    reply = 'You can reach us via:\n- WhatsApp: Click the WhatsApp button on our website\n- Telegram: Click the Telegram button\n- Or fill out the contact form and we will reach out to you!\n\nWe are happy to help you start your transformation journey.';
  } else {
    reply = 'Thank you for your message! I can help you with:\n\n- Program information and pricing\n- Booking a free consultation\n- Learning about our founder Altynai\n- Understanding how we work\n\nJust ask me anything, or click "Book Consultation" to get started!';
  }

  res.json({ reply });
});

// Send notification (demo - generates links)
app.post('/api/notify', (req, res) => {
  const { type, phone, message } = req.body;

  if (type === 'whatsapp') {
    const whatsappUrl = `https://wa.me/${(phone || '').replace(/[^0-9]/g, '')}?text=${encodeURIComponent(message || 'Thank you for your purchase at KVANTUM!')}`;
    res.json({ message: 'WhatsApp notification ready', url: whatsappUrl });
  } else if (type === 'telegram') {
    res.json({ message: 'Telegram notification sent', note: 'In production, integrate with Telegram Bot API' });
  } else {
    res.json({ message: 'Notification sent' });
  }
});

if (SERVE_STATIC) {
  // Serve main page for all other routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
}

let server;
if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log(`KVANTUM server running at http://localhost:${PORT}`);
    if (ALLOWED_ORIGINS.length) {
      console.log(`CORS enabled for: ${ALLOWED_ORIGINS.join(', ')}`);
    } else {
      console.log('CORS enabled for all origins (ALLOWED_ORIGINS is empty)');
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
