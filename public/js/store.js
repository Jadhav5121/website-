// Storefront: catalogue, live stock, bag, checkout (Razorpay), tracking, accounts, stylist and customiser.
import { $, $$, esc, api, toast, teeSVG, rupees, rupeesExact, SIZES } from './common.js';

const CART_KEY = 'kt.cart.v1';
const LAST_ORDER_KEY = 'kt.lastOrder.v1';
const VIEWS = ['home', 'product', 'customise', 'stylist', 'track', 'account', 'checkout', 'confirm'];

const state = {
  products: [],
  store: null,
  customer: null,
  cart: load(CART_KEY, []),
  category: 'All',
  filter: { color: null, size: null, max: 3000, sort: 'featured' },
  modal: { product: null, colour: null, size: null },
  cz: { product: null, colour: null, size: null, text: '', font: 'serif', place: 'front' },
  trackPrefill: null,
  otpPhone: '',
  acctTab: 'orders',
  pp: { product: null, colour: null, size: null, img: 0, qty: 1 },
};

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function persistCart() { try { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); } catch { /* storage blocked */ } }

/* ---------- Catalogue ---------- */
async function loadCatalogue() {
  const { products } = await api('/api/products');
  state.products = products.filter((p) => p.active);
  renderCategoryTabs();
  renderGrid();
  renderCustomiserBase();
  if (state.modal.product) refreshModal();
  if (location.hash.startsWith('#product/')) renderProductPage(location.hash.slice(9));
  refreshCustomiser();
  renderBag();
}

function renderCategoryTabs() {
  const cats = ['All', ...new Set(state.products.map((p) => p.category))];
  $('#catTabs').innerHTML = cats.map((c) => `<button class="fcat ${c === state.category ? 'on' : ''}" data-cat="${esc(c)}"><i></i>${esc(c)}</button>`).join('');
  const colours = new Map();
  state.products.forEach((p) => p.colors.forEach((c) => colours.set(c.name, c.hex)));
  $('#colorFilter').innerHTML = [...colours].map(([n, h]) => `<button class="fcol ${state.filter.color === n ? 'on' : ''}" data-fcolor="${esc(n)}" title="${esc(n)}" style="background:${esc(h)}"></button>`).join('');
  $('#sizeFilter').innerHTML = SIZES.map((z) => `<button class="${state.filter.size === z ? 'on' : ''}" data-fsize="${z}">${z}</button>`).join('');
  $('#priceRange').value = state.filter.max;
  $('#priceVal').textContent = '₹' + Number(state.filter.max).toLocaleString('en-IN') + (state.filter.max >= 3000 ? '+' : '');
}

