// Customer messaging: WhatsApp Cloud API for order alerts, MSG91 for SMS and OTP.
// When a provider is not configured, messages are written to the order event log instead, so the flow
// can be tested end to end without sending real messages.
const axios = require('axios');
const config = require('../config');
const { q } = require('../db');

const whatsappReady = () => Boolean(config.whatsapp.phoneNumberId && config.whatsapp.accessToken);
const smsReady = () => Boolean(config.msg91.authKey);

function normalisePhone(phone) {
  const digits = String(phone).replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
}

async function logEvent(orderId, kind, detail) {
  await q(`INSERT INTO order_events (order_id, kind, detail) VALUES ($1,$2,$3)`, [orderId, kind, JSON.stringify(detail)]);
}

async function sendWhatsAppTemplate(phone, template, params) {
  const to = normalisePhone(phone);
  await axios.post(
    `https://graph.facebook.com/v21.0/${config.whatsapp.phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template,
        language: { code: 'en' },
        components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: String(text) })) }],
      },
    },
    { headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` }, timeout: 10_000 }
  );
}

async function sendSmsFlow(phone, templateId, vars) {
  await axios.post(
    'https://control.msg91.com/api/v5/flow/',
    {
      template_id: templateId,
      sender: config.msg91.senderId,
      short_url: '0',
      mobiles: normalisePhone(phone),
      ...vars,
    },
    { headers: { authkey: config.msg91.authKey, 'Content-Type': 'application/json' }, timeout: 10_000 }
  );
}

// Order-related message to a customer. Tries WhatsApp first, then SMS.
async function notifyCustomer(orderId, phone, kind, params) {
  const template = kind === 'confirmed' ? config.whatsapp.templateConfirmed : config.whatsapp.templateDispatched;
  const text = kind === 'confirmed'
    ? `Order ${orderId} confirmed. Thank you for shopping with ${config.store.brandLatin}.`
    : `Order ${orderId} has been dispatched. AWB ${params[1]}.`;

  if (whatsappReady()) {
    try {
      await sendWhatsAppTemplate(phone, template, params);
      await logEvent(orderId, 'notify.whatsapp', { kind, to: normalisePhone(phone), status: 'sent' });
    } catch (err) {
      await logEvent(orderId, 'notify.whatsapp', { kind, status: 'failed', error: err.response?.data?.error?.message || err.message });
    }
  } else {
    await logEvent(orderId, 'notify.whatsapp', { kind, status: 'simulated', text });
  }

  if (smsReady() && config.msg91.orderTemplateId) {
    try {
      await sendSmsFlow(phone, config.msg91.orderTemplateId, { order_id: orderId, message: text });
      await logEvent(orderId, 'notify.sms', { kind, status: 'sent' });
    } catch (err) {
      await logEvent(orderId, 'notify.sms', { kind, status: 'failed', error: err.response?.data?.message || err.message });
    }
  } else {
    await logEvent(orderId, 'notify.sms', { kind, status: 'simulated', text });
  }
}

// OTP delivery. Returns true when a real SMS was sent.
async function sendOtp(phone, code) {
  if (smsReady() && config.msg91.otpTemplateId) {
    await sendSmsFlow(phone, config.msg91.otpTemplateId, { otp: code });
    return true;
  }
  return false;
}

module.exports = { notifyCustomer, sendOtp, normalisePhone, logEvent, whatsappReady, smsReady };
