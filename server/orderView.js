'use strict';
const db = require('./db');
const cfg = require('./config');

// Calcula el total de una fila de costo (regla de negocio del enunciado) -----
function computeCostTotal(c) {
  const unit = +c.unit_cost || 0, qty = +c.qty || 0;
  return unit * qty + (+c.extras_cost || 0) + (+c.legs_cost || 0) +
    (+c.fabric_cost || 0) + (+c.packaging_cost || 0) +
    (+c.shipping_cost || 0) + (+c.other_cost || 0);
}

// Rentabilidad de un pedido (SOLO admin). Devuelve desglose + alertas --------
function profitability(order, lines) {
  const sale = +order.sale_total || 0;
  let cost = 0, missingCost = false;
  for (const l of lines) {
    if (l.cost && l.cost.status !== 'rechazado') cost += +l.cost.total_cost || 0;
    else missingCost = true;
  }
  const net = sale - cost;
  const margin = sale > 0 ? (net / sale) * 100 : 0;
  const alerts = [];
  if (missingCost) alerts.push({ level: 'warn', msg: 'Faltan costos por cargar/aprobar' });
  if (net < 0) alerts.push({ level: 'danger', msg: 'Rentabilidad negativa' });
  if (sale > 0 && margin < cfg.minMarginPct) alerts.push({ level: 'warn', msg: `Margen por debajo del mínimo (${cfg.minMarginPct}%)` });
  return { sale, cost, net, margin: +margin.toFixed(2), missingCost, alerts };
}

// Ensambla el detalle completo de un pedido. hideFinancials oculta venta/rent.
function assembleOrder(orderId, { hideFinancials = false } = {}) {
  const order = db.prepare(`
    SELECT o.*, c.name AS client_name, c.phone AS client_phone, c.address, c.city,
           c.province, c.zip, s.name AS supplier_name
    FROM orders o
    LEFT JOIN clients c ON c.id = o.client_id
    LEFT JOIN suppliers s ON s.id = o.supplier_id
    WHERE o.id = ?`).get(orderId);
  if (!order) return null;

  const lines = db.prepare('SELECT * FROM order_lines WHERE order_id=? ORDER BY id').all(orderId);
  for (const l of lines) {
    const cost = db.prepare('SELECT * FROM line_costs WHERE line_id=? ORDER BY id DESC LIMIT 1').get(l.id);
    l.cost = cost || null;
    l.bultos = db.prepare('SELECT * FROM bultos WHERE line_id=? ORDER BY number').all(l.id);
  }
  const delivery = db.prepare('SELECT * FROM deliveries WHERE order_id=? ORDER BY id DESC LIMIT 1').get(orderId);
  const attachments = db.prepare('SELECT id,kind,filename,mimetype,size,created_at,line_id FROM attachments WHERE order_id=? ORDER BY id DESC').all(orderId);
  const history = db.prepare(`SELECT a.*, u.name AS user_name FROM audit_log a
     LEFT JOIN users u ON u.id=a.user_id WHERE a.order_id=? ORDER BY a.id DESC LIMIT 100`).all(orderId);

  const result = { ...order, lines, delivery: delivery || null, attachments, history };

  if (hideFinancials) {
    delete result.sale_total;
    for (const l of result.lines) {
      // el proveedor SÍ ve su costo cargado, pero nunca venta ni rentabilidad
    }
  } else {
    result.profit = profitability(order, lines);
  }
  return result;
}

module.exports = { assembleOrder, profitability, computeCostTotal };