function filteredProducts() {
  const f = state.filter;
  let list = state.products.filter((p) => (state.category === 'All' || p.category === state.category)
    && (!f.color || p.colors.some((c) => c.name === f.color))
    && (!f.size || p.variants.some((v) => v.size === f.size && v.stock > 0 && (!f.color || v.color === f.color)))
    && (f.max >= 3000 || p.pricePaise / 100 <= f.max));
  if (f.sort === 'low') list = [...list].sort((a, b) => a.pricePaise - b.pricePaise);
  if (f.sort === 'high') list = [...list].sort((a, b) => b.pricePaise - a.pricePaise);
  if (f.sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

function stockFor(product, colour, size) {
  return product.variants.find((v) => v.color === colour && v.size === size)?.stock ?? 0;
}
function totalStock(product) {
  return product.variants.reduce((a, v) => a + v.stock, 0);
}
function lowStock(product) {
  return product.variants.some((v) => v.stock > 0 && v.stock <= 2);
}

function renderGrid() {
  const list = filteredProducts();
  $('#prodCount').textContent = `${list.length} product${list.length === 1 ? '' : 's'}`;
  $('#productGrid').innerHTML = list.map((p, i) => {
    const sold = totalStock(p) === 0;
    const onSale = p.mrpPaise > p.pricePaise;
    const first = (state.filter.color && p.colors.find((c) => c.name === state.filter.color)?.hex) || p.colors[0]?.hex || '#ccc';
    return `<article class="card reveal" style="transition-delay:${(i % 4) * 0.06}s" data-open="${esc(p.slug)}" tabindex="0" aria-label="${esc(p.name)}">
      <div class="media">
        <span class="heart" aria-hidden="true">♡</span>
        ${p.tag ? `<span class="badge">${esc(p.tag)}</span>` : ''}
        ${sold ? '<div class="soldout">Sold out</div>' : ''}
        ${teeSVG(first)}
        <div class="quick">View &amp; add</div>
      </div>
      <div class="pr">
        <span class="price">${onSale ? `<s>${rupees(p.mrpPaise)}</s>` : ''}${rupees(p.pricePaise)}</span>
        <span class="swatches">${p.colors.map((c) => `<i title="${esc(c.name)}" style="background:${esc(c.hex)}"></i>`).join('')}</span>
      </div>
      <h3>${esc(p.name)}</h3>
      <div class="stockline">${!sold && lowStock(p) ? 'Only a few left in some sizes' : ''}</div>
    </article>`;
  }).join('') || '<p class="muted">No styles in this category yet.</p>';
  observeReveals();
}

/* ---------- Product quick view ---------- */
function openProduct(slug) {
  const product = state.products.find((p) => p.slug === slug);
  if (!product) return;
  const firstInStock = product.colors.find((c) => product.variants.some((v) => v.color === c.name && v.stock > 0)) || product.colors[0];
  state.modal = { product, colour: firstInStock.name, size: null };
  $('#pmCustomise').onclick = () => { state.cz.product = product; closeModal(); location.hash = 'customise'; };
  refreshModal();
  $('#productModal').classList.add('open');
  $('#productModal').setAttribute('aria-hidden', 'false');
}

function refreshModal() {
  const { product, colour, size } = state.modal;
  if (!product) return;
  const c = product.colors.find((x) => x.name === colour) || product.colors[0];
  $('#pmArt').innerHTML = teeSVG(c.hex);
  $('#pmCat').textContent = `${product.category} · ${product.subtitle}`;
  $('#pmName').textContent = product.name;
  $('#pmPrice').innerHTML = (product.mrpPaise > product.pricePaise ? `<s style="color:var(--mid);font-weight:400;margin-right:8px">${rupees(product.mrpPaise)}</s>` : '') + rupees(product.pricePaise) + ' <span class="muted" style="font-size:13px;font-weight:400">incl. GST</span>';
  $('#pmDesc').textContent = product.description;
  $('#pmColourName').textContent = c.name;
  $('#pmColours').innerHTML = product.colors.map((x) => `<button data-colour="${esc(x.name)}" title="${esc(x.name)}" class="${x.name === colour ? 'on' : ''}" style="background:${esc(x.hex)}"></button>`).join('');
  $('#pmSizes').innerHTML = SIZES.map((s) => {
    const avail = stockFor(product, colour, s) - cartQty(product.id, colour, s);
    return `<button data-size="${s}" class="${s === size ? 'on' : ''}" ${avail <= 0 ? 'disabled' : ''}>${s}</button>`;
  }).join('');
  const avail = size ? stockFor(product, colour, size) - cartQty(product.id, colour, size) : null;
  $('#pmStock').textContent = avail === null ? '' : avail <= 0 ? `${size} is sold out in ${colour}` : avail <= 2 ? `Only ${avail} left in ${size}` : '';
}

function closeModal() {
  $('#productModal').classList.remove('open');
  $('#productModal').setAttribute('aria-hidden', 'true');
}


/* ---------- Product page ---------- */
const WISH_KEY = 'kt.wish.v1';
function wishList() { return load(WISH_KEY, []); }
function toggleWish(slug) {
  const w = wishList(); const i = w.indexOf(slug);
  if (i >= 0) w.splice(i, 1); else w.push(slug);
  try { localStorage.setItem(WISH_KEY, JSON.stringify(w)); } catch { /* blocked */ }
  return i < 0;
}

function ppLogo() {
  return '<g transform="translate(124 66)" fill="none" stroke="#e8d6a8" stroke-width="1.4"><circle r="8"/><circle r="4"/><path d="M-8 0h16M0-8v16" stroke-width=".7"/></g><text x="124" y="84" font-size="3.4" fill="#e8d6a8" text-anchor="middle" letter-spacing=".5">KALSHIT KALSHI</text>';
}
const PP_VIEWS = [
  { label: 'Front', svg: (hex) => teeSVG(hex, ppLogo()) },
  { label: 'Back', svg: (hex) => teeSVG(hex, '<text x="100" y="62" font-size="7" fill="#e8d6a8" text-anchor="middle" letter-spacing="1.5">KALSHIT KALSHI</text>') },
  { label: 'Detail', svg: (hex) => `<div class="zoom">${teeSVG(hex, ppLogo())}</div>` },
  { label: 'Flat', svg: (hex) => `<div class="flat">${teeSVG(hex)}</div>` },
];

function renderProductPage(slug) {
  const product = state.products.find((x) => x.slug === slug);
  const body = $('#productBody');
  if (!product) { body.innerHTML = '<p class="muted" style="padding:60px 0">Loading the product… <a class="link" href="#shop">Back to shop</a></p>'; return; }
  if (state.pp.product?.id !== product.id) {
    const first = product.colors.find((c0) => product.variants.some((v) => v.color === c0.name && v.stock > 0)) || product.colors[0];
    state.pp = { product, colour: first.name, size: null, img: 0, qty: 1 };
  }
  state.pp.product = product;
  const { colour, size, img } = state.pp;
  const c = product.colors.find((x) => x.name === colour) || product.colors[0];
  const off = product.mrpPaise > product.pricePaise ? Math.round((1 - product.pricePaise / product.mrpPaise) * 100) : 0;
  const avail = size ? stockFor(product, colour, size) - cartQty(product.id, colour, size) : null;
  const wished = wishList().includes(product.slug);
  const related = state.products.filter((x) => x.id !== product.id).slice(0, 4);
  body.innerHTML = `
    <nav class="crumbs"><a href="#home">Home</a> / <a href="#shop">Shop</a> / <span>${esc(product.name)}</span></nav>
    <div class="pp">
      <div class="pp-thumbs">${PP_VIEWS.map((v, i) => `<button class="${i === img ? 'on' : ''}" data-pp-img="${i}" aria-label="${v.label} view">${v.svg(c.hex)}</button>`).join('')}</div>
      <div class="pp-main" id="ppMain">${PP_VIEWS[img].svg(c.hex)}<span class="pp-tag">${PP_VIEWS[img].label}</span></div>
      <div class="pp-info">
        <p class="eyebrow">${esc(product.category)} · ${esc(product.subtitle)}</p>
        <h1>${esc(product.name)}</h1>
        <div class="pp-price"><b>${rupees(product.pricePaise)}</b>${off ? `<s>${rupees(product.mrpPaise)}</s><em>${off}% OFF</em>` : ''}</div>
        <p class="pp-desc">${esc(product.description)}</p>
        <div class="pp-group"><span class="lbl">Size</span>
          <div class="pp-sizes">${SIZES.map((z) => { const a = stockFor(product, colour, z) - cartQty(product.id, colour, z); return `<button data-pp-size="${z}" class="${z === size ? 'on' : ''}" ${a <= 0 ? 'disabled' : ''}>${z}</button>`; }).join('')}</div>
          <div class="stockline">${avail === null ? '' : avail <= 0 ? `${size} is sold out in ${esc(colour)}` : avail <= 2 ? `Only ${avail} left in ${size}` : ''}</div>
        </div>
        <div class="pp-group"><span class="lbl">Color: <b style="color:var(--ink);text-transform:none;letter-spacing:0">${esc(colour)}</b></span>
          <div class="pp-cols">${product.colors.map((x) => `<button data-pp-colour="${esc(x.name)}" title="${esc(x.name)}" class="${x.name === colour ? 'on' : ''}" style="background:${esc(x.hex)}"></button>`).join('')}</div>
        </div>
        <div class="pp-buy">
          <button class="btn" id="ppAdd"><span>Add to Cart</span></button>
          <button class="btn buy" id="ppBuy"><span>Buy Now</span></button>
        </div>
        <button class="pp-wish ${wished ? 'on' : ''}" data-pp-wish>${wished ? '♥ Saved to wishlist' : '♡ Add to Wishlist'}</button>
        <a class="link" href="#customise" data-pp-custom style="align-self:flex-start;margin-top:6px">Customise this tee</a>
        <ul class="pp-perks"><li>Free delivery over ₹999</li><li>7-day easy returns</li><li>GST invoice on every order</li><li>Pre-shrunk, 240 GSM cotton</li></ul>
      </div>
    </div>
    <h2 class="pp-rel-h">You may also like</h2>
    <div class="grid pp-rel">${related.map((r) => `<article class="card in" data-open="${esc(r.slug)}" tabindex="0"><div class="media">${teeSVG(r.colors[0]?.hex || '#ccc')}</div><div class="pr"><span class="price">${rupees(r.pricePaise)}</span></div><h3>${esc(r.name)}</h3></article>`).join('')}</div>`;
}

function handleProductPageClick(t) {
  if (!t.closest('[data-view=product]')) return false;
  const pp = state.pp;
  const im = t.closest('[data-pp-img]');
  if (im) { pp.img = Number(im.dataset.ppImg); renderProductPage(pp.product.slug); return true; }
  const co = t.closest('[data-pp-colour]');
  if (co) {
    pp.colour = co.dataset.ppColour;
    if (pp.size && stockFor(pp.product, pp.colour, pp.size) - cartQty(pp.product.id, pp.colour, pp.size) <= 0) pp.size = null;
    renderProductPage(pp.product.slug); return true;
  }
  const sz = t.closest('[data-pp-size]');
  if (sz) { pp.size = sz.dataset.ppSize; renderProductPage(pp.product.slug); return true; }
  if (t.closest('[data-pp-wish]')) { const on = toggleWish(pp.product.slug); toast(on ? 'Saved to wishlist' : 'Removed from wishlist'); renderProductPage(pp.product.slug); return true; }
  if (t.closest('[data-pp-custom]')) { state.cz.product = pp.product; return false; }
  const add = t.closest('#ppAdd'); const buy = t.closest('#ppBuy');
  if (add || buy) {
    if (!pp.size) { const box = $('.pp-info'); box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake'); toast('Choose a size first', { error: true }); return true; }
    if (addToBag({ product: pp.product, colour: pp.colour, size: pp.size })) {
      if (buy) location.hash = 'checkout'; else { renderProductPage(pp.product.slug); openBag(true); }
    }
    return true;
  }
  return false;
}

/* ---------- Bag ---------- */
function cartQty(productId, colour, size) {
  return state.cart.filter((l) => l.productId === productId && l.colour === colour && l.size === size).reduce((a, l) => a + l.qty, 0);
}

function lineKey(l) { return [l.productId, l.colour, l.size, l.customText, l.customFont, l.customPlace].join('|'); }

function addToBag({ product, colour, size, qty = 1, customText = '', customFont = '', customPlace = '' }) {
  const available = stockFor(product, colour, size) - cartQty(product.id, colour, size);
  if (available < qty) { toast(`Only ${Math.max(available, 0)} left in ${size} ${colour}.`, { error: true }); return false; }
  const key = [product.id, colour, size, customText, customFont, customPlace].join('|');
  const existing = state.cart.find((l) => lineKey(l) === key);
  if (existing) existing.qty += qty;
  else state.cart.push({ productId: product.id, slug: product.slug, name: product.name, colour, size, qty, customText, customFont, customPlace });
  persistCart();
  renderBag();
  bumpCount();
  return true;
}

function bumpCount() {
  const el = $('#bagCount');
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

function cartTotals() {
  let subtotal = 0;
  let items = 0;
  for (const l of state.cart) {
    const p = state.products.find((x) => x.id === l.productId);
    if (!p) continue;
    const unit = p.pricePaise + (l.customText ? (state.store?.customPrintFeePaise || 0) : 0);
    subtotal += unit * l.qty;
    items += l.qty;
  }
  const shipping = subtotal === 0 || subtotal >= (state.store?.freeShippingOverPaise ?? 99900) ? 0 : (state.store?.shippingFeePaise ?? 9900);
  return { subtotal, shipping, total: subtotal + shipping, items };
}

function renderBag() {
  const { items } = cartTotals();
  $('#bagCount').textContent = items;
  const body = $('#bagBody');
  const foot = $('#bagFoot');
  const valid = state.cart.filter((l) => state.products.some((p) => p.id === l.productId));
  if (!valid.length) {
    body.innerHTML = `<div class="empty"><b>Your bag is empty.</b>Browse the drop or design your own tee.</div>`;
    foot.innerHTML = `<a class="btn ghost block" href="#shop" data-close-bag><span>Shop the drop</span></a>`;
    return;
  }
  body.innerHTML = valid.map((l, i) => {
    const p = state.products.find((x) => x.id === l.productId);
    const hex = p.colors.find((c) => c.name === l.colour)?.hex || '#ccc';
    const avail = stockFor(p, l.colour, l.size);
    const warn = l.qty > avail ? `<div class="stockline">Only ${avail} left. Reduce the quantity.</div>` : '';
    return `<div class="line">
      <div class="thumb">${teeSVG(hex)}</div>
      <div class="info">
        <div class="nm">${esc(l.name)}</div>
        <div class="meta">${esc(l.colour)} · ${esc(l.size)}${l.customText ? ` · Print “${esc(l.customText)}” (${esc(l.customPlace)})` : ''}</div>
        <div class="meta" style="color:var(--ink);font-weight:600">${rupees(p.pricePaise + (l.customText ? (state.store?.customPrintFeePaise || 0) : 0))}</div>
        <div class="qty"><button data-dec="${i}" aria-label="Decrease">−</button><span>${l.qty}</span><button data-inc="${i}" aria-label="Increase">+</button></div>
        <button class="rm" data-rm="${i}">Remove</button>
        ${warn}
      </div>
    </div>`;
  }).join('');
  const t = cartTotals();
  foot.innerHTML = `
    <div class="sumrow"><span>Subtotal</span><span>${rupeesExact(t.subtotal)}</span></div>
    <div class="sumrow"><span>Delivery</span><span>${t.shipping ? rupeesExact(t.shipping) : 'Free'}</span></div>
    <div class="sumrow small muted"><span>GST included in prices</span><span></span></div>
    <div class="sumrow total"><span>Total</span><span>${rupeesExact(t.total)}</span></div>
    <button class="btn block" id="goCheckout"><span>Checkout</span></button>`;
}

function openBag(open) {
  $('#drawer').classList.toggle('open', open);
  $('#overlay').classList.toggle('open', open);
  if (open) renderBag();
}

/* ---------- Checkout ---------- */
function renderCheckout() {
  const valid = state.cart.filter((l) => state.products.some((p) => p.id === l.productId));
  if (!valid.length) {
    $('#checkoutBody').innerHTML = `<div class="empty"><b>Your bag is empty.</b><a class="btn" href="#shop" style="margin-top:20px"><span>Shop the drop</span></a></div>`;
    return;
  }
  const t = cartTotals();
  const c = state.customer || {};
  $('#checkoutBody').innerHTML = `
    <div class="view-head"><p class="eyebrow">Checkout</p><h1>Almost <span class="gold-text">yours</span>.</h1></div>
    <div class="co">
      <form class="panel" id="coForm" novalidate>
        <h3>Delivery details</h3>
        <div class="row2">
          <div class="field"><label for="coName">Full name</label><input type="text" id="coName" name="name" required value="${esc(c.name || '')}" autocomplete="name"></div>
          <div class="field"><label for="coPhone">Mobile (10 digits)</label><input type="tel" id="coPhone" name="phone" required pattern="[0-9]{10}" value="${esc(c.phone || '')}" autocomplete="tel"></div>
        </div>
        <div class="field"><label for="coEmail">Email (for invoices)</label><input type="email" id="coEmail" name="email" value="${esc(c.email || '')}" autocomplete="email"></div>
        <div class="field"><label for="coAddr">Address</label><input type="text" id="coAddr" name="address" required autocomplete="street-address"></div>
        <div class="row3">
          <div class="field"><label for="coCity">City</label><input type="text" id="coCity" name="city" required autocomplete="address-level2"></div>
          <div class="field"><label for="coState">State</label><input type="text" id="coState" name="state" autocomplete="address-level1"></div>
          <div class="field"><label for="coPin">PIN code</label><input type="text" id="coPin" name="pin" required pattern="[0-9]{6}" inputmode="numeric" autocomplete="postal-code"></div>
        </div>
        <div class="eta" id="coEta"></div>
        <h3 style="margin-top:26px">Payment</h3>
        <div class="pay"><span><b>UPI, cards and NetBanking</b><small>Google Pay, PhonePe and all major banks. You'll pay on Razorpay's secure screen.</small></span></div>
        <button class="btn block" type="submit" id="coPay" style="margin-top:18px"><span>Pay ${rupeesExact(t.total)}</span></button>
        <div class="error-text" id="coError"></div>
      </form>
      <aside class="panel">
        <h3>Order summary</h3>
        ${valid.map((l) => {
          const p = state.products.find((x) => x.id === l.productId);
          const hex = p.colors.find((x) => x.name === l.colour)?.hex || '#ccc';
          return `<div class="sumitem"><div class="thumb">${teeSVG(hex)}</div><div style="flex:1"><div style="font-family:var(--display);font-weight:700">${esc(l.name)}</div><div class="muted small">${esc(l.colour)} · ${esc(l.size)} × ${l.qty}${l.customText ? ` · “${esc(l.customText)}”` : ''}</div></div><div style="font-weight:700">${rupees((p.pricePaise + (l.customText ? (state.store?.customPrintFeePaise || 0) : 0)) * l.qty)}</div></div>`;
        }).join('')}
        <div style="margin-top:16px;display:grid;gap:8px">
          <div class="sumrow"><span>Subtotal</span><span>${rupeesExact(t.subtotal)}</span></div>
          <div class="sumrow"><span>Delivery</span><span>${t.shipping ? rupeesExact(t.shipping) : 'Free'}</span></div>
          <div class="sumrow total"><span>Total</span><span>${rupeesExact(t.total)}</span></div>
        </div>
      </aside>
    </div>`;

  const pin = $('#coPin');
  pin.addEventListener('input', debounce(async () => {
    const v = pin.value.trim();
    const eta = $('#coEta');
    if (!/^\d{6}$/.test(v)) { eta.textContent = ''; return; }
    try {
      const r = await api(`/api/shipping/estimate?pin=${v}`);
      if (!r.serviceable) eta.innerHTML = `<span style="color:var(--bad)">Sorry, we don't deliver to this PIN yet.</span>`;
      else if (r.source === 'courier') eta.textContent = `Estimated delivery in ${r.days} days via ${r.courier}`;
      else eta.textContent = `Estimated delivery in ${r.days} business days`;
    } catch (err) { eta.textContent = err.message; }
  }, 350));
  if (c.name && pin.value === '') pin.focus();
  $('#coForm').addEventListener('submit', submitCheckout);
}

async function submitCheckout(e) {
  e.preventDefault();
  const form = e.target;
  const err = $('#coError');
  err.textContent = '';
  const fd = Object.fromEntries(new FormData(form));
  const customer = {
    name: fd.name.trim(), phone: fd.phone.trim(), email: (fd.email || '').trim(),
    address: fd.address.trim(), city: fd.city.trim(), state: (fd.state || '').trim(), pin: fd.pin.trim(),
  };
  if (!form.checkValidity()) { err.textContent = 'Please check the highlighted fields.'; form.reportValidity(); return; }

  const items = state.cart.filter((l) => state.products.some((p) => p.id === l.productId)).map((l) => ({
    productId: l.productId, color: l.colour, size: l.size, qty: l.qty,
    customText: l.customText || undefined, customFont: l.customFont || undefined, customPlace: l.customPlace || undefined,
  }));

  const btn = $('#coPay');
  btn.disabled = true;
  btn.querySelector('span').textContent = 'Starting payment…';
  try {
    const order = await api('/api/orders', { method: 'POST', body: { items, customer } });
    if (order.mode === 'dev') {
      await api(`/api/orders/${order.orderId}/dev-pay`, { method: 'POST' });
      finishOrder(order.orderId, order.amountPaise);
    } else {
      await openRazorpay(order, customer);
    }
  } catch (error) {
    err.textContent = error.message;
    if (error.status === 409) await loadCatalogue().catch(() => {});
  } finally {
    btn.disabled = false;
    btn.querySelector('span').textContent = `Pay ${rupeesExact(cartTotals().total)}`;
  }
}

let razorpayScript = null;
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  if (!razorpayScript) {
    razorpayScript = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load the payment window. Check your connection.'));
      document.head.appendChild(s);
    });
  }
  return razorpayScript;
}

async function openRazorpay(order, customer) {
  await loadRazorpay();
  const rzp = new window.Razorpay({
    key: order.razorpayKeyId,
    amount: order.amountPaise,
    currency: order.currency,
    name: state.store?.brand || 'Store',
    description: `Order ${order.orderId}`,
    order_id: order.razorpayOrderId,
    prefill: { name: customer.name, email: customer.email, contact: customer.phone },
    theme: { color: '#b3402d' },
    handler: async (resp) => {
      try {
        await api(`/api/orders/${order.orderId}/verify`, {
          method: 'POST',
          body: {
            razorpay_order_id: resp.razorpay_order_id,
            razorpay_payment_id: resp.razorpay_payment_id,
            razorpay_signature: resp.razorpay_signature,
          },
        });
        finishOrder(order.orderId, order.amountPaise);
      } catch (error) {
        $('#coError').textContent = `Payment received but not confirmed yet: ${error.message}. We'll update your order shortly.`;
      }
    },
    modal: { ondismiss: () => toast('Payment cancelled. Your bag is unchanged.') },
  });
  rzp.on('payment.failed', (r) => {
    $('#coError').textContent = `Payment failed: ${r.error?.description || 'please try again'}.`;
  });
  rzp.open();
}

function finishOrder(orderId, amountPaise) {
  state.cart = [];
  persistCart();
  renderBag();
  sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify({ orderId, amountPaise, phone: state.customer?.phone || '' }));
  location.hash = 'confirm';
}

