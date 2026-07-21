'use strict';
// Comentarios (chat por pedido) + notificaciones.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../auth');
const { audit, notify, notifyAdmins } = require('../helpers');
const router = express.Router();
router.use(authRequired);

function accessibleOrder(user, orderId) {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (!o) return null;
  if (user.role === 'proveedor' && o.supplier_id !== user.supplier_id) return null;
  return o;
}

// GET /api/social/comments/:orderId ---------------------------------------
router.get('/comments/:orderId', (req, res) => {
  const o = accessibleOrder(req.user, req.params.orderId);
  if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
  // El proveedor no ve mensajes internos
  const internalClause = req.user.role === 'proveedor' ? 'AND internal=0' : '';
  const rows = db.prepare(`SELECT c.id,c.body,c.internal,c.is_deleted,c.created_at,u.name AS user_name,u.role AS user_role
    FROM comments c LEFT JOIN users u ON u.id=c.user_id
    WHERE c.order_id=? ${internalClause} ORDER BY c.id ASC`).all(o.id);
  res.json(rows.map((r) => (r.is_deleted ? { ...r, body: '(mensaje eliminado)' } : r)));
});

// POST /api/social/comments/:orderId  { body, internal } -------------------
router.post('/comments/:orderId', (req, res) => {
  const o = accessibleOrder(req.user, req.params.orderId);
  if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: 'Mensaje vacío' });
  // Sólo admin puede marcar interno
  const internal = req.user.role === 'admin' && req.body.internal ? 1 : 0;
  const info = db.prepare('INSERT INTO comments (order_id,user_id,body,internal) VALUES (?,?,?,?)')
    .run(o.id, req.user.id, body.trim(), internal);
  audit(req, { entity: 'comments', entity_id: info.lastInsertRowid, order_id: o.id, action: 'comment' });
  // Notificar a la contraparte
  if (req.user.role === 'proveedor') notifyAdmins({ order_id: o.id, type: 'comentario',
    title: `Comentario del proveedor en ${o.order_number}` });
  else if (!internal && o.supplier_id) {
    const us = db.prepare("SELECT id FROM users WHERE role='proveedor' AND supplier_id=?").all(o.supplier_id);
    for (const u of us) notify({ userId: u.id, order_id: o.id, type: 'comentario',
      title: `Nuevo mensaje en ${o.order_number}` });
  }
  res.json({ ok: true, id: info.lastInsertRowid });
});

// DELETE /api/social/comments/:id — soft delete (se conserva en auditoría) --
router.delete('/comments/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  if (req.user.role !== 'admin' && c.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Sin permiso' });
  }
  db.prepare('UPDATE comments SET is_deleted=1 WHERE id=?').run(c.id);
  audit(req, { entity: 'comments', entity_id: c.id, order_id: c.order_id, action: 'soft_delete',
    old_value: c.body });
  res.json({ ok: true });
});

// GET /api/social/notifications ------------------------------------------
router.get('/notifications', (req, res) => {
  const rows = db.prepare(`SELECT * FROM notifications WHERE user_id=? OR (user_id IS NULL AND role=?)
    ORDER BY id DESC LIMIT 50`).all(req.user.id, req.user.role);
  const unread = db.prepare('SELECT COUNT(*) n FROM notifications WHERE (user_id=? OR (user_id IS NULL AND role=?)) AND is_read=0')
    .get(req.user.id, req.user.role).n;
  res.json({ notifications: rows, unread });
});

// POST /api/social/notifications/read ------------------------------------
router.post('/notifications/read', (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=? OR (user_id IS NULL AND role=?)')
    .run(req.user.id, req.user.role);
  res.json({ ok: true });
});

module.exports = router;
