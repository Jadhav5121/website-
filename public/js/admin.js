// Admin portal: products and prices, inventory grid with live stock, orders and dispatch, settings, alerts.
import { $, esc, api, toast, rupees, rupeesExact, SIZES } from './common.js';

const ORDER_STEPS = ['paid', 'packed', 'shipped', 'delivered', 'cancelled'];
const TABS = [['overview', 'Overview'], ['products', 'Products'], ['inventory', 'Inventory'], ['orders', 'Orders'], ['settings', 'Settings'], ['alerts', 'Alerts']];

const s = {
  tab: 'overview',
  products: [],
  orders: [],
  orderFilter: '',
  settings: null,
  integrations: {},
  overview: null,
  alerts: [],
  editing: null,
};

const root = $('#root');

/* ---------- Auth gate ---------- */
async function boot() {
  try {
    await api('/api/admin/overview');
    shell();
  } catch (err) {
    if (err.status === 401 || err.status === 403) return gate();
    if (err.status === 503) return gate('Admin login is disabled. Set ADMIN_PASSWORD in the server .env file.');
    root.innerHTML = `<p class="error-text">${esc(err.message)}</p>`;
  }
}

function gate(note = '') {
  root.innerHTML = `
    <div class="gate">
      <p class="eyebrow">Admin</p>
      <h1>Sign in</h1>
      <form id="loginForm">
        <div class="field"><label for="pw">Password</label><input type="password" id="pw" required autocomplete="current-password"></div>
        <button class="btn block" type="submit"><span>Sign in</span></button>
        <div class="error-text" id="loginErr">${esc(note)}</div>
      </form>
    </div>`;
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/auth/admin/login', { method: 'POST', body: { password: $('#pw').value } });
      shell();
    } catch (err) { $('#loginErr').textContent = err.message; }
  });
}

