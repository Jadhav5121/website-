-- Kalshit store schema. Safe to run repeatedly (all statements are idempotent).
-- Money is stored as integer paise (1 rupee = 100 paise).

CREATE TABLE IF NOT EXISTS settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id          serial PRIMARY KEY,
  slug        text UNIQUE NOT NULL,
  name        text NOT NULL,
  subtitle    text NOT NULL DEFAULT '',
  category    text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_paise integer NOT NULL CHECK (price_paise > 0),
  mrp_paise   integer NOT NULL CHECK (mrp_paise >= 0),
  tag         text NOT NULL DEFAULT '',
  colors      jsonb NOT NULL DEFAULT '[]'::jsonb,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS variants (
  id         serial PRIMARY KEY,
  product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  color      text NOT NULL,
  size       text NOT NULL,
  sku        text UNIQUE NOT NULL,
  stock      integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  UNIQUE (product_id, color, size)
);

CREATE TABLE IF NOT EXISTS customers (
  id         serial PRIMARY KEY,
  name       text NOT NULL DEFAULT '',
  phone      text UNIQUE,
  email      text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otp_codes (
  phone      text PRIMARY KEY,
  code_hash  text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts   integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id                  text PRIMARY KEY,
  customer_id         integer REFERENCES customers(id),
  status              text NOT NULL,
  invoice_no          text UNIQUE,
  customer_name       text NOT NULL,
  phone               text NOT NULL,
  email               text NOT NULL DEFAULT '',
  ship_address        text NOT NULL,
  ship_city           text NOT NULL,
  ship_state          text NOT NULL DEFAULT '',
  ship_pin            text NOT NULL,
  subtotal_paise      integer NOT NULL,
  shipping_paise      integer NOT NULL,
  tax_paise           integer NOT NULL,
  total_paise         integer NOT NULL,
  payment_method      text NOT NULL DEFAULT '',
  razorpay_order_id   text UNIQUE,
  razorpay_payment_id text,
  courier_order_id    text,
  shipment_id         text,
  awb                 text,
  courier_name        text,
  eta_text            text NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  paid_at             timestamptz
);
CREATE INDEX IF NOT EXISTS orders_phone_idx ON orders(phone);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
  id              serial PRIMARY KEY,
  order_id        text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id      integer REFERENCES variants(id),
  product_name    text NOT NULL,
  color           text NOT NULL,
  size            text NOT NULL,
  sku             text NOT NULL,
  qty             integer NOT NULL CHECK (qty > 0),
  unit_price_paise integer NOT NULL,
  custom_text     text NOT NULL DEFAULT '',
  custom_font     text NOT NULL DEFAULT '',
  custom_place    text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS invoice_counters (
  fy       text PRIMARY KEY,
  last_no  integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS order_events (
  id         serial PRIMARY KEY,
  order_id   text,
  kind       text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_events_order_idx ON order_events(order_id);

CREATE TABLE IF NOT EXISTS processed_webhooks (
  event_id    text PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);
