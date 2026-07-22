'use strict';
const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../auth');
const { audit, notify, notifyAdmins } = require('../helpers');
const { assembleOrder } = require('../orderView');
const { pushToOdoo } = require('../odoo');
const { STATE_LABELS } = require('../constants');
const router = express.Router();

router.use(authRequired);

// Verifica que el usuario pueda acceder al pedido. Devuelve el pedido o null.
function accessibleOrder(user, orderId) {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (!o) return null;
  if (user.role === 'proveedor' && o.supplier_id !== user.supplier_id) return null;
  return o;
}

// GET /api/orders  — lista con scoping + filtros --------------------------
router.get('/', (req, res) => {
  const { q, status, client, product, from, to, eta, delayed, no_cost, no_date, urgent, confirmation } = req.query;
  const where = [];
  const params = [];

  if (req.user.role === 'proveedor') { where.push('o.supplier_id = ?'); params.push(req.user.supplier_id); }

  // Entregado = todas las líneas recibidas (o canceladas). Pendiente = queda algo por entregar.
  const DELIVERED = `NOT EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id=o.id
      AND l.qty_delivered < l.qty AND l.state <> 'cancelado')
    AND EXISTS (SELECT 1 FROM order_lines l2 WHERE l2.order_id=o.id)`;
  if (req.query.entregados) {
    where.push(`(${DELIVERED})`);                    // vista "Entregados"
  } else if (!req.query.all) {
    where.push(`NOT (${DELIVERED})`);                // por defecto: solo pendientes de entregar
  }

  if (client) { where.push('c.name LIKE ?'); params.push(`%${client}%`); }
  if (confirmation) { where.push('o.confirmation = ?'); params.push(confirmation); }
  if (urgent) where.push("o.priority = 'urgente'");
  if (from) { where.push('date(o.created_date) >= date(?)'); params.push(from); }
  if (to) { where.push('date(o.created_date) <= date(?)'); params.push(to); }
  if (q) {
    where.push(`(o.order_number LIKE ? OR c.name LIKE ? OR EXISTS
      (SELECT 1 FROM order_lines l WHERE l.order_id=o.id AND l.product_name LIKE ?))`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (product) {
    where.push('EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id=o.id AND l.product_name LIKE ?)');
    params.push(`%${product}%`);
  }

  const sql = `
    SELECT o.id, o.order_number, o.priority, o.confirmation, o.created_date, o.general_notes,
           c.name AS client_name, s.name AS supplier_name, o.supplier_id,
           (SELECT COUNT(*) FROM order_lines l WHERE l.order_id=o.id) AS line_count,
           (SELECT COALESCE(SUM(l.qty),0) FROM order_lines l WHERE l.order_id=o.id) AS total_qty,
           (SELECT MIN(d.estimated_date) FROM deliveries d WHERE d.order_id=o.id) AS eta,
           (SELECT COUNT(*) FROM order_lines l WHERE l.order_id=o.id AND l.state='demorado') AS delayed_lines,
           (SELECT COUNT(*) FROM order_lines l WHERE l.order_id=o.id
              AND NOT EXISTS (SELECT 1 FROM line_costs lc WHERE lc.line_id=l.id)) AS lines_no_cost
    FROM orders o
    LEFT JOIN clients c ON c.id=o.client_id
    LEFT JOIN suppliers s ON s.id=o.supplier_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY o.id DESC`;

  let rows = db.prepare(sql).all(...params);

  // Filtros derivados (post-query para mantener el SQL legible)
  if (status) rows = rows.filter((r) => statesOfOrder(r.id).includes(status));
  if (delayed) rows = rows.filter((r) => r.delayed_lines > 0);
  if (no_cost) rows = rows.filter((r) => r.lines_no_cost > 0);
  if (no_date) rows = rows.filter((r) => !r.eta);
  if (eta) rows = rows.filter((r) => r.eta && r.eta.slice(0, 10) === eta);

  res.json(rows.map((r) => ({ ...r, states: statesOfOrder(r.id) })));
});

function statesOfOrder(orderId) {
  return db.prepare('SELECT DISTINCT state FROM order_lines WHERE order_id=?')
    .all(orderId).map((x) => x.state);
}

// GET /api/orders/:id — detalle completo ----------------------------------
router.get('/:id', (req, res) => {
  const o = accessibleOrder(req.user, req.params.id);
  if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });

  // Marcar "visto por el proveedor" la primera vez
  if (req.user.role === 'proveedor' && !o.seen_at) {
    db.prepare("UPDATE orders SET seen_at=datetime('now') WHERE id=?").run(o.id);
    db.prepare("UPDATE order_lines SET state='visto' WHERE order_id=? AND state='nuevo'").run(o.id);
    audit(req, { entity: 'orders', entity_id: o.id, order_id: o.id, action: 'seen', field: 'seen_at' });
    notifyAdmins({ order_id: o.id, type: 'visto', title: `Pedido ${o.order_number} visto por el proveedor` });
  }
  res.json(assembleOrder(o.id, { hideFinancials: req.user.role !== 'admin' }));
});

