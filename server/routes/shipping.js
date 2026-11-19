const express = require('express');
const { q } = require('../db');
const config = require('../config');
const shiprocket = require('../lib/shiprocket');
const { getSettings } = require('../lib/settings');

const router = express.Router();

// Delivery date for a PIN code. Uses Shiprocket serviceability when configured;
// otherwise returns a clearly labelled estimate.
router.get('/estimate', async (req, res, next) => {
  try {
    const pin = String(req.query.pin || '');
    if (!/^\d{6}$/.test(pin)) return res.status(400).json({ error: 'Enter a valid 6-digit PIN code.' });
    const settings = await getSettings();

    if (shiprocket.enabled() && settings.pickupPin) {
      const result = await shiprocket.serviceability({ deliveryPin: pin, pickupPin: settings.pickupPin });
      if (!result.serviceable) return res.json({ serviceable: false, source: 'courier' });
      return res.json({
        serviceable: true,
        source: 'courier',
        days: result.days,
        etd: result.etd,
        courier: result.courier,
      });
    }

    // Estimate used until the courier account is connected.
    const metro = ['1', '4', '5', '6'].includes(pin[0]);
    return res.json({
      serviceable: true,
      source: 'estimate',
      days: metro ? '2-4' : '4-7',
      etd: null,
      courier: null,
    });
  } catch (err) { next(err); }
});

// Customer tracking: order ID plus the phone number used at checkout.
router.get('/track', async (req, res, next) => {
  try {
    const orderId = String(req.query.orderId || '').trim().toUpperCase();
    const phone = String(req.query.phone || '').replace(/\D/g, '').slice(-10);
    if (!orderId || phone.length !== 10) return res.status(400).json({ error: 'Enter your order ID and phone number.' });

    const { rows } = await q(`SELECT * FROM orders WHERE id = $1 AND phone = $2`, [orderId, phone]);
    const o = rows[0];
    if (!o) return res.status(404).json({ error: 'No order matches those details.' });

    let live = null;
    if (o.awb && shiprocket.enabled()) {
      try {
        live = await shiprocket.track(o.awb);
      } catch (err) {
        console.warn('[track] Shiprocket lookup failed:', err.message);
      }
    }

    res.json({
      orderId: o.id,
      status: o.status,
      invoiceNo: o.invoice_no,
      awb: o.awb,
      courierName: o.courier_name,
      placedAt: o.created_at,
      paidAt: o.paid_at,
      totalPaise: o.total_paise,
      live,
    });
  } catch (err) { next(err); }
});

module.exports = router;
