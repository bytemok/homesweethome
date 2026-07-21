'use strict';
const express = require('express');
const db = require('../db');
const { authRequired } = require('../auth');
const { audit } = require('../helpers');
const { renderLabels } = require('../labels');
const router = express.Router();
router.use(authRequired);

function canAccessOrder(user, order) {
  if (!order) return false;
  if (user.role === 'proveedor') return order.supplier_id === user.supplier_id;
  return true; // admin y deposito
}

// Construye los datos de etiqueta para una línea -----------------------------
function labelForLine(order, line, bulto) {
  return {
    orderNumber: order.order_number,
    orderBarcode: order.barcode || order.order_number,
    supplier: order.supplier_name,
    qty: line.qty,
    bulto: bulto ? `${bulto.number}/${bulto.total}` : (line.packages > 1 ? `1/${line.packages}` : ''),
    productName: line.product_name,
    productBarcode: line.barcode || line.internal_code || '',
    internalCode: line.internal_code,
    model: line.model, measure: line.measure,
    fabric: line.fabric, color: line.color,
    legs: [line.legs, line.legs_type, line.legs_color].filter(Boolean).join(' '),
    extras: line.extras,
    notes: line.notes,
    clientName: order.client_name,
    phone: order.client_phone, address: order.address,
    city: order.city, province: order.province,
    eta: order.eta ? order.eta.slice(0, 10) : '',
    qrPayload: `LINE:${line.id}`,
  };
}

function orderWithClient(orderId) {
  return db.prepare(`
    SELECT o.*, c.name AS client_name, c.phone AS client_phone, c.address, c.city, c.province,
           s.name AS supplier_name,
           (SELECT MIN(estimated_date) FROM deliveries d WHERE d.order_id=o.id) AS eta
    FROM orders o LEFT JOIN clients c ON c.id=o.client_id
    LEFT JOIN suppliers s ON s.id=o.supplier_id WHERE o.id=?`).get(orderId);
}

// GET /api/labels/order/:orderId?mode=order|unit|package -------------------
router.get('/order/:orderId', async (req, res) => {
  const order = orderWithClient(req.params.orderId);
  if (!canAccessOrder(req.user, order)) return res.status(403).json({ error: 'Sin acceso' });
  const mode = req.query.mode || 'order';
  const lines = db.prepare('SELECT * FROM order_lines WHERE order_id=?').all(order.id);

  const labels = [];
  for (const line of lines) {
    if (mode === 'unit') {
      for (let u = 0; u < Math.max(1, line.qty); u++) labels.push(labelForLine(order, line));
    } else if (mode === 'package') {
      const total = Math.max(1, line.packages);
      for (let n = 1; n <= total; n++) labels.push(labelForLine(order, line, { number: n, total }));
    } else {
      labels.push(labelForLine(order, line));
    }
  }
  db.prepare('INSERT INTO labels (order_id,scope,printed_by) VALUES (?,?,?)')
    .run(order.id, mode, req.user.id);
  audit(req, { entity: 'labels', order_id: order.id, action: 'print', new_value: `${mode} x${labels.length}` });
  await renderLabels(res, labels, `etiquetas-${order.order_number}.pdf`);
});

// GET /api/labels/line/:lineId — una etiqueta de una línea -----------------
router.get('/line/:lineId', async (req, res) => {
  const line = db.prepare('SELECT * FROM order_lines WHERE id=?').get(req.params.lineId);
  if (!line) return res.status(404).json({ error: 'Línea no encontrada' });
  const order = orderWithClient(line.order_id);
  if (!canAccessOrder(req.user, order)) return res.status(403).json({ error: 'Sin acceso' });
  db.prepare('INSERT INTO labels (order_id,line_id,scope,printed_by) VALUES (?,?,?,?)')
    .run(order.id, line.id, 'linea', req.user.id);
  audit(req, { entity: 'labels', order_id: order.id, line_id: line.id, action: 'print' });
  await renderLabels(res, [labelForLine(order, line)], `etiqueta-${order.order_number}.pdf`);
});

// GET /api/labels/multi?orders=1,2,3 — varios pedidos ----------------------
router.get('/multi', async (req, res) => {
  const ids = String(req.query.orders || '').split(',').map(Number).filter(Boolean);
  const labels = [];
  for (const id of ids) {
    const order = orderWithClient(id);
    if (!canAccessOrder(req.user, order)) continue;
    const lines = db.prepare('SELECT * FROM order_lines WHERE order_id=?').all(order.id);
    for (const line of lines) labels.push(labelForLine(order, line));
    db.prepare('INSERT INTO labels (order_id,scope,printed_by) VALUES (?,?,?)').run(order.id, 'multi', req.user.id);
  }
  audit(req, { entity: 'labels', action: 'print_multi', new_value: `${labels.length} etiquetas` });
  await renderLabels(res, labels, 'etiquetas-multiples.pdf');
});

module.exports = router;
