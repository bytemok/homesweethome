// ============================================================================
//  Vistas de administración
// ============================================================================

// Mini gráfico de barras horizontales (sin librerías) ------------------------
function barChart(items, valueKey, labelKey, fmt = (v) => v) {
  if (!items.length) return '<p class="muted">Sin datos.</p>';
  const max = Math.max(...items.map((i) => Math.abs(i[valueKey])), 1);
  return `<div style="display:flex;flex-direction:column;gap:6px">${items.map((i) => {
    const v = i[valueKey]; const w = Math.max(2, (Math.abs(v) / max) * 100);
    const color = v < 0 ? 'var(--danger)' : 'var(--brand-2)';
    return `<div style="display:grid;grid-template-columns:150px 1fr 90px;gap:8px;align-items:center;font-size:13px">
      <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i[labelKey])}</span>
      <span style="background:#eee;border-radius:6px;height:16px"><span style="display:block;height:16px;width:${w}%;background:${color};border-radius:6px"></span></span>
      <span class="right">${fmt(v)}</span></div>`;
  }).join('')}</div>`;
}

async function viewAdminDashboard() {
  setTitle('Panel administrativo');
  const d = await API.get('/dashboard/admin');
  const t = d.totals;
  const stat = (num, lbl, alert) => `<div class="card ${alert ? 'alert' : ''}" style="cursor:default"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`;
  C().innerHTML = `<div class="section-title"><h1>📊 Panel administrativo</h1></div>
    <div class="cards">
      ${stat(money(t.committed), 'Comprometido con proveedores')}
      ${stat(money(t.total_net), 'Rentabilidad total', t.total_net < 0)}
      ${stat(t.avg_margin + '%', 'Margen promedio', t.avg_margin < t.min_margin_pct)}
      ${stat(t.pending_costs, 'Costos pendientes', t.pending_costs > 0)}
      ${stat(t.orders_with_loss, 'Pedidos con pérdida', t.orders_with_loss > 0)}
      ${stat(t.products_pending, 'Productos pendientes')}
      ${stat(t.products_done, 'Productos terminados')}
      ${stat(t.products_delayed, 'Productos demorados', t.products_delayed > 0)}
      ${stat(t.orders_no_cost, 'Pedidos sin costo', t.orders_no_cost > 0)}
      ${stat(t.orders_no_date, 'Pedidos sin fecha', t.orders_no_date > 0)}
    </div>
    <div class="grid2" style="margin-top:18px">
      <div class="panel"><h2>Rentabilidad por proveedor</h2>${barChart(d.by_supplier, 'net', 'name', (v) => money(v))}</div>
      <div class="panel"><h2>Rentabilidad por vendedor</h2>${barChart(d.by_salesperson, 'net', 'name', (v) => money(v))}</div>
    </div>
    <div class="panel"><h2>Productos por modelo</h2>${barChart(d.by_model, 'qty', 'name')}</div>`;
}

async function viewPendingCosts() {
  setTitle('Costos pendientes');
  const rows = await API.get('/costs/pending');
  C().innerHTML = `<div class="section-title"><h1>💲 Costos pendientes de aprobación</h1></div>
    <div class="panel"><div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Producto</th><th>Proveedor</th><th>Costo</th><th>Actualizado</th><th></th></tr></thead>
    <tbody>${rows.length ? rows.map((r) => `<tr>
      <td class="clickable" onclick="location.hash='#/orders/${r.order_id}'"><b>${esc(r.order_number)}</b></td>
      <td>${esc(r.product_name)}</td><td>${esc(r.supplier_name || '—')}</td>
      <td>${money(r.total_cost, r.currency)}</td><td>${fdatetime(r.updated_at)}</td>
      <td class="btnrow">
        <button class="btn small ok" onclick="quickDecision(${r.cost_id},'aprobado')">Aprobar</button>
        <button class="btn small danger" onclick="quickDecision(${r.cost_id},'rechazado')">Rechazar</button></td></tr>`).join('')
      : '<tr><td colspan="6" class="muted">No hay costos pendientes.</td></tr>'}</tbody></table></div></div>`;
}
async function quickDecision(costId, decision) {
  if (!(await confirmAction(`¿Marcar el costo como "${decision}"?`))) return;
  try { await API.post(`/costs/${costId}/decision`, { decision }); toast('Costo ' + decision, 'ok'); viewPendingCosts(); }
  catch (e) { toast(e.message, 'err'); }
}

