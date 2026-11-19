# कळशीत कळशी · Storefront, admin and back end

A men's t-shirt store for India: storefront, admin and inventory, Razorpay payments, GST invoices, courier dispatch and tracking, OTP and Google sign-in, WhatsApp and SMS alerts, a 3D customiser and an AI stylist.

## What is live and what is simulated

Nothing here has been tested against live services. The table shows what each part does with and without keys.

| Area | With keys in `.env` | Without keys |
|---|---|---|
| Payments | Razorpay Checkout, signature verification, webhook | Dev-pay route (development only, disabled in production) |
| Invoices | GST PDF generated on payment, numbered per financial year | Same, always available |
| Courier | Shiprocket serviceability, shipment and AWB, tracking | Estimated delivery dates, dispatch returns an error |
| OTP and SMS | MSG91 flow API | OTP code shown on screen in development only |
| WhatsApp | WhatsApp Cloud API templates | Logged as simulated in `order_events` |
| Google sign-in | Google Identity Services, ID-token verification | Button hidden |
| AI stylist | Anthropic Messages API | Rule-based fit guide |
| Stock | Live via Server-Sent Events | Same |

Before going live, verify the Shiprocket endpoints and the WhatsApp and MSG91 message templates against each provider's current documentation. Confirm the GST slabs and HSN classification with your accountant.

## Requirements

- Node.js 20 or newer
- PostgreSQL 14 or newer (or Docker, see below)

## Setup

```bash
cp .env.example .env          # then fill in the values you have
docker compose up -d          # starts PostgreSQL on port 5432 (or use your own server)
npm install
npm run seed                  # creates tables and sample products (also runs on first start)
npm run dev                   # http://localhost:3000
```

- Storefront: `http://localhost:3000`
- Admin: `http://localhost:3000/admin` (set `ADMIN_PASSWORD` in `.env`; admin login is disabled while it is empty)
- Health check: `http://localhost:3000/api/health`

Run `npm run check` to syntax-check every server file.

## Environment variables

See `.env.example`. The essentials:

- `DATABASE_URL`: PostgreSQL connection string
- `JWT_SECRET`, `OTP_SECRET`: long random strings (use `openssl rand -hex 32`)
- `ADMIN_PASSWORD`: admin sign-in
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`: payments
- `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPROCKET_WEBHOOK_TOKEN`, pickup PIN in admin settings: courier
- `WHATSAPP_*`, `MSG91_*`: messaging
- `GOOGLE_CLIENT_ID`: Google sign-in (the same ID goes in the storefront)
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`: AI stylist (defaults to `claude-haiku-5-5`)

## Webhooks

- Razorpay: `POST {SITE_URL}/api/webhooks/razorpay`. Subscribe to `payment.captured` and `payment.failed`.
- Shiprocket: `POST {SITE_URL}/api/webhooks/shiprocket?token=SHIPROCKET_WEBHOOK_TOKEN`.

## Money and tax

- All amounts are stored as integer paise.
- Prices are GST-inclusive. Tax is `amount × rate / (100 + rate)`. The rate follows the unit-price threshold set in admin settings.
- Invoice numbers follow `KT/<financial year>/<sequence>`, for example `KT/2026-27/0001`. Numbers are issued once, when payment is confirmed.

## Stock and orders

- Stock is reserved in a database transaction when checkout starts.
- Unpaid orders release their stock after 30 minutes (a sweeper runs every 5 minutes).
- Payment confirmation is idempotent, so the browser callback and the webhook can both arrive safely.

## Folder layout

```
server/
  index.js            app, security headers, routes, startup
  config.js           environment and store defaults
  db.js, schema.sql   PostgreSQL pool and schema
  seed.js             sample products and settings
  bus.js              live stock events
  lib/                auth, catalogue, orders, GST, invoices, couriers, messaging, AI stylist
  routes/             catalog, auth, orders, shipping, webhooks, admin
public/
  index.html          storefront
  admin.html          admin portal
  css/app.css         styles and palettes
  js/common.js        shared helpers
  js/store.js         storefront logic
  js/customizer.js    3D customiser (Three.js)
  js/admin.js         admin logic
fonts/                optional Devanagari font for invoices (see fonts/README.md)
```

## Deployment notes

- Set `NODE_ENV=production` and `SITE_URL` to the public HTTPS address. Cookies are `secure` in production.
- Run behind a reverse proxy that terminates TLS. The app trusts one proxy hop.
- Back up the PostgreSQL database daily. Orders, customers and invoice numbers live there.
- Keep `.env` out of version control. It is already in `.gitignore`.
- Razorpay requires KYC and an activated live account before live keys work.
