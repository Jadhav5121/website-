const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { loadProducts, publicProduct } = require('../lib/catalog');
const { recommend } = require('../lib/stylist');
const { bus } = require('../bus');
const config = require('../config');

const router = express.Router();

router.get('/products', async (req, res, next) => {
  try {
    const rows = await loadProducts();
    res.set('Cache-Control', 'no-cache');
    res.json({ products: rows.map(publicProduct) });
  } catch (err) { next(err); }
});

router.get('/products/:slug', async (req, res, next) => {
  try {
    const [row] = await loadProducts({ slug: req.params.slug });
    if (!row) return res.status(404).json({ error: 'Product not found.' });
    res.json({ product: publicProduct(row) });
  } catch (err) { next(err); }
});

// Public store rules the storefront needs for display (never secrets).
router.get('/store', (req, res) => {
  res.json({
    brand: config.store.brand,
    freeShippingOverPaise: config.store.freeShippingOverPaise,
    shippingFeePaise: config.store.shippingFeePaise,
    customPrintFeePaise: config.store.customPrintFeePaise,
    razorpayKeyId: config.razorpay.keyId || null,
    paymentsLive: Boolean(config.razorpay.keyId && config.razorpay.keySecret),
    googleClientId: config.googleClientId || null,
  });
});

// Live stock: the browser keeps this open and updates sizes without a page reload.
router.get('/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write(`event: ready\ndata: {}\n\n`);
  const onStock = (msg) => res.write(`event: stock\ndata: ${JSON.stringify(msg)}\n\n`);
  bus.on('stock', onStock);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off('stock', onStock);
  });
});

const stylistLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });

const stylistSchema = z.object({
  heightCm: z.coerce.number().min(140).max(215),
  weightKg: z.coerce.number().min(40).max(180),
  build: z.enum(['slim', 'regular', 'athletic', 'broad']),
  fit: z.enum(['slim', 'regular', 'oversized']),
  occasion: z.enum(['casual', 'office', 'gym', 'college']),
  budgetRupees: z.coerce.number().min(0).max(100000).optional().nullable(),
  notes: z.string().max(300).optional(),
});

router.post('/stylist', stylistLimiter, async (req, res, next) => {
  try {
    const parsed = stylistSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please check your height, weight and preferences.' });
    const b = parsed.data;
    const profile = {
      heightCm: b.heightCm,
      weightKg: b.weightKg,
      build: b.build,
      fit: b.fit,
      occasion: b.occasion,
      budgetPaise: b.budgetRupees ? Math.round(b.budgetRupees * 100) : null,
      notes: b.notes,
    };
    const rows = await loadProducts();
    const result = await recommend(profile, rows);
    const byId = new Map(rows.map((p) => [p.id, publicProduct(p)]));
    res.json({
      source: result.source,
      size: result.size,
      note: result.note,
      picks: result.picks.map((pk) => ({ ...pk, product: byId.get(pk.productId) })).filter((pk) => pk.product),
    });
  } catch (err) { next(err); }
});

module.exports = router;
