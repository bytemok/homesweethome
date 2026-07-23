'use strict';
// Cliente XML-RPC mínimo para Odoo 19 (External API) + capa de sincronización.
// Si ODOO_ENABLED=false trabaja en modo mock (datos de prueba locales) y
// simula los push registrándolos en sync_logs.
const https = require('https');
const http = require('http');
const { URL } = require('url');
const cfg = require('./config');
const db = require('./db');
const { logSync } = require('./helpers');

// ---- Serialización XML-RPC -------------------------------------------------
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function encodeValue(v) {
  if (v === null || v === undefined) return '<value><nil/></value>';
  if (typeof v === 'boolean') return `<value><boolean>${v ? 1 : 0}</boolean></value>`;
  if (typeof v === 'number') {
    return Number.isInteger(v)
      ? `<value><int>${v}</int></value>`
      : `<value><double>${v}</double></value>`;
  }
  if (Array.isArray(v)) {
    return `<value><array><data>${v.map(encodeValue).join('')}</data></array></value>`;
  }
  if (typeof v === 'object') {
    const members = Object.entries(v)
      .map(([k, val]) => `<member><name>${esc(k)}</name>${encodeValue(val)}</member>`)
      .join('');
    return `<value><struct>${members}</struct></value>`;
  }
  return `<value><string>${esc(v)}</string></value>`;
}
function buildRequest(method, params) {
  return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName>` +
    `<params>${params.map((p) => `<param>${encodeValue(p)}</param>`).join('')}</params></methodCall>`;
}

// ---- Parser XML-RPC (suficiente para respuestas de Odoo) -------------------
function parseResponse(xml) {
  let i = 0;
  const skipWs = () => { while (i < xml.length && /\s/.test(xml[i])) i++; };
  function readTag() {
    skipWs();
    if (xml[i] !== '<') return null;
    const end = xml.indexOf('>', i);
    const tag = xml.slice(i + 1, end);
    i = end + 1;
    return tag;
  }
  function readTextUntil(closeTag) {
    const idx = xml.indexOf(`</${closeTag}>`, i);
    const txt = xml.slice(i, idx);
    i = idx + closeTag.length + 3;
    return txt.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  function parseValue() {
    skipWs();
    // <value> ...
    let tag = readTag();
    if (tag !== 'value') throw new Error('esperaba <value>');
    skipWs();
    // El tipo interno, o texto plano (=string)
    if (xml[i] !== '<') { // texto sin tipo
      const idx = xml.indexOf('</value>', i);
      const txt = xml.slice(i, idx); i = idx + 8;
      return txt;
    }
    const t = readTag();
    let val;
    switch (t) {
      case 'array': {
        readTag(); // <data>
        val = [];
        skipWs();
        while (xml.startsWith('<value', i)) { val.push(parseValue()); skipWs(); }
        readTag(); // </data>
        readTag(); // </array>
        break;
      }
      case 'struct': {
        val = {};
        skipWs();
        while (xml.startsWith('<member', i)) {
          readTag(); // <member>
          readTag(); // <name>
          const name = readTextUntil('name');
          val[name] = parseValue();
          skipWs(); readTag(); // </member>
          skipWs();
        }
        readTag(); // </struct>
        break;
      }
      case 'int': case 'i4': val = parseInt(readTextUntil(t), 10); break;
      case 'double': val = parseFloat(readTextUntil(t)); break;
      case 'boolean': val = readTextUntil(t).trim() === '1'; break;
      case 'nil': val = null; i = xml.indexOf('>', i - 4) + 1; readTag(); break;
      case 'string': val = readTextUntil('string'); break;
      default: val = readTextUntil(t);
    }
    readTag(); // </value>
    return val;
  }
  // fault?
  if (/<fault>/.test(xml)) {
    const idx = xml.indexOf('<value', xml.indexOf('<fault>'));
    i = idx;
    const fault = parseValue();
    const e = new Error(fault?.faultString || 'Odoo fault');
    e.odooFault = fault; throw e;
  }
  const idx = xml.indexOf('<param>');
  i = xml.indexOf('<value', idx);
  return parseValue();
}

// ---- Transporte ------------------------------------------------------------
function call(endpoint, method, params) {
  return new Promise((resolve, reject) => {
    const body = buildRequest(method, params);
    const u = new URL(cfg.odoo.url + endpoint);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(parseResponse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

let _uid = null;
async function authenticate() {
  if (_uid) return _uid;
  _uid = await call('/xmlrpc/2/common', 'authenticate',
    [cfg.odoo.db, cfg.odoo.username, cfg.odoo.password, {}]);
  if (!_uid) throw new Error('Autenticación con Odoo fallida (verifique credenciales).');
  return _uid;
}
async function execKw(model, method, args, kwargs = {}) {
  const uid = await authenticate();
  return call('/xmlrpc/2/object', 'execute_kw',
    [cfg.odoo.db, uid, cfg.odoo.password, model, method, args, kwargs]);
}

// ---- Sincronización (pull) -------------------------------------------------
// Trae órdenes de venta confirmadas desde Odoo y las mapea al modelo local.
async function pullOrders() {
  if (!cfg.odoo.enabled) {
    logSync({ direction: 'pull', entity: 'sale.order', status: 'ok',
      message: 'Modo mock: Odoo deshabilitado. Use datos de prueba (npm run seed).' });
    return { imported: 0, mode: 'mock' };
  }
  const orders = await execKw('sale.order', 'search_read',
    [[['state', '=', 'sale']]],
    { fields: ['name', 'partner_id', 'date_order', 'amount_total', 'user_id'], limit: 200 });

  let imported = 0;
  for (const o of orders) {
    try {
      // Cliente
      const partnerId = Array.isArray(o.partner_id) ? o.partner_id[0] : null;
      let clientId = null;
      if (partnerId) {
        const [p] = await execKw('res.partner', 'read', [[partnerId]],
          { fields: ['name', 'phone', 'street', 'city', 'state_id', 'zip'] });
        const existing = db.prepare('SELECT id FROM clients WHERE odoo_id=?').get(partnerId);
        if (existing) clientId = existing.id;
        else {
          clientId = db.prepare(`INSERT INTO clients (odoo_id,name,phone,address,city,province,zip)
            VALUES (?,?,?,?,?,?,?)`).run(partnerId, p.name, p.phone, p.street, p.city,
            Array.isArray(p.state_id) ? p.state_id[1] : null, p.zip).lastInsertRowid;
        }
      }
      // Orden
      const exists = db.prepare('SELECT id FROM orders WHERE odoo_id=?').get(o.id);
      let orderId;
      if (exists) {
        orderId = exists.id;
        db.prepare('UPDATE orders SET sale_total=?, updated_at=datetime(\'now\') WHERE id=?')
          .run(o.amount_total, orderId);
      } else {
        orderId = db.prepare(`INSERT INTO orders
          (odoo_id, order_number, barcode, client_id, salesperson, sale_total, created_date, confirmed_date)
          VALUES (?,?,?,?,?,?,?,?)`).run(o.id, o.name, o.name, clientId,
          Array.isArray(o.user_id) ? o.user_id[1] : null, o.amount_total,
          o.date_order, o.date_order).lastInsertRowid;
      }
      // Líneas
      const lines = await execKw('sale.order.line', 'search_read',
        [[['order_id', '=', o.id], ['display_type', '=', false]]],
        { fields: ['product_id', 'name', 'product_uom_qty', 'price_unit'] });
      for (const l of lines) {
        if (db.prepare('SELECT id FROM order_lines WHERE odoo_id=?').get(l.id)) continue;
        let code = null, barcode = null, model = null;
        if (Array.isArray(l.product_id)) {
          const [prod] = await execKw('product.product', 'read', [[l.product_id[0]]],
            { fields: ['default_code', 'barcode'] });
          code = prod.default_code; barcode = prod.barcode;
        }
        db.prepare(`INSERT INTO order_lines (odoo_id, order_id, product_name, internal_code, barcode, qty)
          VALUES (?,?,?,?,?,?)`).run(l.id, orderId, l.name, code, barcode, l.product_uom_qty);
      }
      imported++;
      logSync({ direction: 'pull', entity: 'sale.order', ref_id: o.id, status: 'ok' });
    } catch (e) {
      logSync({ direction: 'pull', entity: 'sale.order', ref_id: o.id, status: 'error', message: e.message });
    }
  }
  return { imported, mode: 'odoo' };
}

// ---- Sincronización (push) -------------------------------------------------
// Escribe de vuelta en Odoo. En modo mock sólo registra la intención.
async function pushToOdoo(model, odooId, values, entity) {
  if (!cfg.odoo.enabled) {
    logSync({ direction: 'push', entity, ref_id: odooId, status: 'ok',
      message: `Mock: ${model}.write ${JSON.stringify(values)}` });
    return { mode: 'mock' };
  }
  try {
    if (!odooId) throw new Error('registro sin odoo_id');
    await execKw(model, 'write', [[odooId], values]);
    logSync({ direction: 'push', entity, ref_id: odooId, status: 'ok', message: `${model}.write` });
    return { mode: 'odoo' };
  } catch (e) {
    logSync({ direction: 'push', entity, ref_id: odooId, status: 'error', message: e.message });
    throw e;
  }
}

// ---- Sincronización de ÓRDENES DE COMPRA (asignación por proveedor) --------
// Cada orden de compra confirmada (state='purchase') se convierte en un pedido
// del portal, asignado automáticamente al proveedor de esa OC (match por odoo_id).
async function pullPurchaseOrders() {
  if (!cfg.odoo.enabled) {
    logSync({ direction: 'pull', entity: 'purchase.order', status: 'ok',
      message: 'Modo mock: Odoo deshabilitado.' });
    return { imported: 0, assigned: 0, mode: 'mock' };
  }
  const pos = await execKw('purchase.order', 'search_read',
    [[['state', 'in', ['purchase', 'done']]]],
    { fields: ['name', 'partner_id', 'date_order', 'date_planned', 'origin', 'amount_total', 'partner_ref'], limit: 5000 });

  let imported = 0, assigned = 0;
  for (const po of pos) {
    try {
      const partnerId = Array.isArray(po.partner_id) ? po.partner_id[0] : null;
      const partnerName = Array.isArray(po.partner_id) ? po.partner_id[1] : 'Proveedor';
      if (!partnerId) continue;

      // Proveedor: buscar por odoo_id, o crearlo si no existe
      let sup = db.prepare('SELECT id FROM suppliers WHERE odoo_id=?').get(partnerId);
      if (!sup) {
        const supId = db.prepare('INSERT INTO suppliers (odoo_id,name) VALUES (?,?)')
          .run(partnerId, partnerName).lastInsertRowid;
        sup = { id: supId };
      }

      // Cliente final + precio de venta + CANAL (para detectar Mercado Libre / Tienda Nube)
      let clientId = null, saleTotal = po.amount_total, channel = po.partner_ref || null;
      if (po.origin) {
        const so = await execKw('sale.order', 'search_read', [[['name', '=', po.origin]]],
          { fields: ['partner_id', 'amount_total', 'team_id', 'client_order_ref'], limit: 1 }).catch(() => []);
        if (so && so[0]) {
          if (typeof so[0].amount_total === 'number') saleTotal = so[0].amount_total;
          channel = [Array.isArray(so[0].team_id) ? so[0].team_id[1] : null,
            so[0].client_order_ref, po.partner_ref].filter(Boolean).join(' ') || null;
        }
        if (so && so[0] && Array.isArray(so[0].partner_id)) {
          const cpid = so[0].partner_id[0];
          const ex = db.prepare('SELECT id FROM clients WHERE odoo_id=?').get(cpid);
          if (ex) clientId = ex.id;
          else {
            const [p] = await execKw('res.partner', 'read', [[cpid]],
              { fields: ['name', 'phone', 'street', 'city', 'state_id', 'zip'] });
            clientId = db.prepare(`INSERT INTO clients (odoo_id,name,phone,address,city,province,zip)
              VALUES (?,?,?,?,?,?,?)`).run(cpid, p.name, p.phone, p.street, p.city,
              Array.isArray(p.state_id) ? p.state_id[1] : null, p.zip).lastInsertRowid;
          }
        }
      }

      // Nº mostrado = número de VENTA (origen, S…); internamente se clavea por la OC (P…).
      const poNumber = po.name;
      const saleNumber = (po.origin && String(po.origin).trim())
        ? String(po.origin).split(',')[0].trim() : po.name;
      const existing = db.prepare('SELECT id, supplier_id FROM orders WHERE po_number=? OR order_number=?')
        .get(poNumber, poNumber);
      let orderId;
      if (existing) {
        orderId = existing.id;
        db.prepare(`UPDATE orders SET supplier_id=?, client_id=COALESCE(?,client_id), sale_total=?,
          order_number=?, barcode=?, po_number=?, store=COALESCE(?,store), updated_at=datetime('now') WHERE id=?`)
          .run(sup.id, clientId, saleTotal, saleNumber, saleNumber, poNumber, channel, orderId);
        if (existing.supplier_id !== sup.id) assigned++;
      } else {
        orderId = db.prepare(`INSERT INTO orders
          (order_number, po_number, barcode, client_id, supplier_id, sale_total, store, created_date, confirmed_date, confirmation)
          VALUES (?,?,?,?,?,?,?,?,?, 'nuevo')`).run(saleNumber, poNumber, saleNumber, clientId, sup.id,
          saleTotal, channel, po.date_order, po.date_order).lastInsertRowid;
        assigned++;
        // Notificar al proveedor
        const users = db.prepare("SELECT id FROM users WHERE role='proveedor' AND supplier_id=?").all(sup.id);
        for (const u of users) {
          db.prepare(`INSERT INTO notifications (user_id, order_id, type, title)
            VALUES (?,?,?,?)`).run(u.id, orderId, 'asignado', `Nuevo pedido asignado: ${saleNumber}`);
        }
      }

      // Líneas de la OC (con cantidad ya recibida para saber qué falta entregar)
      const lines = await execKw('purchase.order.line', 'search_read',
        [[['order_id', '=', po.id]]],
        { fields: ['product_id', 'name', 'product_qty', 'price_unit', 'qty_received', 'date_planned'] });
      for (const l of lines) {
        const qty = +l.product_qty || 0;
        const received = +l.qty_received || 0;
        const fullyReceived = qty > 0 && received >= qty;
        const existing = db.prepare('SELECT id, state FROM order_lines WHERE odoo_id=?').get(l.id);
        if (existing) {
          // Actualizar lo recibido; si ya llegó todo, marcar recibido_completo (sale de la lista del proveedor)
          const newState = fullyReceived ? 'recibido_completo' : existing.state;
          db.prepare('UPDATE order_lines SET qty=?, qty_delivered=?, state=? WHERE id=?')
            .run(qty, received, newState, existing.id);
          continue;
        }
        let code = null, barcode = null;
        if (Array.isArray(l.product_id)) {
          const [prod] = await execKw('product.product', 'read', [[l.product_id[0]]],
            { fields: ['default_code', 'barcode'] }).catch(() => [{}]);
          code = prod?.default_code || null; barcode = prod?.barcode || null;
        }
        db.prepare(`INSERT INTO order_lines (odoo_id, order_id, product_name, internal_code, barcode, qty, qty_delivered, state)
          VALUES (?,?,?,?,?,?,?,?)`).run(l.id, orderId, l.name, code, barcode, qty, received,
          fullyReceived ? 'recibido_completo' : 'nuevo');
      }
      imported++;
      logSync({ direction: 'pull', entity: 'purchase.order', ref_id: po.id, status: 'ok', message: `${po.name} -> ${partnerName}` });
    } catch (e) {
      logSync({ direction: 'pull', entity: 'purchase.order', ref_id: po.id, status: 'error', message: e.message });
    }
  }
  return { imported, assigned, mode: 'odoo' };
}

module.exports = { pullOrders, pullPurchaseOrders, pushToOdoo, execKw, authenticate, call, _internals: { parseResponse, buildRequest } };
