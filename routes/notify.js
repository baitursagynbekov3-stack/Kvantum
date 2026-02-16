const router = require('express').Router();

// POST /api/notify — send notification (demo — generates links)
router.post('/', (req, res) => {
  const { type, phone, message } = req.body;

  if (type === 'whatsapp') {
    const whatsappUrl = `https://wa.me/${(phone || '').replace(/[^0-9]/g, '')}?text=${encodeURIComponent(message || 'Thank you for your purchase at QUANTUM!')}`;
    res.json({ message: 'WhatsApp notification ready', url: whatsappUrl });
  } else if (type === 'telegram') {
    res.json({ message: 'Telegram notification sent', note: 'In production, integrate with Telegram Bot API' });
  } else {
    res.json({ message: 'Notification sent' });
  }
});

module.exports = router;
