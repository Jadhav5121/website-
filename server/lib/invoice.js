// GST tax invoice PDF generation with PDFKit.
// Amounts are written as "Rs." so the built-in fonts render them correctly.
// To print the Marathi brand name, place NotoSansDevanagari-Regular.ttf in /fonts (see README).
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { q, tx } = require('../db');
const { financialYear, taxInclusive } = require('./gst');
const { getSettings } = require('./settings');
const config = require('../config');

const FONT_PATH = path.join(__dirname, '..', '..', 'fonts', 'NotoSansDevanagari-Regular.ttf');
const hasDevanagari = fs.existsSync(FONT_PATH);

const rs = (paise) => `Rs. ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Allocates the next invoice number for the current financial year, e.g. KT/2026-27/0001.
// Runs inside the caller's transaction so numbers never repeat or skip after a failure.
async function nextInvoiceNumber(client, date = new Date()) {
  const fy = financialYear(date);
  const { rows } = await client.query(
    `INSERT INTO invoice_counters (fy, last_no) VALUES ($1, 1)
     ON CONFLICT (fy) DO UPDATE SET last_no = invoice_counters.last_no + 1
     RETURNING last_no`,
    [fy]
  );
  return `KT/${fy}/${String(rows[0].last_no).padStart(4, '0')}`;
}

async function loadInvoiceData(orderId) {
  const { rows: orders } = await q(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  if (!orders[0]) return null;
  const { rows: items } = await q(`SELECT * FROM order_items WHERE order_id = $1 ORDER BY id`, [orderId]);
  return { order: orders[0], items, settings: await getSettings() };
}

function buildPdf({ order, items, settings }) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));

  if (hasDevanagari) doc.registerFont('brand', FONT_PATH);
  const brandFont = hasDevanagari ? 'brand' : 'Helvetica-Bold';

  // Header
  doc.font(brandFont).fontSize(20).text(config.store.brand, { continued: false });
  doc.font('Helvetica').fontSize(9).fillColor('#444');
  doc.text(settings.legalName || 'Your registered legal name');
  doc.text(settings.address || 'Registered address');
  doc.text(`GSTIN: ${settings.gstin || 'Add GSTIN in Admin > Settings'}   State: ${settings.state || ''} ${settings.stateCode ? `(${settings.stateCode})` : ''}`);
  doc.fillColor('#000');

  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(16).text('TAX INVOICE', { align: 'right' });
  doc.font('Helvetica').fontSize(9).text(`Invoice No: ${order.invoice_no || '-'}`, { align: 'right' });
  doc.text(`Invoice Date: ${new Date(order.paid_at || order.created_at).toLocaleDateString('en-IN')}`, { align: 'right' });
  doc.text(`Order ID: ${order.id}`, { align: 'right' });

  // Bill to / ship to
  doc.moveDown(1);
  const top = doc.y;
  doc.font('Helvetica-Bold').text('Bill to / Ship to', 40, top);
  doc.font('Helvetica').text(order.customer_name);
  doc.text(order.ship_address);
  doc.text(`${order.ship_city}, ${order.ship_state} ${order.ship_pin}`);
  doc.text(`Phone: ${order.phone}${order.email ? `   Email: ${order.email}` : ''}`);
  doc.text(`Place of supply: ${order.ship_state || '-'}`);

  // Table
  doc.moveDown(1);
  const cols = { no: 40, item: 62, hsn: 290, qty: 330, rate: 370, taxable: 430, gst: 490, amount: 530 };
  let y = doc.y;
  const row = (values, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
    doc.text(values.no, cols.no, y, { width: 20 });
    doc.text(values.item, cols.item, y, { width: 224 });
    doc.text(values.hsn, cols.hsn, y, { width: 36 });
    doc.text(values.qty, cols.qty, y, { width: 36, align: 'right' });
    doc.text(values.rate, cols.rate, y, { width: 56, align: 'right' });
    doc.text(values.taxable, cols.taxable, y, { width: 56, align: 'right' });
    doc.text(values.gst, cols.gst, y, { width: 36, align: 'right' });
    doc.text(values.amount, cols.amount, y, { width: 40, align: 'right' });
  };
  doc.moveTo(40, y - 4).lineTo(555, y - 4).stroke('#999');
  row({ no: '#', item: 'Description', hsn: 'HSN', qty: 'Qty', rate: 'Rate', taxable: 'Taxable', gst: 'GST', amount: 'Total' }, true);
  y += 16;
  doc.moveTo(40, y - 4).lineTo(555, y - 4).stroke('#999');

  let taxableTotal = 0;
  let taxTotal = 0;
  items.forEach((it, idx) => {
    const amount = it.unit_price_paise * it.qty;
    const { tax, taxable } = taxInclusive(amount, it.unit_price_paise, settings);
    taxableTotal += taxable;
    taxTotal += tax;
    const desc = `${it.product_name}\n${it.color} / ${it.size}${it.custom_text ? `  · Print: ${it.custom_text}` : ''}`;
    row({
      no: String(idx + 1),
      item: desc,
      hsn: '6109',
      qty: String(it.qty),
      rate: rs(Math.round(taxable / it.qty)),
      taxable: rs(taxable),
      gst: rs(tax),
      amount: rs(amount),
    });
    y += 30;
  });

  doc.moveTo(40, y - 4).lineTo(555, y - 4).stroke('#999');

  // Totals
  y += 6;
  const totalRow = (label, value, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    doc.text(label, 340, y, { width: 130, align: 'right' });
    doc.text(value, 470, y, { width: 85, align: 'right' });
    y += 14;
  };
  totalRow('Taxable value', rs(taxableTotal));
  totalRow(`CGST + SGST (${settings.lowRate}% / ${settings.highRate}% slabs)`, rs(taxTotal));
  totalRow('Delivery charges', order.shipping_paise ? rs(order.shipping_paise) : 'Free');
  totalRow('Grand total', rs(order.total_paise), true);

  doc.y = y + 12;
  doc.font('Helvetica').fontSize(8).fillColor('#333');
  doc.text(`Amount paid via ${order.payment_method || 'online payment'} (ref ${order.razorpay_payment_id || '-'}).`);
  doc.text('Prices are inclusive of GST. Intra-state supplies show CGST and SGST; inter-state supplies show IGST.');
  doc.text('This is a computer-generated invoice and does not require a signature.');

  doc.end();
  return new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
}

async function invoicePdf(orderId) {
  const data = await loadInvoiceData(orderId);
  if (!data) return null;
  if (!data.order.invoice_no) return null;
  return buildPdf(data);
}

// Called after payment succeeds. Assigns an invoice number inside a transaction.
async function issueInvoiceNumber(orderId) {
  return tx(async (client) => {
    const { rows } = await client.query(`SELECT invoice_no FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
    if (rows[0]?.invoice_no) return rows[0].invoice_no;
    const no = await nextInvoiceNumber(client);
    await client.query(`UPDATE orders SET invoice_no = $2 WHERE id = $1`, [orderId, no]);
    return no;
  });
}

module.exports = { invoicePdf, issueInvoiceNumber, nextInvoiceNumber, rs };