function renderConfirm() {
  const last = load(LAST_ORDER_KEY, null);
  if (!last) {
    $('#confirmBody').innerHTML = `<div class="empty"><b>No recent order.</b><a class="btn" href="#shop" style="margin-top:20px"><span>Shop the drop</span></a></div>`;
    return;
  }
  const signedIn = Boolean(state.customer);
  $('#confirmBody').innerHTML = `
    <div class="confirm">
      <div class="tick" aria-hidden="true">✓</div>
      <p class="eyebrow">Order confirmed</p>
      <h1 class="big" style="margin:14px 0 18px">Thank <span class="gold-text">you</span>.</h1>
      <p class="muted">Order <b style="color:var(--ink)">${esc(last.orderId)}</b> · ${rupeesExact(last.amountPaise)}</p>
      <p class="muted" style="margin-top:10px">We've sent confirmation to your mobile. Your GST invoice is ready to download.</p>
      <div class="actions">
        ${signedIn
          ? `<a class="btn" href="/api/orders/${esc(last.orderId)}/invoice.pdf"><span>Download invoice (PDF)</span></a>`
          : `<a class="btn" href="#account"><span>Sign in to download invoice</span></a>`}
        <button class="btn ghost" id="confirmTrack"><span>Track this order</span></button>
        <a class="link" href="#shop">Keep shopping</a>
      </div>
    </div>`;
  $('#confirmTrack').onclick = () => {
    state.trackPrefill = { orderId: last.orderId, phone: last.phone };
    location.hash = 'track';
  };
}

