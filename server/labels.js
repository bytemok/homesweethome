'use strict';
// Generación de etiquetas PDF de tamaño físico EXACTO 100 x 80 mm.
// Compatible con impresoras térmicas (Zebra ZD220, 203 dpi). Sin márgenes.
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');

const MM = 72 / 25.4;                 // 1 mm en puntos PDF
const mm = (v) => v * MM;
const PAGE_W = mm(100);
const PAGE_H = mm(80);

// Logo opcional: si existe public/logo.png (o .jpg) se usa en la etiqueta.
const LOGO_PATH = ['logo.png', 'logo.jpg', 'logo.jpeg']
  .map((f) => path.join(__dirname, '..', 'public', f))
  .find((p) => fs.existsSync(p)) || null;

// Genera un buffer PNG de código de barras / QR ------------------------------
async function barcode(text, type = 'code128', opts = {}) {
  if (!text) return null;
  try {
    return await bwipjs.toBuffer({
      bcid: type,
      text: String(text),
      scale: 3,
      height: type === 'qrcode' ? undefined : (opts.height || 8),
      includetext: opts.includetext || false,
      textxalign: 'center',
      paddingwidth: 0,
      paddingheight: 0,
    });
  } catch (e) {
    return null; // texto no codificable -> se omite el gráfico
  }
}

// Dibuja texto ajustando el tamaño de fuente para que entre en el recuadro.
// Nunca corta sin advertencia: si no entra ni al mínimo, agrega marca «»».
function fitted(doc, text, x, y, w, h, { max = 10, min = 5, bold = false } = {}) {
  if (text == null || text === '') return;
  const str = String(text);
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
  let size = max;
  for (; size >= min; size--) {
    doc.fontSize(size);
    if (doc.heightOfString(str, { width: w }) <= h) break;
  }
  doc.fontSize(size);
  let out = str;
  let warn = false;
  if (doc.heightOfString(str, { width: w }) > h) {
    // Recortar por líneas hasta que entre y marcar la advertencia.
    warn = true;
    while (out.length > 4 && doc.heightOfString(out + ' »', { width: w }) > h) {
      out = out.slice(0, -6);
    }
    out = out.trimEnd() + ' »»';
  }
  doc.fillColor(warn ? '#b00020' : '#111').text(out, x, y, { width: w, height: h });
  doc.fillColor('#111');
}

function line(doc, x1, y1, x2, y2, color = '#999') {
  doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(0.5).strokeColor(color).stroke();
}

// Un recuadro destacado (patas / adicionales / observaciones) ----------------
function highlight(doc, label, value, x, y, w, h) {
  doc.save();
  doc.roundedRect(x, y, w, h, 2).fillColor('#FFF3CD').fill();
  doc.roundedRect(x, y, w, h, 2).lineWidth(0.6).strokeColor('#E0A800').stroke();
  doc.restore();
  doc.font('Helvetica-Bold').fontSize(6).fillColor('#8a6d00')
    .text(label.toUpperCase(), x + mm(1), y + mm(0.6), { width: w - mm(2) });
  fitted(doc, value || '—', x + mm(1), y + mm(3.2), w - mm(2), h - mm(3.6),
    { max: 8, min: 5, bold: true });
  doc.fillColor('#111');
}

