'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const cfg = require('./config');

fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
const db = new Database(cfg.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
//  Esquema completo. Idempotente (IF NOT EXISTS) para poder re-ejecutarlo.
// ---------------------------------------------------------------------------
db.exec(`
-- Usuarios y roles ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  username      TEXT UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','proveedor','deposito')),
  supplier_id   INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  last_login_ip TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT,
  reset_token   TEXT,
  reset_expires TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Proveedores (relacionados con res.partner de Odoo) ------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id           INTEGER PRIMARY KEY,
  odoo_id      INTEGER UNIQUE,               -- res.partner id en Odoo
  name         TEXT NOT NULL,
  cuit         TEXT,
  email        TEXT,
  phone        TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Clientes (datos mínimos necesarios para fabricar/entregar) -----------------
CREATE TABLE IF NOT EXISTS clients (
  id           INTEGER PRIMARY KEY,
  odoo_id      INTEGER UNIQUE,
  name         TEXT NOT NULL,
  phone        TEXT,
  address      TEXT,
  city         TEXT,
  province     TEXT,
  zip          TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pedidos (cabecera = orden de venta confirmada de Odoo) --------------------
CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY,
  odoo_id        INTEGER UNIQUE,             -- sale.order id
  order_number   TEXT NOT NULL,             -- ej: S00042
  barcode        TEXT,                       -- Code128 del nro de orden
  client_id      INTEGER REFERENCES clients(id),
  supplier_id    INTEGER REFERENCES suppliers(id),
  salesperson    TEXT,
  store          TEXT,                       -- local
  priority       TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('baja','normal','alta','urgente')),
  sale_total     REAL DEFAULT 0,             -- precio de venta (solo admin)
  -- Confirmación del proveedor
  confirmation   TEXT DEFAULT 'nuevo' CHECK (confirmation IN
                   ('nuevo','recibido','confirmado','aclaracion','no_puedo','rechazado')),
  confirmation_note TEXT,
  confirmed_by   INTEGER REFERENCES users(id),
  confirmed_at   TEXT,
  seen_at        TEXT,
  created_date   TEXT,                       -- fecha de creación en Odoo
  confirmed_date TEXT,                       -- fecha de confirmación de la venta
  real_delivery_date TEXT,
  general_notes  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Líneas de pedido = producto/variante con todo el detalle de fabricación ---
CREATE TABLE IF NOT EXISTS order_lines (
  id            INTEGER PRIMARY KEY,
  odoo_id       INTEGER UNIQUE,              -- sale.order.line id
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_name  TEXT NOT NULL,
  internal_code TEXT,
  barcode       TEXT,                        -- barcode del producto (Odoo o generado)
  model         TEXT,
  measure       TEXT,
  width         TEXT, depth TEXT, height TEXT,
  qty           REAL NOT NULL DEFAULT 1,
  fabric        TEXT, fabric_type TEXT, color TEXT,
  legs          TEXT, legs_type TEXT, legs_color TEXT, legs_height TEXT,
  extras        TEXT,                        -- adicionales (DESTACAR)
  finishes      TEXT,                        -- terminaciones
  piping        TEXT,                        -- vivos
  tufted        TEXT,                        -- capitoneado
  daybed        TEXT,                        -- camastro
  orientation   TEXT,                        -- derecha / izquierda
  board_density TEXT,                        -- densidad de placa
  packages      INTEGER NOT NULL DEFAULT 1,  -- cantidad de bultos
  notes         TEXT,                        -- observaciones particulares (DESTACAR)
  image_url     TEXT,
  -- Estado de fabricación por producto
  state         TEXT NOT NULL DEFAULT 'nuevo',
  progress      INTEGER NOT NULL DEFAULT 0 CHECK (progress IN (0,25,50,75,100)),
  delay_reason  TEXT,
  qty_done      REAL NOT NULL DEFAULT 0,     -- cantidad terminada
  qty_delivered REAL NOT NULL DEFAULT 0,     -- cantidad entregada
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Costos por línea con desglose y flujo de aprobación -----------------------
CREATE TABLE IF NOT EXISTS line_costs (
  id             INTEGER PRIMARY KEY,
  line_id        INTEGER NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  unit_cost      REAL DEFAULT 0,
  qty            REAL DEFAULT 1,
  extras_cost    REAL DEFAULT 0,
  legs_cost      REAL DEFAULT 0,
  fabric_cost    REAL DEFAULT 0,             -- tela especial
  packaging_cost REAL DEFAULT 0,
  shipping_cost  REAL DEFAULT 0,             -- envío / traslado
  other_cost     REAL DEFAULT 0,
  total_cost     REAL DEFAULT 0,             -- calculado
  vat_included   INTEGER NOT NULL DEFAULT 0,
  currency       TEXT DEFAULT 'ARS',
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'pendiente'
                   CHECK (status IN ('pendiente','aprobado','rechazado','revision')),
  approved_by    INTEGER REFERENCES users(id),
  approved_at    TEXT,
  updated_by     INTEGER REFERENCES users(id),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Historial de costos -------------------------------------------------------
CREATE TABLE IF NOT EXISTS cost_history (
  id          INTEGER PRIMARY KEY,
  line_id     INTEGER NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  old_total   REAL,
  new_total   REAL,
  reason      TEXT,
  changed_by  INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Fechas de entrega (por pedido) --------------------------------------------
CREATE TABLE IF NOT EXISTS deliveries (
  id             INTEGER PRIMARY KEY,
  order_id       INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  estimated_date TEXT,                       -- fecha estimada inicial / vigente
  new_estimated  TEXT,                       -- nueva fecha estimada
  time_slot      TEXT,                       -- franja horaria
  finished_date  TEXT,
  dispatch_date  TEXT,
  real_date      TEXT,
  delivery_type  TEXT CHECK (delivery_type IN
                   ('retiro','deposito','directa_cliente','transporte_externo') OR delivery_type IS NULL),
  full_or_partial TEXT DEFAULT 'total' CHECK (full_or_partial IN ('total','parcial')),
  notes          TEXT,
  updated_by     INTEGER REFERENCES users(id),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Entregas parciales --------------------------------------------------------
CREATE TABLE IF NOT EXISTS partial_deliveries (
  id            INTEGER PRIMARY KEY,
  line_id       INTEGER NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  qty_requested REAL, qty_done REAL, qty_delivered REAL, qty_pending REAL,
  pending_eta   TEXT,
  reason        TEXT,
  notes         TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bultos --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bultos (
  id          INTEGER PRIMARY KEY,
  line_id     INTEGER NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  number      INTEGER NOT NULL,              -- bulto N de total
  total       INTEGER NOT NULL,
  barcode     TEXT,
  received    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Registro de impresión de etiquetas ---------------------------------------
CREATE TABLE IF NOT EXISTS labels (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  line_id     INTEGER REFERENCES order_lines(id) ON DELETE CASCADE,
  scope       TEXT,                          -- orden / unidad / bulto
  printed_by  INTEGER REFERENCES users(id),
  printed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Archivos adjuntos ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS attachments (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  line_id     INTEGER REFERENCES order_lines(id) ON DELETE SET NULL,
  kind        TEXT,                          -- factura/remito/foto/etc.
  filename    TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mimetype    TEXT,
  size        INTEGER,
  odoo_synced INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Comentarios (chat por pedido, no se borran) -------------------------------
CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id),
  body        TEXT NOT NULL,
  internal    INTEGER NOT NULL DEFAULT 0,    -- mensaje interno (no visible al proveedor)
  is_deleted  INTEGER NOT NULL DEFAULT 0,    -- soft delete (se conserva)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Notificaciones ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT,                          -- destinatario por rol (opcional)
  order_id    INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  is_read     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Recepciones en depósito ---------------------------------------------------
CREATE TABLE IF NOT EXISTS receptions (
  id           INTEGER PRIMARY KEY,
  order_id     INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  line_id      INTEGER REFERENCES order_lines(id) ON DELETE CASCADE,
  result       TEXT NOT NULL,                -- recibido/parcial/danado/etc.
  qty_received REAL DEFAULT 0,
  qty_pending  REAL DEFAULT 0,
  notes        TEXT,
  received_by  INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Incidencias / reclamos ----------------------------------------------------
CREATE TABLE IF NOT EXISTS incidents (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  line_id     INTEGER REFERENCES order_lines(id) ON DELETE SET NULL,
  type        TEXT,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'abierta',
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Historial de cambios / auditoría ------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  entity      TEXT NOT NULL,                 -- tabla afectada
  entity_id   INTEGER,
  order_id    INTEGER,
  field       TEXT,
  old_value   TEXT,
  new_value   TEXT,
  action      TEXT,                          -- create/update/delete/login...
  ip          TEXT,
  device      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Registros de sincronización con Odoo --------------------------------------
CREATE TABLE IF NOT EXISTS sync_logs (
  id          INTEGER PRIMARY KEY,
  direction   TEXT NOT NULL,                 -- pull / push
  entity      TEXT,
  ref_id      INTEGER,
  status      TEXT NOT NULL,                 -- ok / error
  message     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_supplier ON orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_lines_order ON order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_costs_line ON line_costs(line_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_audit_order ON audit_log(order_id);
`);

module.exports = db;