/* ---------- Shell ---------- */
const ICONS = { overview: '▦', products: '👕', inventory: '▤', orders: '🧾', settings: '⚙', alerts: '🔔' };
function shell() {
  root.innerHTML = `
    <div class="adm">
      <aside class="adm-side">
        <div class="adm-brand"><svg viewBox="0 0 200 190" width="30" aria-hidden="true"><path d="M62 16 L22 38 L5 78 L38 90 L46 74 L46 172 L154 172 L154 74 L162 90 L195 78 L178 38 L138 16 Q100 36 62 16 Z" fill="none" stroke="#d6b36a" stroke-width="8" stroke-linejoin="round"/></svg><div><b>Kalshit Kalshi</b><small>Admin</small></div></div>
        <nav id="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}"><i>${ICONS[k] || '•'}</i>${k === 'overview' ? 'Dashboard' : l}</button>`).join('')}</nav>
        <div class="adm-foot">
          <span class="small" id="liveState">Live</span>
          <a href="/">View store</a>
          <button id="logout">Sign out</button>
        </div>
      </aside>
      <main class="adm-main">
        <header class="adm-top"><h1 id="admTitle">Dashboard</h1></header>
        <div id="pane"></div>
      </main>
    </div>`;
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) go(b.dataset.tab);
  });
  $('#logout').onclick = async () => { await api('/api/auth/admin/logout', { method: 'POST' }); location.reload(); };
  connectLive();
  go(s.tab);
}

function go(tab) {
  s.tab = tab;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const t = $('#admTitle');
  if (t) t.textContent = tab === 'overview' ? 'Dashboard' : (TABS.find(([k]) => k === tab) || [, tab])[1];
  ({ overview: renderOverview, products: renderProducts, inventory: renderInventory, orders: renderOrders, settings: renderSettings, alerts: renderAlerts })[tab]();
}

function pane(html) { $('#pane').innerHTML = html; }

async function run(fn) {
  try { return await fn(); } catch (err) { toast(err.message, { error: true }); throw err; }
}

/* ---------- Live stock ---------- */
function connectLive() {
  try {
    const es = new EventSource('/api/stream');
    let t;
    es.addEventListener('stock', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        $('#liveState').textContent = 'Stock changed';
        if (s.tab === 'inventory' && !document.activeElement?.matches('input')) renderInventory();
        if (s.tab === 'overview') renderOverview();
      }, 300);
    });
    es.onerror = () => { const el = $('#liveState'); if (el) el.textContent = 'Reconnecting…'; };
    es.onopen = () => { const el = $('#liveState'); if (el) el.textContent = 'Live'; };
  } catch { /* SSE unsupported */ }
}

/* ---------- Overview ---------- */
function salesSeries(orders, days = 7) {
  const counted = new Set(['paid', 'packed', 'shipped', 'delivered']);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    out.push({ key: d.toDateString(), label: d.toLocaleDateString('en-IN', { weekday: 'short' }), paise: 0, n: 0 });
  }
  orders.forEach((o) => {
    if (!counted.has(o.status)) return;
    const slot = out.find((x) => x.key === new Date(o.createdAt).toDateString());
    if (slot) { slot.paise += o.totalPaise; slot.n += 1; }
  });
  return out;
}

function salesChart(series) {
  const W = 560, H = 190, pad = 26;
  const max = Math.max(...series.map((x) => x.paise), 1);
  const pts = series.map((x, i) => [pad + (i * (W - pad * 2)) / (series.length - 1), H - pad - (x.paise / max) * (H - pad * 2)]);
  const line = pts.map((p) => p.join(',')).join(' ');
  const area = `${pad},${H - pad} ${line} ${W - pad},${H - pad}`;
  const empty = series.every((x) => x.paise === 0);
  return `<svg viewBox="0 0 ${W} ${H}" class="sc" role="img" aria-label="Sales over the last 7 days">
    <defs><linearGradient id="scg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2563eb" stop-opacity=".28"/><stop offset="1" stop-color="#2563eb" stop-opacity="0"/></linearGradient></defs>
    ${[0, 1, 2, 3].map((i) => `<line x1="${pad}" x2="${W - pad}" y1="${pad + (i * (H - pad * 2)) / 3}" y2="${pad + (i * (H - pad * 2)) / 3}" stroke="#e7e1d8"/>`).join('')}
    <polygon points="${area}" fill="url(#scg)"/>
    <polyline points="${line}" fill="none" stroke="#2563eb" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" class="scl"/>
    ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4.5" fill="#fff" stroke="#2563eb" stroke-width="2.5"><title>${series[i].label}: ${rupees(series[i].paise)} · ${series[i].n} orders</title></circle>`).join('')}
    ${series.map((x, i) => `<text x="${pts[i][0]}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#8b8374">${x.label}</text>`).join('')}
    ${empty ? `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="#8b8374">No sales in the last 7 days</text>` : ''}
  </svg>`;
}

async function renderOverview() {
  const [{ overview }, { orders }] = await Promise.all([
    api('/api/admin/overview'),
    api('/api/admin/orders'),
  ]);
  const recent = orders.slice(0, 6);
  const series = salesSeries(orders);
  const week = series.reduce((a, x) => a + x.paise, 0);
  pane(`
    <div class="kpis">
      <div class="kpi"><span>Total Sales</span><b>${rupees(overview.revenue_paise)}</b><small>${rupees(week)} in the last 7 days</small></div>
      <div class="kpi"><span>Total Orders</span><b>${overview.orders}</b><small>${series.reduce((a, x) => a + x.n, 0)} in the last 7 days</small></div>
      <div class="kpi"><span>To pack</span><b>${overview.to_pack}</b><small>Paid, waiting to be packed</small></div>
      <div class="kpi ${overview.low_stock ? 'warn' : ''}"><span>Low stock sizes</span><b>${overview.low_stock}</b><small>${overview.low_stock ? 'Needs restocking' : 'All healthy'}</small></div>
    </div>
    <div class="adm-grid">
      <div class="adm-card"><h2>Sales Overview</h2><p class="muted small">Last 7 days · paid orders</p>${salesChart(series)}</div>
      <div class="adm-card"><h2>Recent Orders</h2>
        ${recent.length ? `<ul class="rec-list">${recent.map((o) => `<li><div><b>#${esc(o.id)}</b><small>${esc(o.customer.name)}</small></div><div class="r"><b>${rupees(o.totalPaise)}</b><span class="pill ${esc(o.status)}">${esc(o.status.replace('_', ' '))}</span></div></li>`).join('')}</ul>` : '<p class="muted">No orders yet.</p>'}
        <button class="link" onclick="document.querySelector('[data-tab=orders]').click()">View all orders</button>
      </div>
    </div>`);
}

/* ---------- Products ---------- */
async function loadProducts() {
  const { products } = await api('/api/admin/products');
  s.products = products;
  return products;
}

async function renderProducts() {
  await run(loadProducts);
  pane(`
    <div class="card-panel">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:14px">
        <h2 style="margin:0">Products</h2>
        <button class="btn sm" id="newProduct"><span>Add t-shirt</span></button>
      </div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Name</th><th>Category</th><th>Price (₹)</th><th>MRP (₹)</th><th>Tag</th><th>Stock</th><th>Live</th><th></th></tr></thead>
        <tbody>${s.products.map(productRow).join('')}</tbody>
      </table></div>
    </div>
    <div id="editor"></div>`);
  $('#newProduct').onclick = () => openEditor(null);
  $('#pane').onclick = productClicks;
}

function productRow(p) {
  return `<tr data-id="${p.id}">
    <td class="wide"><b>${esc(p.name)}</b><div class="small muted">${esc(p.subtitle)}</div></td>
    <td>${esc(p.category)}</td>
    <td><input class="num" type="number" min="1" step="1" value="${p.pricePaise / 100}" data-field="price"></td>
    <td><input class="num" type="number" min="0" step="1" value="${p.mrpPaise / 100}" data-field="mrp"></td>
    <td>${esc(p.tag)}</td>
    <td>${p.totalStock}</td>
    <td><select data-field="active"><option value="true" ${p.active ? 'selected' : ''}>On</option><option value="false" ${!p.active ? 'selected' : ''}>Off</option></select></td>
    <td style="white-space:nowrap">
      <button class="link" data-save="${p.id}">Save</button>
      <button class="link" data-edit="${p.id}">Edit</button>
    </td>
  </tr>`;
}

async function productClicks(e) {
  const save = e.target.closest('[data-save]');
  const edit = e.target.closest('[data-edit]');
  if (save) {
    const row = save.closest('tr');
    const body = {
      price: row.querySelector('[data-field=price]').value,
      mrp: row.querySelector('[data-field=mrp]').value,
      active: row.querySelector('[data-field=active]').value === 'true',
    };
    await run(() => api(`/api/admin/products/${save.dataset.save}`, { method: 'PATCH', body }));
    toast('Saved');
    renderProducts();
  }
  if (edit) openEditor(Number(edit.dataset.edit));
}

function openEditor(id) {
  const p = id ? s.products.find((x) => x.id === id) : null;
  const colors = p ? p.colors : [{ name: 'Black', hex: '#0b0a08' }];
  $('#editor').innerHTML = `
    <div class="card-panel">
      <h2>${p ? `Edit ${esc(p.name)}` : 'Add a t-shirt'}</h2>
      <form id="pForm">
        <div class="row2">
          <div class="field"><label for="pName">Name</label><input type="text" id="pName" required maxlength="120" value="${esc(p?.name || '')}"></div>
          <div class="field"><label for="pSub">Short line</label><input type="text" id="pSub" maxlength="60" value="${esc(p?.subtitle || '')}"></div>
        </div>
        <div class="row3">
          <div class="field"><label for="pCat">Category</label><input type="text" id="pCat" required maxlength="40" value="${esc(p?.category || 'Essentials')}"></div>
          <div class="field"><label for="pPrice">Price (₹, incl. GST)</label><input type="number" id="pPrice" required min="1" step="1" value="${p ? p.pricePaise / 100 : ''}"></div>
          <div class="field"><label for="pMrp">MRP (₹)</label><input type="number" id="pMrp" min="0" step="1" value="${p ? p.mrpPaise / 100 : ''}"></div>
        </div>
        <div class="row2">
          <div class="field"><label for="pTag">Tag</label><input type="text" id="pTag" maxlength="20" placeholder="New, Bestseller…" value="${esc(p?.tag || '')}"></div>
          <div class="field"><label for="pDesc">Description</label><input type="text" id="pDesc" maxlength="1000" value="${esc(p?.description || '')}"></div>
        </div>
        ${p ? '' : `
        <div class="field"><label for="pColors">Colours (name:#hex, one per line)</label>
          <textarea id="pColors" rows="3">${colors.map((c) => `${c.name}:${c.hex}`).join('\n')}</textarea></div>
        <p class="notice">Starting stock can be set in the Inventory tab once the t-shirt is saved.</p>`}
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <button class="btn sm" type="submit"><span>${p ? 'Save changes' : 'Create t-shirt'}</span></button>
          <button class="link" type="button" id="pCancel">Cancel</button>
          ${p ? '<button class="link" type="button" id="pDelete" style="color:var(--bad)">Hide from shop</button>' : ''}
        </div>
      </form>
    </div>`;
  $('#editor').scrollIntoView({ behavior: 'smooth' });
  $('#pCancel').onclick = () => { $('#editor').innerHTML = ''; };
  if (p) $('#pDelete').onclick = async () => {
    if (!confirm(`Hide ${p.name} from the shop? Past orders are kept.`)) return;
    await run(() => api(`/api/admin/products/${p.id}`, { method: 'DELETE' }));
    toast('Hidden from the shop');
    renderProducts();
  };
  $('#pForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      name: $('#pName').value.trim(),
      subtitle: $('#pSub').value.trim(),
      category: $('#pCat').value.trim(),
      price: $('#pPrice').value,
      mrp: $('#pMrp').value || undefined,
      tag: $('#pTag').value.trim(),
      description: $('#pDesc').value.trim(),
    };
    if (p) {
      await run(() => api(`/api/admin/products/${p.id}`, { method: 'PATCH', body }));
    } else {
      const lines = $('#pColors').value.split('\n').map((l) => l.trim()).filter(Boolean);
      const parsed = lines.map((l) => {
        const [name, hex] = l.split(':').map((x) => x.trim());
        return { name, hex };
      });
      if (!parsed.length || parsed.some((c) => !c.name || !/^#[0-9a-fA-F]{6}$/.test(c.hex || ''))) {
        toast('Each colour needs a name and a hex value, such as Black:#0b0a08', { error: true });
        return;
      }
      await run(() => api('/api/admin/products', { method: 'POST', body: { ...body, colors: parsed } }));
    }
    toast('Saved');
    renderProducts();
  });
}

/* ---------- Inventory ---------- */
async function renderInventory() {
  await run(loadProducts);
  const cards = s.products.map((p) => {
    const colours = p.colors.map((c) => {
      const cells = SIZES.map((sz) => {
        const v = p.variants.find((x) => x.color === c.name && x.size === sz);
        const stock = v ? v.stock : 0;
        return `<div class="cell ${stock > 0 && stock <= 2 ? 'low' : ''}">
          <b>${sz}</b>
          <input class="stock" type="number" min="0" step="1" value="${stock}" data-variant="${v?.id ?? ''}" data-product="${p.id}" data-color="${esc(c.name)}" data-size="${sz}" ${v ? '' : 'disabled title="Create the size with Save stock"'} aria-label="${esc(p.name)} ${esc(c.name)} ${sz} stock">
        </div>`;
      }).join('');
      return `<div style="margin-top:14px"><div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><i style="width:14px;height:14px;border-radius:50%;background:${esc(c.hex)};display:inline-block"></i><b>${esc(c.name)}</b></div><div class="inv-grid">${cells}</div></div>`;
    }).join('');
    return `<div class="card-panel" data-pid="${p.id}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <h2 style="margin:0">${esc(p.name)} <span class="small muted" style="font-family:var(--sans);font-weight:400">${esc(p.category)}${p.active ? '' : ' · hidden'}</span></h2>
        <div style="display:flex;gap:12px;align-items:center"><span class="saved-flash" data-flash="${p.id}">Saved</span><button class="btn sm" data-save-stock="${p.id}"><span>Save stock</span></button></div>
      </div>
      ${colours}
    </div>`;
  }).join('') || '<p class="muted">No products yet.</p>';
  pane(cards);
  document.querySelectorAll('[data-save-stock]').forEach((btn) => btn.addEventListener('click', () => saveStock(Number(btn.dataset.saveStock))));
}

async function saveStock(productId) {
  const inputs = [...document.querySelectorAll(`[data-product="${productId}"]`)];
  const p = s.products.find((x) => x.id === productId);
  const missing = inputs.filter((i) => !i.dataset.variant);
  const changed = inputs.filter((i) => i.dataset.variant && Number(i.value) !== (p.variants.find((v) => v.id === Number(i.dataset.variant))?.stock ?? -1));
  if (!changed.length && !missing.length) { toast('No changes to save'); return; }
  try {
    if (missing.length) {
      const variants = inputs.map((i) => ({ color: i.dataset.color, size: i.dataset.size, stock: Number(i.value) || 0 }));
      await api(`/api/admin/products/${productId}/variants`, { method: 'PUT', body: { variants } });
    } else {
      for (const i of changed) {
        await api(`/api/admin/variants/${i.dataset.variant}`, { method: 'PATCH', body: { stock: Number(i.value) || 0 } });
      }
    }
    const flash = document.querySelector(`[data-flash="${productId}"]`);
    flash?.classList.add('show');
    setTimeout(() => flash?.classList.remove('show'), 1600);
    toast('Stock updated. The storefront is already showing it.');
    await loadProducts();
  } catch (err) {
    toast(err.message, { error: true });
  }
}

/* ---------- Orders ---------- */
async function loadOrders() {
  const q = s.orderFilter ? `?status=${encodeURIComponent(s.orderFilter)}` : '';
  const { orders } = await api(`/api/admin/orders${q}`);
  s.orders = orders;
  return orders;
}

async function renderOrders() {
  await run(loadOrders);
  pane(`
    <div class="card-panel">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:14px">
        <h2 style="margin:0">Orders</h2>
        <select id="ordFilter" style="width:auto">
          <option value="">All paid orders</option>
          ${ORDER_STEPS.map((x) => `<option value="${x}" ${s.orderFilter === x ? 'selected' : ''}>${x}</option>`).join('')}
        </select>
      </div>
      ${s.orders.length ? orderTable(s.orders, true) : '<p class="muted">No orders match this filter.</p>'}
    </div>`);
  $('#ordFilter').onchange = (e) => { s.orderFilter = e.target.value; renderOrders(); };
  $('#pane').onclick = async (e) => {
    const b = e.target.closest('[data-order-action]');
    if (!b) return;
    const [action, id] = b.dataset.orderAction.split(':');
    try {
      if (action === 'ship') {
        if (!confirm('Create the courier shipment for this order now?')) return;
        const r = await api(`/api/admin/orders/${id}/ship`, { method: 'POST' });
        toast(r.awb ? `Shipped. AWB ${r.awb}` : 'Shipment created');
      } else {
        await api(`/api/admin/orders/${id}`, { method: 'PATCH', body: { status: action } });
        toast(`Marked ${action}`);
      }
      renderOrders();
    } catch (err) { toast(err.message, { error: true }); }
  };
}

function orderTable(orders, actions) {
  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Courier</th>${actions ? '<th>Actions</th>' : ''}</tr></thead>
    <tbody>${orders.map((o) => `<tr>
      <td><b>${esc(o.id)}</b><div class="small muted">${esc(o.invoiceNo || '')}</div></td>
      <td class="small">${new Date(o.createdAt).toLocaleString('en-IN')}</td>
      <td class="small"><b>${esc(o.customer.name)}</b><br>${esc(o.customer.phone)}<br>${esc(o.customer.city)} ${esc(o.customer.pin)}</td>
      <td class="small">${o.items.map((i) => `${esc(i.productName)} · ${esc(i.color)} ${esc(i.size)} × ${i.qty}${i.customText ? ` · “${esc(i.customText)}”` : ''}`).join('<br>')}</td>
      <td>${rupeesExact(o.totalPaise)}</td>
      <td><span class="pill ${esc(o.status)}">${esc(o.status.replace('_', ' '))}</span></td>
      <td class="small">${o.awb ? `${esc(o.courierName || '')}<br>${esc(o.awb)}` : '—'}</td>
      ${actions ? `<td style="white-space:nowrap">
        ${o.status === 'paid' ? `<button class="link" data-order-action="packed:${esc(o.id)}">Mark packed</button><br>` : ''}
        ${['paid', 'packed'].includes(o.status) ? `<button class="link" data-order-action="ship:${esc(o.id)}">Create shipment</button><br>` : ''}
        ${o.status === 'shipped' ? `<button class="link" data-order-action="delivered:${esc(o.id)}">Mark delivered</button><br>` : ''}
        ${o.invoiceNo ? `<a class="link" href="/api/orders/${esc(o.id)}/invoice.pdf" target="_blank" rel="noopener">Invoice</a>` : ''}
      </td>` : ''}
    </tr>`).join('')}</tbody>
  </table></div>`;
}

