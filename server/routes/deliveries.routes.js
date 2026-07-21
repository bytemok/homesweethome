'use strict';
const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../auth');
const { audit, notifyAdmins } = require('../helpers');
const { pushToOdoo } = require('../odoo');
const router = express.Router();
router.use(authRequired);

function order(user, orderId) {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (!o) return null;
  if (user.role === 'proveedor' && o.supplier_id !== user.supplier_id) return null;
  return o;
}

// POST /api/deliveries/:orderId — cargar/actualizar fechas de entrega ------
router.post('/:orderId', requireRole('proveedor', 'admin'), (req, res) => {
  const o = order(req.user, req.params.orderId);
  if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
  const b = req.body || {};
  const prev = db.prepare('SELECT * FROM deliveries WHERE order_id=? ORDER BY id DESC LIMIT 1').get(o.id);

  const fields = {
    estimated_date: b.estimated_date ?? prev?.estimated_date ?? null,
    new_estimated: b.new_estimated ?? prev?.new_estimated ?? null,
    time_slot: b.time_slot ?? prev?.time_slot ?? null,
    finished_date: b.finished_date ?? prev?.finished_date ?? null,
    dispatch_date: b.dispatch_date ?? prev?.dispatch_date ?? null,
    real_date: b.real_date ?? prev?.real_date ?? null,
    delivery_type: b.delivery_type ?? prev?.delivery_type ?? null,
    full_or_partial: b.full_or_partial ?? prev?.full_or_partial ?? 'total',
    notes: b.notes ?? prev?.notes ?? null,
  };
  // Si viene nueva fecha, pasa a ser la estimada vigente
  if (b.new_estimated) fields.estimated_date = b.new_estimated;

  if (prev) {
    db.prepare(`UPDATE deliveries SET estimated_date=?,new_estimated=?,time_slot=?,finished_date=?,
      dispatch_date=?,real_date=?,delivery_type=?,full_or_partial=?,notes=?,updated_by=?,updated_at=datetime('now')
      WHERE id=?`).run(fields.estimated_date, fields.new_estimated, fields.time_slot, fields.finished_date,
      fields.dispatch_date, fields.real_date, fields.delivery_type, fields.full_or_partial, fields.notes,
      req.user.id, prev.id);
  } else {
    db.prepare(`INSERT INTO deliveries (order_id,estimated_date,new_estimated,time_slot,finished_date,
      dispatch_date,real_date,delivery_type,full_or_partial,notes,updated_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(o.id, fields.estimated_date, fields.new_estimated,
      fields.time_slot, fields.finished_date, fields.dispatch_date, fields.real_date,
      fields.delivery_type, fields.full_or_partial, fields.notes, req.user.id);
  }

  audit(req, { entity: 'deliveries', order_id: o.id, field: 'estimated_date',
    old_value: prev?.estimated_date, new_value: fields.estimated_date, action: 'delivery_update' });
  pushToOdoo('sale.order', o.odoo_id, { commitment_date: fields.estimated_date }, 'deliveries').catch(() => {});
  notifyAdmins({ order_id: o.id, type: 'fecha', title: `Fecha de entrega actualizada en ${o.order_number}` });
  res.json({ ok: true });
});

// POST /api/deliveries/partial/:lineId — entrega parcial -------------------
router.post('/partial/:lineId', requireRole('proveedor', 'admin', 'deposito'), (req, res) => {
  const line = db.prepare(`SELECT l.*, o.supplier_id, o.order_number FROM order_lines l
    JOIN orders o ON o.id=l.order_id WHERE l.id=?`).get(req.params.lineId);
  if (!line) return res.status(404).json({ error: 'Línea no encontrada' });
  if (req.user.role === 'proveedor' && line.supplier_id !== req.user.supplier_id) {
    return res.status(403).json({ error: 'Sin acceso' });
  }
  const b = req.body || {};
  const requested = +b.qty_requested || line.qty;
  const done = +b.qty_done || 0;
  const delivered = +b.qty_delivered || 0;
  const pending = Math.max(0, requested - delivered);

  db.prepare(`INSERT INTO partial_deliveries
    (line_id,qty_requested,qty_done,qty_delivered,qty_pending,pending_eta,reason,notes,created_by)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(line.id, requested, done, delivered, pending,
    b.pending_eta || null, b.reason || null, b.notes || null, req.user.id);
  db.prepare('UPDATE order_lines SET qty_done=?, qty_delivered=? WHERE id=?').run(done, delivered, line.id);

  // Regla: no marcar entrega completa si quedan unidades pendientes
  const newState = pending > 0 ? 'recibido_parcial' : line.state;
  if (pending > 0) db.prepare('UPDATE order_lines SET state=? WHERE id=?').run(newState, line.id);

  audit(req, { entity: 'partial_deliveries', entity_id: line.id, order_id: line.order_id,
    action: 'partial', new_value: `entregado ${delivered}/${requested}` });
  notifyAdmins({ order_id: line.order_id, type: 'entrega_parcial',
    title: `Entrega parcial en ${line.order_number}`, body: `${delivered}/${requested} (pendiente ${pending})` });
  res.json({ ok: true, qty_pending: pending });
});

// GET /api/deliveries/calendar — próximas entregas (calendario) ------------
router.get('/calendar', (req, res) => {
  const where = req.user.role === 'proveedor' ? 'AND o.supplier_id=' + Number(req.user.supplier_id) : '';
  const rows = db.prepare(`
    SELECT o.id AS order_id, o.order_number, s.name AS supplier_name, c.name AS client_name,
           d.estimated_date, d.delivery_type, d.full_or_partial
    FROM deliveries d JOIN orders o ON o.id=d.order_id
    LEFT JOIN suppliers s ON s.id=o.supplier_id
    LEFT JOIN clients c ON c.id=o.client_id
    WHERE d.estimated_date IS NOT NULL ${where}
    ORDER BY d.estimated_date ASC`).all();
  // Alertas: varias entregas el mismo día
  const byDay = {};
  for (const r of rows) { const d = (r.estimated_date || '').slice(0, 10); byDay[d] = (byDay[d] || 0) + 1; }
  res.json(rows.map((r) => ({ ...r, same_day_count: byDay[(r.estimated_date || '').slice(0, 10)] })));
});

module.exports = router;
