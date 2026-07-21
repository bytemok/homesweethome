// ============================================================================
//  Portal de Proveedores – Todo en Muebles  ·  SPA (router + vistas)
// ============================================================================
const app = () => document.getElementById('app');

// ---- Navegación por rol ----------------------------------------------------
const NAV = {
  admin: [
    ['#/', '🏠', 'Inicio'], ['#/orders', '📋', 'Pedidos'], ['#/admin/costs', '💲', 'Costos'],
    ['#/admin', '📊', 'Panel'], ['#/ranking', '🏆', 'Ranking'], ['#/reception', '📦', 'Recepción'],
    ['#/calendar', '📅', 'Calendario'], ['#/admin/users', '👥', 'Usuarios'],
    ['#/admin/audit', '🕓', 'Auditoría'], ['#/admin/sync', '🔄', 'Odoo'],
  ],
  proveedor: [
    ['#/', '🏠', 'Inicio'], ['#/orders', '📋', 'Pedidos'], ['#/calendar', '📅', 'Entregas'],
    ['#/notifications', '🔔', 'Avisos'],
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
      <div class="logo">🛋️ Todo en Muebles<small>Portal de Proveedores</small></div>
      <nav>${navLinks}</nav>
      <div class="spacer"></div>
      <div class="userbox">${esc(API.user.name)}<br>${esc(roleLabel(role))}
        <br><a href="#" id="logout" style="color:#ffd">Cerrar sesión</a></div>
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
    <h1>🛋️ Todo en Muebles</h1>
    <p class="sub">Portal de Proveedores — ingresá con tu usuario</p>
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
  ['nuevos', 'Pedidos nuevos', '#/orders?confirmation=nuevo'],
  ['sin_confirmar', 'Sin confirmar', '#/orders'],
  ['confirmados', 'Confirmados', '#/orders?confirmation=confirmado'],
  ['en_fabricacion', 'En fabricación', '#/orders'],
  ['demorados', 'Demorados', '#/orders?delayed=1', true],
  ['terminados', 'Terminados', '#/orders'],
  ['listos', 'Listos para entregar', '#/orders'],
  ['entregados', 'Entregados', '#/orders'],
  ['sin_costo', 'Sin costo cargado', '#/orders?no_cost=1', true],
  ['sin_fecha', 'Sin fecha estimada', '#/orders?no_date=1', true],
  ['productos_pendientes', 'Productos pendientes', '#/orders'],
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
async function viewOrders() {
  setTitle('Pedidos');
  const q = parseQuery(location.hash);
  const isAdmin = API.user.role === 'admin';
  C().innerHTML = `
    <div class="section-title"><h1>Pedidos</h1></div>
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
        <label class="lab" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="f_urgent" style="width:auto" ${q.urgent ? 'checked' : ''}> Urgentes</label>
      </div>
      <div class="btnrow" style="margin-bottom:8px">
        <button class="btn small" id="applyF">Filtrar</button>
        <button class="btn small ghost" id="clearF">Limpiar</button>
        ${isAdmin ? '<button class="btn small secondary" id="printSel">🏷️ Imprimir seleccionados</button>' : ''}
      </div>
      <div class="table-wrap"><table id="ordersTable"><thead><tr>
        ${isAdmin ? '<th></th>' : ''}<th>Orden</th><th>Cliente</th>${isAdmin ? '<th>Proveedor</th>' : ''}
        <th>Prioridad</th><th>Confirmación</th><th>Estados</th><th>Prod.</th><th>Entrega</th>
      </tr></thead><tbody><tr><td colspan="9" class="muted">Cargando…</td></tr></tbody></table></div>
    </div>`;

  const buildQ = () => {
    const p = new URLSearchParams();
    const add = (id, key) => { const v = document.getElementById(id).value.trim(); if (v) p.set(key, v); };
    add('f_q', 'q'); add('f_client', 'client'); add('f_product', 'product');
    add('f_from', 'from'); add('f_to', 'to'); add('f_state', 'status'); add('f_conf', 'confirmation');
    ['delayed:f_delayed', 'no_cost:f_nocost', 'no_date:f_nodate', 'urgent:f_urgent'].forEach((pair) => {
      const [key, id] = pair.split(':'); if (document.getElementById(id).checked) p.set(key, '1');
    });
    return p.toString();
  };
  document.getElementById('applyF').onclick = () => { location.hash = '#/orders?' + buildQ(); loadOrders(buildQ()); };
  document.getElementById('clearF').onclick = () => { location.hash = '#/orders'; render(); };
  if (isAdmin) document.getElementById('printSel').onclick = () => {
    const ids = [...document.querySelectorAll('.selorder:checked')].map((c) => c.value);
    if (!ids.length) return toast('Seleccioná al menos un pedido', 'err');
    openLabelWindow('/labels/multi?orders=' + ids.join(','));
  };

  async function loadOrders(qs) {
    const rows = await API.get('/orders' + (qs ? '?' + qs : ''));
    const tb = document.querySelector('#ordersTable tbody');
    if (!rows.length) { tb.innerHTML = '<tr><td colspan="9" class="muted">Sin resultados.</td></tr>'; return; }
    tb.innerHTML = rows.map((o) => {
      const states = (o.states || []).map((s) => stateBadge(s)).join(' ');
      return `<tr class="clickable" data-id="${o.id}">
        ${isAdmin ? `<td><input type="checkbox" class="selorder" value="${o.id}" onclick="event.stopPropagation()" style="width:auto"></td>` : ''}
        <td><b>${esc(o.order_number)}</b></td>
        <td>${esc(o.client_name || '—')}</td>
        ${isAdmin ? `<td>${esc(o.supplier_name || '<span style="color:#b00">Sin asignar</span>')}</td>` : ''}
        <td>${prioBadge(o.priority)}</td>
        <td>${confBadge(o.confirmation)}</td>
        <td><div class="pill-row">${states || '—'}</div></td>
        <td>${o.total_qty}</td>
        <td>${o.eta ? fdate(o.eta) : '<span class="badge b-amber">Sin fecha</span>'}</td></tr>`;
    }).join('');
    tb.querySelectorAll('tr[data-id]').forEach((tr) =>
      (tr.onclick = () => (location.hash = '#/orders/' + tr.dataset.id)));
  }
  loadOrders(new URLSearchParams(q).toString());
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
