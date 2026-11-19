// Shared helpers for the storefront and admin pages.
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Money arrives from the API in paise. Display in rupees.
export const rupees = (paise) => '₹' + Math.round((paise || 0) / 100).toLocaleString('en-IN');
export const rupeesExact = (paise) => '₹' + ((paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function api(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function toast(message, { error = false } = {}) {
  const t = document.getElementById('toast');
  if (!t) return alert(message);
  t.textContent = message;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2600);
}

export const TEE_PATH = 'M62 16 L22 38 L5 78 L38 90 L46 74 L46 172 L154 172 L154 74 L162 90 L195 78 L178 38 L138 16 Q100 36 62 16 Z';

// Flat garment illustration used on cards, the cart and the admin table.
export function teeSVG(hex, extra = '') {
  return `<svg viewBox="0 0 200 190" aria-hidden="true">
    <g filter="url(#drop)"><path d="${TEE_PATH}" fill="${esc(hex)}"/></g>
    <path d="M46 74 L46 172 L154 172 L154 74 Q100 96 46 74 Z" fill="url(#fold)"/>
    <path d="M62 16 Q100 42 138 16 Q128 30 100 34 Q72 30 62 16 Z" fill="url(#collar)"/>
    <path d="M62 16 Q100 42 138 16" fill="none" stroke="#0000002e" stroke-width="2.2"/>
    ${extra}
  </svg>`;
}

export const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
