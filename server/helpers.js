'use strict';
const db = require('./db');

// Auditoría: registra un cambio de campo con contexto de request -------------
function audit(req, { entity, entity_id, order_id, field, old_value, new_value, action }) {
  db.prepare(`INSERT INTO audit_log
      (user_id, entity, entity_id, order_id, field, old_value, new_value, action, ip, device)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    req?.user?.id ?? null,
    entity, entity_id ?? null, order_id ?? null,
    field ?? null,
    old_value == null ? null : String(old_value),
    new_value == null ? null : String(new_value),
    action ?? 'update',
    req?.ip ?? null,
    req?.headers?.['user-agent']?.slice(0, 255) ?? null
  );
}

// Notificación in-app. destino: {userId} o {role} ---------------------------
function notify({ userId = null, role = null, order_id = null, type, title, body = '' }) {
  db.prepare(`INSERT INTO notifications (user_id, role, order_id, type, title, body)
              VALUES (?,?,?,?,?,?)`).run(userId, role, order_id, type, title, body);
}

// Notifica a todos los administradores --------------------------------------
function notifyAdmins(payload) {
  const admins = db.prepare("SELECT id FROM users WHERE role='admin' AND is_active=1").all();
  for (const a of admins) notify({ ...payload, userId: a.id });
}

function logSync({ direction, entity, ref_id = null, status, message = '' }) {
  db.prepare(`INSERT INTO sync_logs (direction, entity, ref_id, status, message)
              VALUES (?,?,?,?,?)`).run(direction, entity, ref_id, status, message);
}

module.exports = { audit, notify, notifyAdmins, logSync };
