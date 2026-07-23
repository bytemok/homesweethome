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

  // Entregado = todas las líneas recibidas/despachadas (o canceladas).
  const DELIVERED = `NOT EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id=o.id
      AND l.qty_delivered < l.qty AND l.state NOT IN ('cancelado','recibido_completo','despachado'))
    AND EXISTS (SELECT 1 FROM order_lines l2 WHERE l2.order_id=o.id)`;
  // Todavía en fabricación = queda alguna línea sin terminar (ni entregada).
  const STILL_MAKING = `EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id=o.id
      AND l.qty_delivered < l.qty
      AND l.state IN ('nuevo','visto','confirmado','en_produccion','en_tapiceria','en_terminacion','pendiente_materiales','demorado','con_problema'))`;
  // 3 pestañas: fabricar (default) / enviar (terminado, sin entregar) / entregados
  const tab = req.query.tab || (req.query.entregados ? 'entregados' : (req.query.all ? 'all' : 'fabricar'));
  if (tab === 'entregados') where.push(`(${DELIVERED})`);
  else if (tab === 'enviar') where.push(`NOT (${DELIVERED}) AND NOT (${STILL_MAKING})`);
  else if (tab === 'fabricar') where.push(`NOT (${DELIVERED}) AND (${STILL_MAKING})`);
  // tab === 'all' -> sin filtro de entrega

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
    SELECT o.id, o.order_number, o.priority, o.confirmation, o.created_date, o.general_notes, o.store,
           c.name AS client_name, s.name AS supplier_name, o.supplier_id,
           o.created_date AS sale_date,
           (SELECT COUNT(*) FROM order_lines l WHERE l.order_id=o.id) AS line_count,
           (SELECT l.product_name FROM order_lines l WHERE l.order_id=o.id ORDER BY l.id LIMIT 1) AS first_product,
           (SELECT COALESCE(SUM(l.qty),0) FROM order_lines l WHERE l.order_id=o.id) AS total_qty,
           (SELECT COALESCE(SUM(lc.total_cost),0) FROM line_costs lc JOIN order_lines l ON l.id=lc.line_id
              WHERE l.order_id=o.id AND lc.id=(SELECT MAX(id) FROM line_costs WHERE line_id=l.id)) AS cost_total,
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

  const newState = state || line.state;
  // "Terminado" da por hecha la cantidad; "Entregado/Despachado" además marca la entrega.
  let newQtyDone = qty_done != null ? +qty_done : line.qty_done;
  let newQtyDelivered = line.qty_delivered;
  let newProgress = progress != null ? +progress : line.progress;
  if (newState === 'terminado') { newQtyDone = line.qty; newProgress = 100; }
  else if (newState === 'recibido_completo' || newState === 'despachado') { newQtyDone = line.qty; newQtyDelivered = line.qty; newProgress = 100; }
  else if (newState === 'en_produccion' && !newProgress) newProgress = 50;
  db.prepare('UPDATE order_lines SET state=?, progress=?, delay_reason=?, qty_done=?, qty_delivered=? WHERE id=?')
    .run(newState, newProgress, delay_reason || null, newQtyDone, newQtyDelivered, line.id);

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

// POST /api/orders/dispatch — "Enviar hoy": marca varios pedidos como enviados
// y manda a Todo en Muebles (admin) un resumen de lo que se envía. ----------
router.post('/dispatch', requireRole('proveedor', 'admin'), (req, res) => {
  const ids = (req.body?.order_ids || []).map(Number).filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: 'No hay pedidos seleccionados' });
  const lines = [];
  let supplierName = null;
  for (const id of ids) {
    const o = accessibleOrder(req.user, id);
    if (!o) continue;
    supplierName = supplierName || db.prepare('SELECT name FROM suppliers WHERE id=?').get(o.supplier_id)?.name;
    const client = db.prepare('SELECT name FROM clients WHERE id=?').get(o.client_id)?.name || '—';
    const prods = db.prepare('SELECT product_name, qty FROM order_lines WHERE order_id=? AND state<>\'cancelado\'').all(o.id);
    db.prepare("UPDATE order_lines SET state='despachado', qty_delivered=qty WHERE order_id=? AND state NOT IN ('recibido_completo','cancelado')").run(o.id);
    db.prepare("UPDATE orders SET real_delivery_date=COALESCE(real_delivery_date, date('now')) WHERE id=?").run(o.id);
    audit(req, { entity: 'orders', entity_id: o.id, order_id: o.id, action: 'dispatch', field: 'enviado', new_value: 'enviar hoy' });
    lines.push(`• ${o.order_number} (${client}): ${prods.map((p) => `${p.product_name} x${p.qty}`).join(', ')}`);
  }
  if (!lines.length) return res.status(400).json({ error: 'Sin pedidos válidos' });
  const body = `Proveedor: ${supplierName || '—'}\n${lines.join('\n')}`;
  notifyAdmins({ type: 'envio', title: `📦 Envío de hoy — ${lines.length} pedido(s) de ${supplierName || 'proveedor'}`, body });
  res.json({ ok: true, count: lines.length, summary: body });
});

