'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
const cfg = require('./config');
const { audit } = require('./helpers');

const hash = (pw) => bcrypt.hashSync(pw, 10);

function issueToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, supplier_id: user.supplier_id, name: user.name },
    cfg.jwtSecret,
    { expiresIn: cfg.jwtExpires }
  );
}

// Intenta autenticar. Devuelve {user, token} o lanza Error con .status -------
function login(identifier, password, req) {
  const user = db.prepare(
    'SELECT * FROM users WHERE email = ? OR username = ?'
  ).get(identifier, identifier);

  const fail = (msg, status = 401) => { const e = new Error(msg); e.status = status; throw e; };

  if (!user) fail('Usuario o contraseña incorrectos');
  if (!user.is_active) fail('Usuario bloqueado. Contacte al administrador.', 403);
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    fail('Cuenta bloqueada temporalmente por intentos fallidos. Reintente más tarde.', 423);
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    const attempts = user.failed_attempts + 1;
    let lockedUntil = null;
    if (attempts >= cfg.maxLoginAttempts) {
      lockedUntil = new Date(Date.now() + cfg.lockMinutes * 60000).toISOString();
    }
    db.prepare('UPDATE users SET failed_attempts=?, locked_until=? WHERE id=?')
      .run(attempts, lockedUntil, user.id);
    audit(req, { entity: 'users', entity_id: user.id, action: 'login_fail' });
    fail(lockedUntil
      ? 'Demasiados intentos. Cuenta bloqueada temporalmente.'
      : 'Usuario o contraseña incorrectos');
  }

  // OK
  db.prepare(`UPDATE users SET failed_attempts=0, locked_until=NULL,
              last_login_at=datetime('now'), last_login_ip=? WHERE id=?`)
    .run(req?.ip ?? null, user.id);
  audit(req, { entity: 'users', entity_id: user.id, action: 'login' });
  return { user: publicUser(user), token: issueToken(user) };
}

function publicUser(u) {
  return {
    id: u.id, email: u.email, username: u.username, name: u.name,
    role: u.role, supplier_id: u.supplier_id, last_login_at: u.last_login_at,
  };
}

// Middleware: exige token válido y controla inactividad ---------------------
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    const payload = jwt.verify(token, cfg.jwtSecret);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(payload.id);
    if (!user || !user.is_active) return res.status(401).json({ error: 'Sesión inválida' });
    req.user = publicUser(user);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sesión expirada' });
  }
}

// Middleware factory: exige uno de los roles dados --------------------------
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No tiene permisos para esta acción' });
    }
    next();
  };
}

// Recuperación de contraseña: genera token (en un entorno real se enviaría por mail)
function requestReset(email) {
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user) return null; // no revelar existencia
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 60 * 60000).toISOString();
  db.prepare('UPDATE users SET reset_token=?, reset_expires=? WHERE id=?')
    .run(token, expires, user.id);
  return token;
}

function resetPassword(token, newPassword) {
  const user = db.prepare('SELECT * FROM users WHERE reset_token=?').get(token);
  if (!user || !user.reset_expires || new Date(user.reset_expires) < new Date()) {
    const e = new Error('Token inválido o expirado'); e.status = 400; throw e;
  }
  db.prepare('UPDATE users SET password_hash=?, reset_token=NULL, reset_expires=NULL, failed_attempts=0, locked_until=NULL WHERE id=?')
    .run(hash(newPassword), user.id);
  return true;
}

module.exports = {
  hash, login, authRequired, requireRole, publicUser,
  requestReset, resetPassword, issueToken,
};
