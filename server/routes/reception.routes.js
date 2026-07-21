'use strict';
const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../auth');
const { audit, notifyAdmins } = require('../helpers');
const { pushToOdoo } = require('../odoo');
const { RECEPTION_RESULTS } = require('../constants');
const router = express.Router();
router.use(authRequired);

// GET /api/reception/scan?code=XXX — buscar por código de orden/producto/QR -
router.get('/scan', requireRole('deposito', 'admin'), (req, res) => {
  const code = (req.query.code || '').trim();
  if (!code) return res.status(400).json({ error: 'Código vacío' });

  // QR con formato ORDER:<id> o LINE:<id>
  let order = null, line = null;
  const m = /^(ORDER|LINE):(\d+)$/i.exec(code);
  if (m) {
    if (m[1].toUpperCase() === 'ORDER') order = db.prepare('SELECT * FROM orders WHERE id=?').get(+m[2]);
    else line = db.prepare('SELECT * FROM order_lines WHERE id=?').get(+m[2]);
  }
  if (!order && !line) {
    order = db.prepare('SELECT * FROM orders WHERE order_number=? OR barcode=?').get(code, code);
  }
  if (!order && !line) {
    line = db.prepare('SELECT * FROM order_lines WHERE barcode=? OR internal_code=?').get(code, code);
  }
  if (line && !order) order = db.prepare('SELECT * FROM orders WHERE id=?').get(line.order_id);
  if (!order) return res.status(404).json({ error: 'No se encontró ningún pedido con ese código' });

  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(order.client_id);
  const supplier = db.prepare('SELECT name FROM suppliers WHERE id=?').get(order.supplier_id);
  const lines = line
    ? [line]
    : db.prepare('SELECT * FROM order_lines WHERE order_id=?').all(order.id);

  res.json({
    order: { id: order.id, order_number: order.order_number },
    client: client ? { name: client.name, city: client.city } : null,
    supplier: supplier?.name || null,
    lines: lines.map((l) => ({
      id: l.id, product_name: l.product_name, qty: l.qty, qty_delivered: l.qty_delivered,
      qty_pending: Math.max(0, l.qty - l.qty_delivered), fabric: l.fabric, color: l.color,
      legs: l.legs, extras: l.extras, notes: l.notes, packages: l.packages, state: l.state,
    })),
    results: RECEPTION_RESULTS,
  });
});

// POST /api/reception — registrar recepción --------------------------------
router.post('/', requireRole('deposito', 'admin'), (req, res) => {
  const b = req.body || {};
  const line = db.prepare('SELECT * FROM order_lines WHERE id=?').get(b.line_id);
  if (!line) return res.status(404).json({ error: 'Línea no encontrada' });
  if (!RECEPTION_RESULTS[b.result]) return res.status(400).json({ error: 'Resultado inválido' });

  const qtyReceived = +b.qty_received || 0;
  const totalDelivered = Math.min(line.qty, line.qty_delivered + qtyReceived);
  const pending = Math.max(0, line.qty - totalDelivered);

  db.prepare(`INSERT INTO receptions (order_id,line_id,result,qty_received,qty_pending,notes,received_by)
    VALUES (?,?,?,?,?,?,?)`).run(line.order_id, line.id, b.result, qtyReceived, pending, b.notes || null, req.user.id);
  db.prepare('UPDATE order_lines SET qty_delivered=? WHERE id=?').run(totalDelivered, line.id);

  // Estado según recepción
  let newState = line.state;
  if (b.result === 'recibido' && pending === 0) newState = 'recibido_completo';
  else if (['recibido', 'parcial'].includes(b.result) && pending > 0) newState = 'recibido_parcial';
  else if (b.result === 'danado') newState = 'con_problema';
  db.prepare('UPDATE order_lines SET state=? WHERE id=?').run(newState, line.id);

  audit(req, { entity: 'receptions', entity_id: line.id, order_id: line.order_id,
    action: 'reception', new_value: `${b.result} (+${qtyReceived}, pend ${pending})` });

  // Incidencia si corresponde
  const problem = ['producto_equivocado', 'tela_incorrecta', 'color_incorrecto',
    'patas_incorrectas', 'faltan_adicionales', 'danado', 'falta_bulto'].includes(b.result);
  if (problem) {
    db.prepare(`INSERT INTO incidents (order_id,line_id,type,description,created_by)
      VALUES (?,?,?,?,?)`).run(line.order_id, line.id, b.result, b.notes || RECEPTION_RESULTS[b.result], req.user.id);
    notifyAdmins({ order_id: line.order_id, type: 'incidencia',
      title: `Problema en recepción: ${RECEPTION_RESULTS[b.result]}`, body: line.product_name });
  } else {
    notifyAdmins({ order_id: line.order_id, type: 'recepcion',
      title: `Recepción registrada`, body: `${line.product_name}: ${RECEPTION_RESULTS[b.result]}` });
  }
  pushToOdoo('sale.order.line', line.odoo_id, { x_recibido: totalDelivered }, 'receptions').catch(() => {});
  res.json({ ok: true, qty_pending: pending, state: newState });
});

module.exports = router;
