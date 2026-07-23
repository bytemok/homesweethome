// ============================================================================
//  Portal de Proveedores – Todo en Muebles  ·  SPA (router + vistas)
// ============================================================================
const app = () => document.getElementById('app');

// ---- Navegación por rol ----------------------------------------------------
const NAV = {
  admin: [
    ['#/', '🏠', 'Inicio'], ['#/orders', '📋', 'Pedidos'], ['#/orders?tab=entregados', '✅', 'Entregados'],
    ['#/admin/costs', '💲', 'Costos'], ['#/admin', '📊', 'Panel'], ['#/ranking', '🏆', 'Ranking'],
    ['#/reception', '📦', 'Recepción'], ['#/calendar', '📅', 'Calendario'], ['#/admin/users', '👥', 'Usuarios'],
    ['#/admin/audit', '🕓', 'Auditoría'], ['#/admin/sync', '🔄', 'Odoo'],
  ],
  proveedor: [
    ['#/', '🏠', 'Inicio'], ['#/orders', '📋', 'Pedidos'], ['#/orders?tab=entregados', '✅', 'Entregados'],
    ['#/calendar', '📅', 'Entregas'], ['#/notifications', '🔔', 'Avisos'],
  ],
  deposito: [
    ['#/reception', '📦', 'Recepción'], ['#/orders', '📋', 'Pedidos'], ['#/notifications', '🔔', 'Avisos'],
  ],
};

// ---- Router ---------------------------------------------------------------
const routes = [];
const route = (re, handler) => routes.push({ re, handler });