/* ---------- Tracking ---------- */
const STEP_ORDER = ['paid', 'packed', 'shipped', 'delivered'];
function renderTrack(o) {
  const at = STEP_ORDER.indexOf(o.status);
  const cancelled = o.status === 'cancelled' || o.status === 'payment_failed';
  const liveRows = (o.live?.activities || []).map((a) => `<li><b>${esc(a.activity || '')}</b><span>${esc(a.location || '')} · ${esc(a.at || '')}</span></li>`).join('');
  const steps = [
    { label: 'Order Placed', sub: o.paidAt ? new Date(o.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '' },
    { label: 'Packed', sub: '' },
    { label: 'Shipped', sub: o.courierName || '' },
    { label: 'Delivered', sub: '' },
  ];
  const pct = cancelled ? 0 : Math.max(0, Math.min(at, 3)) / 3;
  // Illustrative route: the truck sits along the curve in proportion to the order stage.
  const route = 'M30,150 C110,40 190,170 270,80 S410,60 470,100';
  $('#trOut').innerHTML = `
    <div class="panel trk">
      <div class="trk-top">
        <div>
          <p class="eyebrow">Order #${esc(o.orderId)}</p>
          <h3>${cancelled ? 'Cancelled' : labelFor(o.status)}</h3>
          ${o.invoiceNo ? `<p class="muted small">Invoice ${esc(o.invoiceNo)}</p>` : ''}
        </div>
        <span class="trk-pill ${cancelled ? 'bad' : o.status === 'delivered' ? 'ok' : ''}">${cancelled ? 'Cancelled' : labelFor(o.status)}</span>
      </div>
      <ol class="stepper" style="--p:${pct}">
        ${steps.map((st, i) => `<li class="${!cancelled && at >= i ? 'done' : ''} ${!cancelled && at === i ? 'now' : ''}"><i>${!cancelled && at >= i ? '✓' : ''}</i><b>${st.label}</b><small>${esc(st.sub)}</small></li>`).join('')}
      </ol>
      ${cancelled ? '' : `<div class="trk-map">
        <svg viewBox="0 0 500 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <rect width="500" height="200" fill="#e9eef3"/>
          <path d="M0,60 Q120,20 240,70 T500,40 V0 H0Z" fill="#d7e6f3"/>
          <path d="M0,180 Q150,130 300,170 T500,150 V200 H0Z" fill="#dfe9d6"/>
          <g stroke="#fff" stroke-width="6" fill="none"><path d="M0,120 H500"/><path d="M130,0 V200"/><path d="M360,0 V200"/></g>
          <path d="${route}" fill="none" stroke="#c4cbd3" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 9"/>
          <path d="${route}" fill="none" stroke="#2563eb" stroke-width="5" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="${1 - pct}"/>
          <circle cx="30" cy="150" r="8" fill="#111"/><circle cx="470" cy="100" r="8" fill="#2f6b3d"/>
        </svg>
        <div class="truck" style="offset-path:path('${route}');offset-distance:${Math.round(pct * 100)}%">🚚</div>
        <span class="trk-note">Illustrative route. Live courier updates appear below once shipped.</span>
      </div>`}
      ${liveRows ? `<ul class="trk-log">${liveRows}</ul>` : (o.awb ? `<p class="muted small" style="margin-top:14px">${esc(o.courierName || 'Courier')} · AWB ${esc(o.awb)}${o.live?.status ? ' · ' + esc(o.live.status) : ''}</p>` : '')}
    </div>`;
}

function labelFor(status) {
  return ({ paid: 'Preparing your order', packed: 'Packed, awaiting pickup', shipped: 'On its way', delivered: 'Delivered' })[status] || status;
}

async function lookupOrder(orderId, phone) {
  const err = $('#trError');
  err.textContent = '';
  try {
    const o = await api(`/api/shipping/track?orderId=${encodeURIComponent(orderId)}&phone=${encodeURIComponent(phone)}`);
    renderTrack({ ...o, orderId: o.orderId });
  } catch (e) {
    $('#trOut').innerHTML = '';
    err.textContent = e.message;
  }
}

/* ---------- Account ---------- */
async function renderAccount() {
  const body = $('#accountBody');
  if (!state.customer) {
    body.innerHTML = `
      <div class="view-head"><p class="eyebrow">Your account</p><h1>Sign <span class="gold-text">in</span>.</h1><p>Use your mobile number with a one-time code. Your orders and invoices appear here.</p></div>
      <div class="panel" id="otpBox">
        <form id="otpPhoneForm">
          <div class="field"><label for="otpPhone">Mobile number</label><input type="tel" id="otpPhone" required pattern="[0-9]{10}" placeholder="10 digits" autocomplete="tel" value="${esc(state.otpPhone)}"></div>
          <button class="btn block" type="submit"><span>Send code</span></button>
        </form>
        <div class="error-text" id="otpError"></div>
      </div>
      <div id="googleBox" style="margin-top:18px"></div>`;
    $('#otpPhoneForm').addEventListener('submit', sendOtp);
    initGoogle();
    return;
  }
  const c = state.customer;
  const tab = state.acctTab || 'orders';
  const nav = [['orders', 'Orders', '▤'], ['wishlist', 'Wishlist', '♡'], ['profile', 'Profile', '☺']];
  body.innerHTML = `
    <div class="acct">
      <aside class="acct-side">
        <div class="acct-who"><div class="av">${esc((c.name || 'K')[0].toUpperCase())}</div><div><b>My Account</b><small>${esc(c.name || c.phone || '')}</small></div></div>
        ${nav.map(([k, l, ic]) => `<button class="${k === tab ? 'on' : ''}" data-acct-tab="${k}"><i>${ic}</i>${l}</button>`).join('')}
        <button id="logoutBtn" type="button"><i>⇥</i>Logout</button>
      </aside>
      <section class="acct-main" id="acctMain"></section>
    </div>`;
  $('#logoutBtn').onclick = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.customer = null;
    toast('Signed out');
    renderAccount();
  };
  const main = $('#acctMain');
  if (tab === 'profile') {
    main.innerHTML = `
      <h2>Profile</h2>
      <form class="panel" id="profileForm">
        <div class="row2">
          <div class="field"><label for="pfName">Name</label><input type="text" id="pfName" name="name" value="${esc(c.name)}" maxlength="80"></div>
          <div class="field"><label for="pfEmail">Email (for invoices)</label><input type="email" id="pfEmail" name="email" value="${esc(c.email)}" maxlength="120"></div>
        </div>
        <button class="btn sm" type="submit"><span>Save</span></button>
        <div class="error-text" id="pfError"></div>
      </form>`;
    $('#profileForm').addEventListener('submit', saveProfile);
    return;
  }
  if (tab === 'wishlist') {
    const items = wishList().map((sl) => state.products.find((p) => p.slug === sl)).filter(Boolean);
    main.innerHTML = `<h2>Wishlist</h2>${items.length
      ? `<div class="grid">${items.map((p) => `<article class="card in" data-open="${esc(p.slug)}" tabindex="0"><div class="media">${teeSVG(p.colors[0]?.hex || '#ccc')}</div><div class="pr"><span class="price">${rupees(p.pricePaise)}</span></div><h3>${esc(p.name)}</h3></article>`).join('')}</div>`
      : '<p class="muted">Nothing saved yet. Tap "Add to Wishlist" on any product.</p>'}`;
    return;
  }
  main.innerHTML = '<h2>My Orders</h2><div class="orders" id="ordersBox"><p class="muted">Loading…</p></div>';
  try {
    const { orders } = await api('/api/orders/mine');
    $('#ordersBox').innerHTML = orders.length ? orders.map(orderCard).join('') : '<p class="muted">No orders yet. Your purchases will appear here.</p>';
  } catch (e) {
    $('#ordersBox').innerHTML = `<p class="error-text">${esc(e.message)}</p>`;
  }
}

