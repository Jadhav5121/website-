// Order lifecycle: reserve stock, create payment, mark paid, release stale reservations.
const crypto = require('crypto');
const { q, tx } = require('../db');
const config = require('../config');
const { getSettings } = require('./settings');
const { taxInclusive } = require('./gst');
const razorpay = require('./razorpay');
const shiprocket = require('./shiprocket');
const { issueInvoiceNumber } = require('./invoice');
const { notifyCustomer, logEvent, normalisePhone } = require('./notify');
const { publishStock } = require('../bus');

const RESERVATION_MINUTES = 30;

function newOrderId() {
  return `KT${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

// Creates the order and reserves stock in one database transaction.
// Prices are read from the database, never from the browser.
async function reserveOrder({ items, customer }) {
  const settings = await getSettings();
  const orderId = newOrderId();
  const touchedProducts = new Set();

  const result = await tx(async (client) => {
    let subtotal = 0;
    let tax = 0;
    const lines = [];

    for (const item of items) {
      const { rows: prodRows } = await client.query(
        `SELECT id, name, price_paise, active FROM products WHERE id = $1`,
        [item.productId]
      );
      const product = prodRows[0];
      if (!product || !product.active) throw httpError(400, 'One of the products is no longer available.');

      const { rows: varRows } = await client.query(
        `SELECT id, sku, stock FROM variants WHERE product_id = $1 AND color = $2 AND size = $3 FOR UPDATE`,
        [product.id, item.color, item.size]
      );
      const variant = varRows[0];
      if (!variant) throw httpError(400, `${product.name} is not available in ${item.color} / ${item.size}.`);
      if (variant.stock < item.qty) {
        throw httpError(409, `Only ${variant.stock} left of ${product.name} (${item.color}, ${item.size}).`);
      }

      await client.query(`UPDATE variants SET stock = stock - $2 WHERE id = $1`, [variant.id, item.qty]);
      touchedProducts.add(product.id);

      const customFee = item.customText ? config.store.customPrintFeePaise : 0;
      const unitPrice = product.price_paise + customFee;
      const amount = unitPrice * item.qty;
      subtotal += amount;
      tax += taxInclusive(amount, unitPrice, settings).tax;

      lines.push({
        variantId: variant.id,
        productName: product.name,
        color: item.color,
        size: item.size,
        sku: variant.sku,
        qty: item.qty,
        unitPrice,
        customText: item.customText || '',
        customFont: item.customFont || '',
        customPlace: item.customPlace || '',
      });
    }

    const shipping = subtotal >= config.store.freeShippingOverPaise ? 0 : config.store.shippingFeePaise;
    const total = subtotal + shipping;

    let customerId = null;
    if (customer.phone) {
      const { rows } = await client.query(
        `INSERT INTO customers (phone, name, email) VALUES ($1,$2,$3)
         ON CONFLICT (phone) DO UPDATE SET name = CASE WHEN customers.name = '' THEN EXCLUDED.name ELSE customers.name END
         RETURNING id`,
        [customer.phone, customer.name, customer.email]
      );
      customerId = rows[0].id;
    }

    await client.query(
      `INSERT INTO orders (id, customer_id, status, customer_name, phone, email, ship_address, ship_city, ship_state, ship_pin,
         subtotal_paise, shipping_paise, tax_paise, total_paise)
       VALUES ($1,$2,'pending_payment',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [orderId, customerId, customer.name, customer.phone, customer.email, customer.address, customer.city,
        customer.state, customer.pin, subtotal, shipping, tax, total]
    );

    for (const l of lines) {
      await client.query(
        `INSERT INTO order_items (order_id, variant_id, product_name, color, size, sku, qty, unit_price_paise,
           custom_text, custom_font, custom_place)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [orderId, l.variantId, l.productName, l.color, l.size, l.sku, l.qty, l.unitPrice, l.customText, l.customFont, l.customPlace]
      );
    }
    return { total, shipping, subtotal, tax };
  });

  touchedProducts.forEach((id) => publishStock(id));
  return { orderId, ...result };
}

// Returns reserved stock to inventory and cancels the order.
async function releaseOrder(orderId, reason) {
  const released = await tx(async (client) => {
    const { rows } = await client.query(`SELECT status FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
    if (!rows[0] || !['pending_payment', 'payment_failed'].includes(rows[0].status)) return null;
    const { rows: items } = await client.query(
      `SELECT variant_id, qty FROM order_items WHERE order_id = $1 AND variant_id IS NOT NULL`,
      [orderId]
    );
    for (const it of items) {
      await client.query(`UPDATE variants SET stock = stock + $2 WHERE id = $1`, [it.variant_id, it.qty]);
    }
    await client.query(`UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = $1`, [orderId]);
    return items.length;
  });
  if (released) {
    await logEvent(orderId, 'order.released', { reason });
    const { rows } = await q(`SELECT DISTINCT v.product_id FROM order_items oi JOIN variants v ON v.id = oi.variant_id WHERE oi.order_id = $1`, [orderId]);
    rows.forEach((r) => publishStock(r.product_id));
  }
  return Boolean(released);
}

