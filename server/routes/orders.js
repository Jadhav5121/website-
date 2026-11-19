const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { q } = require('../db');
const config = require('../config');
const auth = require('../lib/auth');
const razorpay = require('../lib/razorpay');
const { reserveOrder, releaseOrder, markPaid, httpError } = require('../lib/orders');
const { invoicePdf } = require('../lib/invoice');
const { loadProducts } = require('../lib/catalog');
const { logEvent } = require('../lib/notify');

const router = express.Router();

const orderLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

const itemSchema = z.object({
  productId: z.coerce.number().int().positive(),
  color: z.string().min(1).max(40),
  size: z.enum(['S', 'M', 'L', 'XL', 'XXL']),
  qty: z.coerce.number().int().min(1).max(10),
  customText: z.string().max(12).regex(/^[A-Za-z0-9 ]*$/, 'Print text can use letters and numbers only.').optional(),
  customFont: z.enum(['serif', 'sans']).optional(),
  customPlace: z.enum(['front', 'back']).optional(),
});

const orderSchema = z.object({
  items: z.array(itemSchema).min(1).max(20),
  customer: z.object({
    name: z.string().trim().min(2).max(80),
    phone: z.string().transform((v) => v.replace(/\D/g, '').slice(-10)).refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number.'),
    email: z.string().trim().email().max(120).optional().or(z.literal('')),
    address: z.string().trim().min(5).max(200),
    city: z.string().trim().min(2).max(60),
    state: z.string().trim().max(60).optional().or(z.literal('')),
    pin: z.string().regex(/^\d{6}$/, 'Enter a valid 6-digit PIN code.'),
  }),
});

// Step 1 of checkout: validates the basket, reserves stock and creates the payment order.
router.post('/', orderLimiter, async (req, res, next) => {
  let reservation = null;
  try {
    const parsed = orderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { items, customer } = parsed.data;
    const cust = { ...customer, email: customer.email || '', state: customer.state || '' };

    // Confirm the product ids exist before reserving stock.
    const ids = [...new Set(items.map((i) => i.productId))];
    const found = await loadProducts({ ids });
    if (found.length !== ids.length) return res.status(400).json({ error: 'One of the products is no longer available.' });

    reservation = await reserveOrder({ items, customer: cust });

    let razorpayOrderId = null;
    if (razorpay.enabled()) {
      razorpayOrderId = await razorpay.createOrder({
        amountPaise: reservation.total,
        receipt: reservation.orderId,
        notes: { phone: cust.phone },
      });
      await q(`UPDATE orders SET razorpay_order_id = $2 WHERE id = $1`, [reservation.orderId, razorpayOrderId]);
    } else {
      // Development mode: no payment keys. The order can be completed with /dev-pay.
      razorpayOrderId = `dev_${reservation.orderId}`;
      await q(`UPDATE orders SET razorpay_order_id = $2 WHERE id = $1`, [reservation.orderId, razorpayOrderId]);
    }

    res.status(201).json({
      orderId: reservation.orderId,
      amountPaise: reservation.total,
      subtotalPaise: reservation.subtotal,
      shippingPaise: reservation.shipping,
      taxPaise: reservation.tax,
      currency: 'INR',
      mode: razorpay.enabled() ? 'live' : 'dev',
      razorpayKeyId: razorpay.enabled() ? config.razorpay.keyId : null,
      razorpayOrderId,
      prefill: { name: cust.name, email: cust.email, contact: cust.phone },
    });
  } catch (err) {
    if (reservation) await releaseOrder(reservation.orderId, 'order creation failed').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// Step 2 (live): the browser sends back Razorpay's payment ids. We verify the signature before trusting them.
router.post('/:id/verify', async (req, res, next) => {
  try {
    const { razorpay_order_id: rzOrder, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
    const { rows } = await q(`SELECT id, razorpay_order_id, status FROM orders WHERE id = $1`, [req.params.id]);
    const order = rows[0];
    if (!order || order.razorpay_order_id !== rzOrder) return res.status(400).json({ error: 'Payment does not match this order.' });
    if (!razorpay.verifyPaymentSignature({ orderId: rzOrder, paymentId, signature })) {
      await logEvent(order.id, 'payment.signature_invalid', {});
      return res.status(400).json({ error: 'Payment could not be verified.' });
    }
    await markPaid(order.id, { paymentId, method: 'Razorpay' });
    res.json({ ok: true, orderId: order.id, status: 'paid' });
  } catch (err) { next(err); }
});

// Development only: completes an order without a real payment. Disabled in production and when keys exist.
router.post('/:id/dev-pay', async (req, res, next) => {
  try {
    if (config.isProd || razorpay.enabled()) return res.status(404).json({ error: 'Not found.' });
    const { rows } = await q(`SELECT id FROM orders WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Order not found.' });
    await markPaid(req.params.id, { paymentId: `dev_pay_${Date.now()}`, method: 'Dev (no gateway)' });
    res.json({ ok: true, orderId: req.params.id, status: 'paid' });
  } catch (err) { next(err); }
});

// Order history for the signed-in customer.
router.get('/mine', auth.requireCustomer, async (req, res, next) => {
  try {
    const { rows: cust } = await q(`SELECT phone FROM customers WHERE id = $1`, [req.customerId]);
    const phone = cust[0]?.phone || '';
    const { rows } = await q(
      `SELECT o.*, COALESCE(json_agg(json_build_object(
          'productName', oi.product_name, 'color', oi.color, 'size', oi.size, 'qty', oi.qty,
          'unitPricePaise', oi.unit_price_paise, 'customText', oi.custom_text
        )) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
       FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.customer_id = $1 OR ($2 <> '' AND o.phone = $2)
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT 50`,
      [req.customerId, phone]
    );
    res.json({
      orders: rows.map((o) => ({
        id: o.id,
        status: o.status,
        createdAt: o.created_at,
        paidAt: o.paid_at,
        invoiceNo: o.invoice_no,
        totalPaise: o.total_paise,
        awb: o.awb,
        courierName: o.courier_name,
        items: o.items,
      })),
    });
  } catch (err) { next(err); }
});

// GST tax invoice PDF. Available to the customer who placed the order, or to the admin.
router.get('/:id/invoice.pdf', async (req, res, next) => {
  try {
    const adminClaims = auth.readToken(req, 'kt_admin');
    const isAdmin = adminClaims?.role === 'admin';
    const customerClaims = auth.readToken(req, auth.CUSTOMER_COOKIE);
    if (!isAdmin) {
      if (!customerClaims || customerClaims.role !== 'customer') return res.status(401).json({ error: 'Please sign in.' });
      const { rows } = await q(
        `SELECT o.id FROM orders o JOIN customers c ON c.id = $2
         WHERE o.id = $1 AND (o.customer_id = c.id OR (c.phone IS NOT NULL AND o.phone = c.phone))`,
        [req.params.id, Number(customerClaims.sub)]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Invoice not found.' });
    }
    const pdf = await invoicePdf(req.params.id);
    if (!pdf) return res.status(404).json({ error: 'Invoice is available once payment is complete.' });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${req.params.id}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  } catch (err) { next(err); }
});

module.exports = router;