function orderCard(o) {
  const first = o.items[0];
  const prod = state.products.find((p) => p.name === first?.productName);
  const hex = prod?.colors.find((c) => c.name === first?.color)?.hex || prod?.colors[0]?.hex || '#14120f';
  const items = o.items.map((i) => `${esc(i.productName)} (${esc(i.color)}, ${esc(i.size)}) × ${i.qty}`).join('<br>');
  const label = { paid: 'Processing', packed: 'Packed', shipped: 'Out for Delivery', delivered: 'Delivered', cancelled: 'Cancelled', payment_failed: 'Payment failed', pending: 'Awaiting payment' }[o.status] || o.status.replace('_', ' ');
  return `<div class="order">
    <div class="top">
      <div><div class="id">Order #${esc(o.id)}</div><div class="muted small">Placed on ${new Date(o.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>
      <span class="pill ${esc(o.status)}"><i></i>${esc(label)}</span>
    </div>
    <div class="ord-body">
      <div class="ord-th">${teeSVG(hex)}</div>
      <div class="small ord-items">${items}</div>
      <b class="ord-amt">${rupeesExact(o.totalPaise)}</b>
    </div>
    <div class="acts">
      <button class="btn sm" data-track-order="${esc(o.id)}"><span>Track Package</span></button>
      ${o.invoiceNo ? `<a class="btn sm ghost" href="/api/orders/${esc(o.id)}/invoice.pdf"><span>GST invoice (PDF)</span></a>` : ''}
    </div>
  </div>`;
}