// Marks an order paid, issues the GST invoice number and sends the confirmation message. Safe to call twice.
async function markPaid(orderId, { paymentId, method }) {
  const transitioned = await tx(async (client) => {
    const { rows } = await client.query(`SELECT status FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
    if (!rows[0]) return false;
    if (!['pending_payment', 'payment_failed'].includes(rows[0].status)) return false;
    await client.query(
      `UPDATE orders SET status = 'paid', razorpay_payment_id = $2, payment_method = $3, paid_at = now(), updated_at = now()
       WHERE id = $1`,
      [orderId, paymentId, method || 'Online']
    );
    return true;
  });
  if (!transitioned) return false;

  const invoiceNo = await issueInvoiceNumber(orderId);
  await logEvent(orderId, 'order.paid', { paymentId, invoiceNo, method: method || 'Online' });

  const { rows } = await q(`SELECT phone, total_paise FROM orders WHERE id = $1`, [orderId]);
  const o = rows[0];
  const amount = `Rs. ${(o.total_paise / 100).toFixed(2)}`;
  await notifyCustomer(orderId, o.phone, 'confirmed', [orderId, amount]).catch((err) => console.error('[notify]', err.message));
  return true;
}

// Ships a paid order: creates the Shiprocket shipment, assigns the AWB, and notifies the customer.
async function dispatchOrder(orderId) {
  const { rows } = await q(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  const order = rows[0];
  if (!order) throw httpError(404, 'Order not found.');
  if (!['paid', 'packed'].includes(order.status)) throw httpError(409, 'Only paid or packed orders can be shipped.');
  if (!shiprocket.enabled()) throw httpError(503, 'Shiprocket is not configured. Add its credentials to .env.');

  const { rows: items } = await q(`SELECT * FROM order_items WHERE order_id = $1`, [orderId]);
  const { courierOrderId, shipmentId } = await shiprocket.createShipment(order, items);
  const { awb, courierName } = await shiprocket.assignAwb(shipmentId);
  if (!awb) throw httpError(502, 'Courier did not return an AWB. Check the shipment in Shiprocket.');

  await q(
    `UPDATE orders SET status = 'shipped', courier_order_id = $2, shipment_id = $3, awb = $4, courier_name = $5, updated_at = now()
     WHERE id = $1`,
    [orderId, courierOrderId, shipmentId, awb, courierName || '']
  );
  await logEvent(orderId, 'order.shipped', { awb, courierName });
  await notifyCustomer(orderId, order.phone, 'dispatched', [orderId, awb]).catch((err) => console.error('[notify]', err.message));
  return { awb, courierName };
}

// Cancels orders whose payment never completed, so stock isn't held forever.
async function releaseStaleOrders() {
  const { rows } = await q(
    `SELECT id FROM orders
     WHERE status IN ('pending_payment','payment_failed')
       AND created_at < now() - ($1 || ' minutes')::interval
     LIMIT 100`,
    [String(RESERVATION_MINUTES)]
  );
  for (const r of rows) await releaseOrder(r.id, 'payment not completed in time');
  return rows.length;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

module.exports = {
  reserveOrder,
  releaseOrder,
  markPaid,
  dispatchOrder,
  releaseStaleOrders,
  httpError,
  RESERVATION_MINUTES,
  normalisePhone,
};