async function viewUsers() {
  setTitle('Usuarios');
  const [users, suppliers] = await Promise.all([API.get('/admin/users'), API.get('/admin/suppliers')]);
  window._suppliers = suppliers;
  C().innerHTML = `<div class="section-title"><h1>👥 Usuarios y permisos</h1>
    <button class="btn small" onclick="showUserForm()">+ Nuevo usuario</button></div>
    <div class="panel"><div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Email/Usuario</th><th>Rol</th><th>Proveedor</th><th>Último acceso</th><th>Estado</th><th></th></tr></thead>
    <tbody>${users.map((u) => `<tr>
      <td>${esc(u.name)}</td><td>${esc(u.email)}${u.username ? ' / ' + esc(u.username) : ''}</td>
      <td>${esc(roleLabel(u.role))}</td><td>${esc(u.supplier_name || '—')}</td>
      <td class="muted">${fdatetime(u.last_login_at)}${u.last_login_ip ? '<br><small>' + esc(u.last_login_ip) + '</small>' : ''}</td>
      <td>${u.is_active ? '<span class="badge b-green">Activo</span>' : '<span class="badge b-red">Bloqueado</span>'}</td>
      <td class="btnrow"><button class="btn small ghost" onclick="toggleUser(${u.id}, ${u.is_active ? 0 : 1})">${u.is_active ? 'Bloquear' : 'Activar'}</button></td></tr>`).join('')}</tbody></table></div></div>
    <div class="panel"><h2>Proveedores</h2>
      <div class="btnrow" style="margin-bottom:10px"><input id="supName" placeholder="Nombre del proveedor" style="flex:1"><input id="supOdoo" placeholder="Odoo ID" style="max-width:120px"><button class="btn small" onclick="addSupplier()">+ Agregar</button></div>
      <div class="table-wrap"><table><tbody>${suppliers.map((s) => `<tr><td>${esc(s.name)}</td><td class="muted">Odoo #${s.odoo_id || '—'}</td><td>${esc(s.email || '')}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function showUserForm() {
  const sups = window._suppliers || [];
  const back = document.createElement('div'); back.className = 'modal-back';
  back.innerHTML = `<div class="modal"><h2>Nuevo usuario</h2>
    <div class="field"><label class="lab">Nombre</label><input id="u_name"></div>
    <div class="grid2">
      <div><label class="lab">Email</label><input id="u_email"></div>
      <div><label class="lab">Usuario (opcional)</label><input id="u_username"></div>
    </div>
    <div class="grid2">
      <div><label class="lab">Contraseña</label><input id="u_pass" type="text"></div>
      <div><label class="lab">Rol</label><select id="u_role" onchange="document.getElementById('u_supbox').style.display=this.value==='proveedor'?'block':'none'">
        <option value="admin">Administrador</option><option value="proveedor">Proveedor</option><option value="deposito">Depósito</option></select></div>
    </div>
    <div class="field" id="u_supbox" style="display:none"><label class="lab">Proveedor vinculado</label>
      <select id="u_sup">${sups.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
    <div class="btnrow" style="justify-content:flex-end"><button class="btn ghost" onclick="this.closest('.modal-back').remove()">Cancelar</button>
      <button class="btn" onclick="submitUser()">Crear</button></div></div>`;
  document.body.appendChild(back);
}
async function submitUser() {
  const g = (id) => document.getElementById(id).value.trim();
  const role = g('u_role');
  const body = { name: g('u_name'), email: g('u_email'), username: g('u_username'), password: g('u_pass'), role };
  if (role === 'proveedor') body.supplier_id = +document.getElementById('u_sup').value;
  try { await API.post('/admin/users', body); document.querySelector('.modal-back').remove(); toast('Usuario creado', 'ok'); viewUsers(); }
  catch (e) { toast(e.message, 'err'); }
}
async function toggleUser(id, active) {
  try { await API.post(`/admin/users/${id}/block`, { active: !!active }); toast('Usuario actualizado', 'ok'); viewUsers(); }
  catch (e) { toast(e.message, 'err'); }
}
async function addSupplier() {
  const name = document.getElementById('supName').value.trim(); if (!name) return;
  await API.post('/admin/suppliers', { name, odoo_id: +document.getElementById('supOdoo').value || null });
  toast('Proveedor agregado', 'ok'); viewUsers();
}

