const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { seedIfNeeded } = require('./seed');
const { pool } = require('./db');
const { releaseStaleOrders, RESERVATION_MINUTES } = require('./lib/orders');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", 'https://checkout.razorpay.com', 'https://accounts.google.com'],
      'connect-src': ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com', 'https://accounts.google.com'],
      'frame-src': ['https://api.razorpay.com', 'https://checkout.razorpay.com', 'https://accounts.google.com'],
      'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
    },
  },
}));

// Webhooks read the raw body for signature checks, so they are mounted before the JSON parser.
app.use('/api/webhooks', require('./routes/webhooks'));

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.use('/api', require('./routes/catalog'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/shipping', require('./routes/shipping'));
app.use('/api/admin', require('./routes/admin'));

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: true, env: config.nodeEnv });
  } catch {
    res.status(503).json({ ok: false, db: false });
  }
});

app.get('/api/*', (req, res) => res.status(404).json({ error: 'Not found.' }));

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, { index: 'index.html', maxAge: config.isProd ? '1h' : 0 }));
app.get('/admin', (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// Error handler: never leak stack traces to the browser.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
  if (err.status && err.expose) return res.status(err.status).json({ error: err.message });
  console.error('[error]', err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

async function start() {
  await seedIfNeeded();
  // Release stock held by orders whose payment never completed.
  setInterval(() => {
    releaseStaleOrders().catch((err) => console.error('[sweeper]', err.message));
  }, 5 * 60_000).unref();

  app.listen(config.port, () => {
    console.log(`${config.store.brand} running on ${config.siteUrl}`);
    console.log(`Payments: ${config.razorpay.keyId ? 'Razorpay live keys' : 'DEV MODE (no Razorpay keys)'}`);
    console.log(`Courier: ${config.shiprocket.email ? 'Shiprocket connected' : 'estimate mode'}`);
    console.log(`Messaging: WhatsApp ${config.whatsapp.phoneNumberId ? 'on' : 'simulated'}, SMS ${config.msg91.authKey ? 'on' : 'simulated'}`);
    console.log(`Stylist: ${config.anthropic.apiKey ? 'AI (Claude)' : 'rule-based'}. Unpaid orders release after ${RESERVATION_MINUTES} min.`);
  });
}

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

start().catch((err) => {
  console.error('Startup failed. Is PostgreSQL running and DATABASE_URL correct?', err.message);
  process.exit(1);
});
