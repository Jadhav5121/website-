// Store settings (legal name, GSTIN, GST slabs, pickup PIN) live in the database so admins can edit them.
const { q } = require('../db');
const config = require('../config');

let cache = null;
let cachedAt = 0;

async function getSettings({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cachedAt < 30_000) return cache;
  const { rows } = await q(`SELECT value FROM settings WHERE key = 'store'`);
  cache = { ...config.store.defaults, ...(rows[0]?.value || {}) };
  cachedAt = Date.now();
  return cache;
}

async function saveSettings(patch) {
  const current = await getSettings({ fresh: true });
  const next = { ...current, ...patch };
  await q(
    `INSERT INTO settings (key, value) VALUES ('store', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(next)]
  );
  cache = next;
  cachedAt = Date.now();
  return next;
}

module.exports = { getSettings, saveSettings };
