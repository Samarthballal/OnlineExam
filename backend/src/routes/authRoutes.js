const express = require('express');
const { z } = require('zod');
const db = require('../db/client');
const { signToken } = require('../utils/jwt');
const { hashPassword, comparePassword } = require('../utils/password');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(6).max(64),
  role: z.enum(['student', 'admin']).optional(),
  adminSignupKey: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid registration payload.', issues: parsed.error.flatten() });
  }

  try {
    const { name, email, password, role = 'student', adminSignupKey } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    if (role === 'admin') {
      const expectedKey = process.env.ADMIN_SIGNUP_KEY;
      if (!expectedKey || adminSignupKey !== expectedKey) {
        return res.status(403).json({ message: 'Admin registration is restricted.' });
      }
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
    if (existing) {
      return res.status(409).json({ message: 'Email already in use.' });
    }

    const passwordHash = await hashPassword(password);
    const result = db
      .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(name.trim(), normalizedEmail, passwordHash, role);

    const user = db
      .prepare('SELECT id, name, email, role, created_at as createdAt FROM users WHERE id = ?')
      .get(result.lastInsertRowid);

    const token = signToken({ id: user.id, role: user.role, email: user.email, name: user.name });

    return res.status(201).json({ token, user });
  } catch (error) {
    return res.status(500).json({ message: 'Registration failed.', error: error.message });
  }
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid login payload.', issues: parsed.error.flatten() });
  }

  try {
    const { email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    const user = db
      .prepare('SELECT id, name, email, role, password_hash as passwordHash FROM users WHERE email = ?')
      .get(normalizedEmail);

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const isValid = await comparePassword(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const token = signToken({ id: user.id, role: user.role, email: user.email, name: user.name });

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Login failed.', error: error.message });
  }
});

router.get('/me', authenticate, (req, res) => {
  const user = db
    .prepare('SELECT id, name, email, role, created_at as createdAt FROM users WHERE id = ?')
    .get(req.user.id);

  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  return res.json({ user });
});

module.exports = router;
