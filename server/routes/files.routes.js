'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const cfg = require('../config');
const { authRequired } = require('../auth');
const { audit } = require('../helpers');
const router = express.Router();
router.use(authRequired);

fs.mkdirSync(cfg.uploadDir, { recursive: true });
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, cfg.uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: cfg.maxUploadMb * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED.includes(file.mimetype)),
});

function accessibleOrder(user, orderId) {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (!o) return null;
  if (user.role === 'proveedor' && o.supplier_id !== user.supplier_id) return null;
  return o;
}

// POST /api/files/:orderId  (multipart: file, kind, line_id?) --------------
router.post('/:orderId', upload.single('file'), (req, res) => {
  const o = accessibleOrder(req.user, req.params.orderId);
  if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (!req.file) return res.status(400).json({ error: 'Archivo no válido (formatos: PDF, JPG, PNG, WEBP)' });
  const info = db.prepare(`INSERT INTO attachments
    (order_id,line_id,kind,filename,stored_name,mimetype,size,uploaded_by)
    VALUES (?,?,?,?,?,?,?,?)`).run(o.id, req.body.line_id || null, req.body.kind || 'otro',
    req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.user.id);
  audit(req, { entity: 'attachments', entity_id: info.lastInsertRowid, order_id: o.id,
    action: 'upload', new_value: req.file.originalname });
  res.json({ ok: true, id: info.lastInsertRowid });
});

// GET /api/files/:orderId — listar --------------------------------------
router.get('/:orderId', (req, res) => {
  const o = accessibleOrder(req.user, req.params.orderId);
  if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
  res.json(db.prepare('SELECT id,kind,filename,mimetype,size,created_at,line_id FROM attachments WHERE order_id=? ORDER BY id DESC').all(o.id));
});

// GET /api/files/download/:id — descargar --------------------------------
router.get('/download/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'No encontrado' });
  const o = accessibleOrder(req.user, a.order_id);
  if (!o) return res.status(403).json({ error: 'Sin acceso' });
  const file = path.join(cfg.uploadDir, a.stored_name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Archivo no disponible' });
  res.setHeader('Content-Type', a.mimetype);
  res.setHeader('Content-Disposition', `inline; filename="${a.filename}"`);
  fs.createReadStream(file).pipe(res);
});

module.exports = router;
