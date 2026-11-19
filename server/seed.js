// Seeds settings and a starter catalogue. Safe to run more than once.
// Usage: npm run seed
const { q, migrate, pool } = require('./db');
const config = require('./config');

const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

const PRODUCTS = [
  {
    slug: 'classic-crew-neck', name: 'Classic Crew Neck', subtitle: 'Crew neck', category: 'Classic', tag: 'Bestseller',
    description: 'A refined crew neck in long-staple combed cotton. Regular fit with a reinforced ribbed collar.',
    pricePaise: 129000, mrpPaise: 149000,
    colors: [{ name: 'Espresso', hex: '#4a3328' }, { name: 'Ivory', hex: '#efe8da' }, { name: 'Sage', hex: '#8c9a7b' }],
  },
  {
    slug: 'drop-shoulder-oversize', name: 'Drop-Shoulder Oversize', subtitle: 'Oversized', category: 'Oversized', tag: 'New',
    description: 'Dropped shoulders and a relaxed, boxy line in a heavier 280 GSM cotton.',
    pricePaise: 169000, mrpPaise: 189000,
    colors: [{ name: 'Sand', hex: '#cdb89a' }, { name: 'Graphite', hex: '#3a3d40' }],
  },
  {
    slug: 'pique-polo', name: 'Pique Polo', subtitle: 'Polo', category: 'Polo', tag: '',
    description: 'A fine pique knit with a two-button placket. Breathable and understated.',
    pricePaise: 149000, mrpPaise: 149000,
    colors: [{ name: 'Navy', hex: '#1f2a44' }, { name: 'Oxblood', hex: '#6b1e2e' }, { name: 'Bone', hex: '#f1ede4' }],
  },
  {
    slug: 'henley', name: 'Henley', subtitle: 'Classic', category: 'Classic', tag: '',
    description: 'A three-button henley with a soft brushed finish. Slim-regular cut.',
    pricePaise: 119000, mrpPaise: 119000,
    colors: [{ name: 'Heather Grey', hex: '#a4a29d' }, { name: 'Terracotta', hex: '#a4502b' }],
  },
  {
    slug: 'garment-dyed-pocket-tee', name: 'Garment-Dyed Pocket Tee', subtitle: 'Oversized', category: 'Oversized', tag: 'Limited',
    description: 'A chest pocket, garment-dyed for a soft, lived-in tone and a relaxed fit.',
    pricePaise: 139000, mrpPaise: 169000,
    colors: [{ name: 'Forest', hex: '#2f4a3a' }, { name: 'Stone', hex: '#c9c3b6' }],
  },
  {
    slug: 'mock-neck-long-tee', name: 'Mock-Neck Long Tee', subtitle: 'Essentials', category: 'Essentials', tag: '',
    description: 'A close mock neck, fine rib and a longer body for layering.',
    pricePaise: 139000, mrpPaise: 139000,
    colors: [{ name: 'Black', hex: '#1a1816' }, { name: 'Mocha', hex: '#7a6250' }],
  },
];

const DEFAULT_STOCK = { S: 8, M: 12, L: 12, XL: 8, XXL: 4 };

function skuFor(slug, color, size) {
  const c = color.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 6);
  return `KT-${slug.split('-').map((w) => w[0]).join('').toUpperCase()}-${c}-${size}`;
}

async function seedSettings() {
  const d = config.store.defaults;
  await q(
    `INSERT INTO settings (key, value) VALUES ('store', $1)
     ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify(d)]
  );
}

async function seedCatalogue() {
  for (const p of PRODUCTS) {
    const inserted = await q(
      `INSERT INTO products (slug, name, subtitle, category, description, price_paise, mrp_paise, tag, colors)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
      [p.slug, p.name, p.subtitle, p.category, p.description, p.pricePaise, p.mrpPaise, p.tag, JSON.stringify(p.colors)]
    );
    if (!inserted.rows[0]) continue;
    const productId = inserted.rows[0].id;
    for (const c of p.colors) {
      for (const s of SIZES) {
        await q(
          `INSERT INTO variants (product_id, color, size, sku, stock)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [productId, c.name, s, skuFor(p.slug, c.name, s), DEFAULT_STOCK[s]]
        );
      }
    }
  }
}

async function seedIfNeeded() {
  await migrate();
  await seedSettings();
  await seedCatalogue();
}

module.exports = { seedIfNeeded };

if (require.main === module) {
  seedIfNeeded()
    .then(() => console.log('Seed complete.'))
    .catch((err) => {
      console.error('Seed failed:', err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
