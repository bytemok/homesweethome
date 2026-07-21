'use strict';
require('dotenv').config();
const path = require('path');

const root = path.resolve(__dirname, '..');
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v, d) => (v === undefined ? d : String(v).toLowerCase() === 'true');

module.exports = {
  root,
  port: num(process.env.PORT, 3000),
  env: process.env.NODE_ENV || 'development',

  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  jwtExpires: process.env.JWT_EXPIRES || '8h',
  sessionIdleMinutes: num(process.env.SESSION_IDLE_MINUTES, 30),
  maxLoginAttempts: num(process.env.MAX_LOGIN_ATTEMPTS, 5),
  lockMinutes: num(process.env.LOCK_MINUTES, 15),

  dbPath: path.resolve(root, process.env.DB_PATH || './data/portal.db'),
  uploadDir: path.resolve(root, process.env.UPLOAD_DIR || './uploads'),
  maxUploadMb: num(process.env.MAX_UPLOAD_MB, 15),

  minMarginPct: num(process.env.MIN_MARGIN_PCT, 20),
  defaultCurrency: process.env.DEFAULT_CURRENCY || 'ARS',

  odoo: {
    enabled: bool(process.env.ODOO_ENABLED, false),
    url: process.env.ODOO_URL || '',
    db: process.env.ODOO_DB || '',
    username: process.env.ODOO_USERNAME || '',
    password: process.env.ODOO_PASSWORD || '',
  },
};
