'use strict';
const express = require('express');
const db = require('../db');
const cfg = require('../config');
const { authRequired, requireRole } = require('../auth');
const { pullOrders } = require('../odoo');
const router = express.Router();
router.use(authRequired, requireRole('admin'));

// POST /api/sync/pull — importar órdenes desde Odoo -----------------------
router.post('/pull', async (req, res) => {
  try {
    const result = await pullOrders();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(502).json({ error: 'Error de sincronización con Odoo: ' + e.message });
  }
});

// GET /api/sync/status — estado de la integración -------------------------
router.get('/status', (req, res) => {
  const last = db.prepare("SELECT * FROM sync_logs ORDER BY id DESC LIMIT 1").get();
  const errors = db.prepare("SELECT COUNT(*) n FROM sync_logs WHERE status='error'").get().n;
  res.json({
    odoo_enabled: cfg.odoo.enabled,
    odoo_url: cfg.odoo.enabled ? cfg.odoo.url : null,
    last_sync: last || null,
    error_count: errors,
  });
});

// GET /api/sync/errors — errores de sincronización (para reintentar) ------
router.get('/errors', (req, res) => {
  res.json(db.prepare("SELECT * FROM sync_logs WHERE status='error' ORDER BY id DESC LIMIT 100").all());
});

module.exports = router;
