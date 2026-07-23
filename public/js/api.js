// Capa de acceso a la API + utilidades de UI.
const API = {
  token: localStorage.getItem('token') || null,
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  meta: null,
  idleMinutes: 30,

  setSession(user, token, idleMinutes) {
    this.token = token; this.user = user;
    if (idleMinutes) this.idleMinutes = idleMinutes;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  },
  clear() {
    this.token = null; this.user = null;
    localStorage.removeItem('token'); localStorage.removeItem('user');
  },

  async req(method, path, body, isForm) {
    const headers = {};
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    let payload;
    if (isForm) { payload = body; }
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch('/api' + path, { method, headers, body: payload });
    if (res.status === 401 && this.token) { this.clear(); location.hash = '#/login'; render(); throw new Error('Sesión expirada'); }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      return data;
    }
    if (!res.ok) throw new Error('Error ' + res.status);
    return res;
  },
  get(p) { return this.req('GET', p); },
  post(p, b) { return this.req('POST', p, b); },
  patch(p, b) { return this.req('PATCH', p, b); },
  del(p) { return this.req('DELETE', p); },
  postForm(p, form) { return this.req('POST', p, form, true); },
};

// ---------- Toasts ----------
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ---------- Helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, cur = 'ARS') => (n == null ? '—' : new Intl.NumberFormat('es-AR',
  { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n));
const fdate = (s) => (s ? String(s).slice(0, 10) : '—');
const fdatetime = (s) => (s ? String(s).replace('T', ' ').slice(0, 16) : '—');

function stateBadge(state) {
  const map = {
    nuevo: 'b-gray', visto: 'b-gray', confirmado: 'b-blue', en_produccion: 'b-blue',
    pendiente_materiales: 'b-amber', en_tapiceria: 'b-blue', en_terminacion: 'b-blue',
    terminado: 'b-green', embalado: 'b-green', listo_retiro: 'b-green', despachado: 'b-purple',
    recibido_parcial: 'b-amber', recibido_completo: 'b-green', demorado: 'b-red',
    con_problema: 'b-red', cancelado: 'b-gray',
  };
  const lbl = (API.meta?.stateLabels || {})[state] || state;
  return `<span class="badge ${map[state] || 'b-gray'}">${esc(lbl)}</span>`;
}
function confBadge(c) {
  const map = { nuevo: 'b-gray', recibido: 'b-blue', confirmado: 'b-green', aclaracion: 'b-amber', no_puedo: 'b-red', rechazado: 'b-red' };
  const lbl = (API.meta?.confirmationLabels || {})[c] || c;
  return `<span class="badge ${map[c] || 'b-gray'}">${esc(lbl)}</span>`;
}
// Marca de canal: Mercado Libre (rojo/urgente) o Tienda Nube ----------------
function channelBadge(store, clientName) {
  const t = ((store || '') + ' ' + (clientName || '')).toLowerCase();
  if (/mercado ?libre|meli|(^|[^a-z])ml([^a-z]|$)/.test(t))
    return '<span class="badge" style="background:#e11900;color:#fff">ML</span>';
  if (/tienda ?nube|tiendanube/.test(t))
    return '<span class="badge" style="background:#6236ff;color:#fff">TN</span>';
  return '';
}
function isUrgentChannel(store, clientName) {
  const t = ((store || '') + ' ' + (clientName || '')).toLowerCase();
  return /mercado ?libre|meli|(^|[^a-z])ml([^a-z]|$)/.test(t);
}
function prioBadge(p) {
  // Solo se marca lo RECLAMADO (prioridad urgente). El resto no muestra nada.
  if (p === 'urgente') return '<span class="badge" style="background:#e11900;color:#fff;font-weight:700">RECLAMADO</span>';
  return '';
}

// ---------- Idle logout ----------
let idleTimer;
function resetIdle() {
  clearTimeout(idleTimer);
  if (!API.token) return;
  idleTimer = setTimeout(() => {
    API.clear(); toast('Sesión cerrada por inactividad', 'err');
    location.hash = '#/login'; render();
  }, API.idleMinutes * 60000);
}
['click', 'keydown', 'mousemove', 'touchstart'].forEach((e) =>
  document.addEventListener(e, resetIdle, { passive: true }));

// ---------- Date prompt modal ----------
function askDate(title, initial) {
  return new Promise((resolve) => {
    const today = initial || new Date().toISOString().slice(0, 10);
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal"><h2>${esc(title)}</h2>
      <div class="field"><input type="date" id="__askdate" value="${today}" style="font-size:18px"></div>
      <div class="btnrow" style="justify-content:flex-end">
      <button class="btn ghost" id="__dno">Cancelar</button>
      <button class="btn" id="__dyes">Aceptar</button></div></div>`;
    document.body.appendChild(back);
    back.querySelector('#__dno').onclick = () => { back.remove(); resolve(null); };
    back.querySelector('#__dyes').onclick = () => { const v = back.querySelector('#__askdate').value; back.remove(); resolve(v || null); };
  });
}

// ---------- Confirm modal ----------
function confirmAction(message) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal"><h2>Confirmar</h2><p>${esc(message)}</p>
      <div class="btnrow" style="justify-content:flex-end;margin-top:16px">
      <button class="btn ghost" id="cno">Cancelar</button>
      <button class="btn" id="cyes">Confirmar</button></div></div>`;
    document.body.appendChild(back);
    back.querySelector('#cno').onclick = () => { back.remove(); resolve(false); };
    back.querySelector('#cyes').onclick = () => { back.remove(); resolve(true); };
  });
}
