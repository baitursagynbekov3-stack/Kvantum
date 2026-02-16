const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { registerRules, loginRules } = require('../middleware/validate');

// POST /api/register
router.post('/register', registerRules, async (req, res, next) => {
  try {
    const { name, email, password, phone } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Create user (password hashed by pre-save hook)
    const user = await User.create({ name, email, password, phone });

    // Generate JWT
    const token = jwt.sign(
      { id: user._id, email: user.email, name: user.name, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Fire webhook on new account creation
    fetch('https://kompot.ai/api/ws/konton/workflows/webhook/6sl6qjjjfac', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: user.name, email: user.email, phone: user.phone, createdAt: user.createdAt })
    }).catch(() => {});

    res.json({
      message: 'Registration successful',
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/login
router.post('/login', loginRules, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Find user and include password for comparison
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Compare passwords
    const validPassword = await user.comparePassword(password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user._id, email: user.email, name: user.name, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
