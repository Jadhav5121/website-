// Inbound webhooks from Razorpay (payment confirmation) and Shiprocket (courier status).
// Razorpay needs the raw request body to check its signature, so this router must be mounted before express.json().
const crypto = require('crypto');
const express = require('express');
const { q } = require('../db');
const razorpay = require('../lib/razorpay');
const { markPaid, releaseOrder } = require('../lib/orders');
const { logEvent } = require('../lib/notify');
const config = require('../config');

const router = express.Router();

router.post('/razorpay', express.raw({ type: '*/*', limit: '512kb' }), async (req, res) => {
  const signature = req.get('x-razorpay-signature');
  if (!razorpay.verifyWebhookSignature(req.body, signature)) {
    return res.status(400).json({ error: 'Invalid signature.' });
  }

  const eventId = req.get('x-razorpay-event-id') || `body-${crypto.createHash('sha256').update(req.body).digest('hex')}`;
  let eventIdSaved = false;

  try {
    const seen = await q(
      `INSERT INTO processed_webhooks (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id`,
      [eventId]
    );
    if (!seen.rows[0]) return res.json({ ok: true, duplicate: true });
    eventIdSaved = true;

    let event;
    try {
      event = JSON.parse(req.body.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Bad JSON.' });
    }

    const payment = event.payload?.payment?.entity;
    if (!payment?.order_id) return res.json({ ok: true, ignored: event.event });

    const { rows } = await q(`SELECT id FROM orders WHERE razorpay_order_id = $1`, [payment.order_id]);
    const order = rows[0];
    if (!order) return res.json({ ok: true, unknownOrder: true });

    if (event.event === 'payment.captured') {
      await markPaid(order.id, { paymentId: payment.id, method: payment.method ? payment.method.toUpperCase() : 'Razorpay' });
    } else if (event.event === 'payment.failed') {
      await q(`UPDATE orders SET status = 'payment_failed', updated_at = now() WHERE id = $1 AND status = 'pending_payment'`, [order.id]);
      await logEvent(order.id, 'payment.failed', { paymentId: payment.id, reason: payment.error_description || '' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[webhook:razorpay]', err);
    // Release the dedupe marker so Razorpay's retry is processed, then ask for a retry.
    if (eventIdSaved) await q(`DELETE FROM processed_webhooks WHERE event_id = $1`, [eventId]).catch(() => {});
    return res.status(500).json({ error: 'Temporary failure, please retry.' });
  }
});

// Shiprocket sends status updates to this URL with a token in the query string.
router.post('/shiprocket', express.json(), async (req, res) => {
  if (!config.shiprocket.webhookToken || req.query.token !== config.shiprocket.webhookToken) {
    return res.status(401).json({ error: 'Unauthorised.' });
  }
  const { awb, current_status: status, order_id: orderId } = req.body || {};
  const s = String(status || '').toUpperCase();
  const { rows } = await q(
    `SELECT id, status FROM orders WHERE ($1::text IS NOT NULL AND awb = $1) OR ($2::text IS NOT NULL AND id = $2) LIMIT 1`,
    [awb ? String(awb) : null, orderId ? String(orderId) : null]
  );
  const order = rows[0];
  if (!order) return res.json({ ok: true, unknownOrder: true });

  await logEvent(order.id, 'courier.status', { awb, status: s });
  if (s.includes('DELIVERED') && order.status !== 'delivered') {
    await q(`UPDATE orders SET status = 'delivered', updated_at = now() WHERE id = $1`, [order.id]);
  }
  res.json({ ok: true });
});

module.exports = router;