// POST /api/orders/:id/confirm — confirmación del proveedor ----------------
router.post('/:id/confirm', requireRole('proveedor', 'admin'), (req, res) => {
  const o = accessibleOrder(req.user, req.params.id);
  if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
  const { response, note } = req.body || {};
  const valid = ['recibido', 'confirmado', 'aclaracion', 'no_puedo', 'rechazado'];
  if (!valid.includes(response)) return res.status(400).json({ error: 'Respuesta inválida' });
  if (['aclaracion', 'no_puedo'].includes(response) && !note) {
    return res.status(400).json({ error: 'Debe indicar un motivo' });
  }
  db.prepare(`UPDATE orders SET confirmation=?, confirmation_note=?, confirmed_by=?,
              confirmed_at=datetime('now') WHERE id=?`)
    .run(response, note || null, req.user.id, o.id);
  if (response === 'confirmado') {
    db.prepare("UPDATE order_lines SET state='confirmado' WHERE order_id=? AND state IN ('nuevo','visto')").run(o.id);
  }
  audit(req, { entity: 'orders', entity_id: o.id, order_id: o.id, field: 'confirmation',
    old_value: o.confirmation, new_value: response, action: 'confirm' });
  notifyAdmins({ order_id: o.id, type: 'confirmacion',
    title: `Pedido ${o.order_number}: ${response}`, body: note || '' });
  res.json({ ok: true });
});

// POST /api/orders/lines/:lineId/state — estado + avance + demora ----------
router.post('/lines/:lineId/state', requireRole('proveedor', 'admin'), (req, res) => {
  const line = db.prepare('SELECT * FROM order_lines WHERE id=?').get(req.params.lineId);
  if (!line) return res.status(404).json({ error: 'Línea no encontrada' });
  const o = accessibleOrder(req.user, line.order_id);
  if (!o) return res.status(403).json({ error: 'Sin acceso' });

  const { state, progress, delay_reason, new_eta, qty_done } = req.body || {};
  if (state && !STATE_LABELS[state]) return res.status(400).json({ error: 'Estado inválido' });
  if (state === 'demorado' && !delay_reason) return res.status(400).json({ error: 'Indique el motivo de la demora' });

  // Regla: no se puede marcar terminado sin completar la cantidad producida
  if (state === 'terminado') {
    const done = qty_done != null ? +qty_done : line.qty_done;
    if (done < line.qty) return res.status(400).json({ error: 'No puede marcar Terminado sin completar la cantidad producida' });
  }

  const newState = state || line.state;
  const newProgress = progress != null ? +progress : line.progress;
  db.prepare('UPDATE order_lines SET state=?, progress=?, delay_reason=?, qty_done=? WHERE id=?')
    .run(newState, newProgress, delay_reason || null,
      qty_done != null ? +qty_done : line.qty_done, line.id);

  audit(req, { entity: 'order_lines', entity_id: line.id, order_id: o.id, field: 'state',
    old_value: line.state, new_value: newState, action: 'update' });

  if (new_eta) {
    const d = db.prepare('SELECT id FROM deliveries WHERE order_id=?').get(o.id);
    if (d) db.prepare('UPDATE deliveries SET new_estimated=?, estimated_date=?, updated_by=?, updated_at=datetime(\'now\') WHERE id=?').run(new_eta, new_eta, req.user.id, d.id);
    else db.prepare('INSERT INTO deliveries (order_id,estimated_date,updated_by) VALUES (?,?,?)').run(o.id, new_eta, req.user.id);
  }

  // Sincronizar estado con Odoo (mock/real)
  pushToOdoo('sale.order.line', line.odoo_id, { x_estado_fabricacion: newState }, 'order_lines').catch(() => {});

  if (newState === 'demorado') notifyAdmins({ order_id: o.id, type: 'demora',
    title: `Demora en ${o.order_number}`, body: delay_reason || '' });
  if (newState === 'terminado') notifyAdmins({ order_id: o.id, type: 'terminado',
    title: `Producto terminado en ${o.order_number}` });
  res.json({ ok: true });
});

