'use strict';
const express = require('express');
const db = require('../db');
const cfg = require('../config');
const { authRequired, requireRole } = require('../auth');
const { profitability } = require('../orderView');
const router = express.Router();
router.use(authRequired);

// Cláusula de scoping para proveedor ----------------------------------------
function scope(user) {
  return user.role === 'proveedor'
    ? { clause: 'AND o.supplier_id = @sid', sid: user.supplier_id }
    : { clause: '', sid: null };
}

// GET /api/dashboard/cards — tarjetas del panel del proveedor/admin --------
router.get('/cards', (req, res) => {
  const s = scope(req.user);
  const q = (sql) => db.prepare(sql).get({ sid: s.sid }).n;
  const base = `FROM orders o WHERE 1=1 ${s.clause}`;
  const lineBase = `FROM order_lines l JOIN orders o ON o.id=l.order_id WHERE 1=1 ${s.clause}`;

  // Un pedido está PENDIENTE si le queda alguna línea sin entregar (pick-in sin validar).
  const PEND = `EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id=o.id AND l.qty_delivered<l.qty AND l.state<>'cancelado')`;
  const HAS = `EXISTS (SELECT 1 FROM order_lines l0 WHERE l0.order_id=o.id)`;
  const has = (states) => `EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id=o.id AND l.state IN (${states}))`;

  const cards = {
    a_fabricar: q(`SELECT COUNT(*) n ${base} AND ${PEND}`),
    en_fabricacion: q(`SELECT COUNT(*) n ${base} AND ${PEND} AND ${has("'en_produccion','en_tapiceria','en_terminacion','pendiente_materiales'")}`),
    demorados: q(`SELECT COUNT(*) n ${base} AND ${PEND} AND ${has("'demorado'")}`),
    terminados: q(`SELECT COUNT(*) n ${base} AND ${PEND} AND ${has("'terminado','embalado','listo_retiro'")}`),
    entregados: q(`SELECT COUNT(*) n ${base} AND ${HAS} AND NOT ${PEND}`),
    sin_costo: q(`SELECT COUNT(*) n ${base} AND ${PEND} AND EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id=o.id AND l.qty_delivered<l.qty AND NOT EXISTS (SELECT 1 FROM line_costs lc WHERE lc.line_id=l.id))`),
    sin_fecha: q(`SELECT COUNT(*) n ${base} AND ${PEND} AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.order_id=o.id AND d.estimated_date IS NOT NULL)`),
    productos_pendientes: q(`SELECT COALESCE(SUM(l.qty - l.qty_delivered),0) n ${lineBase} AND l.state NOT IN ('recibido_completo','cancelado') AND l.qty_delivered<l.qty`),
  };

  // Próximas entregas (7 días)
  const proximas = db.prepare(`
    SELECT o.order_number, d.estimated_date, s2.name AS supplier_name
    FROM deliveries d JOIN orders o ON o.id=d.order_id
    LEFT JOIN suppliers s2 ON s2.id=o.supplier_id
    WHERE d.estimated_date IS NOT NULL ${s.clause}
      AND date(d.estimated_date) >= date('now') AND date(d.estimated_date) <= date('now','+7 day')
    ORDER BY d.estimated_date ASC LIMIT 10`).all({ sid: s.sid });

  res.json({ cards, proximas });
});