route(/^#\/login$/, renderLogin);
route(/^#\/$/, () => shell(viewDashboard));
route(/^#\/orders$/, () => shell(viewOrders));
route(/^#\/orders\/(\d+)$/, (m) => shell(() => viewOrderDetail(+m[1])));
route(/^#\/reception$/, () => shell(viewReception));
route(/^#\/calendar$/, () => shell(viewCalendar));
route(/^#\/notifications$/, () => shell(viewNotifications));
route(/^#\/admin$/, () => shell(viewAdminDashboard));
route(/^#\/admin\/costs$/, () => shell(viewPendingCosts));
route(/^#\/admin\/users$/, () => shell(viewUsers));
route(/^#\/admin\/audit$/, () => shell(viewAudit));
route(/^#\/admin\/sync$/, () => shell(viewSync));
route(/^#\/ranking$/, () => shell(viewRanking));

async function render() {
  const hash = location.hash || '#/';
  const path = hash.split('?')[0]; // ignora la query (?a=b) al elegir la ruta
  if (!API.token && path !== '#/login') { location.hash = '#/login'; return; }
  if (API.token && !API.meta) { try { API.meta = await API.get('/meta'); } catch (e) {} }
  const found = routes.find((r) => r.re.test(path));
  if (found) { try { await found.handler(path.match(found.re)); } catch (e) { app().innerHTML = errorBox(e.message); } }
  else app().innerHTML = errorBox('Página no encontrada');
  resetIdle();
}
window.addEventListener('hashchange', render);
window.addEventListener('load', render);

const errorBox = (m) => `<div class="content"><div class="alertbox danger">${esc(m)}</div>
  <a class="btn" href="#/">Volver al inicio</a></div>`;

// ---- Shell (sidebar / topbar / bottomnav) ---------------------------------
let notifCount = 0;
async function shell(view) {
  const role = API.user.role;
  const nav = NAV[role] || [];
  const active = location.hash || '#/';
  const navLinks = nav.map(([h, ic, t]) =>
    `<a href="${h}" class="${h === active ? 'active' : ''}"><span>${ic}</span> ${t}</a>`).join('');
  const bottomLinks = nav.slice(0, 5).map(([h, ic, t]) =>
    `<a href="${h}" class="${h === active ? 'active' : ''}"><span class="ic">${ic}</span>${t}</a>`).join('');

  app().innerHTML = `<div class="layout">
    <aside class="sidebar">
      <div class="logo">
        <span class="logo-top">TODO <em>EN</em></span>
        <span class="logo-bottom">MUEBLES</span>
        <small>Portal de Proveedores</small>
      </div>
      <nav>${navLinks}</nav>
      <div class="spacer"></div>
      <div class="userbox">${esc(API.user.name)}<br>${esc(roleLabel(role))}
        <br><a href="#" id="logout">Cerrar sesión</a></div>
    </aside>
    <div class="main">
      <div class="topbar">
        <h1 id="pageTitle">Portal</h1>
        <a href="#/notifications" title="Notificaciones">🔔<span id="nbadge"></span></a>
      </div>
      <div class="content" id="content"><p class="muted">Cargando…</p></div>
    </div>
    <nav class="bottomnav">${bottomLinks}</nav>
  </div>`;
  document.getElementById('logout').onclick = (e) => { e.preventDefault(); API.clear(); location.hash = '#/login'; render(); };
  refreshNotifBadge();
  await view();
}
const roleLabel = (r) => ({ admin: 'Administrador', proveedor: 'Proveedor', deposito: 'Depósito' }[r] || r);
const setTitle = (t) => { const el = document.getElementById('pageTitle'); if (el) el.textContent = t; };
const C = () => document.getElementById('content');

async function refreshNotifBadge() {
  try {
    const { unread } = await API.get('/social/notifications');
    notifCount = unread;
    const b = document.getElementById('nbadge');
    if (b) b.innerHTML = unread ? ` <span class="notif-badge">${unread}</span>` : '';
  } catch (e) {}
}

// ============================================================================
//  LOGIN
// ============================================================================
function renderLogin() {
  app().innerHTML = `<div class="login-wrap"><div class="login-card">
    <div class="brand-logo"><span class="lt">TODO <em>EN</em></span><span class="lb">MUEBLES</span></div>
    <p class="sub">Portal de Proveedores</p>
    <form id="loginForm">
      <div class="field"><label class="lab">Correo o usuario</label>
        <input id="identifier" autocomplete="username" required></div>
      <div class="field"><label class="lab">Contraseña</label>
        <input id="password" type="password" autocomplete="current-password" required></div>
      <button class="btn" style="width:100%">Ingresar</button>
    </form>
    <p style="margin-top:12px"><a href="#" id="forgot">¿Olvidaste tu contraseña?</a></p>
    <div id="loginMsg" class="muted" style="font-size:13px"></div>
  </div></div>`;

  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const data = await API.post('/auth/login', {
        identifier: document.getElementById('identifier').value.trim(),
        password: document.getElementById('password').value,
      });
      API.setSession(data.user, data.token, data.idleMinutes);
      API.meta = null;
      location.hash = '#/'; render();
    } catch (err) { document.getElementById('loginMsg').innerHTML = `<span style="color:#b00020">${esc(err.message)}</span>`; }
  };
  document.getElementById('forgot').onclick = async (e) => {
    e.preventDefault();
    const email = prompt('Ingresá tu correo para recuperar la contraseña:');
    if (!email) return;
    const r = await API.post('/auth/forgot', { email });
    document.getElementById('loginMsg').textContent = r.dev_token
      ? `Token de recuperación (dev): ${r.dev_token}`
      : 'Si el correo existe, recibirás instrucciones.';
  };
}

// ============================================================================
//  DASHBOARD (tarjetas)
// ============================================================================
const CARD_DEFS = [
  ['a_fabricar', 'Pedidos a fabricar', '#/orders?tab=fabricar'],
  ['en_fabricacion', 'En fabricación', '#/orders?tab=fabricar'],
  ['demorados', 'Demorados', '#/orders?tab=fabricar&delayed=1', true],
  ['terminados', 'Terminados (a entregar)', '#/orders?tab=enviar'],
  ['entregados', 'Entregados', '#/orders?tab=entregados'],
  ['sin_costo', 'Sin costo cargado', '#/orders?tab=all&no_cost=1', true],
  ['sin_fecha', 'Sin fecha estimada', '#/orders?tab=all&no_date=1', true],
  ['productos_pendientes', 'Productos pendientes', '#/orders?tab=all'],
];
async function viewDashboard() {
  setTitle('Inicio');
  const { cards, proximas } = await API.get('/dashboard/cards');
  const cardsHtml = CARD_DEFS.map(([k, lbl, href, alert]) =>
    `<div class="card ${alert && cards[k] ? 'alert' : ''}" onclick="location.hash='${href}'">
      <div class="num">${cards[k] ?? 0}</div><div class="lbl">${lbl}</div></div>`).join('');
  const prox = proximas.length
    ? `<div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Proveedor</th><th>Fecha estimada</th></tr></thead>
       <tbody>${proximas.map((p) => `<tr><td>${esc(p.order_number)}</td><td>${esc(p.supplier_name || '—')}</td><td>${fdate(p.estimated_date)}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">Sin entregas en los próximos 7 días.</p>';
  C().innerHTML = `<div class="section-title"><h1>Hola, ${esc(API.user.name)}</h1></div>
    <div class="cards">${cardsHtml}</div>
    <div class="panel" style="margin-top:20px"><h2>📅 Próximas entregas</h2>${prox}</div>`;
}

// ============================================================================
//  LISTA DE PEDIDOS + filtros
// ============================================================================
function parseQuery(hash) {
  const q = {}; const i = hash.indexOf('?');
  if (i >= 0) new URLSearchParams(hash.slice(i + 1)).forEach((v, k) => (q[k] = v));
  return q;
}
const ORDER_TABS = [
  ['fabricar', 'Pendientes de fabricación'],
  ['enviar', 'Próximos a enviar'],
  ['entregados', 'Entregados'],
];
async function viewOrders() {
  const q = parseQuery(location.hash);
  const tab = q.tab || (q.entregados ? 'entregados' : 'fabricar');
  const heading = (ORDER_TABS.find((t) => t[0] === tab) || [, 'Pedidos'])[1];
  setTitle(heading);
  const isAdmin = API.user.role === 'admin';
  const canSelect = isAdmin || API.user.role === 'proveedor';
  const showCost = API.user.role !== 'proveedor'; // el proveedor no ve montos totales/rentabilidad
  const tabsHtml = ORDER_TABS.map(([v, t]) =>
    `<a href="#/orders?tab=${v}" class="btn small ${tab === v ? '' : 'ghost'}" style="text-decoration:none">${t}</a>`).join(' ');
  C().innerHTML = `
    <div class="section-title"><h1>${heading}</h1></div>
    <div class="btnrow" style="margin-bottom:14px">${tabsHtml}</div>
    <div class="panel">
      <div class="filters">
        <input id="f_q" placeholder="Buscar (orden, cliente, producto)" value="${esc(q.q || '')}">
        <input id="f_client" placeholder="Cliente" value="${esc(q.client || '')}">
        <input id="f_product" placeholder="Producto" value="${esc(q.product || '')}">
        <input id="f_from" type="date" value="${esc(q.from || '')}">
        <input id="f_to" type="date" value="${esc(q.to || '')}">
        <select id="f_state"><option value="">Estado (todos)</option>${(API.meta?.states || []).map((s) => `<option value="${s}" ${q.status === s ? 'selected' : ''}>${esc(API.meta.stateLabels[s])}</option>`).join('')}</select>
        <select id="f_conf"><option value="">Confirmación (todas)</option>${Object.entries(API.meta?.confirmationLabels || {}).map(([k, v]) => `<option value="${k}" ${q.confirmation === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
        <label class="lab" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="f_delayed" style="width:auto" ${q.delayed ? 'checked' : ''}> Demorados</label>
        <label class="lab" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="f_nocost" style="width:auto" ${q.no_cost ? 'checked' : ''}> Sin costo</label>
        <label class="lab" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="f_nodate" style="width:auto" ${q.no_date ? 'checked' : ''}> Sin fecha</label>
        <label class="lab" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="f_urgent" style="width:auto" ${q.urgent ? 'checked' : ''}> Reclamados</label>
      </div>
      <div class="btnrow" style="margin-bottom:8px">
        <button class="btn small" id="applyF">Filtrar</button>
        <button class="btn small ghost" id="clearF">Limpiar</button>
        ${canSelect ? '<button class="btn small secondary" id="printSel">🏷️ Imprimir seleccionados</button>' : ''}
        ${canSelect ? '<button class="btn small ok" id="sendToday">📦 Enviar hoy</button>' : ''}
        ${canSelect ? '<button class="btn small ok" id="bulkDeliver">✅ Marcar entregados</button>' : ''}
        ${canSelect ? '<button class="btn small ghost" id="bulkDate">📅 Fijar fecha</button>' : ''}
      </div>
      <div id="owedBox"></div>
      <div class="table-wrap"><table id="ordersTable"><thead><tr>
        <th>Fecha</th>${canSelect ? '<th></th>' : ''}<th>Orden</th><th>Cliente</th><th>Producto a preparar</th>${isAdmin ? '<th>Proveedor</th>' : ''}
        <th>Reclamo</th><th>Confirmación</th><th>Estados</th><th>Cant.</th>${showCost ? '<th>Costo</th>' : ''}<th>Entrega</th>
      </tr></thead><tbody><tr><td colspan="11" class="muted">Cargando…</td></tr></tbody></table></div>
    </div>`;

  // Total a pagar/cobrar (no se muestra al proveedor: es información de administración)
  if (showCost) {
    API.get('/dashboard/owed').then((o) => {
      document.getElementById('owedBox').innerHTML = `<div class="alertbox warn" style="display:flex;gap:18px;flex-wrap:wrap">
        <span><b>Total a pagar (aprobado):</b> ${money(o.aprobado)}</span>
        <span><b>Pendiente de aprobación:</b> ${money(o.pendiente)}</span>
        <span><b>Total comprometido:</b> ${money(o.total)}</span></div>`;
    }).catch(() => {});
  }

  const buildQ = () => {
    const p = new URLSearchParams();
    const add = (id, key) => { const v = document.getElementById(id).value.trim(); if (v) p.set(key, v); };
    add('f_q', 'q'); add('f_client', 'client'); add('f_product', 'product');
    add('f_from', 'from'); add('f_to', 'to'); add('f_state', 'status'); add('f_conf', 'confirmation');
    ['delayed:f_delayed', 'no_cost:f_nocost', 'no_date:f_nodate', 'urgent:f_urgent'].forEach((pair) => {
      const [key, id] = pair.split(':'); if (document.getElementById(id).checked) p.set(key, '1');
    });
    p.set('tab', tab); // conservar la pestaña activa al filtrar
    return p.toString();
  };
  document.getElementById('applyF').onclick = () => { location.hash = '#/orders?' + buildQ(); loadOrders(buildQ()); };
  document.getElementById('clearF').onclick = () => { location.hash = '#/orders?tab=' + tab; render(); };
  const selectedIds = () => [...document.querySelectorAll('.selorder:checked')].map((c) => c.value);
  if (canSelect) document.getElementById('printSel').onclick = () => {
    const ids = selectedIds();
    if (!ids.length) return toast('Seleccioná al menos un pedido', 'err');
    openLabelWindow('/labels/multi?orders=' + ids.join(','));
  };
  if (canSelect) document.getElementById('sendToday').onclick = async () => {
    const ids = selectedIds();
    if (!ids.length) return toast('Seleccioná los pedidos a enviar', 'err');
    if (!(await confirmAction(`¿Marcar ${ids.length} pedido(s) como ENVIADOS hoy? Se avisa a Todo en Muebles con el resumen y se generan las etiquetas.`))) return;
    try {
      const r = await API.post('/orders/dispatch', { order_ids: ids.map(Number) });
      toast(`Enviados ${r.count} pedido(s). Resumen enviado a Todo en Muebles.`, 'ok');
      openLabelWindow('/labels/multi?orders=' + ids.join(','));
      loadOrders(buildQ());
    } catch (e) { toast(e.message, 'err'); }
  };
  if (canSelect) document.getElementById('bulkDeliver').onclick = async () => {
    const ids = selectedIds();
    if (!ids.length) return toast('Seleccioná al menos un pedido', 'err');
    const date = await askDate(`Marcar ${ids.length} pedido(s) como ENTREGADOS — fecha:`);
    if (!date) return;
    try {
      const r = await API.post('/orders/bulk', { order_ids: ids.map(Number), action: 'deliver', date });
      toast(`${r.count} pedido(s) marcados como entregados`, 'ok');
      loadOrders(buildQ());
    } catch (e) { toast(e.message, 'err'); }
  };
  if (canSelect) document.getElementById('bulkDate').onclick = async () => {
    const ids = selectedIds();
    if (!ids.length) return toast('Seleccioná al menos un pedido', 'err');
    const date = await askDate(`Fijar fecha de entrega estimada para ${ids.length} pedido(s):`);
    if (!date) return;
    try {
      const r = await API.post('/orders/bulk', { order_ids: ids.map(Number), action: 'set_date', date });
      toast(`Fecha fijada en ${r.count} pedido(s)`, 'ok');
      loadOrders(buildQ());
    } catch (e) { toast(e.message, 'err'); }
  };

  async function loadOrders(qs) {
    const rows = await API.get('/orders' + (qs ? '?' + qs : ''));
    const tb = document.querySelector('#ordersTable tbody');
    const cols = (canSelect ? 1 : 0) + 9 + (isAdmin ? 1 : 0) + (showCost ? 1 : 0);
    if (!rows.length) { tb.innerHTML = `<tr><td colspan="${cols || 10}" class="muted">Sin resultados.</td></tr>`; return; }
    tb.innerHTML = rows.map((o) => {
      const states = (o.states || []).map((s) => stateBadge(s)).join(' ');
      return `<tr class="clickable" data-id="${o.id}">
        <td class="muted">${o.sale_date ? fdate(o.sale_date) : '—'}</td>
        ${canSelect ? `<td><input type="checkbox" class="selorder" value="${o.id}" onclick="event.stopPropagation()" style="width:auto"></td>` : ''}
        <td><b>${esc(o.order_number)}</b> ${channelBadge(o.store, o.client_name)}</td>
        <td>${esc(o.client_name || '—')}</td>
        <td>${esc(o.first_product || '—')}${o.line_count > 1 ? ` <span class="muted">(+${o.line_count - 1})</span>` : ''}</td>
        ${isAdmin ? `<td>${esc(o.supplier_name || '<span style="color:#b00">Sin asignar</span>')}</td>` : ''}
        <td>${prioBadge(o.priority)}</td>
        <td>${confBadge(o.confirmation)}</td>
        <td><div class="pill-row">${states || '—'}</div></td>
        <td>${o.total_qty}</td>
        ${showCost ? `<td>${o.cost_total > 0 ? money(o.cost_total) : '<span class="badge b-amber">Sin costo</span>'}</td>` : ''}
        <td>${o.eta ? fdate(o.eta) : '<span class="badge b-amber">Sin fecha</span>'}</td></tr>`;
    }).join('');
    tb.querySelectorAll('tr[data-id]').forEach((tr) =>
      (tr.onclick = () => (location.hash = '#/orders/' + tr.dataset.id)));
  }
  loadOrders(buildQ());
}

// Abre etiquetas en pestaña nueva usando fetch (para pasar el token) ---------
async function openLabelWindow(path) {
  try {
    const res = await API.req('GET', path);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { toast(e.message, 'err'); }
}