// POST /api/orders/bulk — acciones masivas: entregar o fijar fecha ---------
router.post('/bulk', requireRole('admin', 'proveedor', 'deposito'), (req, res) => {
  const ids = (req.body?.order_ids || []).map(Number).filter(Boolean);
  const action = req.body?.action;
  const date = (req.body?.date || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  if (!ids.length) return res.status(400).json({ error: 'No hay pedidos seleccionados' });
  let count = 0;
  for (const id of ids) {
    const o = accessibleOrder(req.user, id);
    if (!o) continue;
    if (action === 'deliver') {
      db.prepare("UPDATE order_lines SET qty_delivered=qty, state='recibido_completo' WHERE order_id=? AND state<>'cancelado'").run(o.id);
      db.prepare('UPDATE orders SET real_delivery_date=? WHERE id=?').run(date, o.id);
      const d = db.prepare('SELECT id FROM deliveries WHERE order_id=?').get(o.id);
      if (d) db.prepare('UPDATE deliveries SET real_date=? WHERE id=?').run(date, d.id);
      else db.prepare('INSERT INTO deliveries (order_id, real_date) VALUES (?,?)').run(o.id, date);
      audit(req, { entity: 'orders', entity_id: o.id, order_id: o.id, action: 'deliver', new_value: date });
    } else if (action === 'set_date') {
      const d = db.prepare('SELECT id FROM deliveries WHERE order_id=?').get(o.id);
      if (d) db.prepare('UPDATE deliveries SET estimated_date=? WHERE id=?').run(date, d.id);
      else db.prepare('INSERT INTO deliveries (order_id, estimated_date) VALUES (?,?)').run(o.id, date);
      audit(req, { entity: 'deliveries', order_id: o.id, action: 'set_date', new_value: date });
    } else { return res.status(400).json({ error: 'Acción inválida' }); }
    count++;
  }
  res.json({ ok: true, count });
});

// POST /api/orders/:id/deliver — marcar el pedido como entregado ----------
// (admin/depósito: "el proveedor ya me lo trajo"). Pasa a la lista de Entregados.
router.post('/:id/deliver', requireRole('admin', 'deposito', 'proveedor'), (req, res) => {
  const o = accessibleOrder(req.user, req.params.id);
  if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
  const date = (req.body?.date || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  db.prepare("UPDATE order_lines SET qty_delivered=qty, state='recibido_completo' WHERE order_id=? AND state<>'cancelado'").run(o.id);
  db.prepare('UPDATE orders SET real_delivery_date=? WHERE id=?').run(date, o.id);
  const d = db.prepare('SELECT id FROM deliveries WHERE order_id=?').get(o.id);
  if (d) db.prepare('UPDATE deliveries SET real_date=? WHERE id=?').run(date, d.id);
  else db.prepare('INSERT INTO deliveries (order_id, real_date) VALUES (?,?)').run(o.id, date);
  audit(req, { entity: 'orders', entity_id: o.id, order_id: o.id, action: 'deliver', field: 'entregado', new_value: date });
  if (req.user.role === 'proveedor') notifyAdmins({ order_id: o.id, type: 'entregado', title: `Pedido ${o.order_number} marcado como ENTREGADO por el proveedor`, body: `Fecha: ${date}` });
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
