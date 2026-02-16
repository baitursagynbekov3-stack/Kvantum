const router = require('express').Router();

// POST /api/chat — public, AI chatbot responses
router.post('/', (req, res) => {
  const { message } = req.body;
  const lowerMsg = (message || '').toLowerCase();

  let reply = '';

  if (lowerMsg.includes('hello') || lowerMsg.includes('hi') || lowerMsg.includes('привет') || lowerMsg.includes('здравствуйте')) {
    reply = 'Welcome to QUANTUM! I am your AI assistant. How can I help you today? You can ask about our programs, pricing, or book a free consultation.';
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
    reply = 'Altynai Eshinbekova is the founder of QUANTUM:\n- Specialist in subconscious and quantum field work\n- NLP Master\n- Master of deep analysis sessions\n\nShe works deeply, ecologically, and delivers real results. She personally accompanies clients to their goals.';
  } else if (lowerMsg.includes('whatsapp') || lowerMsg.includes('telegram') || lowerMsg.includes('contact') || lowerMsg.includes('связ') || lowerMsg.includes('контакт')) {
    reply = 'You can reach us via:\n- WhatsApp: Click the WhatsApp button on our website\n- Telegram: Click the Telegram button\n- Or fill out the contact form and we will reach out to you!\n\nWe are happy to help you start your transformation journey.';
  } else {
    reply = 'Thank you for your message! I can help you with:\n\n- Program information and pricing\n- Booking a free consultation\n- Learning about our founder Altynai\n- Understanding how we work\n\nJust ask me anything, or click "Book Consultation" to get started!';
  }

  res.json({ reply });
});

module.exports = router;