// GET /api/dashboard/admin — panel administrativo (solo admin) -------------
router.get('/admin', requireRole('admin'), (req, res) => {
  const orders = db.prepare('SELECT * FROM orders').all();
  let committed = 0, totalNet = 0, totalSale = 0, loss = 0, marginSum = 0, marginCount = 0;
  const perModel = {}, perSupplier = {}, perSalesperson = {};

  for (const o of orders) {
    const lines = db.prepare('SELECT * FROM order_lines WHERE order_id=?').all(o.id);
    for (const l of lines) {
      l.cost = db.prepare('SELECT * FROM line_costs WHERE line_id=? ORDER BY id DESC LIMIT 1').get(l.id);
      if (l.cost && l.cost.status === 'aprobado') committed += l.cost.total_cost || 0;
    }
    const p = profitability(o, lines);
    totalNet += p.net; totalSale += p.sale;
    if (p.net < 0) loss++;
    if (p.sale > 0) { marginSum += p.margin; marginCount++; }

    const supName = db.prepare('SELECT name FROM suppliers WHERE id=?').get(o.supplier_id)?.name || 'Sin asignar';
    perSupplier[supName] = perSupplier[supName] || { orders: 0, net: 0 };
    perSupplier[supName].orders++; perSupplier[supName].net += p.net;
    if (o.salesperson) {
      perSalesperson[o.salesperson] = perSalesperson[o.salesperson] || { orders: 0, net: 0 };
      perSalesperson[o.salesperson].orders++; perSalesperson[o.salesperson].net += p.net;
    }
    for (const l of lines) {
      const m = l.model || l.product_name;
      perModel[m] = perModel[m] || { qty: 0, net: 0 };
      perModel[m].qty += l.qty;
    }
  }

  const pendingCosts = db.prepare(`SELECT COUNT(*) n FROM line_costs lc WHERE lc.status='pendiente'
    AND lc.id=(SELECT MAX(id) FROM line_costs WHERE line_id=lc.line_id)`).get().n;
  const productsPending = db.prepare(`SELECT COALESCE(SUM(qty-qty_delivered),0) n FROM order_lines
    WHERE state NOT IN ('recibido_completo','cancelado')`).get().n;
  const productsDone = db.prepare("SELECT COUNT(*) n FROM order_lines WHERE state='terminado'").get().n;
  const productsDelayed = db.prepare("SELECT COUNT(*) n FROM order_lines WHERE state='demorado'").get().n;
  const ordersNoCost = db.prepare(`SELECT COUNT(DISTINCT order_id) n FROM order_lines l
    WHERE NOT EXISTS (SELECT 1 FROM line_costs lc WHERE lc.line_id=l.id)`).get().n;
  const ordersNoDate = db.prepare(`SELECT COUNT(*) n FROM orders o
    WHERE NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.order_id=o.id AND d.estimated_date IS NOT NULL)`).get().n;

  res.json({
    totals: {
      committed: +committed.toFixed(2),
      total_net: +totalNet.toFixed(2),
      total_sale: +totalSale.toFixed(2),
      avg_margin: marginCount ? +(marginSum / marginCount).toFixed(2) : 0,
      orders_with_loss: loss,
      pending_costs: pendingCosts,
      products_pending: productsPending,
      products_done: productsDone,
      products_delayed: productsDelayed,
      orders_no_cost: ordersNoCost,
      orders_no_date: ordersNoDate,
      min_margin_pct: cfg.minMarginPct,
    },
    by_supplier: Object.entries(perSupplier).map(([name, v]) => ({ name, ...v, net: +v.net.toFixed(2) })),
    by_salesperson: Object.entries(perSalesperson).map(([name, v]) => ({ name, ...v, net: +v.net.toFixed(2) })),
    by_model: Object.entries(perModel).map(([name, v]) => ({ name, ...v })).slice(0, 20),
  });
});

// GET /api/dashboard/suppliers-ranking — ranking de proveedores (admin) ----
router.get('/suppliers-ranking', requireRole('admin'), (req, res) => {
  const suppliers = db.prepare('SELECT * FROM suppliers').all();
  const rows = suppliers.map((s) => {
    const orders = db.prepare('SELECT COUNT(*) n FROM orders WHERE supplier_id=?').get(s.id).n;
    const products = db.prepare(`SELECT COALESCE(SUM(l.qty),0) n FROM order_lines l
      JOIN orders o ON o.id=l.order_id WHERE o.supplier_id=?`).get(s.id).n;
    const delayed = db.prepare(`SELECT COUNT(*) n FROM order_lines l
      JOIN orders o ON o.id=l.order_id WHERE o.supplier_id=? AND l.state='demorado'`).get(s.id).n;
    const incidents = db.prepare(`SELECT COUNT(*) n FROM incidents i
      JOIN orders o ON o.id=i.order_id WHERE o.supplier_id=?`).get(s.id).n;
    // Entregas a tiempo vs demoradas
    const onTime = db.prepare(`SELECT COUNT(*) n FROM deliveries d JOIN orders o ON o.id=d.order_id
      WHERE o.supplier_id=? AND d.real_date IS NOT NULL AND (d.estimated_date IS NULL OR d.real_date<=d.estimated_date)`).get(s.id).n;
    const late = db.prepare(`SELECT COUNT(*) n FROM deliveries d JOIN orders o ON o.id=d.order_id
      WHERE o.supplier_id=? AND d.real_date IS NOT NULL AND d.estimated_date IS NOT NULL AND d.real_date>d.estimated_date`).get(s.id).n;
    const completion = orders ? Math.round(((orders - delayed) / orders) * 100) : 0;
    const avgCost = db.prepare(`SELECT COALESCE(AVG(lc.total_cost),0) n FROM line_costs lc
      JOIN order_lines l ON l.id=lc.line_id JOIN orders o ON o.id=l.order_id WHERE o.supplier_id=?`).get(s.id).n;
    return {
      supplier: s.name, orders, products, delayed, incidents,
      on_time: onTime, late, completion_pct: completion, avg_cost: +avgCost.toFixed(2),
    };
  }).sort((a, b) => b.completion_pct - a.completion_pct);
  res.json(rows);
});

module.exports = router;