// Construye una etiqueta (una página) --------------------------------------
async function drawLabel(doc, d) {
  const pad = mm(2.5);
  const innerW = PAGE_W - pad * 2;

  // Pre-generar gráficos
  const [orderBar, prodBar, qr] = await Promise.all([
    barcode(d.orderBarcode || d.orderNumber, 'code128', { height: 7 }),
    barcode(d.productBarcode, 'code128', { height: 6 }),
    barcode(d.qrPayload, 'qrcode'),
  ]);

  // --- Cabecera: logo + QR -------------------------------------------------
  let logoOk = false;
  if (LOGO_PATH) {
    try { doc.image(LOGO_PATH, pad, mm(2), { fit: [mm(52), mm(11)] }); logoOk = true; } catch (e) { logoOk = false; }
  }
  if (!logoOk) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111')
      .text('TODO EN MUEBLES', pad, mm(2.5), { width: mm(60) });
    doc.font('Helvetica').fontSize(6).fillColor('#666')
      .text('Portal de Proveedores', pad, mm(7.5));
  }

  if (qr) doc.image(qr, PAGE_W - pad - mm(16), mm(2), { width: mm(16), height: mm(16) });

  // --- Número de orden grande ---------------------------------------------
  doc.font('Helvetica-Bold').fontSize(22).fillColor('#111')
    .text(d.orderNumber || '', pad, mm(11), { width: mm(60) });
  doc.font('Helvetica').fontSize(6).fillColor('#666')
    .text(`Proveedor: ${d.supplier || '—'}`, pad, mm(20.5), { width: mm(60) });

  // Código de barras de la orden
  if (orderBar) doc.image(orderBar, pad, mm(24), { width: mm(52), height: mm(9) });

  // Cantidad / bulto (derecha)
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#111')
    .text(`Cant: ${d.qty}`, PAGE_W - pad - mm(30), mm(24), { width: mm(30), align: 'right' });
  if (d.bulto) doc.fontSize(9).text(`Bulto ${d.bulto}`, PAGE_W - pad - mm(30), mm(28.5),
    { width: mm(30), align: 'right' });

  line(doc, pad, mm(34), PAGE_W - pad, mm(34));

  // --- Producto (izquierda) -----------------------------------------------
  const colW = mm(53);
  fitted(doc, d.productName, pad, mm(35.5), colW, mm(9), { max: 11, min: 7, bold: true });
  doc.font('Helvetica').fontSize(7).fillColor('#333');
  const meta = [d.model && `Modelo: ${d.model}`, d.measure && `Medida: ${d.measure}`,
    d.internalCode && `Cód: ${d.internalCode}`].filter(Boolean).join('   ');
  doc.text(meta, pad, mm(45), { width: colW });
  fitted(doc, `Tela: ${d.fabric || '—'}  ·  Color: ${d.color || '—'}`,
    pad, mm(49.5), colW, mm(6), { max: 8, min: 6 });

  if (prodBar) doc.image(prodBar, pad, mm(56), { width: mm(40), height: mm(7) });
  doc.font('Helvetica').fontSize(6).fillColor('#666')
    .text(d.productBarcode || '', pad, mm(63), { width: mm(40) });

  // --- Recuadros destacados (derecha) -------------------------------------
  const hx = pad + mm(55);
  const hw = innerW - mm(55);
  highlight(doc, 'Patas', d.legs, hx, mm(35.5), hw, mm(11));
  highlight(doc, 'Adicionales', d.extras, hx, mm(48), hw, mm(11));

  line(doc, pad, mm(65), PAGE_W - pad, mm(65));

  // --- Cliente + observaciones + fecha ------------------------------------
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#111')
    .text(d.clientName || '—', pad, mm(66), { width: mm(55) });
  doc.font('Helvetica').fontSize(6.5).fillColor('#333');
  const addr = [d.phone, d.address, [d.city, d.province].filter(Boolean).join(', ')]
    .filter(Boolean).join('  ·  ');
  doc.text(addr, pad, mm(70), { width: mm(60) });

  // Observaciones destacadas (abajo, ancho reducido para dejar la fecha)
  if (d.notes) {
    doc.save();
    doc.rect(pad, mm(74), mm(60), mm(4.5)).fillColor('#FDECEA').fill();
    doc.restore();
    doc.font('Helvetica-Bold').fontSize(6).fillColor('#b00020');
    fitted(doc, `OBS: ${d.notes}`, pad + mm(1), mm(74.6), mm(58), mm(3.5), { max: 6.5, min: 5, bold: true });
  }

  // Fecha estimada (derecha abajo)
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#111')
    .text('Entrega estimada', PAGE_W - pad - mm(30), mm(66), { width: mm(30), align: 'right' });
  doc.fontSize(9).text(d.eta || '—', PAGE_W - pad - mm(30), mm(69.5), { width: mm(30), align: 'right' });
}

// Renderiza N etiquetas (una por página) hacia un stream ---------------------
async function renderLabels(res, labelsData, filename = 'etiquetas.pdf') {
  const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);
  for (let i = 0; i < labelsData.length; i++) {
    if (i > 0) doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });
    await drawLabel(doc, labelsData[i]);
  }
  if (labelsData.length === 0) {
    doc.fontSize(10).text('Sin etiquetas para generar', mm(5), mm(35));
  }
  doc.end();
}

module.exports = { renderLabels, PAGE_W, PAGE_H };
