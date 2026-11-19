// Razorpay: create payment orders, verify payment signatures and webhook signatures.
// Docs: https://razorpay.com/docs/payments/server-integration/nodejs/
const crypto = require('crypto');
const Razorpay = require('razorpay');
const config = require('../config');

const enabled = () => Boolean(config.razorpay.keyId && config.razorpay.keySecret);

let client = null;
function instance() {
  if (!client) client = new Razorpay({ key_id: config.razorpay.keyId, key_secret: config.razorpay.keySecret });
  return client;
}

async function createOrder({ amountPaise, receipt, notes }) {
  const order = await instance().orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt,
    notes,
  });
  return order.id;
}

// Checkout returns order_id, payment_id and signature. Signature = HMAC_SHA256(order_id|payment_id, key_secret).
function verifyPaymentSignature({ orderId, paymentId, signature }) {
  const expected = crypto.createHmac('sha256', config.razorpay.keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Webhooks: HMAC_SHA256(raw request body, webhook secret) must equal the x-razorpay-signature header.
function verifyWebhookSignature(rawBody, signature) {
  if (!config.razorpay.webhookSecret) return false;
  const expected = crypto.createHmac('sha256', config.razorpay.webhookSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { enabled, createOrder, verifyPaymentSignature, verifyWebhookSignature };