async function viewAudit() {
  setTitle('Auditoría');
  const rows = await API.get('/admin/audit?limit=300');
  C().innerHTML = `<div class="section-title"><h1>🕓 Historial de auditoría</h1></div>
    <div class="panel"><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Entidad</th><th>Acción</th><th>Campo</th><th>Anterior</th><th>Nuevo</th><th>IP</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${fdatetime(r.created_at)}</td><td>${esc(r.user_name || '—')}</td><td>${esc(r.entity)}${r.order_id ? ` <a href="#/orders/${r.order_id}">#${r.order_id}</a>` : ''}</td>
      <td>${esc(r.action || '')}</td><td>${esc(r.field || '')}</td><td class="muted">${esc(r.old_value || '')}</td><td>${esc(r.new_value || '')}</td><td class="muted">${esc(r.ip || '')}</td></tr>`).join('')}</tbody></table></div></div>`;
}

async function viewSync() {
  setTitle('Sincronización Odoo');
  const [status, logs] = await Promise.all([API.get('/sync/status'), API.get('/admin/sync-logs')]);
  C().innerHTML = `<div class="section-title"><h1>🔄 Integración con Odoo 19</h1>
    <button class="btn small" id="pullBtn">Importar pedidos desde Odoo</button></div>
    <div class="panel">
      <div class="specs">
        <div class="spec"><b>Estado Odoo</b>${status.odoo_enabled ? '<span class="badge b-green">Conectado</span>' : '<span class="badge b-amber">Modo mock (deshabilitado)</span>'}</div>
        <div class="spec"><b>URL</b>${esc(status.odoo_url || '—')}</div>
        <div class="spec"><b>Errores</b>${status.error_count}</div>
        <div class="spec"><b>Última sync</b>${status.last_sync ? fdatetime(status.last_sync.created_at) : '—'}</div>
      </div>
      ${!status.odoo_enabled ? '<div class="alertbox warn">Odoo está en modo mock. Configurá ODOO_ENABLED=true y las credenciales en el archivo .env para sincronizar con tu instancia real. Los cambios (costos, estados, fechas) se registran igual y se enviarán al reconectar.</div>' : ''}
    </div>
    <div class="panel"><h2>Registro de sincronización</h2><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Dirección</th><th>Entidad</th><th>Ref</th><th>Estado</th><th>Mensaje</th></tr></thead>
    <tbody>${logs.length ? logs.map((l) => `<tr><td>${fdatetime(l.created_at)}</td><td>${esc(l.direction)}</td><td>${esc(l.entity || '')}</td><td>${l.ref_id || '—'}</td>
      <td>${l.status === 'ok' ? '<span class="badge b-green">ok</span>' : '<span class="badge b-red">error</span>'}</td><td class="muted">${esc(l.message || '')}</td></tr>`).join('') : '<tr><td colspan="6" class="muted">Sin registros.</td></tr>'}</tbody></table></div></div>`;
  document.getElementById('pullBtn').onclick = async () => {
    try { const r = await API.post('/sync/pull'); toast(`Importados: ${r.imported} (modo ${r.mode})`, 'ok'); viewSync(); }
    catch (e) { toast(e.message, 'err'); }
  };
}

async function viewRanking() {
  setTitle('Ranking de proveedores');
  const rows = await API.get('/dashboard/suppliers-ranking');
  C().innerHTML = `<div class="section-title"><h1>🏆 Ranking de proveedores</h1></div>
    <div class="panel"><div class="table-wrap"><table><thead><tr><th>Proveedor</th><th>Pedidos</th><th>Productos</th><th>A tiempo</th><th>Demoradas</th><th>Demorados</th><th>Reclamos</th><th>Costo prom.</th><th>Cumplimiento</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td><b>${esc(r.supplier)}</b></td><td>${r.orders}</td><td>${r.products}</td><td>${r.on_time}</td><td>${r.late}</td>
      <td>${r.delayed}</td><td>${r.incidents}</td><td>${money(r.avg_cost)}</td>
      <td><div style="display:flex;align-items:center;gap:6px"><progress value="${r.completion_pct}" max="100"></progress> ${r.completion_pct}%</div></td></tr>`).join('')}</tbody></table></div></div>`;
}
