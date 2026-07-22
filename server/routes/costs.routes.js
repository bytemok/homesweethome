'use strict';
const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../auth');
const { audit, notify, notifyAdmins } = require('../helpers');
const { computeCostTotal } = require('../orderView');
const { pushToOdoo } = require('../odoo');
const router = express.Router();
router.use(authRequired);

function lineWithOrder(lineId) {
  return db.prepare(`SELECT l.*, o.supplier_id, o.order_number, o.odoo_id AS order_odoo
    FROM order_lines l JOIN orders o ON o.id=l.order_id WHERE l.id=?`).get(lineId);
}

// POST /api/costs/line/:lineId — cargar/actualizar costo (proveedor) --------
router.post('/line/:lineId', requireRole('proveedor', 'admin'), (req, res) => {
  const line = lineWithOrder(req.params.lineId);
  if (!line) return res.status(404).json({ error: 'Línea no encontrada' });
  if (req.user.role === 'proveedor' && line.supplier_id !== req.user.supplier_id) {
    return res.status(403).json({ error: 'Sin acceso' });
  }
  const b = req.body || {};
  const data = {
    unit_cost: +b.unit_cost || 0, qty: +b.qty || line.qty || 1,
    extras_cost: +b.extras_cost || 0, legs_cost: +b.legs_cost || 0,
    fabric_cost: +b.fabric_cost || 0, packaging_cost: +b.packaging_cost || 0,
    shipping_cost: +b.shipping_cost || 0, other_cost: +b.other_cost || 0,
    vat_included: b.vat_included ? 1 : 0, currency: b.currency || 'ARS',
    notes: b.notes || null,
  };
  data.total_cost = computeCostTotal(data);

  const prev = db.prepare('SELECT * FROM line_costs WHERE line_id=? ORDER BY id DESC LIMIT 1').get(line.id);
  const oldTotal = prev ? prev.total_cost : null;

  // Toda carga/modificación vuelve a estado "pendiente de aprobación"
  db.prepare(`INSERT INTO line_costs
    (line_id,unit_cost,qty,extras_cost,legs_cost,fabric_cost,packaging_cost,shipping_cost,
     other_cost,total_cost,vat_included,currency,notes,status,updated_by,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'pendiente', ?, datetime('now'))`)
    .run(line.id, data.unit_cost, data.qty, data.extras_cost, data.legs_cost, data.fabric_cost,
      data.packaging_cost, data.shipping_cost, data.other_cost, data.total_cost,
      data.vat_included, data.currency, data.notes, req.user.id);

  db.prepare(`INSERT INTO cost_history (line_id,old_total,new_total,reason,changed_by)
    VALUES (?,?,?,?,?)`).run(line.id, oldTotal, data.total_cost, b.reason || null, req.user.id);
  audit(req, { entity: 'line_costs', entity_id: line.id, order_id: line.order_id,
    field: 'total_cost', old_value: oldTotal, new_value: data.total_cost, action: 'cost_update' });

  const wasApproved = prev && prev.status === 'aprobado';
  notifyAdmins({ order_id: line.order_id, type: 'costo',
    title: `${wasApproved ? 'Costo MODIFICADO (ya aprobado)' : 'Nuevo costo cargado'} en ${line.order_number}`,
    body: `${line.product_name}: ${data.total_cost} ${data.currency}` });
  res.json({ ok: true, total_cost: data.total_cost, status: 'pendiente' });
});

// POST /api/costs/:costId/decision — aprobar/rechazar (admin) --------------
router.post('/:costId/decision', requireRole('admin'), (req, res) => {
  const cost = db.prepare('SELECT * FROM line_costs WHERE id=?').get(req.params.costId);
  if (!cost) return res.status(404).json({ error: 'Costo no encontrado' });
  const { decision } = req.body || {};
  if (!['aprobado', 'rechazado', 'revision'].includes(decision)) {
    return res.status(400).json({ error: 'Decisión inválida' });
  }
  db.prepare("UPDATE line_costs SET status=?, approved_by=?, approved_at=datetime('now') WHERE id=?")
    .run(decision, req.user.id, cost.id);
  db.prepare(`UPDATE cost_history SET approved_by=?
    WHERE id=(SELECT MAX(id) FROM cost_history WHERE line_id=?)`).run(req.user.id, cost.line_id);

  const line = lineWithOrder(cost.line_id);
  audit(req, { entity: 'line_costs', entity_id: cost.id, order_id: line.order_id,
    field: 'status', old_value: cost.status, new_value: decision, action: 'cost_decision' });

  // Al aprobar, actualizar el costo unitario en la orden de compra de Odoo
  // (queda reflejado en tu lista de costos y en la ganancia).
  if (decision === 'aprobado') {
    pushToOdoo('purchase.order.line', line.odoo_id, { price_unit: cost.unit_cost }, 'line_costs').catch(() => {});
  }
  // Notificar a los usuarios del proveedor
  const users = db.prepare("SELECT id FROM users WHERE role='proveedor' AND supplier_id=?").all(line.supplier_id);
  for (const u of users) notify({ userId: u.id, order_id: line.order_id, type: 'costo_decision',
    title: `Costo ${decision} en ${line.order_number}` });
  res.json({ ok: true, status: decision });
});

// GET /api/costs/line/:lineId/history --------------------------------------
router.get('/line/:lineId/history', (req, res) => {
  const line = lineWithOrder(req.params.lineId);
  if (!line) return res.status(404).json({ error: 'Línea no encontrada' });
  if (req.user.role === 'proveedor' && line.supplier_id !== req.user.supplier_id) {
    return res.status(403).json({ error: 'Sin acceso' });
  }
  const rows = db.prepare(`SELECT h.*, u.name AS changed_name, a.name AS approved_name
    FROM cost_history h LEFT JOIN users u ON u.id=h.changed_by
    LEFT JOIN users a ON a.id=h.approved_by
    WHERE h.line_id=? ORDER BY h.id DESC`).all(line.id);
  res.json(rows);
});

// GET /api/costs/pending — costos pendientes de aprobación (admin) ----------
router.get('/pending', requireRole('admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT lc.id AS cost_id, lc.total_cost, lc.currency, lc.status, lc.updated_at,
           l.id AS line_id, l.product_name, o.order_number, o.id AS order_id, s.name AS supplier_name
    FROM line_costs lc
    JOIN order_lines l ON l.id=lc.line_id
    JOIN orders o ON o.id=l.order_id
    LEFT JOIN suppliers s ON s.id=o.supplier_id
    WHERE lc.status='pendiente'
      AND lc.id=(SELECT MAX(id) FROM line_costs WHERE line_id=l.id)
    ORDER BY lc.updated_at DESC`).all();
  res.json(rows);
});

module.exports = router;
