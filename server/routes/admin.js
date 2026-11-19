// Admin portal API. Every route requires an admin session (see routes/auth.js /admin/login).
const express = require('express');
const { z } = require('zod');
const { q, tx } = require('../db');
const auth = require('../lib/auth');
const { loadProducts, publicProduct } = require('../lib/catalog');
const { getSettings, saveSettings } = require('../lib/settings');
const { dispatchOrder, httpError } = require('../lib/orders');
const { publishStock } = require('../bus');
const config = require('../config');

const router = express.Router();
router.use(auth.requireAdmin);

const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
const ORDER_STATUSES = ['paid', 'packed', 'shipped', 'delivered', 'cancelled'];

const rupeesToPaise = (r) => Math.round(Number(r) * 100);
const skuFor = (slug, color, size) => {
  const c = color.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 6) || 'CLR';
  const base = slug.split('-').map((w) => w[0]).join('').toUpperCase().slice(0, 4) || 'KT';
  return `KT-${base}-${c}-${size}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
};

const variantSchema = z.object({
  color: z.string().trim().min(1).max(40),
  size: z.enum(['S', 'M', 'L', 'XL', 'XXL']),
  stock: z.coerce.number().int().min(0).max(100000),
});

const productSchema = z.object({
  name: z.string().trim().min(2).max(120),
  subtitle: z.string().trim().max(60).optional().default(''),
  category: z.string().trim().min(2).max(40),
  description: z.string().trim().max(1000).optional().default(''),
  price: z.coerce.number().positive().max(100000),
  mrp: z.coerce.number().min(0).max(100000).optional(),
  tag: z.string().trim().max(20).optional().default(''),
  colors: z.array(z.object({
    name: z.string().trim().min(1).max(40),
    hex: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a hex value such as #1a1816'),
  })).min(1).max(8),
  variants: z.array(variantSchema).max(200).optional().default([]),
});

router.get('/overview', async (req, res, next) => {
  try {
    const { rows } = await q(`
      SELECT
        (SELECT count(*)::int FROM orders WHERE status NOT IN ('pending_payment','cancelled','payment_failed')) AS orders,
        (SELECT coalesce(sum(total_paise),0)::bigint FROM orders WHERE status NOT IN ('pending_payment','cancelled','payment_failed')) AS revenue_paise,
        (SELECT count(*)::int FROM orders WHERE status = 'paid') AS to_pack,
        (SELECT count(*)::int FROM variants WHERE stock > 0 AND stock <= 2) AS low_stock,
        (SELECT count(*)::int FROM products WHERE active) AS products
    `);
    res.json({ overview: rows[0] });
  } catch (err) { next(err); }
});

router.get('/products', async (req, res, next) => {
  try {
    const rows = await loadProducts({ includeInactive: true });
    res.json({ products: rows.map(publicProduct) });
  } catch (err) { next(err); }
});

router.post('/products', async (req, res, next) => {
  try {
    const parsed = productSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const b = parsed.data;
    const slug = `${b.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + '-' + Date.now().toString(36).slice(-4);
    const pricePaise = rupeesToPaise(b.price);
    const mrpPaise = b.mrp ? rupeesToPaise(b.mrp) : pricePaise;

    const id = await tx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO products (slug, name, subtitle, category, description, price_paise, mrp_paise, tag, colors)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [slug, b.name, b.subtitle, b.category, b.description, pricePaise, mrpPaise, b.tag, JSON.stringify(b.colors)]
      );
      const productId = rows[0].id;
      // Build a stock row for every colour and size. Rows not sent start at zero.
      const given = new Map(b.variants.map((v) => [`${v.color}|${v.size}`, v.stock]));
      for (const c of b.colors) {
        for (const s of SIZES) {
          await client.query(
            `INSERT INTO variants (product_id, color, size, sku, stock) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (product_id, color, size) DO NOTHING`,
            [productId, c.name, s, skuFor(slug, c.name, s), given.get(`${c.name}|${s}`) ?? 0]
          );
        }
      }
      return productId;
    });
    publishStock(id);
    const [row] = await loadProducts({ includeInactive: true, ids: [id] });
    res.status(201).json({ product: publicProduct(row) });
  } catch (err) { next(err); }
});

