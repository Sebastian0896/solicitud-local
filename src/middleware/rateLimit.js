const rateLimit = require('express-rate-limit');

// Helper para normalizar IPv6 a IPv4 cuando aplica
const ipKey = (ip) => {
  if (!ip) return 'unknown';
  // Mapeo IPv4-en-IPv6 (::ffff:1.2.3.4) → toma solo la parte IPv4
  if (ip.startsWith('::ffff:')) return ip.substring(7);
  return ip;
};

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { error: 'Demasiadas peticiones. Espera un momento.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKey(req.ip),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.' },
  skipSuccessfulRequests: true,
  keyGenerator: (req) => ipKey(req.ip),
});

const requestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Demasiados pedidos en poco tiempo. Espera un momento.' },
  keyGenerator: (req) => req.user?.id || ipKey(req.ip),
});

const eventLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Demasiadas acciones. Espera un momento.' },
  keyGenerator: (req) => req.user?.id || ipKey(req.ip),
});

module.exports = {
  generalLimiter,
  authLimiter,
  requestLimiter,
  eventLimiter,
};
