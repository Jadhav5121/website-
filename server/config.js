require('dotenv').config();

const str = (key, fallback = '') => (process.env[key] ?? fallback).toString().trim();
const num = (key, fallback) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && process.env[key] !== undefined && process.env[key] !== '' ? v : fallback;
};

const nodeEnv = str('NODE_ENV', 'development');

module.exports = {
  isProd: nodeEnv === 'production',
  nodeEnv,
  port: num('PORT', 3000),
  siteUrl: str('SITE_URL', 'http://localhost:3000'),
  databaseUrl: str('DATABASE_URL', 'postgres://kalshit:kalshit@localhost:5432/kalshit'),
  jwtSecret: str('JWT_SECRET', 'dev-only-insecure-secret'),
  otpSecret: str('OTP_SECRET', 'dev-only-insecure-otp-secret'),

  adminPassword: str('ADMIN_PASSWORD'),

  razorpay: {
    keyId: str('RAZORPAY_KEY_ID'),
    keySecret: str('RAZORPAY_KEY_SECRET'),
    webhookSecret: str('RAZORPAY_WEBHOOK_SECRET'),
  },

  shiprocket: {
    email: str('SHIPROCKET_EMAIL'),
    password: str('SHIPROCKET_PASSWORD'),
    pickupLocation: str('SHIPROCKET_PICKUP_LOCATION', 'Primary'),
    webhookToken: str('SHIPROCKET_WEBHOOK_TOKEN'),
  },

  whatsapp: {
    phoneNumberId: str('WHATSAPP_PHONE_NUMBER_ID'),
    accessToken: str('WHATSAPP_ACCESS_TOKEN'),
    templateConfirmed: str('WHATSAPP_TEMPLATE_CONFIRMED', 'order_confirmed'),
    templateDispatched: str('WHATSAPP_TEMPLATE_DISPATCHED', 'order_dispatched'),
  },

  msg91: {
    authKey: str('MSG91_AUTH_KEY'),
    senderId: str('MSG91_SENDER_ID'),
    otpTemplateId: str('MSG91_OTP_TEMPLATE_ID'),
    orderTemplateId: str('MSG91_ORDER_TEMPLATE_ID'),
  },

  googleClientId: str('GOOGLE_CLIENT_ID'),

  anthropic: {
    apiKey: str('ANTHROPIC_API_KEY'),
    model: str('ANTHROPIC_MODEL', 'claude-haiku-5-5'),
  },

  // Store rules. Money is stored in paise (1 rupee = 100 paise) everywhere in the database.
  store: {
    brand: 'कळशीत कळशी',
    brandLatin: 'Kalshit',
    freeShippingOverPaise: 99900,
    shippingFeePaise: 9900,
    customPrintFeePaise: 19900,
    // Default GST slabs for apparel. Confirm the current rates with your accountant.
    defaults: {
      legalName: '',
      gstin: '',
      address: '',
      stateCode: '',
      state: '',
      pickupPin: '',
      lowRate: 5,
      highRate: 18,
      thresholdPaise: 250000,
    },
  },
};