async function sendOtp(e) {
  e.preventDefault();
  const phone = $('#otpPhone').value.trim();
  $('#otpError').textContent = '';
  try {
    const r = await api('/api/auth/otp/request', { method: 'POST', body: { phone } });
    state.otpPhone = phone;
    $('#otpBox').innerHTML = `
      <form id="otpVerifyForm">
        <p class="muted" style="margin-bottom:14px">Enter the 6-digit code sent to ${esc(phone.slice(0, 2))}••••••${esc(phone.slice(-2))}.</p>
        ${r.devCode ? `<div class="notice">Development mode: no SMS provider is connected, so the code is <b>${esc(r.devCode)}</b>.</div>` : ''}
        <div class="field"><label for="otpCode">One-time code</label><input type="text" id="otpCode" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code"></div>
        <button class="btn block" type="submit"><span>Verify and sign in</span></button>
        <div class="error-text" id="otpError"></div>
      </form>`;
    $('#otpVerifyForm').addEventListener('submit', verifyOtp);
    $('#otpCode').focus();
  } catch (err) {
    $('#otpError').textContent = err.message;
  }
}

async function verifyOtp(e) {
  e.preventDefault();
  $('#otpError').textContent = '';
  try {
    const { customer } = await api('/api/auth/otp/verify', { method: 'POST', body: { phone: state.otpPhone, code: $('#otpCode').value.trim() } });
    state.customer = customer;
    toast('Signed in');
    renderAccount();
  } catch (err) {
    $('#otpError').textContent = err.message;
  }
}

async function saveProfile(e) {
  e.preventDefault();
  $('#pfError').textContent = '';
  try {
    const f = Object.fromEntries(new FormData(e.target));
    const { customer } = await api('/api/auth/profile', { method: 'POST', body: { name: f.name, email: f.email } });
    state.customer = customer;
    toast('Saved');
  } catch (err) {
    $('#pfError').textContent = err.message;
  }
}

function initGoogle() {
  const clientId = state.store?.googleClientId;
  if (!clientId) {
    $('#googleBox').innerHTML = `<p class="muted small" style="text-align:center">Google sign-in will appear here once it's connected.</p>`;
    return;
  }
  const go = () => {
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async (resp) => {
        try {
          const { customer } = await api('/api/auth/google', { method: 'POST', body: { credential: resp.credential } });
          state.customer = customer;
          toast('Signed in with Google');
          renderAccount();
        } catch (err) { toast(err.message, { error: true }); }
      },
    });
    window.google.accounts.id.renderButton($('#googleBox'), { theme: 'filled_black', size: 'large', shape: 'rectangular', width: 320 });
  };
  if (window.google?.accounts?.id) return go();
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.onload = go;
  document.head.appendChild(s);
}

/* ---------- Stylist (chat) ---------- */
const chat = { profile: {}, started: false, busy: false };

function chatAdd(html, who = 'bot') {
  const log = $('#chatLog');
  const d = document.createElement('div');
  d.className = `msg ${who}`;
  d.innerHTML = html;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  return d;
}

function chatChips(list) {
  $('#chatChips').innerHTML = list.map((t) => `<button type="button" data-chat-chip="${esc(t)}">${esc(t)}</button>`).join('');
}

function chatStart() {
  if (chat.started) return;
  chat.started = true;
  chat.profile = {};
  $('#chatLog').innerHTML = '';
  chatAdd('Hi! I\'m your style buddy. Tell me your <b>height, weight and build</b> and I\'ll suggest your size and a few tees from what\'s in stock.');
  chatAdd('For example: <i>"5\'10", 72 kg, slim build, for office"</i>');
  chatChips(['5\'10", 72 kg, slim', '170 cm, 65 kg, regular, college', '180 cm, 85 kg, athletic, gym']);
}

