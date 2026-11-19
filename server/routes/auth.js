const express = require('express');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const { z } = require('zod');
const { q } = require('../db');
const config = require('../config');
const auth = require('../lib/auth');
const { sendOtp, normalisePhone, smsReady } = require('../lib/notify');

const router = express.Router();
const googleClient = new OAuth2Client(config.googleClientId || undefined);

const otpLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many OTP requests. Try again in a few minutes.' } });

const phoneSchema = z.string().transform((v) => v.replace(/\D/g, '')).refine((v) => /^[6-9]\d{9}$/.test(v.slice(-10)), 'Enter a valid 10-digit mobile number.');

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;

router.post('/otp/request', otpLimiter, async (req, res, next) => {
  try {
    const parsed = phoneSchema.safeParse(req.body?.phone);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const phone = parsed.data.slice(-10);
    const code = auth.newOtp();
    await q(
      `INSERT INTO otp_codes (phone, code_hash, expires_at, attempts) VALUES ($1,$2,$3,0)
       ON CONFLICT (phone) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0`,
      [phone, auth.hashOtp(phone, code), new Date(Date.now() + OTP_TTL_MS)]
    );
    const sent = await sendOtp(phone, code).catch((err) => {
      console.error('[otp] SMS failed:', err.response?.data || err.message);
      return false;
    });
    // Development only: when no SMS provider is configured, return the code so the flow can be tested.
    const devCode = !sent && !config.isProd ? code : undefined;
    res.json({ ok: true, sent: sent || smsReady(), devCode });
  } catch (err) { next(err); }
});

router.post('/otp/verify', async (req, res, next) => {
  try {
    const parsed = phoneSchema.safeParse(req.body?.phone);
    const code = String(req.body?.code || '').trim();
    if (!parsed.success || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code.' });
    const phone = parsed.data.slice(-10);

    const { rows } = await q(`SELECT * FROM otp_codes WHERE phone = $1`, [phone]);
    const row = rows[0];
    if (!row || row.expires_at < new Date()) return res.status(400).json({ error: 'That code has expired. Request a new one.' });
    if (row.attempts >= OTP_MAX_ATTEMPTS) return res.status(429).json({ error: 'Too many wrong attempts. Request a new code.' });

    if (!auth.safeEqualHex(row.code_hash, auth.hashOtp(phone, code))) {
      await q(`UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = $1`, [phone]);
      return res.status(400).json({ error: 'That code is not correct.' });
    }
    await q(`DELETE FROM otp_codes WHERE phone = $1`, [phone]);

    const { rows: customers } = await q(
      `INSERT INTO customers (phone) VALUES ($1)
       ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
       RETURNING id, name, phone, email`,
      [phone]
    );
    auth.setCustomerSession(res, customers[0].id);
    res.json({ customer: publicCustomer(customers[0]) });
  } catch (err) { next(err); }
});

router.post('/google', async (req, res, next) => {
  try {
    if (!config.googleClientId) return res.status(503).json({ error: 'Google sign-in is not configured yet.' });
    const credential = String(req.body?.credential || '');
    if (!credential) return res.status(400).json({ error: 'Missing Google credential.' });
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: config.googleClientId });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload.email_verified) return res.status(400).json({ error: 'Google account email is not verified.' });

    const { rows } = await q(
      `INSERT INTO customers (email, name) VALUES ($1,$2)
       ON CONFLICT (email) DO UPDATE SET name = CASE WHEN customers.name = '' THEN EXCLUDED.name ELSE customers.name END
       RETURNING id, name, phone, email`,
      [payload.email.toLowerCase(), payload.name || '']
    );
    auth.setCustomerSession(res, rows[0].id);
    res.json({ customer: publicCustomer(rows[0]) });
  } catch (err) { next(err); }
});

router.get('/me', async (req, res, next) => {
  try {
    const claims = auth.readToken(req, auth.CUSTOMER_COOKIE);
    if (!claims || claims.role !== 'customer') return res.json({ customer: null });
    const { rows } = await q(`SELECT id, name, phone, email FROM customers WHERE id = $1`, [Number(claims.sub)]);
    res.json({ customer: rows[0] ? publicCustomer(rows[0]) : null });
  } catch (err) { next(err); }
});

router.post('/profile', auth.requireCustomer, async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 120);
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
    const { rows } = await q(
      `UPDATE customers SET name = COALESCE(NULLIF($2,''), name), email = COALESCE(NULLIF($3,''), email)
       WHERE id = $1 RETURNING id, name, phone, email`,
      [req.customerId, name, email]
    );
    res.json({ customer: publicCustomer(rows[0]) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This email is already linked to another account. Use a different email.' });
    next(err);
  }
});

router.post('/logout', (req, res) => {
  auth.clearCustomerSession(res);
  res.json({ ok: true });
});

// Admin sign-in uses a password from the environment. Disabled when ADMIN_PASSWORD is empty.
const adminLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
router.post('/admin/login', adminLimiter, (req, res) => {
  if (!config.adminPassword) return res.status(503).json({ error: 'Admin login is disabled. Set ADMIN_PASSWORD in .env.' });
  if (!auth.checkAdminPassword(req.body?.password)) return res.status(401).json({ error: 'Wrong password.' });
  auth.setAdminSession(res);
  res.json({ ok: true });
});

router.post('/admin/logout', (req, res) => {
  auth.clearAdminSession(res);
  res.json({ ok: true });
});

function publicCustomer(c) {
  return { id: c.id, name: c.name || '', phone: c.phone || '', email: c.email || '' };
}

module.exports = router;
