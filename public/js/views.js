// ============================================================================
//  Vistas: Detalle de pedido, Recepción, Calendario, Notificaciones
// ============================================================================
const DELIVERY_TYPES = {
  retiro: 'Retiro por Todo en Muebles', deposito: 'Entrega del proveedor en depósito',
  directa_cliente: 'Entrega directa al cliente', transporte_externo: 'Transporte externo',
};

async function viewOrderDetail(id) {
  setTitle('Pedido');
  const o = await API.get('/orders/' + id);
  const isAdmin = API.user.role === 'admin';
  const isProv = API.user.role === 'proveedor';
  C().innerHTML = `<a href="#/orders" class="muted">← Volver a pedidos</a>
    <div class="section-title" style="margin-top:8px">
      <h1>Pedido ${esc(o.order_number)} ${prioBadge(o.priority)}</h1>
      <div class="btnrow">
        <button class="btn small secondary" onclick="openLabelWindow('/labels/order/${o.id}?mode=order')">🏷️ Etiquetas</button>
        ${(isAdmin || API.user.role === 'deposito') ? `<button class="btn small ok" onclick="markDelivered(${o.id})">✅ Marcar entregado</button>` : ''}
        <button class="btn small ghost" onclick="printMenu(${o.id})">⋯</button>
      </div>
    </div>
    <div id="detailBody"></div>`;
  const body = document.getElementById('detailBody');

  // --- Cabecera del pedido ---
  let head = isUrgentChannel(o.store, o.client_name)
    ? '<div class="alertbox danger" style="font-weight:800;font-size:16px">🔴 MERCADO LIBRE — PEDIDO URGENTE</div>' : '';
  head += `<div class="panel"><h2>Datos del pedido ${channelBadge(o.store, o.client_name)}</h2>
    <div class="specs">
      <div class="spec"><b>Orden</b>${esc(o.order_number)}</div>
      <div class="spec"><b>Código</b><span class="mono">${esc(o.barcode || o.order_number)}</span></div>
      <div class="spec"><b>Creación</b>${fdate(o.created_date)}</div>
      <div class="spec"><b>Confirmación venta</b>${fdate(o.confirmed_date)}</div>
      <div class="spec"><b>Cliente</b>${esc(o.client_name || '—')}</div>
      <div class="spec"><b>Teléfono</b>${esc(o.client_phone || '—')}</div>
      <div class="spec"><b>Dirección</b>${esc(o.address || '—')}</div>
      <div class="spec"><b>Localidad</b>${esc(o.city || '—')}</div>
      <div class="spec"><b>Provincia</b>${esc(o.province || '—')}</div>
      <div class="spec"><b>Código postal</b>${esc(o.zip || '—')}</div>
      <div class="spec"><b>Proveedor</b>${esc(o.supplier_name || 'Sin asignar')}</div>
      <div class="spec"><b>Vendedor</b>${esc(o.salesperson || '—')}</div>
    </div>
    ${o.general_notes ? `<div class="highlight hl-notes"><div class="hl-title">Observaciones generales</div><div>${esc(o.general_notes)}</div></div>` : ''}
    <div style="margin-top:8px">Estado de confirmación: ${confBadge(o.confirmation)} ${o.confirmation_note ? `<span class="muted">— ${esc(o.confirmation_note)}</span>` : ''}</div>
  </div>`;

  // --- Panel de confirmación (proveedor) ---
  if (isProv || isAdmin) head += confirmationPanel(o);

  // --- Asignación + rentabilidad (admin) ---
  if (isAdmin) head += adminOrderPanel(o);

  // --- Líneas de producto ---
  const linesHtml = o.lines.map((l) => linePanel(o, l, { isAdmin, isProv })).join('');

  // --- Fechas de entrega ---
  const deliveryHtml = deliveryPanel(o);

  // --- Adjuntos (el proveedor no sube nada acá; se oculta para proveedor) ---
  const filesHtml = isProv ? '' : `<div class="panel"><h2>📎 Documentación y archivos</h2>
    <div class="btnrow" style="margin-bottom:10px">
      <select id="fileKind" style="max-width:180px">
        <option value="factura">Factura</option><option value="remito">Remito</option>
        <option value="presupuesto">Presupuesto</option><option value="foto_terminado">Foto producto terminado</option>
        <option value="foto_embalaje">Foto embalaje</option><option value="foto_falla">Foto de falla</option>
        <option value="comprobante">Comprobante de entrega</option><option value="otro">Otro</option>
      </select>
      <input type="file" id="fileInput" accept=".pdf,.jpg,.jpeg,.png,.webp" style="max-width:230px">
      <button class="btn small" id="uploadBtn">Subir</button>
    </div>
    <div id="fileList">${attachmentList(o.attachments)}</div></div>`;

  // --- Comentarios ---
  const commentsHtml = `<div class="panel"><h2>💬 Comunicación</h2>
    <div class="chatbox" id="chatbox"><p class="muted">Cargando…</p></div>
    <div class="btnrow">
      <input id="commentInput" placeholder="Escribí un mensaje…" style="flex:1">
      ${isAdmin ? '<label class="lab" style="display:flex;gap:4px;align-items:center"><input type="checkbox" id="internalChk" style="width:auto">Interno</label>' : ''}
      <button class="btn small" id="sendComment">Enviar</button>
    </div></div>`;

  // --- Historial ---
  const histHtml = `<div class="panel"><h2>🕓 Historial de cambios</h2>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Campo</th><th>Anterior</th><th>Nuevo</th></tr></thead>
    <tbody>${(o.history || []).map((h) => `<tr><td>${fdatetime(h.created_at)}</td><td>${esc(h.user_name || '—')}</td>
      <td>${esc(h.action || '')}</td><td>${esc(h.field || '')}</td><td class="muted">${esc(h.old_value || '')}</td><td>${esc(h.new_value || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Sin cambios registrados.</td></tr>'}</tbody></table></div></div>`;

  body.innerHTML = head +
    `<h3 style="margin:18px 0 6px">🛠️ Productos a fabricar</h3>` + linesHtml +
    deliveryHtml + filesHtml + commentsHtml + histHtml;

  wireOrderDetail(o, { isAdmin, isProv });
}

// ---- Panel de confirmación -------------------------------------------------
function confirmationPanel(o) {
  if (['confirmado', 'rechazado', 'no_puedo'].includes(o.confirmation)) {
    return `<div class="panel"><h2>Confirmación</h2><p>Respuesta actual: ${confBadge(o.confirmation)} ${o.confirmation_note ? `— ${esc(o.confirmation_note)}` : ''}</p>
      <div class="btnrow"><button class="btn small ghost" onclick="showConfirmForm(${o.id})">Cambiar respuesta</button></div></div>`;
  }
  return `<div class="panel" id="confPanel"><h2>Confirmación del pedido</h2>${confirmFormHtml(o.id)}</div>`;
}
function confirmFormHtml(id) {
  return `<div class="field"><label class="lab">¿Qué querés informar?</label>
    <select id="confResp">
      <option value="recibido">Pedido recibido</option>
      <option value="confirmado">Pedido confirmado</option>
      <option value="aclaracion">Necesito una aclaración</option>
      <option value="no_puedo">No puedo realizarlo</option>
      <option value="rechazado">Pedido rechazado</option>
    </select></div>
    <div class="field"><label class="lab">Comentario / motivo (obligatorio para aclaración o "no puedo")</label>
      <textarea id="confNote"></textarea></div>
    <button class="btn" onclick="submitConfirm(${id})">Guardar respuesta</button>`;
}
function showConfirmForm(id) {
  const p = document.getElementById('confPanel') || document.querySelector('.panel');
  const el = document.createElement('div'); el.className = 'panel'; el.innerHTML = '<h2>Cambiar respuesta</h2>' + confirmFormHtml(id);
  p.parentNode.insertBefore(el, p.nextSibling);
}
async function submitConfirm(id) {
  const response = document.getElementById('confResp').value;
  const note = document.getElementById('confNote').value.trim();
  try { await API.post(`/orders/${id}/confirm`, { response, note }); toast('Confirmación guardada', 'ok'); viewOrderDetail(id); }
  catch (e) { toast(e.message, 'err'); }
}

// ---- Panel admin: asignar + rentabilidad ----------------------------------
function adminOrderPanel(o) {
  const p = o.profit || {};
  const alerts = (p.alerts || []).map((a) => `<div class="alertbox ${a.level === 'danger' ? 'danger' : 'warn'}">${esc(a.msg)}</div>`).join('');
  return `<div class="panel"><h2>Administración</h2>
    <div class="grid2">
      <div><label class="lab">Asignar proveedor</label>
        <div class="btnrow"><select id="assignSel" style="flex:1"></select><button class="btn small" id="assignBtn">Asignar</button></div></div>
      <div><label class="lab">Prioridad</label>
        <div class="btnrow"><select id="prioSel" style="flex:1">
          ${['baja', 'normal', 'alta', 'urgente'].map((x) => `<option ${o.priority === x ? 'selected' : ''}>${x}</option>`).join('')}
        </select><button class="btn small" id="prioBtn">Guardar</button></div></div>
    </div>
    <h3>💰 Rentabilidad (solo administración)</h3>
    <div class="specs">
      <div class="spec"><b>Precio de venta</b>${money(p.sale)}</div>
      <div class="spec"><b>Costo total</b>${money(p.cost)}</div>
      <div class="spec"><b>Ganancia neta</b><span style="color:${p.net < 0 ? 'var(--danger)' : 'var(--ok)'};font-weight:700">${money(p.net)}</span></div>
      <div class="spec"><b>Margen</b><span style="color:${p.margin < (p.min || 20) ? 'var(--warn)' : 'var(--ok)'};font-weight:700">${p.margin ?? 0}%</span></div>
    </div>${alerts}</div>`;
}

// ---- Panel de una línea de producto ---------------------------------------
function linePanel(o, l, { isAdmin, isProv }) {
  const canEdit = isAdmin || isProv;
  const cost = l.cost;
  const highlight = (cls, title, val) => val
    ? `<div class="highlight ${cls}"><div class="hl-title">${title}</div><div class="hl-val">${esc(val)}</div></div>` : '';
  const specRow = (lbl, v) => (v ? `<div class="spec"><b>${lbl}</b>${esc(v)}</div>` : '');

  return `<div class="panel" data-line="${l.id}">
    <div class="section-title"><h2 style="flex:1">${esc(l.product_name)} <span class="muted">×${l.qty}</span></h2>${stateBadge(l.state)}</div>
    <div class="specs">
      ${specRow('Código interno', l.internal_code)}${specRow('Código de barras', l.barcode)}
      ${specRow('Modelo', l.model)}${specRow('Medida', l.measure)}
      ${specRow('Ancho', l.width)}${specRow('Profundidad', l.depth)}${specRow('Alto', l.height)}
      ${specRow('Tela', l.fabric)}${specRow('Tipo de tela', l.fabric_type)}${specRow('Color', l.color)}
      ${specRow('Terminaciones', l.finishes)}${specRow('Vivos', l.piping)}${specRow('Capitoneado', l.tufted)}
      ${specRow('Camastro', l.daybed)}${specRow('Orientación', l.orientation)}${specRow('Densidad placa', l.board_density)}
      ${specRow('Cantidad de bultos', l.packages)}
    </div>
    ${highlight('hl-legs', 'Patas', [l.legs, l.legs_type, l.legs_color, l.legs_height].filter(Boolean).join(' · '))}
    ${highlight('hl-extras', 'Adicionales', l.extras)}
    ${highlight('hl-notes', 'Observaciones del producto', l.notes)}
    ${l.image_url ? `<img src="${esc(l.image_url)}" style="max-width:180px;border-radius:8px;margin-top:8px">` : ''}

    ${canEdit ? statePanel(l) : ''}
    ${canEdit ? costPanel(l, cost, isAdmin) : (cost ? costReadOnly(cost) : '')}

    <div class="btnrow" style="margin-top:10px">
      <button class="btn small secondary" onclick="openLabelWindow('/labels/line/${l.id}')">🏷️ Etiqueta</button>
      <button class="btn small ghost" onclick="openLabelWindow('/labels/order/${o.id}?mode=package')">🏷️ Por bulto</button>
      <button class="btn small ghost" onclick="showPartial(${l.id}, ${l.qty})">Entrega parcial</button>
      <button class="btn small ghost" onclick="showCostHistory(${l.id})">Historial de costo</button>
    </div>
  </div>`;
}

function statePanel(l) {
  // Estados simples para el proveedor. Si el estado actual es otro (ej recibido), se muestra igual.
  const SIMPLE = [['en_produccion', 'En fabricación'], ['terminado', 'Terminado / listo para entregar'], ['demorado', 'Demorado']];
  const known = SIMPLE.some(([v]) => v === l.state);
  const opts = SIMPLE.map(([v, t]) => `<option value="${v}" ${l.state === v ? 'selected' : ''}>${t}</option>`).join('')
    + (known ? '' : `<option value="${l.state}" selected>${esc((API.meta?.stateLabels || {})[l.state] || l.state)}</option>`);
  return `<h3>Estado</h3>
    <div class="field"><label class="lab">Estado de fabricación</label>
      <select class="st_state" style="font-size:16px;max-width:360px">${opts}</select></div>
    <input type="hidden" class="st_progress" value="${l.progress || 0}">
    <input type="hidden" class="st_qtydone" value="${l.qty_done || 0}">
    <div class="grid2 st_delaybox hidden">
      <div><label class="lab">Motivo de la demora</label><input class="st_delay" value="${esc(l.delay_reason || '')}"></div>
      <div><label class="lab">Nueva fecha de posible entrega</label><input type="date" class="st_neweta"></div>
    </div>
    <button class="btn" onclick="saveState(${l.id}, this)">Guardar estado</button>`;
}

function costPanel(l, cost, isAdmin) {
  const c = cost || {};
  const f = (k, lbl) => `<div><label class="lab">${lbl}</label><input type="number" class="c_${k}" value="${c[k] ?? 0}" step="0.01"></div>`;
  const statusBadge = cost ? costStatusBadge(cost.status) : '<span class="badge b-gray">Sin costo</span>';
  const decision = isAdmin && cost && cost.status !== 'aprobado'
    ? `<div class="btnrow" style="margin-top:8px"><span class="muted">Decisión:</span>
       <button class="btn small ok" onclick="costDecision(${cost.id}, 'aprobado', ${l.id})">Aprobar</button>
       <button class="btn small danger" onclick="costDecision(${cost.id}, 'rechazado', ${l.id})">Rechazar</button>
       <button class="btn small ghost" onclick="costDecision(${cost.id}, 'revision', ${l.id})">Requiere revisión</button></div>` : '';
  return `<h3>💲 Costo ${statusBadge}</h3>
    <input type="hidden" class="c_qty" value="${c.qty ?? l.qty}">
    <div class="grid2">
      <div><label class="lab">Precio de costo (por unidad)</label>
        <input type="number" class="c_unit_cost" value="${c.unit_cost ?? ''}" step="0.01" placeholder="0" style="font-size:18px"></div>
      <div><label class="lab">Total (${l.qty} u.)</label><input class="c_total" value="${money(c.total_cost)}" disabled></div>
    </div>
    <div class="field"><label class="lab">Observación (opcional)</label><input class="c_notes" value="${esc(c.notes || '')}"></div>
    <button class="btn" onclick="saveCost(${l.id}, this)">Guardar costo</button>${decision}`;
}
function costReadOnly(cost) {
  return `<h3>💲 Costo ${costStatusBadge(cost.status)}</h3>
    <div class="specs"><div class="spec"><b>Total</b>${money(cost.total_cost, cost.currency)}</div>
    <div class="spec"><b>Actualizado</b>${fdatetime(cost.updated_at)}</div></div>`;
}
function costStatusBadge(s) {
  const map = { pendiente: 'b-amber', aprobado: 'b-green', rechazado: 'b-red', revision: 'b-blue' };
  const lbl = { pendiente: 'Pendiente de aprobación', aprobado: 'Aprobado', rechazado: 'Rechazado', revision: 'Requiere revisión' };
  return `<span class="badge ${map[s] || 'b-gray'}">${lbl[s] || s}</span>`;
}

function deliveryPanel(o) {
  const d = o.delivery || {};
  const canEdit = API.user.role === 'proveedor' || API.user.role === 'admin';
  return `<div class="panel"><h2>📅 Entrega</h2>
    <div class="grid2">
      <div><label class="lab">Fecha de posible entrega</label>
        <input type="date" id="d_est" value="${(d.estimated_date || '').slice(0, 10)}" ${canEdit ? '' : 'disabled'} style="font-size:18px"></div>
      <div><label class="lab">Observación</label>
        <input id="d_notes" value="${esc(d.notes || '')}" placeholder="Comentario sobre la entrega" ${canEdit ? '' : 'disabled'}></div>
    </div>
    ${canEdit ? `<button class="btn" onclick="saveDelivery(${o.id}, this)">Guardar</button>` : ''}
  </div>`;
}

function attachmentList(atts) {
  if (!atts || !atts.length) return '<p class="muted">Sin archivos adjuntos.</p>';
  return `<div class="table-wrap"><table><tbody>${atts.map((a) => `<tr>
    <td>${esc(a.kind)}</td><td>${esc(a.filename)}</td><td class="muted">${(a.size / 1024 | 0)} KB</td>
    <td><a class="btn small ghost" href="#" onclick="downloadFile(${a.id});return false">Ver</a></td></tr>`).join('')}</tbody></table></div>`;
}
async function downloadFile(id) {
  const res = await API.req('GET', '/files/download/' + id);
  const blob = await res.blob(); const url = URL.createObjectURL(blob);
  window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ---- Wiring del detalle ----------------------------------------------------
function wireOrderDetail(o, ctx) {
  // asignación / prioridad
  if (ctx.isAdmin) {
    (async () => {
      try {
        const sups = await API.get('/admin/suppliers');
        const sel = document.getElementById('assignSel');
        if (sel) sel.innerHTML = sups.map((s) => `<option value="${s.id}" ${o.supplier_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
      } catch (e) {}
    })();
    const ab = document.getElementById('assignBtn');
    if (ab) ab.onclick = async () => { await API.post(`/orders/${o.id}/assign`, { supplier_id: +document.getElementById('assignSel').value }); toast('Proveedor asignado', 'ok'); viewOrderDetail(o.id); };
    const pb = document.getElementById('prioBtn');
    if (pb) pb.onclick = async () => { await API.post(`/orders/${o.id}/general`, { priority: document.getElementById('prioSel').value }); toast('Prioridad guardada', 'ok'); };
  }
  // demora toggle + cost auto-calc
  document.querySelectorAll('[data-line]').forEach((panel) => {
    const st = panel.querySelector('.st_state');
    const box = panel.querySelector('.st_delaybox');
    if (st && box) { const upd = () => box.classList.toggle('hidden', st.value !== 'demorado'); st.onchange = upd; upd(); }
    const recalc = () => {
      const g = (c) => +(panel.querySelector('.c_' + c)?.value || 0);
      const total = g('unit_cost') * (+panel.querySelector('.c_qty')?.value || 0) + g('extras_cost') + g('legs_cost') + g('fabric_cost') + g('packaging_cost') + g('shipping_cost') + g('other_cost');
      const t = panel.querySelector('.c_total'); if (t) t.value = money(total);
    };
    panel.querySelectorAll('input[type=number]').forEach((i) => (i.oninput = recalc));
  });
  // upload
  const ub = document.getElementById('uploadBtn');
  if (ub) ub.onclick = async () => {
    const fi = document.getElementById('fileInput');
    if (!fi.files.length) return toast('Elegí un archivo', 'err');
    const fd = new FormData(); fd.append('file', fi.files[0]); fd.append('kind', document.getElementById('fileKind').value);
    try { await API.postForm('/files/' + o.id, fd); toast('Archivo subido', 'ok');
      document.getElementById('fileList').innerHTML = attachmentList(await API.get('/files/' + o.id)); fi.value = ''; }
    catch (e) { toast(e.message, 'err'); }
  };
  // comments
  loadComments(o.id);
  const sc = document.getElementById('sendComment');
  if (sc) sc.onclick = async () => {
    const input = document.getElementById('commentInput'); const body = input.value.trim(); if (!body) return;
    const internal = document.getElementById('internalChk')?.checked;
    await API.post('/social/comments/' + o.id, { body, internal }); input.value = ''; loadComments(o.id);
  };
}

async function loadComments(orderId) {
  const box = document.getElementById('chatbox'); if (!box) return;
  const rows = await API.get('/social/comments/' + orderId);
  box.innerHTML = rows.length ? rows.map((r) => {
    const mine = r.user_role === API.user.role;
    return `<div class="msg ${r.internal ? 'internal' : mine ? 'mine' : 'theirs'}">
      <div class="meta">${esc(r.user_name || '—')} · ${fdatetime(r.created_at)} ${r.internal ? '· interno' : ''}</div>${esc(r.body)}</div>`;
  }).join('') : '<p class="muted">Sin mensajes.</p>';
  box.scrollTop = box.scrollHeight;
}

// ---- Acciones de línea -----------------------------------------------------
async function saveState(lineId, btn) {
  const p = btn.closest('[data-line]');
  const body = {
    state: p.querySelector('.st_state').value,
    progress: +p.querySelector('.st_progress').value,
    qty_done: +p.querySelector('.st_qtydone').value,
  };
  if (body.state === 'demorado') { body.delay_reason = p.querySelector('.st_delay').value; body.new_eta = p.querySelector('.st_neweta').value; }
  try { await API.post(`/orders/lines/${lineId}/state`, body); toast('Estado actualizado', 'ok'); }
  catch (e) { toast(e.message, 'err'); }
}
async function saveCost(lineId, btn) {
  const p = btn.closest('[data-line]');
  const g = (c) => +(p.querySelector('.c_' + c)?.value || 0);
  const body = {
    unit_cost: g('unit_cost'), qty: g('qty') || 1, extras_cost: g('extras_cost'), legs_cost: g('legs_cost'),
    fabric_cost: g('fabric_cost'), packaging_cost: g('packaging_cost'), shipping_cost: g('shipping_cost'),
    other_cost: g('other_cost'), currency: p.querySelector('.c_currency')?.value || 'ARS',
    vat_included: p.querySelector('.c_vat')?.value === '1', notes: p.querySelector('.c_notes')?.value || '',
  };
  try { const r = await API.post(`/costs/line/${lineId}`, body); toast('Costo guardado (' + r.status + ')', 'ok'); viewOrderDetail(currentOrderId()); }
  catch (e) { toast(e.message, 'err'); }
}
async function costDecision(costId, decision, lineId) {
  if (!(await confirmAction(`¿Confirmás marcar el costo como "${decision}"?`))) return;
  try { await API.post(`/costs/${costId}/decision`, { decision }); toast('Costo ' + decision, 'ok'); viewOrderDetail(currentOrderId()); }
  catch (e) { toast(e.message, 'err'); }
}
async function saveDelivery(orderId, btn) {
  const v = (id) => document.getElementById(id)?.value || null;
  const body = { estimated_date: v('d_est'), notes: v('d_notes') };
  try { await API.post('/deliveries/' + orderId, body); toast('Guardado', 'ok'); }
  catch (e) { toast(e.message, 'err'); }
}
const currentOrderId = () => +(location.hash.match(/orders\/(\d+)/) || [])[1];

async function markDelivered(orderId) {
  if (!(await confirmAction('¿Marcar este pedido como ENTREGADO? Sale de la lista de pendientes y pasa a "Entregados".'))) return;
  try { await API.post('/orders/' + orderId + '/deliver'); toast('Marcado como entregado', 'ok'); viewOrderDetail(orderId); }
  catch (e) { toast(e.message, 'err'); }
}

function printMenu(orderId) {
  const back = document.createElement('div'); back.className = 'modal-back';
  back.innerHTML = `<div class="modal"><h2>🏷️ Imprimir etiquetas</h2>
    <div class="btnrow" style="flex-direction:column;align-items:stretch">
      <button class="btn" onclick="labelGo(${orderId},'order')">Una etiqueta por producto</button>
      <button class="btn" onclick="labelGo(${orderId},'unit')">Una etiqueta por unidad</button>
      <button class="btn" onclick="labelGo(${orderId},'package')">Una etiqueta por bulto</button>
      <button class="btn ghost" onclick="this.closest('.modal-back').remove()">Cerrar</button>
    </div><p class="muted" style="margin-top:8px">PDF 100×80 mm · compatible con Zebra ZD220.</p></div>`;
  document.body.appendChild(back);
  back.onclick = (e) => { if (e.target === back) back.remove(); };
}
function labelGo(orderId, mode) { document.querySelector('.modal-back')?.remove(); openLabelWindow(`/labels/order/${orderId}?mode=${mode}`); }

function showPartial(lineId, qty) {
  const back = document.createElement('div'); back.className = 'modal-back';
  back.innerHTML = `<div class="modal"><h2>Entrega parcial</h2>
    <div class="grid2">
      <div><label class="lab">Cantidad solicitada</label><input type="number" id="pq_req" value="${qty}"></div>
      <div><label class="lab">Cantidad terminada</label><input type="number" id="pq_done" value="0"></div>
      <div><label class="lab">Cantidad entregada</label><input type="number" id="pq_del" value="0"></div>
      <div><label class="lab">Fecha estimada pendiente</label><input type="date" id="pq_eta"></div>
    </div>
    <div class="field"><label class="lab">Motivo del faltante</label><input id="pq_reason"></div>
    <div class="btnrow" style="justify-content:flex-end">
      <button class="btn ghost" onclick="this.closest('.modal-back').remove()">Cancelar</button>
      <button class="btn" onclick="submitPartial(${lineId})">Guardar</button></div></div>`;
  document.body.appendChild(back);
}
async function submitPartial(lineId) {
  const v = (id) => document.getElementById(id).value;
  try {
    await API.post('/deliveries/partial/' + lineId, {
      qty_requested: +v('pq_req'), qty_done: +v('pq_done'), qty_delivered: +v('pq_del'),
      pending_eta: v('pq_eta') || null, reason: v('pq_reason'),
    });
    document.querySelector('.modal-back').remove(); toast('Entrega parcial registrada', 'ok'); viewOrderDetail(currentOrderId());
  } catch (e) { toast(e.message, 'err'); }
}
async function showCostHistory(lineId) {
  const rows = await API.get(`/costs/line/${lineId}/history`);
  const back = document.createElement('div'); back.className = 'modal-back';
  back.innerHTML = `<div class="modal"><h2>Historial de costo</h2>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Anterior</th><th>Nuevo</th><th>Modificó</th><th>Aprobó</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${fdatetime(r.created_at)}</td><td>${money(r.old_total)}</td><td>${money(r.new_total)}</td><td>${esc(r.changed_name || '—')}</td><td>${esc(r.approved_name || '—')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sin historial.</td></tr>'}</tbody></table></div>
    <div class="btnrow" style="justify-content:flex-end;margin-top:10px"><button class="btn ghost" onclick="this.closest('.modal-back').remove()">Cerrar</button></div></div>`;
  document.body.appendChild(back);
}

// ============================================================================
//  RECEPCIÓN (depósito)
// ============================================================================
async function viewReception() {
  setTitle('Recepción en depósito');
  C().innerHTML = `<div class="section-title"><h1>📦 Recepción</h1></div>
    <div class="panel">
      <label class="lab">Escaneá o ingresá el código (orden, producto o QR)</label>
      <div class="btnrow"><input id="scanInput" placeholder="Ej: S00042" style="flex:1;font-size:18px" autofocus>
        <button class="btn" id="scanBtn">Buscar</button></div>
    </div>
    <div id="scanResult"></div>`;
  const doScan = async () => {
    const code = document.getElementById('scanInput').value.trim(); if (!code) return;
    try {
      const r = await API.get('/reception/scan?code=' + encodeURIComponent(code));
      renderScanResult(r);
    } catch (e) { document.getElementById('scanResult').innerHTML = `<div class="alertbox danger">${esc(e.message)}</div>`; }
  };
  document.getElementById('scanBtn').onclick = doScan;
  document.getElementById('scanInput').onkeydown = (e) => { if (e.key === 'Enter') doScan(); };
}
function renderScanResult(r) {
  const el = document.getElementById('scanResult');
  el.innerHTML = `<div class="panel"><h2>Pedido ${esc(r.order.order_number)} <span class="muted">· ${esc(r.supplier || '')}</span></h2>
    <p>Cliente: <b>${esc(r.client?.name || '—')}</b> ${r.client?.city ? '· ' + esc(r.client.city) : ''}</p>
    ${r.lines.map((l) => `<div class="panel" data-recline="${l.id}" style="background:#faf8f4">
      <div class="section-title"><h3 style="margin:0">${esc(l.product_name)}</h3>${stateBadge(l.state)}</div>
      <div class="specs">
        <div class="spec"><b>Esperada</b>${l.qty}</div><div class="spec"><b>Entregada</b>${l.qty_delivered}</div>
        <div class="spec"><b>Pendiente</b>${l.qty_pending}</div><div class="spec"><b>Bultos</b>${l.packages}</div>
      </div>
      ${l.legs ? `<div class="highlight hl-legs"><div class="hl-title">Patas</div>${esc(l.legs)}</div>` : ''}
      ${l.extras ? `<div class="highlight hl-extras"><div class="hl-title">Adicionales</div>${esc(l.extras)}</div>` : ''}
      ${l.notes ? `<div class="highlight hl-notes"><div class="hl-title">Observaciones</div>${esc(l.notes)}</div>` : ''}
      <div class="grid3" style="margin-top:8px">
        <div><label class="lab">Resultado</label><select class="rc_result">${Object.entries(r.results).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
        <div><label class="lab">Cantidad recibida</label><input type="number" class="rc_qty" value="${l.qty_pending}" min="0"></div>
        <div><label class="lab">Observaciones</label><input class="rc_notes"></div>
      </div>
      <div class="btnrow" style="margin-top:8px">
        <button class="btn small" onclick="submitReception(${l.id}, this)">Registrar recepción</button>
        <label class="btn small ghost" style="position:relative;overflow:hidden">📷 Foto
          <input type="file" accept="image/*" capture="environment" class="rc_photo" style="position:absolute;inset:0;opacity:0" onchange="uploadReceptionPhoto(${r.order.id}, ${l.id}, this)"></label>
      </div>
    </div>`).join('')}
  </div>`;
}
async function submitReception(lineId, btn) {
  const p = btn.closest('[data-recline]');
  try {
    const res = await API.post('/reception', {
      line_id: lineId, result: p.querySelector('.rc_result').value,
      qty_received: +p.querySelector('.rc_qty').value, notes: p.querySelector('.rc_notes').value,
    });
    toast(`Registrado. Pendiente: ${res.qty_pending}`, 'ok');
  } catch (e) { toast(e.message, 'err'); }
}
async function uploadReceptionPhoto(orderId, lineId, input) {
  if (!input.files.length) return;
  const fd = new FormData(); fd.append('file', input.files[0]); fd.append('kind', 'foto_falla'); fd.append('line_id', lineId);
  try { await API.postForm('/files/' + orderId, fd); toast('Foto adjuntada', 'ok'); } catch (e) { toast(e.message, 'err'); }
}

// ============================================================================
//  CALENDARIO
// ============================================================================
async function viewCalendar() {
  setTitle('Calendario de entregas');
  const rows = await API.get('/deliveries/calendar');
  const today = new Date().toISOString().slice(0, 10);
  C().innerHTML = `<div class="section-title"><h1>📅 Calendario de entregas</h1></div>
    <div class="panel"><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Pedido</th><th>Cliente</th><th>Proveedor</th><th>Tipo</th><th>Alerta</th></tr></thead>
    <tbody>${rows.length ? rows.map((r) => {
      const d = (r.estimated_date || '').slice(0, 10);
      const overdue = d < today; const soon = d >= today && d <= new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
      let alert = ''; if (overdue) alert = '<span class="badge b-red">Vencida</span>';
      else if (soon) alert = '<span class="badge b-amber">Próxima</span>';
      if (r.same_day_count > 1) alert += ` <span class="badge b-blue">${r.same_day_count} el mismo día</span>`;
      return `<tr class="clickable" onclick="location.hash='#/orders/${r.order_id}'"><td>${d}</td><td><b>${esc(r.order_number)}</b></td>
        <td>${esc(r.client_name || '—')}</td><td>${esc(r.supplier_name || '—')}</td><td>${DELIVERY_TYPES[r.delivery_type] || '—'}</td><td>${alert || '—'}</td></tr>`;
    }).join('') : '<tr><td colspan="6" class="muted">Sin entregas programadas.</td></tr>'}</tbody></table></div></div>`;
}

// ============================================================================
//  NOTIFICACIONES
// ============================================================================
async function viewNotifications() {
  setTitle('Notificaciones');
  const { notifications } = await API.get('/social/notifications');
  await API.post('/social/notifications/read'); refreshNotifBadge();
  C().innerHTML = `<div class="section-title"><h1>🔔 Notificaciones</h1></div>
    <div class="panel">${notifications.length ? notifications.map((n) => `<div class="alertbox ${n.type === 'demora' || n.type === 'incidencia' ? 'danger' : 'warn'}" style="cursor:${n.order_id ? 'pointer' : 'default'}" ${n.order_id ? `onclick="location.hash='#/orders/${n.order_id}'"` : ''}>
      <b>${esc(n.title)}</b> ${n.body ? '— ' + esc(n.body) : ''}<br><span class="muted" style="font-size:12px">${fdatetime(n.created_at)}</span></div>`).join('') : '<p class="muted">Sin notificaciones.</p>'}</div>`;
}
