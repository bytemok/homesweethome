'use strict';
const express = require('express');
const db = require('../db');
const cfg = require('../config');
const { authRequired, requireRole } = require('../auth');
const { pullOrders, pullPurchaseOrders } = require('../odoo');
const router = express.Router();
router.use(authRequired, requireRole('admin'));

// POST /api/sync/pull — importar desde Odoo -------------------------------
// Trae órdenes de venta confirmadas Y órdenes de compra confirmadas
// (estas últimas se auto-asignan al proveedor de cada OC).
router.post('/pull', async (req, res) => {
  try {
    const sales = await pullOrders();
    let purchases = { imported: 0, assigned: 0, mode: sales.mode };
    try { purchases = await pullPurchaseOrders(); } catch (e) { /* no bloquea */ }
    res.json({ ok: true, mode: sales.mode,
      imported: sales.imported, purchase_imported: purchases.imported, assigned: purchases.assigned });
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