// Edit price, MRP, name, tag, description, or switch a product on and off.
router.patch('/products/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    const sets = [];
    const params = [id];
    const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (b.name !== undefined) add('name', String(b.name).trim().slice(0, 120));
    if (b.subtitle !== undefined) add('subtitle', String(b.subtitle).trim().slice(0, 60));
    if (b.category !== undefined) add('category', String(b.category).trim().slice(0, 40));
    if (b.description !== undefined) add('description', String(b.description).slice(0, 1000));
    if (b.tag !== undefined) add('tag', String(b.tag).trim().slice(0, 20));
    if (b.price !== undefined) {
      const p = rupeesToPaise(b.price);
      if (!(p > 0)) return res.status(400).json({ error: 'Price must be more than zero.' });
      add('price_paise', p);
    }
    if (b.mrp !== undefined) add('mrp_paise', rupeesToPaise(b.mrp));
    if (b.active !== undefined) add('active', Boolean(b.active));
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });
    sets.push('updated_at = now()');
    const { rowCount } = await q(`UPDATE products SET ${sets.join(', ')} WHERE id = $1`, params);
    if (!rowCount) return res.status(404).json({ error: 'Product not found.' });
    const [row] = await loadProducts({ includeInactive: true, ids: [id] });
    res.json({ product: publicProduct(row) });
  } catch (err) { next(err); }
});

// Add or change the stock of colour/size combinations for an existing product.
router.put('/products/:id/variants', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const parsed = z.array(variantSchema).max(200).safeParse(req.body?.variants);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { rows: prod } = await q(`SELECT slug FROM products WHERE id = $1`, [id]);
    if (!prod[0]) return res.status(404).json({ error: 'Product not found.' });
    await tx(async (client) => {
      for (const v of parsed.data) {
        await client.query(
          `INSERT INTO variants (product_id, color, size, sku, stock) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (product_id, color, size) DO UPDATE SET stock = EXCLUDED.stock`,
          [id, v.color, v.size, skuFor(prod[0].slug, v.color, v.size), v.stock]
        );
      }
    });
    publishStock(id);
    const [row] = await loadProducts({ includeInactive: true, ids: [id] });
    res.json({ product: publicProduct(row) });
  } catch (err) { next(err); }
});

// Quick stock change for one size (used by the inventory grid).
router.patch('/variants/:id', async (req, res, next) => {
  try {
    const stock = Number(req.body?.stock);
    if (!Number.isInteger(stock) || stock < 0 || stock > 100000) return res.status(400).json({ error: 'Stock must be a whole number, 0 or more.' });
    const { rows } = await q(`UPDATE variants SET stock = $2 WHERE id = $1 RETURNING product_id, stock`, [req.params.id, stock]);
    if (!rows[0]) return res.status(404).json({ error: 'Variant not found.' });
    publishStock(rows[0].product_id);
    res.json({ variant: { id: Number(req.params.id), stock: rows[0].stock } });
  } catch (err) { next(err); }
});