/* ---------- Settings ---------- */
async function renderSettings() {
  const { settings, integrations } = await run(() => api('/api/admin/settings'));
  s.settings = settings;
  const chip = (k, label) => `<span class="${integrations[k] ? 'on' : ''}">${label}: ${integrations[k] ? 'connected' : 'not connected'}</span>`;
  pane(`
    <div class="card-panel">
      <h2>Connections</h2>
      <div class="integrations">
        ${chip('razorpay', 'Razorpay')}${chip('shiprocket', 'Shiprocket')}${chip('whatsapp', 'WhatsApp')}${chip('sms', 'SMS (MSG91)')}${chip('google', 'Google sign-in')}${chip('ai', 'AI stylist')}
      </div>
      <p class="small muted">Add keys to the server .env file and restart. Unconnected services are logged as simulated and never charge or send real messages.</p>
    </div>
    <form class="card-panel" id="setForm">
      <h2>Business &amp; tax</h2>
      <div class="row2">
        <div class="field"><label for="sLegal">Legal name</label><input type="text" id="sLegal" value="${esc(settings.legalName)}" maxlength="120"></div>
        <div class="field"><label for="sGstin">GSTIN (15 characters, blank if not registered)</label><input type="text" id="sGstin" value="${esc(settings.gstin)}" maxlength="15"></div>
      </div>
      <div class="field"><label for="sAddr">Registered address (shown on invoices)</label><input type="text" id="sAddr" value="${esc(settings.address)}" maxlength="300"></div>
      <div class="row3">
        <div class="field"><label for="sState">State</label><input type="text" id="sState" value="${esc(settings.state)}" maxlength="60"></div>
        <div class="field"><label for="sCode">State code</label><input type="text" id="sCode" value="${esc(settings.stateCode)}" maxlength="3"></div>
        <div class="field"><label for="sPin">Dispatch PIN</label><input type="text" id="sPin" value="${esc(settings.pickupPin)}" maxlength="6" inputmode="numeric"></div>
      </div>
      <div class="row3">
        <div class="field"><label for="sLow">GST rate, lower slab (%)</label><input type="number" id="sLow" step="0.01" min="0" max="28" value="${settings.lowRate}"></div>
        <div class="field"><label for="sHigh">GST rate, higher slab (%)</label><input type="number" id="sHigh" step="0.01" min="0" max="28" value="${settings.highRate}"></div>
        <div class="field"><label for="sThr">Slab threshold (₹ per unit)</label><input type="number" id="sThr" step="1" min="0" value="${settings.thresholdRupees}"></div>
      </div>
      <p class="notice">Confirm GST slabs and HSN classification with your accountant before going live. Prices are GST-inclusive.</p>
      <button class="btn sm" type="submit"><span>Save settings</span></button>
    </form>`);
  $('#setForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      legalName: $('#sLegal').value.trim(), gstin: $('#sGstin').value.trim(), address: $('#sAddr').value.trim(),
      state: $('#sState').value.trim(), stateCode: $('#sCode').value.trim(), pickupPin: $('#sPin').value.trim(),
      lowRate: $('#sLow').value, highRate: $('#sHigh').value, thresholdRupees: $('#sThr').value,
    };
    await run(() => api('/api/admin/settings', { method: 'PUT', body }));
    toast('Settings saved');
  });
}

/* ---------- Alerts ---------- */
async function renderAlerts() {
  const { alerts } = await run(() => api('/api/admin/alerts'));
  pane(`
    <div class="card-panel">
      <h2>Message and courier log</h2>
      ${alerts.length ? alerts.map((a) => `<div class="alert"><b>${esc(a.kind)}</b> · order ${esc(a.order_id)}<small>${new Date(a.created_at).toLocaleString('en-IN')}${a.detail ? ` · ${esc(JSON.stringify(a.detail))}` : ''}</small></div>`).join('') : '<p class="muted">Nothing yet.</p>'}
    </div>`);
}

boot();
