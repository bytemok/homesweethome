'use strict';
const path = require('path');
const express = require('express');
const cors = require('cors');
const cfg = require('./config');
require('./db'); // inicializa esquema
const { authRequired } = require('./auth');
const { STATE_LABELS, STATES, CONFIRMATION_LABELS, RECEPTION_RESULTS } = require('./constants');

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// --- API -------------------------------------------------------------------
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/orders', require('./routes/orders.routes'));
app.use('/api/costs', require('./routes/costs.routes'));
app.use('/api/deliveries', require('./routes/deliveries.routes'));
app.use('/api/reception', require('./routes/reception.routes'));
app.use('/api/labels', require('./routes/labels.routes'));
app.use('/api/files', require('./routes/files.routes'));
app.use('/api/social', require('./routes/social.routes'));
app.use('/api/dashboard', require('./routes/dashboard.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/sync', require('./routes/sync.routes'));

// Metadatos (etiquetas de estados, etc.) para el frontend
app.get('/api/meta', authRequired, (req, res) => {
  res.json({ states: STATES, stateLabels: STATE_LABELS, confirmationLabels: CONFIRMATION_LABELS, receptionResults: RECEPTION_RESULTS });
});

app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// --- Frontend estático -----------------------------------------------------
app.use(express.static(path.join(cfg.root, 'public')));
// SPA fallback (rutas del cliente)
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(cfg.root, 'public', 'index.html'));
});

// Manejo de errores (incluye límite de tamaño de archivo de multer)
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `Archivo demasiado grande (máx ${cfg.maxUploadMb} MB)` });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

if (require.main === module) {
  app.listen(cfg.port, () => {
    console.log(`\n  Portal de Proveedores – Todo en Muebles`);
    console.log(`  Servidor: http://localhost:${cfg.port}`);
    console.log(`  Entorno:  ${cfg.env}   Odoo: ${cfg.odoo.enabled ? 'ON' : 'mock'}\n`);
  });
}

module.exports = app;