// POST /api/orders/:id/assign — asignar proveedor (admin) ------------------
router.post('/:id/assign', requireRole('admin'), (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
  const { supplier_id } = req.body || {};
  const sup = db.prepare('SELECT * FROM suppliers WHERE id=?').get(supplier_id);
  if (!sup) return res.status(400).json({ error: 'Proveedor inválido' });
  db.prepare('UPDATE orders SET supplier_id=? WHERE id=?').run(supplier_id, o.id);
  audit(req, { entity: 'orders', entity_id: o.id, order_id: o.id, field: 'supplier_id',
    old_value: o.supplier_id, new_value: supplier_id, action: 'assign' });
  // Notificar al/los usuarios del proveedor
  const users = db.prepare("SELECT id FROM users WHERE role='proveedor' AND supplier_id=?").all(supplier_id);
  for (const u of users) notify({ userId: u.id, order_id: o.id, type: 'asignado',
    title: `Nuevo pedido asignado: ${o.order_number}` });
  res.json({ ok: true });
});

// POST /api/orders/:id/deliver — marcar el pedido como entregado ----------
// (admin/depósito: "el proveedor ya me lo trajo"). Pasa a la lista de Entregados.
router.post('/:id/deliver', requireRole('admin', 'deposito'), (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
  db.prepare("UPDATE order_lines SET qty_delivered=qty, state='recibido_completo' WHERE order_id=? AND state<>'cancelado'").run(o.id);
  db.prepare("UPDATE orders SET real_delivery_date=datetime('now') WHERE id=?").run(o.id);
  audit(req, { entity: 'orders', entity_id: o.id, order_id: o.id, action: 'deliver', field: 'entregado', new_value: 'entregado' });
  res.json({ ok: true });
});

// POST /api/orders/:id/undeliver — volver a pendiente (por si se marcó mal)
router.post('/:id/undeliver', requireRole('admin', 'deposito'), (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
  db.prepare("UPDATE order_lines SET qty_delivered=0, state='confirmado' WHERE order_id=? AND state='recibido_completo'").run(o.id);
  db.prepare("UPDATE orders SET real_delivery_date=NULL WHERE id=?").run(o.id);
  audit(req, { entity: 'orders', entity_id: o.id, order_id: o.id, action: 'undeliver' });
  res.json({ ok: true });
});

// POST /api/orders/:id/general — notas/prioridad (admin) ------------------
router.post('/:id/general', requireRole('admin'), (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
  const { general_notes, priority } = req.body || {};
  db.prepare('UPDATE orders SET general_notes=COALESCE(?,general_notes), priority=COALESCE(?,priority) WHERE id=?')
    .run(general_notes ?? null, priority ?? null, o.id);
  audit(req, { entity: 'orders', entity_id: o.id, order_id: o.id, action: 'update', field: 'general' });
  res.json({ ok: true });
});

module.exports = router;