router.delete('/products/:id', async (req, res, next) => {
  try {
    // Soft delete keeps past orders intact. The product is hidden from the shop.
    const { rowCount } = await q(`UPDATE products SET active = false, updated_at = now() WHERE id = $1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Product not found.' });
    publishStock(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/orders', async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    const params = [];
    let where = `o.status <> 'pending_payment'`;
    if (status) { params.push(status); where = `o.status = $1`; }
    const { rows } = await q(
      `SELECT o.*, COALESCE(json_agg(json_build_object(
          'productName', oi.product_name, 'color', oi.color, 'size', oi.size, 'sku', oi.sku,
          'qty', oi.qty, 'unitPricePaise', oi.unit_price_paise, 'customText', oi.custom_text
        )) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
       FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE ${where}
       GROUP BY o.id ORDER BY o.created_at DESC LIMIT 300`,
      params
    );
    res.json({
      orders: rows.map((o) => ({
        id: o.id,
        status: o.status,
        invoiceNo: o.invoice_no,
        createdAt: o.created_at,
        paidAt: o.paid_at,
        customer: { name: o.customer_name, phone: o.phone, email: o.email, address: o.ship_address, city: o.ship_city, state: o.ship_state, pin: o.ship_pin },
        totalPaise: o.total_paise,
        taxPaise: o.tax_paise,
        shippingPaise: o.shipping_paise,
        paymentMethod: o.payment_method,
        awb: o.awb,
        courierName: o.courier_name,
        items: o.items,
      })),
    });
  } catch (err) { next(err); }
});

// Manual status change: packed, delivered, or cancelled. Shipping uses the dedicated route below.
router.patch('/orders/:id', async (req, res, next) => {
  try {
    const status = String(req.body?.status || '');
    if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status.' });
    const { rowCount } = await q(
      `UPDATE orders SET status = $2, updated_at = now() WHERE id = $1 AND status NOT IN ('pending_payment')`,
      [req.params.id, status]
    );
    if (!rowCount) return res.status(404).json({ error: 'Order not found or not yet paid.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/orders/:id/ship', async (req, res, next) => {
  try {
    const result = await dispatchOrder(req.params.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/settings', async (req, res, next) => {
  try {
    const s = await getSettings({ fresh: true });
    res.json({
      settings: {
        ...s,
        thresholdRupees: s.thresholdPaise / 100,
      },
      integrations: {
        razorpay: Boolean(config.razorpay.keyId),
        shiprocket: Boolean(config.shiprocket.email),
        whatsapp: Boolean(config.whatsapp.phoneNumberId),
        sms: Boolean(config.msg91.authKey),
        google: Boolean(config.googleClientId),
        ai: Boolean(config.anthropic.apiKey),
      },
    });
  } catch (err) { next(err); }
});

const settingsSchema = z.object({
  legalName: z.string().trim().max(120),
  gstin: z.string().trim().toUpperCase().regex(/^$|^[0-9A-Z]{15}$/, 'GSTIN must be 15 characters.'),
  address: z.string().trim().max(300),
  state: z.string().trim().max(60),
  stateCode: z.string().trim().max(3),
  pickupPin: z.string().trim().regex(/^$|^\d{6}$/, 'Pickup PIN must be 6 digits.'),
  lowRate: z.coerce.number().min(0).max(28),
  highRate: z.coerce.number().min(0).max(28),
  thresholdRupees: z.coerce.number().min(0).max(1000000),
});

router.put('/settings', async (req, res, next) => {
  try {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const b = parsed.data;
    const saved = await saveSettings({
      legalName: b.legalName,
      gstin: b.gstin,
      address: b.address,
      state: b.state,
      stateCode: b.stateCode,
      pickupPin: b.pickupPin,
      lowRate: b.lowRate,
      highRate: b.highRate,
      thresholdPaise: rupeesToPaise(b.thresholdRupees),
    });
    res.json({ settings: saved });
  } catch (err) { next(err); }
});

// Recent customer messages and courier updates, for the admin alert log.
router.get('/alerts', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT e.order_id, e.kind, e.detail, e.created_at
       FROM order_events e
       WHERE e.kind LIKE 'notify.%' OR e.kind LIKE 'courier.%' OR e.kind = 'order.paid' OR e.kind = 'order.shipped'
       ORDER BY e.created_at DESC LIMIT 100`
    );
    res.json({ alerts: rows });
  } catch (err) { next(err); }
});

module.exports = router;
