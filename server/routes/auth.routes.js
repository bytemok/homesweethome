'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const auth = require('../auth');
const cfg = require('../config');
const router = express.Router();

// POST /api/auth/login  { identifier, password }
router.post('/login', (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) return res.status(400).json({ error: 'Faltan datos' });
  try {
    const { user, token } = auth.login(identifier, password, req);
    res.json({ user, token, idleMinutes: cfg.sessionIdleMinutes });
  } catch (e) {
    res.status(e.status || 401).json({ error: e.message });
  }
});

// GET /api/auth/me
router.get('/me', auth.authRequired, (req, res) => {
  let supplier = null;
  if (req.user.supplier_id) {
    supplier = db.prepare('SELECT id,name FROM suppliers WHERE id=?').get(req.user.supplier_id);
  }
  res.json({ user: req.user, supplier });
});

// POST /api/auth/change-password  { current, next }
router.post('/change-password', auth.authRequired, (req, res) => {
  const { current, next } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(current || '', u.password_hash)) {
    return res.status(400).json({ error: 'Contraseña actual incorrecta' });
  }
  if (!next || next.length < 6) return res.status(400).json({ error: 'La nueva contraseña es muy corta' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(auth.hash(next), u.id);
  res.json({ ok: true });
});

// POST /api/auth/forgot  { email }  -> devuelve token (en prod se enviaría por mail)
router.post('/forgot', (req, res) => {
  const token = auth.requestReset((req.body || {}).email || '');
  // Nunca revelar si el email existe. En producción, enviar por correo.
  res.json({ ok: true, dev_token: cfg.env === 'production' ? undefined : token });
});

// POST /api/auth/reset  { token, password }
router.post('/reset', (req, res) => {
  const { token, password } = req.body || {};
  try {
    auth.resetPassword(token, password);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

module.exports = router;
