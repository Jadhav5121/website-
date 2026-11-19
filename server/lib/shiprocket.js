// Shiprocket courier integration: serviceability (PIN-code delivery dates), order creation, AWB assignment and tracking.
// Base URL and endpoint paths follow Shiprocket's external API. Confirm them against the current docs
// before going live: https://apidocs.shiprocket.in
const axios = require('axios');
const config = require('../config');

const BASE = 'https://apiv2.shiprocket.in/v1/external';
const TOKEN_TTL_MS = 9 * 24 * 3600 * 1000; // Shiprocket tokens last about 10 days

const enabled = () => Boolean(config.shiprocket.email && config.shiprocket.password);

let token = null;
let tokenAt = 0;

async function authToken() {
  if (token && Date.now() - tokenAt < TOKEN_TTL_MS) return token;
  const { data } = await axios.post(`${BASE}/auth/login`, {
    email: config.shiprocket.email,
    password: config.shiprocket.password,
  }, { timeout: 15_000 });
  token = data.token;
  tokenAt = Date.now();
  return token;
}

async function api(method, path, { params, body } = {}) {
  const t = await authToken();
  const { data } = await axios({
    method,
    url: `${BASE}${path}`,
    params,
    data: body,
    headers: { Authorization: `Bearer ${t}` },
    timeout: 20_000,
  });
  return data;
}

// Estimated delivery for a PIN code. Weight in kg. Returns the fastest courier option.
async function serviceability({ deliveryPin, weightKg = 0.3, pickupPin }) {
  const data = await api('GET', '/courier/serviceability/', {
    params: { pickup_postcode: pickupPin, delivery_postcode: deliveryPin, weight: weightKg, cod: 0 },
  });
  const couriers = data?.data?.available_courier_companies || [];
  if (!couriers.length) return { serviceable: false, couriers: [] };
  const best = [...couriers].sort((a, b) => (a.estimated_delivery_days ?? 99) - (b.estimated_delivery_days ?? 99))[0];
  return {
    serviceable: true,
    days: best.estimated_delivery_days,
    etd: best.etd,
    courier: best.courier_name,
    couriers: couriers.map((c) => ({ name: c.courier_name, days: c.estimated_delivery_days, etd: c.etd })),
  };
}

// Creates a shipment (adhoc order) for a paid order. Returns Shiprocket's order and shipment ids.
async function createShipment(order, items) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const orderDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const [first, ...rest] = order.customer_name.split(' ');
  const body = {
    order_id: order.id,
    order_date: orderDate,
    pickup_location: config.shiprocket.pickupLocation,
    billing_customer_name: first,
    billing_last_name: rest.join(' ') || '.',
    billing_address: order.ship_address,
    billing_city: order.ship_city,
    billing_pincode: order.ship_pin,
    billing_state: order.ship_state,
    billing_country: 'India',
    billing_email: order.email || 'orders@example.com',
    billing_phone: order.phone,
    shipping_is_billing: true,
    order_items: items.map((i) => ({
      name: `${i.product_name} (${i.color}, ${i.size})`,
      sku: i.sku,
      units: i.qty,
      selling_price: i.unit_price_paise / 100,
    })),
    payment_method: 'Prepaid',
    sub_total: order.subtotal_paise / 100,
    length: 30,
    breadth: 25,
    height: 4,
    weight: 0.3 * items.reduce((a, i) => a + i.qty, 0),
  };
  const data = await api('POST', '/orders/create/adhoc', { body });
  return { courierOrderId: String(data.order_id), shipmentId: String(data.shipment_id) };
}

// Picks a courier and generates the AWB (tracking number) for a shipment.
async function assignAwb(shipmentId) {
  const data = await api('POST', '/courier/assign/awb', { body: { shipment_id: shipmentId } });
  const r = data?.response?.data || {};
  return { awb: r.awb_code, courierName: r.courier_name };
}

// Live tracking by AWB: returns the current status and recent scan activities.
async function track(awb) {
  const data = await api('GET', `/courier/track/awb/${encodeURIComponent(awb)}`);
  const t = data?.tracking_data || {};
  return {
    status: t.shipment_track?.[0]?.current_status || t.track_status || 'unknown',
    eta: t.etd || '',
    activities: (t.shipment_track_activities || []).slice(0, 10).map((a) => ({
      at: a.date,
      location: a.location,
      activity: a.activity,
    })),
  };
}

module.exports = { enabled, serviceability, createShipment, assignAwb, track };
