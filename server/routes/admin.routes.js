'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { authRequired, requireRole } = auth;
const { audit } = require('../helpers');
const router = express.Router();
router.use(authRequired, requireRole('admin'));

// --- Usuarios --------------------------------------------------------------
router.get('/users', (req, res) => {
  res.json(db.prepare(`SELECT u.id,u.email,u.username,u.name,u.role,u.supplier_id,u.is_active,
    u.last_login_at,u.last_login_ip,s.name AS supplier_name
    FROM users u LEFT JOIN suppliers s ON s.id=u.supplier_id ORDER BY u.id`).all());
});

router.post('/users', (req, res) => {
  const { email, username, name, password, role, supplier_id } = req.body || {};
  if (!email || !name || !password || !role) return res.status(400).json({ error: 'Faltan datos' });
  if (!['admin', 'proveedor', 'deposito'].includes(role)) return res.status(400).json({ error: 'Rol inválido' });
  if (role === 'proveedor' && !supplier_id) return res.status(400).json({ error: 'El proveedor debe estar vinculado a un registro de proveedor' });
  try {
    const info = db.prepare(`INSERT INTO users (email,username,name,password_hash,role,supplier_id)
      VALUES (?,?,?,?,?,?)`).run(email, username || null, name, auth.hash(password), role,
      role === 'proveedor' ? supplier_id : null);
    audit(req, { entity: 'users', entity_id: info.lastInsertRowid, action: 'create_user', new_value: email });
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'Email o usuario ya existente' });
  }
});

router.patch('/users/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'No encontrado' });
  const { name, role, supplier_id, is_active, password } = req.body || {};
  db.prepare(`UPDATE users SET name=COALESCE(?,name), role=COALESCE(?,role),
    supplier_id=?, is_active=COALESCE(?,is_active), password_hash=COALESCE(?,password_hash),
    locked_until=NULL, failed_attempts=0 WHERE id=?`).run(
    name ?? null, role ?? null, supplier_id ?? u.supplier_id,
    is_active == null ? null : (is_active ? 1 : 0),
    password ? auth.hash(password) : null, u.id);
  audit(req, { entity: 'users', entity_id: u.id, action: 'update_user' });
  res.json({ ok: true });
});

// Bloquear / desbloquear rápido
router.post('/users/:id/block', (req, res) => {
  const active = req.body?.active ? 1 : 0;
  db.prepare('UPDATE users SET is_active=? WHERE id=?').run(active, req.params.id);
  audit(req, { entity: 'users', entity_id: +req.params.id, action: active ? 'unblock' : 'block' });
  res.json({ ok: true });
});

// --- Proveedores -----------------------------------------------------------
router.get('/suppliers', (req, res) => {
  res.json(db.prepare('SELECT * FROM suppliers ORDER BY name').all());
});
router.post('/suppliers', (req, res) => {
  const { name, cuit, email, phone, odoo_id } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const info = db.prepare('INSERT INTO suppliers (name,cuit,email,phone,odoo_id) VALUES (?,?,?,?,?)')
    .run(name, cuit || null, email || null, phone || null, odoo_id || null);
  audit(req, { entity: 'suppliers', entity_id: info.lastInsertRowid, action: 'create' });
  res.json({ ok: true, id: info.lastInsertRowid });
});

// --- Auditoría / historial de cambios --------------------------------------
router.get('/audit', (req, res) => {
  const { order_id, entity, limit } = req.query;
  const where = [], params = [];
  if (order_id) { where.push('a.order_id=?'); params.push(order_id); }
  if (entity) { where.push('a.entity=?'); params.push(entity); }
  const rows = db.prepare(`SELECT a.*, u.name AS user_name FROM audit_log a
    LEFT JOIN users u ON u.id=a.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.id DESC LIMIT ?`).all(...params, Number(limit) || 200);
  res.json(rows);
});

// --- Logs de sincronización ------------------------------------------------
router.get('/sync-logs', (req, res) => {
  res.json(db.prepare('SELECT * FROM sync_logs ORDER BY id DESC LIMIT 200').all());
});

module.exports = router;
