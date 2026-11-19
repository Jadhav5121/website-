const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');

const CUSTOMER_COOKIE = 'kt_customer';
const ADMIN_COOKIE = 'kt_admin';
const CUSTOMER_TTL_DAYS = 30;
const ADMIN_TTL_HOURS = 12;

const cookieBase = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProd,
  path: '/',
});

function setCustomerSession(res, customerId) {
  const token = jwt.sign({ sub: String(customerId), role: 'customer' }, config.jwtSecret, { expiresIn: `${CUSTOMER_TTL_DAYS}d` });
  res.cookie(CUSTOMER_COOKIE, token, { ...cookieBase(), maxAge: CUSTOMER_TTL_DAYS * 864e5 });
}

function clearCustomerSession(res) {
  res.clearCookie(CUSTOMER_COOKIE, cookieBase());
}

function setAdminSession(res) {
  const token = jwt.sign({ role: 'admin' }, config.jwtSecret, { expiresIn: `${ADMIN_TTL_HOURS}h` });
  res.cookie(ADMIN_COOKIE, token, { ...cookieBase(), maxAge: ADMIN_TTL_HOURS * 36e5 });
}

function clearAdminSession(res) {
  res.clearCookie(ADMIN_COOKIE, cookieBase());
}

function readToken(req, name) {
  const raw = req.cookies?.[name];
  if (!raw) return null;
  try {
    return jwt.verify(raw, config.jwtSecret);
  } catch {
    return null;
  }
}

function requireCustomer(req, res, next) {
  const claims = readToken(req, CUSTOMER_COOKIE);
  if (!claims || claims.role !== 'customer') return res.status(401).json({ error: 'Please sign in.' });
  req.customerId = Number(claims.sub);
  next();
}

function requireAdmin(req, res, next) {
  const claims = readToken(req, ADMIN_COOKIE);
  if (!claims || claims.role !== 'admin') return res.status(401).json({ error: 'Admin sign-in required.' });
  next();
}

// OTP: 6 digits, stored as an HMAC so the database never holds a usable code.
function newOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashOtp(phone, code) {
  return crypto.createHmac('sha256', config.otpSecret).update(`${phone}:${code}`).digest('hex');
}

function safeEqualHex(a, b) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function checkAdminPassword(input) {
  if (!config.adminPassword) return false;
  const a = crypto.createHash('sha256').update(String(input)).digest();
  const b = crypto.createHash('sha256').update(config.adminPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  setCustomerSession,
  clearCustomerSession,
  setAdminSession,
  clearAdminSession,
  requireCustomer,
  requireAdmin,
  readToken,
  CUSTOMER_COOKIE,
  newOtp,
  hashOtp,
  safeEqualHex,
  checkAdminPassword,
};
