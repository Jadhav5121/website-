// AI personal stylist.
// 1. If ANTHROPIC_API_KEY is set, the catalogue and the customer's profile are sent to Claude,
//    which returns a size and product picks as JSON. Picks are checked against the real catalogue.
// 2. Otherwise (or if the AI call fails), a rule-based stylist is used so the feature always works.
const axios = require('axios');
const config = require('../config');

const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

function sizeFor({ heightCm, weightKg, build, fit }) {
  const hi = heightCm < 165 ? 0 : heightCm < 175 ? 1 : heightCm < 185 ? 2 : heightCm < 195 ? 3 : 4;
  const wi = weightKg < 58 ? 0 : weightKg < 70 ? 1 : weightKg < 82 ? 2 : weightKg < 95 ? 3 : 4;
  let idx = Math.round((hi + wi) / 2);
  if (build === 'broad') idx += 1;
  if (build === 'slim') idx -= 1;
  if (fit === 'oversized') idx += 1; // relaxed fit: one size up
  idx = Math.min(4, Math.max(0, idx));
  return SIZES[idx];
}

function ruleBased(profile, products) {
  const size = sizeFor(profile);
  const colourPrefs = {
    office: ['Navy', 'Ivory', 'Bone', 'Black', 'Graphite'],
    gym: ['Black', 'Heather Grey', 'Graphite', 'Forest', 'Sage'],
  }[profile.occasion] || [];
  const fitCats = {
    oversized: ['Oversized'],
    regular: ['Classic', 'Polo', 'Essentials'],
    slim: ['Classic', 'Essentials', 'Polo'],
  }[profile.fit] || [];

  const picks = products.map((p) => {
    let score = 0;
    const reasons = [];
    if (fitCats.includes(p.category)) { score += 3; reasons.push(profile.fit === 'oversized' ? 'Relaxed fit' : 'Matches your fit'); }
    const colour = p.colors.find((c) => colourPrefs.includes(c.name));
    if (colour) { score += 2; reasons.push(`Suits ${profile.occasion}`); }
    const inStock = p.variants.some((v) => v.size === size && v.stock > 0);
    if (!inStock) { score -= 10; reasons.push(`${size} is sold out`); }
    if (profile.budgetPaise && p.pricePaise > profile.budgetPaise) { score -= 5; reasons.push('Above your budget'); }
    return { productId: p.id, score, reasons, colour: (colour || p.colors[0]).name };
  });

  picks.sort((a, b) => b.score - a.score);
  return {
    source: 'rules',
    size,
    note: profile.fit === 'oversized' ? 'Relaxed fit: we suggest one size up from your usual.' : 'Based on your height and weight. Check the size chart before buying.',
    picks: picks.slice(0, 3).map(({ productId, reasons, colour }) => ({ productId, reasons, colour })),
  };
}

async function aiRecommend(profile, products) {
  const catalogue = products.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    price: p.pricePaise / 100,
    colours: p.colors.map((c) => c.name),
    sizesInStock: [...new Set(p.variants.filter((v) => v.stock > 0).map((v) => v.size))],
  }));

  const system = [
    'You are a men\'s streetwear stylist for an Indian t-shirt brand.',
    'Recommend one size and up to three products from the catalogue that suit the customer.',
    'Only use product ids from the catalogue. Only pick sizes listed as in stock for that product.',
    'Reply with JSON only, in this shape: {"size":"M","note":"one short sentence","picks":[{"productId":1,"colour":"Ivory","reasons":["short reason"]}]}',
  ].join(' ');

  const userMessage = `Customer profile: ${JSON.stringify({
    heightCm: profile.heightCm,
    weightKg: profile.weightKg,
    build: profile.build,
    fit: profile.fit,
    occasion: profile.occasion,
    budgetRupees: profile.budgetPaise ? profile.budgetPaise / 100 : null,
    notes: profile.notes || '',
  })}\nCatalogue: ${JSON.stringify(catalogue)}`;

  const { data } = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: config.anthropic.model,
      max_tokens: 700,
      system,
      messages: [{ role: 'user', content: userMessage }],
    },
    {
      headers: {
        'x-api-key': config.anthropic.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 20_000,
    }
  );

  const text = data?.content?.find((b) => b.type === 'text')?.text || '';
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const validIds = new Set(products.map((p) => p.id));
  const picks = (json.picks || []).filter((p) => validIds.has(Number(p.productId))).slice(0, 3).map((p) => ({
    productId: Number(p.productId),
    colour: String(p.colour || ''),
    reasons: (p.reasons || []).map(String).slice(0, 3),
  }));
  return {
    source: 'ai',
    size: SIZES.includes(json.size) ? json.size : sizeFor(profile),
    note: String(json.note || ''),
    picks,
  };
}

async function recommend(profile, products) {
  if (config.anthropic.apiKey) {
    try {
      return await aiRecommend(profile, products);
    } catch (err) {
      console.warn('[stylist] AI call failed, using rules:', err.message);
    }
  }
  return ruleBased(profile, products);
}

module.exports = { recommend, sizeFor };