// Pull height / weight / build / fit / occasion / budget out of a free-text message.
function parseProfile(text) {
  const t = text.toLowerCase();
  const out = {};
  let m = t.match(/(\d)\s*(?:'|ft|feet|foot)\s*(\d{1,2})?/);
  if (m) out.heightCm = Math.round(Number(m[1]) * 30.48 + Number(m[2] || 0) * 2.54);
  m = t.match(/(\d{3})\s*cm/);
  if (m) out.heightCm = Number(m[1]);
  m = t.match(/(\d{2,3})\s*(?:kg|kgs|kilo)/);
  if (m) out.weightKg = Number(m[1]);
  if (!out.heightCm || !out.weightKg) {
    const nums = (t.match(/\b\d{2,3}\b/g) || []).map(Number);
    const h = nums.find((n) => n >= 140 && n <= 215);
    const w = nums.find((n) => n >= 40 && n <= 139 && n !== h);
    if (!out.heightCm && h) out.heightCm = h;
    if (!out.weightKg && w) out.weightKg = w;
  }
  for (const b of ['slim', 'regular', 'athletic', 'broad']) if (t.includes(b)) out.build = b;
  if (/oversize|relaxed|loose/.test(t)) out.fit = 'oversized';
  else if (/slim fit/.test(t)) out.fit = 'slim';
  if (/office|smart|formal|work/.test(t)) out.occasion = 'office';
  else if (/gym|active|sport|run/.test(t)) out.occasion = 'gym';
  else if (/college|weekend|campus/.test(t)) out.occasion = 'college';
  else if (/casual|everyday|daily/.test(t)) out.occasion = 'casual';
  m = t.match(/(?:under|budget|below|within|₹|rs\.?)\s*(\d{3,5})/);
  if (m) out.budgetRupees = Number(m[1]);
  return out;
}

async function chatSend(text) {
  text = (text || '').trim();
  if (!text || chat.busy) return;
  chatAdd(esc(text), 'me');
  chatChips([]);
  Object.assign(chat.profile, parseProfile(text));
  const pr = chat.profile;
  if (!pr.heightCm || !pr.weightKg) {
    const need = !pr.heightCm && !pr.weightKg ? 'height and weight' : !pr.heightCm ? 'height' : 'weight';
    chatAdd(`Thanks! I still need your <b>${need}</b> (like <i>175 cm</i> or <i>72 kg</i>).`);
    return;
  }
  chat.busy = true;
  const typing = chatAdd('<i></i><i></i><i></i>', 'bot');
  typing.classList.add('typing');
  try {
    const r = await api('/api/stylist', {
      method: 'POST',
      body: {
        heightCm: pr.heightCm, weightKg: pr.weightKg, build: pr.build || 'regular', fit: pr.fit || 'regular',
        occasion: pr.occasion || 'casual', budgetRupees: pr.budgetRupees || null, notes: text.slice(0, 300),
      },
    });
    typing.remove();
    chatAdd(`Your size is <span class="sizechip">${esc(r.size)}</span><br>${esc(r.note)}<small>${r.source === 'ai' ? 'AI stylist' : 'Fit guide'} · ${pr.heightCm} cm, ${pr.weightKg} kg</small>`);
    if (r.picks.length) {
      chatAdd('Here are some perfect picks for you:');
      const box = document.createElement('div');
      box.className = 'picks';
      box.innerHTML = r.picks.map((pk) => {
        const p = pk.product;
        const hex = p.colors.find((c) => c.name === pk.colour)?.hex || p.colors[0].hex;
        return `<div class="pick" data-open="${esc(p.slug)}" tabindex="0"><div class="th">${teeSVG(hex)}</div><b>${esc(p.name)}</b><span>${esc(pk.colour)} · ${rupees(p.pricePaise)}</span></div>`;
      }).join('');
      $('#chatLog').appendChild(box);
      $('#chatLog').scrollTop = $('#chatLog').scrollHeight;
    } else {
      chatAdd('No matching styles are in stock right now. Try a different fit or a higher budget.');
    }
    chatChips(['Show something oversized', 'Under ₹1500', 'For the gym', 'Start over']);
  } catch (err) {
    typing.remove();
    chatAdd(`Sorry, I couldn't fetch picks: ${esc(err.message)}`);
  } finally {
    chat.busy = false;
  }
}

/* ---------- Customiser ---------- */
let czScene = null;
let czLoading = null;

function renderCustomiserBase() {
  const sel = $('#czProduct');
  if (!sel) return;
  if (!state.cz.product) state.cz.product = state.products[0];
  const current = state.cz.product?.id;
  sel.innerHTML = state.products.map((p) => `<option value="${p.id}" ${p.id === current ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const p = state.products.find((x) => x.id === Number(sel.value)) || state.products[0];
  if (!state.cz.colour || !p.colors.some((c) => c.name === state.cz.colour)) state.cz.colour = p.colors[0].name;
  state.cz.product = p;
  renderCzControls();
}

function renderCzControls() {
  const { product, colour, size, text, font, place } = state.cz;
  if (!product) return;
  $('#czColours').innerHTML = product.colors.map((c) => `<button data-cz-colour="${esc(c.name)}" title="${esc(c.name)}" class="${c.name === colour ? 'on' : ''}" style="background:${esc(c.hex)}"></button>`).join('');
  $('#czColourName').textContent = colour || '';
  const sizes = SIZES.map((s) => {
    const avail = stockFor(product, colour, s);
    return `<button data-cz-size="${s}" class="${s === size ? 'on' : ''}" ${avail <= 0 ? 'disabled' : ''}>${s}</button>`;
  }).join('');
  $('#czSizes').innerHTML = sizes;
  const chosen = size && stockFor(product, colour, size) > 0 ? size : null;
  if (!chosen) {
    const firstAvail = SIZES.find((s) => stockFor(product, colour, s) > 0);
    state.cz.size = firstAvail || null;
  }
  const price = product.pricePaise + (text ? (state.store?.customPrintFeePaise || 0) : 0);
  $('#czPrice').textContent = rupeesExact(price);
  $('#czPriceNote').textContent = text ? `Includes ${rupees(state.store?.customPrintFeePaise || 0)} for your custom print. GST included.` : 'GST included. Add a name or print for an extra fee.';
  const avail = state.cz.size ? stockFor(product, colour, state.cz.size) - cartQty(product.id, colour, state.cz.size) : 0;
  $('#czStock').textContent = !state.cz.size ? 'Sold out in this colour' : avail <= 2 ? `Only ${Math.max(avail, 0)} left in ${state.cz.size}` : '';
  $('#czAdd').disabled = !state.cz.size;
  refreshCustomiser();
}

function refreshCustomiser() {
  if (!czScene || !state.cz.product) return;
  const c = state.cz.product.colors.find((x) => x.name === state.cz.colour) || state.cz.product.colors[0];
  czScene.setTee(c.hex);
  czScene.setPrint({ text: state.cz.text, font: state.cz.font, place: state.cz.place, tee: c.hex });
}

async function ensureCustomiser() {
  if (czScene || czLoading) return;
  czLoading = import('./customizer.js')
    .then((m) => m.createCustomiser($('#czStage')))
    .then((scene) => { czScene = scene; refreshCustomiser(); })
    .catch(() => { $('#czFallback').hidden = false; });
}

/* ---------- Scroll, reveal, live stock ---------- */
let revealObserver = null;
function observeReveals() {
  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); revealObserver.unobserve(en.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  }
  $$('.reveal:not(.in), .card:not(.in)').forEach((el) => revealObserver.observe(el));
}

function onScroll() {
  $('#siteHeader').classList.toggle('scrolled', scrollY > 30);
  const hero = $('#heroStage');
  if (hero && !$('[data-view=home]').hidden) {
    const p = Math.min(scrollY / innerHeight, 1);
    hero.style.transform = `translateY(${p * 60}px)`;
    hero.style.opacity = String(1 - p * 0.5);
    const ph = $('.hero-photo img');
    if (ph) ph.style.translate = `0 ${p * 70}px`;
  }
}

function connectLiveStock() {
  try {
    const es = new EventSource('/api/stream');
    es.addEventListener('stock', debounce(() => {
      loadCatalogue().then(() => {
        $('#topStatus').textContent = 'Stock updated just now';
      }).catch(() => {});
    }, 250));
    es.onerror = () => { $('#topStatus').textContent = 'Live stock reconnecting…'; };
    es.onopen = () => { $('#topStatus').textContent = 'Live stock'; };
  } catch { /* EventSource unsupported */ }
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ---------- Router ---------- */
function setNav(view) {
  $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === view));
}

function route() {
  const hash = location.hash.replace('#', '') || 'home';
  let view = 'home';
  let anchor = null;
  if (['shop', 'reviews', 'story'].includes(hash)) anchor = hash;
  else if (hash.startsWith('product/')) view = 'product';
  else if (VIEWS.includes(hash)) view = hash;
  $$('[data-view]').forEach((s) => { s.hidden = s.dataset.view !== view; });
  setNav(view === 'home' || view === 'product' ? 'shop' : view);
  $('#mobileNav').classList.remove('open');

  if (view === 'customise') { state.cz.product = state.cz.product || state.products[0]; renderCustomiserBase(); ensureCustomiser(); }
  if (view === 'product') renderProductPage(hash.slice(8));
  if (view === 'stylist') chatStart();
  if (view === 'checkout') renderCheckout();
  if (view === 'confirm') renderConfirm();
  if (view === 'account') renderAccount();
  if (view === 'track') {
    if (state.trackPrefill) { $('#trId').value = state.trackPrefill.orderId; $('#trPhone').value = state.trackPrefill.phone || ''; state.trackPrefill = null; }
  }
  if (view !== 'home' || !anchor) window.scrollTo({ top: 0, behavior: 'instant' });
  if (anchor) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' }));
  if (view === 'home') { $('#heroSection')?.classList.add('loaded'); }
  observeReveals();
  onScroll();
}

/* ---------- Events ---------- */
function bindEvents() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    const cat = t.closest('[data-cat]');
    if (cat) { state.category = cat.dataset.cat; renderCategoryTabs(); renderGrid(); return; }
    const fc = e.target.closest('[data-fcolor]');
    if (fc) { state.filter.color = state.filter.color === fc.dataset.fcolor ? null : fc.dataset.fcolor; renderCategoryTabs(); renderGrid(); return; }
    const fs = e.target.closest('[data-fsize]');
    if (fs) { state.filter.size = state.filter.size === fs.dataset.fsize ? null : fs.dataset.fsize; renderCategoryTabs(); renderGrid(); return; }
    if (e.target.closest('#clearFilters')) { state.category = 'All'; state.filter = { color: null, size: null, max: 3000, sort: 'featured' }; $('#sortBy').value = 'featured'; renderCategoryTabs(); renderGrid(); return; }
    const open = t.closest('[data-open]');
    if (open && !t.closest('[data-size]')) { location.hash = 'product/' + open.dataset.open; return; }
    if (handleProductPageClick(t)) return;
    const at = t.closest('[data-acct-tab]');
    if (at) { state.acctTab = at.dataset.acctTab; renderAccount(); return; }
    const chip = t.closest('[data-chat-chip]');
    if (chip) {
      const v = chip.dataset.chatChip;
      if (v === 'Start over') { chat.started = false; chatStart(); } else chatSend(v);
      return;
    }
    if (t.closest('#openBag')) { openBag(true); return; }
    if (t.closest('#closeBag') || t.id === 'overlay' || t.closest('[data-close-bag]')) { openBag(false); return; }
    if (t.closest('#goCheckout')) { openBag(false); location.hash = 'checkout'; return; }
    if (t.closest('#menuBtn')) { $('#mobileNav').classList.toggle('open'); return; }
    if (t.closest('#pmClose') || t.id === 'productModal') { closeModal(); return; }

    const colour = t.closest('[data-colour]');
    if (colour && state.modal.product) {
      state.modal.colour = colour.dataset.colour;
      const avail = state.modal.size && stockFor(state.modal.product, state.modal.colour, state.modal.size) - cartQty(state.modal.product.id, state.modal.colour, state.modal.size);
      if (!avail) state.modal.size = null;
      refreshModal(); return;
    }
    const size = t.closest('[data-size]');
    if (size && state.modal.product) { state.modal.size = size.dataset.size; refreshModal(); return; }
    if (t.closest('#pmAdd')) {
      const { product, colour: c, size: s } = state.modal;
      if (!s) { const box = $('#productBox'); box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake'); toast('Choose a size first', { error: true }); return; }
      if (addToBag({ product, colour: c, size: s })) { closeModal(); openBag(true); }
      return;
    }

    const inc = t.closest('[data-inc]');
    const dec = t.closest('[data-dec]');
    const rm = t.closest('[data-rm]');
    if (inc || dec || rm) {
      const idx = Number((inc || dec || rm).dataset[inc ? 'inc' : dec ? 'dec' : 'rm']);
      const valid = state.cart.filter((l) => state.products.some((p) => p.id === l.productId));
      const line = valid[idx];
      const real = state.cart.indexOf(line);
      if (inc) {
        const p = state.products.find((x) => x.id === line.productId);
        const avail = stockFor(p, line.colour, line.size) - cartQty(p.id, line.colour, line.size);
        if (avail <= 0) toast(`No more ${line.size} left in ${line.colour}.`, { error: true });
        else line.qty++;
      } else if (dec) {
        if (line.qty > 1) line.qty--; else state.cart.splice(real, 1);
      } else {
        state.cart.splice(real, 1);
      }
      persistCart(); renderBag(); return;
    }

    const czt = t.closest('[data-cz-tab]');
    if (czt) {
      $$('[data-cz-tab]').forEach((b) => b.classList.toggle('on', b === czt));
      $$('[data-cz-pane]').forEach((x) => x.classList.toggle('on', x.dataset.czPane === czt.dataset.czTab));
      return;
    }
    const czp = t.closest('[data-cz-print]');
    if (czp) {
      const inp = $('#czText'); inp.value = czp.dataset.czPrint;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      $('#czTextPrev').textContent = inp.value;
      return;
    }
    const cz = t.closest('[data-cz-colour]');
    if (cz) { state.cz.colour = cz.dataset.czColour; state.cz.size = null; renderCzControls(); return; }
    const czs = t.closest('[data-cz-size]');
    if (czs) { state.cz.size = czs.dataset.czSize; renderCzControls(); return; }
    if (t.closest('#czAdd')) {
      const { product, colour, size, text, font, place } = state.cz;
      if (!size) return;
      addToBag({ product, colour, size, customText: text.trim(), customFont: text.trim() ? font : '', customPlace: text.trim() ? place : '' });
      toast('Added to your bag');
      openBag(true);
      return;
    }

    const trackOrder = t.closest('[data-track-order]');
    if (trackOrder) {
      const o = trackOrder.dataset.trackOrder;
      state.trackPrefill = { orderId: o, phone: state.customer?.phone || '' };
      location.hash = 'track';
      return;
    }
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id === 'chatForm') { e.preventDefault(); chatSend($('#chatInput').value); $('#chatInput').value = ''; }
    if (e.target.id === 'trForm') { e.preventDefault(); lookupOrder($('#trId').value.trim(), $('#trPhone').value.trim()); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); openBag(false); }
    if (e.key === 'Enter' && e.target.matches('.card[data-open]')) openProduct(e.target.dataset.open);
  });

  $('#czProduct').addEventListener('change', (e) => {
    state.cz.product = state.products.find((p) => p.id === Number(e.target.value));
    state.cz.colour = state.cz.product.colors[0].name;
    state.cz.size = null;
    renderCzControls();
  });
  $('#czText').addEventListener('input', (e) => { $('#czTextPrev').textContent = e.target.value || 'KALSHI'; });
  $('#czText').addEventListener('input', (e) => {
    state.cz.text = e.target.value.replace(/[^A-Za-z0-9 ]/g, '').slice(0, 12);
    e.target.value = state.cz.text;
    renderCzControls();
  });
  $('#czFont').addEventListener('change', (e) => { state.cz.font = e.target.value; refreshCustomiser(); });
  document.querySelectorAll('input[name=czPlace]').forEach((r) => r.addEventListener('change', (e) => { state.cz.place = e.target.value; refreshCustomiser(); }));

  window.addEventListener('hashchange', route);
  window.addEventListener('scroll', onScroll, { passive: true });
}

/* ---------- Boot ---------- */
async function boot() {
  $('#storyTee').innerHTML = teeSVG('#cdb89a');
  /* heroMouse: gentle pointer parallax on the hero photo and frame */
  const heroEl = $('#heroSection');
  if (heroEl && matchMedia('(pointer:fine)').matches) {
    heroEl.addEventListener('pointermove', (e) => {
      const r = heroEl.getBoundingClientRect();
      heroEl.style.setProperty('--mx', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
      heroEl.style.setProperty('--my', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
    });
  }
  $('#priceRange').addEventListener('input', (e) => { state.filter.max = Number(e.target.value); renderCategoryTabs(); renderGrid(); });
  $('#sortBy').addEventListener('change', (e) => { state.filter.sort = e.target.value; renderGrid(); });
  bindEvents();
  try {
    state.store = await api('/api/store');
  } catch { state.store = { brand: 'कळशीत कळशी', customPrintFeePaise: 19900, freeShippingOverPaise: 99900, shippingFeePaise: 9900 }; }
  try {
    const me = await api('/api/auth/me');
    state.customer = me.customer;
  } catch { state.customer = null; }
  try {
    await loadCatalogue();
  } catch (err) {
    $('#productGrid').innerHTML = `<p class="error-text">Could not load the catalogue: ${esc(err.message)}</p>`;
  }
  connectLiveStock();
  renderBag();
  route();
  requestAnimationFrame(() => $('#heroSection')?.classList.add('loaded'));
}

boot();
