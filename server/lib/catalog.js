// Loads products with their size/colour variants and live stock.
const { q } = require('../db');

async function loadProducts({ includeInactive = false, slug, ids } = {}) {
  const params = [];
  const where = [];
  if (!includeInactive) where.push('p.active = true');
  if (slug) { params.push(slug); where.push(`p.slug = $${params.length}`); }
  if (ids) { params.push(ids); where.push(`p.id = ANY($${params.length}::int[])`); }
  const sql = `
    SELECT p.*,
      COALESCE(json_agg(json_build_object(
        'id', v.id, 'color', v.color, 'size', v.size, 'sku', v.sku, 'stock', v.stock
      ) ORDER BY v.color, v.size) FILTER (WHERE v.id IS NOT NULL), '[]') AS variants
    FROM products p
    LEFT JOIN variants v ON v.product_id = p.id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    GROUP BY p.id
    ORDER BY p.id`;
  const { rows } = await q(sql, params);
  return rows;
}

// Shape sent to the storefront and admin. Prices are in paise; the frontend divides by 100 for display.
function publicProduct(p) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    subtitle: p.subtitle,
    category: p.category,
    description: p.description,
    pricePaise: p.price_paise,
    mrpPaise: p.mrp_paise,
    tag: p.tag,
    active: p.active,
    colors: p.colors,
    variants: p.variants,
    totalStock: p.variants.reduce((a, v) => a + v.stock, 0),
  };
}

module.exports = { loadProducts, publicProduct };
