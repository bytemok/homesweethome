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
      height: type === 'qrcode' ? undefined : (opts.height || 10),
      includetext: opts.includetext ?? true,
      textsize: opts.textsize || 9,
      textxalign: 'center',
      paddingwidth: 0,
      paddingheight: 0,
    });
  } catch (e) {
    return null; // texto no codificable -> se omite el gráfico
  }
}

function line(doc, x1, y1, x2, y2, color = '#999') {
  doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(0.5).strokeColor(color).stroke();
}

// Dibuja una imagen a un ancho fijo y devuelve su altura real renderizada
// (para no adivinar la altura del código de barras + texto y evitar superposiciones).
function drawImageW(doc, buf, x, y, w) {
  const img = doc.openImage(buf);
  const h = w * (img.height / img.width);
  doc.image(img, x, y, { width: w });
  return h;
}

// Construye una etiqueta (una página). Diseño: logo grande, escaneo de la
// orden, escaneo del producto, y debajo Producto / Cliente / Orden / Dir.
async function drawLabel(doc, d) {
  const pad = mm(4);
  const innerW = PAGE_W - pad * 2;

  // Barras chicas (altura 4mm + texto 6pt) para que el bloque completo (barras+texto)
  // ocupe poco alto: a un ancho de 50mm da ~9 mm de alto.
  const [orderBar, prodBar] = await Promise.all([
    barcode(d.orderBarcode || d.orderNumber, 'code128', { height: 4, textsize: 6 }),
    barcode(d.productBarcode, 'code128', { height: 4, textsize: 6 }),
  ]);

  // Borde de la etiqueta
  doc.save();
  doc.rect(mm(0.8), mm(0.8), PAGE_W - mm(1.6), PAGE_H - mm(1.6)).lineWidth(0.75).strokeColor('#111').stroke();
  doc.restore();

  const bottom = PAGE_H - mm(2); // límite inferior de contenido
  let y = mm(2.5);

  const txt = (str, size, opts = {}) => {
    doc.font(opts.bold === false ? 'Helvetica' : 'Helvetica-Bold').fontSize(size).fillColor('#111');
    const h = doc.heightOfString(str, { width: innerW });
    doc.text(str, pad, y, { width: innerW, height: bottom - y, ellipsis: true });
    y += h;
  };

  // --- Logo grande ------------------------------------------------------------
  let logoOk = false;
  if (LOGO_PATH) {
    try { doc.image(LOGO_PATH, pad, y, { fit: [innerW, mm(13)] }); logoOk = true; y += mm(14); } catch (e) { logoOk = false; }
  }
  if (!logoOk) {
    txt('TODO', 24); y += mm(0.5);
    txt('MUEBLES', 24); y += mm(1.5);
  }

  line(doc, pad, y, PAGE_W - pad, y, '#111'); y += mm(1.5);

  // --- Escanear primero: ORDEN -------------------------------------------------
  txt('ESCANEAR PRIMERO - ORDEN', 8); y += mm(1);
  if (orderBar) y += drawImageW(doc, orderBar, pad, y, mm(48)) + mm(1);

  line(doc, pad, y, PAGE_W - pad, y, '#111'); y += mm(1.5);

  // --- Escanear segundo: PRODUCTO -----------------------------------------------
  txt('ESCANEAR SEGUNDO - PRODUCTO', 8); y += mm(1);
  if (prodBar) y += drawImageW(doc, prodBar, pad, y, mm(48)) + mm(1);

  line(doc, pad, y, PAGE_W - pad, y, '#111'); y += mm(1.5);

  // --- Datos del pedido ---------------------------------------------------------
  const addr = [d.address, [d.city, d.province].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  txt(`Producto: ${d.productName || '—'}`, 9); y += mm(0.6);
  txt(`Cliente: ${d.clientName || '—'}`, 9); y += mm(0.6);
  txt(`Orden: ${d.orderNumber || '—'}`, 8, { bold: false }); y += mm(0.6);
  if (addr) txt(`Dir: ${addr}`, 8, { bold: false });
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
