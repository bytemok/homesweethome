'use strict';
// Datos de prueba. Ejecutar: npm run seed
const db = require('./db');
const { hash } = require('./auth');

const reset = () => {
  const tables = ['audit_log', 'sync_logs', 'notifications', 'comments', 'attachments',
    'receptions', 'incidents', 'partial_deliveries', 'bultos', 'labels', 'cost_history',
    'line_costs', 'deliveries', 'order_lines', 'orders', 'clients', 'users', 'suppliers'];
  db.pragma('foreign_keys = OFF');
  for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
  db.pragma('foreign_keys = ON');
};

const run = db.transaction(() => {
  reset();

  // Proveedores
  const sup1 = db.prepare('INSERT INTO suppliers (odoo_id,name,cuit,email,phone) VALUES (?,?,?,?,?)')
    .run(101, 'Tapicería del Sur', '30-11111111-2', 'contacto@tapiceriadelsur.com', '+54 11 4000-0001').lastInsertRowid;
  const sup2 = db.prepare('INSERT INTO suppliers (odoo_id,name,cuit,email,phone) VALUES (?,?,?,?,?)')
    .run(102, 'Muebles Norte', '30-22222222-3', 'ventas@mueblesnorte.com', '+54 11 4000-0002').lastInsertRowid;

  // Usuarios
  db.prepare('INSERT INTO users (email,username,name,password_hash,role) VALUES (?,?,?,?,?)')
    .run('admin@todoenmuebles.com', 'admin', 'Administrador TEM', hash('admin123'), 'admin');
  db.prepare('INSERT INTO users (email,username,name,password_hash,role,supplier_id) VALUES (?,?,?,?,?,?)')
    .run('proveedor1@tapiceriadelsur.com', 'sur', 'Tapicería del Sur', hash('proveedor123'), 'proveedor', sup1);
  db.prepare('INSERT INTO users (email,username,name,password_hash,role,supplier_id) VALUES (?,?,?,?,?,?)')
    .run('proveedor2@mueblesnorte.com', 'norte', 'Muebles Norte', hash('proveedor123'), 'proveedor', sup2);
  db.prepare('INSERT INTO users (email,username,name,password_hash,role) VALUES (?,?,?,?,?)')
    .run('deposito@todoenmuebles.com', 'deposito', 'Depósito Central', hash('deposito123'), 'deposito');

  // Clientes
  const cli1 = db.prepare('INSERT INTO clients (odoo_id,name,phone,address,city,province,zip) VALUES (?,?,?,?,?,?,?)')
    .run(201, 'Juan Pérez', '+54 9 11 5555-1234', 'Av. Rivadavia 4500', 'CABA', 'Buenos Aires', 'C1424').lastInsertRowid;
  const cli2 = db.prepare('INSERT INTO clients (odoo_id,name,phone,address,city,province,zip) VALUES (?,?,?,?,?,?,?)')
    .run(202, 'María Gómez', '+54 9 11 5555-9876', 'Calle Falsa 123', 'La Plata', 'Buenos Aires', 'B1900').lastInsertRowid;

  // --- Pedido 1: ejemplo del enunciado (Sillón Italiano) -------------------
  const o1 = db.prepare(`INSERT INTO orders
    (odoo_id,order_number,barcode,client_id,supplier_id,salesperson,store,priority,sale_total,
     confirmation,created_date,confirmed_date,general_notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    5001, 'S00042', 'S00042', cli1, sup1, 'Lucía Fernández', 'Sucursal Centro', 'alta', 850000,
    'nuevo', '2026-07-10', '2026-07-11', 'Cliente frecuente. Coordinar entrega por la tarde.').lastInsertRowid;

  const l1 = db.prepare(`INSERT INTO order_lines
    (odoo_id,order_id,product_name,internal_code,barcode,model,measure,width,depth,height,qty,
     fabric,fabric_type,color,legs,legs_type,legs_color,legs_height,extras,finishes,piping,tufted,
     daybed,orientation,board_density,packages,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    9001, o1, 'Sillón Italiano 210 x 90', 'SILL-ITAL-210', '7790000000011', 'Italiano', '210 x 90',
    '210 cm', '90 cm', '85 cm', 1, 'Pana Cross', 'Chenille', 'Beige',
    'Bajas de madera color roble', 'Madera', 'Roble', '12 cm',
    'Con vivos y camastro móvil', 'Costura reforzada', 'Sí', 'No', 'Móvil',
    'Derecha', 'Alta densidad 30', 3, 'Respetar medidas especiales indicadas por el cliente').lastInsertRowid;

  db.prepare(`INSERT INTO order_lines
    (odoo_id,order_id,product_name,internal_code,barcode,model,measure,qty,fabric,color,legs,extras,packages,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    9002, o1, 'Puff Cubo 50 x 50', 'PUFF-CUBO-50', '7790000000028', 'Cubo', '50 x 50', 2,
    'Pana Cross', 'Beige', 'Sin patas', 'Juego con sillón', 1, 'Mismo tono que el sillón');

  // 3 bultos del sillón
  for (let n = 1; n <= 3; n++) {
    db.prepare('INSERT INTO bultos (line_id,number,total,barcode) VALUES (?,?,?,?)')
      .run(l1, n, 3, `S00042-9001-B${n}`);
  }
  db.prepare('INSERT INTO deliveries (order_id,estimated_date,delivery_type,full_or_partial) VALUES (?,?,?,?)')
    .run(o1, '2026-07-28', 'directa_cliente', 'total');

  // --- Pedido 2: con costo cargado pendiente + demora ---------------------
  const o2 = db.prepare(`INSERT INTO orders
    (odoo_id,order_number,barcode,client_id,supplier_id,salesperson,store,priority,sale_total,
     confirmation,created_date,confirmed_date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    5002, 'S00043', 'S00043', cli2, sup1, 'Pedro Ruiz', 'Sucursal Norte', 'urgente', 420000,
    'confirmado', '2026-07-05', '2026-07-06').lastInsertRowid;

  const l3 = db.prepare(`INSERT INTO order_lines
    (odoo_id,order_id,product_name,internal_code,barcode,model,measure,qty,fabric,color,legs,legs_type,
     legs_color,extras,packages,notes,state,progress)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    9003, o2, 'Sofá Escandinavo 3 cuerpos', 'SOFA-ESC-3C', '7790000000035', 'Escandinavo', '220 x 95', 1,
    'Lino', 'Gris', 'Cónicas de madera', 'Madera', 'Natural', 'Almohadones extra',
    2, 'Entrega antes de fin de mes', 'demorado', 50).lastInsertRowid;
  db.prepare('UPDATE order_lines SET delay_reason=? WHERE id=?')
    .run('Demora en la llegada de la tela', l3);

  db.prepare(`INSERT INTO line_costs
    (line_id,unit_cost,qty,extras_cost,legs_cost,packaging_cost,shipping_cost,total_cost,currency,status,updated_by,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    l3, 180000, 1, 15000, 12000, 5000, 8000, 220000, 'ARS', 'pendiente', 2, 'Incluye tela premium');
  db.prepare('INSERT INTO cost_history (line_id,old_total,new_total,changed_by) VALUES (?,?,?,?)')
    .run(l3, null, 220000, 2);
  db.prepare('INSERT INTO deliveries (order_id,estimated_date,new_estimated,delivery_type) VALUES (?,?,?,?)')
    .run(o2, '2026-07-22', '2026-07-30', 'deposito');

  // --- Pedido 3: sin asignar (para que el admin asigne) -------------------
  const o3 = db.prepare(`INSERT INTO orders
    (odoo_id,order_number,barcode,client_id,salesperson,priority,sale_total,confirmation,created_date)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    5003, 'S00044', 'S00044', cli1, 'Lucía Fernández', 'normal', 300000, 'nuevo', '2026-07-18').lastInsertRowid;
  db.prepare(`INSERT INTO order_lines (odoo_id,order_id,product_name,internal_code,model,measure,qty,fabric,color,legs,packages)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    9004, o3, 'Banqueta Alta Bar', 'BANQ-BAR', 'Bar', '45 x 45 x 75', 4, 'Ecocuero', 'Negro', 'Metálicas', 1);

  // Notificación de bienvenida para el admin
  const adminId = db.prepare("SELECT id FROM users WHERE role='admin'").get().id;
  db.prepare('INSERT INTO notifications (user_id,order_id,type,title,body) VALUES (?,?,?,?,?)')
    .run(adminId, o3, 'asignado', 'Pedido S00044 sin proveedor asignado', 'Asignar un proveedor para continuar');

  // Comentario de ejemplo
  db.prepare('INSERT INTO comments (order_id,user_id,body,internal) VALUES (?,?,?,?)')
    .run(o2, 2, '¿La tela gris es la referencia clara o la oscura?', 0);
});

run();
console.log('\n✔ Datos de prueba cargados.\n');
console.log('  Usuarios de prueba:');
console.log('  ┌─────────────┬──────────────────────────────────┬──────────────┐');
console.log('  │ Rol         │ Email / usuario                  │ Contraseña   │');
console.log('  ├─────────────┼──────────────────────────────────┼──────────────┤');
console.log('  │ Admin       │ admin@todoenmuebles.com / admin  │ admin123     │');
console.log('  │ Proveedor 1 │ proveedor1@tapiceriadelsur.com   │ proveedor123 │');
console.log('  │ Proveedor 2 │ proveedor2@mueblesnorte.com      │ proveedor123 │');
console.log('  │ Depósito    │ deposito@todoenmuebles.com       │ deposito123  │');
console.log('  └─────────────┴──────────────────────────────────┴──────────────┘\n');
