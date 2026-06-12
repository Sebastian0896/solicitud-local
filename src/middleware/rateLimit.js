const rateLimit = require('express-rate-limit');

// General: todas las rutas autenticadas — ventana 1 min, 300 req
// Justificación: un usuario en NegotiationScreen genera ~56 req/min entre
// chat polling (3s) y events polling (5s). Con la optimización de polling
// incremental esto baja a ~25/min, pero dejamos margen para uso normal.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { error: 'Demasiadas peticiones. Espera un momento.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip, // por usuario, no por IP
});

// Auth: login/registro — estricto, ventana 15 min, 5 intentos fallidos
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.' },
  skipSuccessfulRequests: true,
});

// Creación de pedidos — 20 por minuto es más que suficiente
const requestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Demasiados pedidos en poco tiempo. Espera un momento.' },
  keyGenerator: (req) => req.user?.id || req.ip,
});

// Eventos (precio, estado) — escrituras, no polling. 60/min es amplio.
const eventLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Demasiadas acciones. Espera un momento.' },
  keyGenerator: (req) => req.user?.id || req.ip,
});

module.exports = {
  generalLimiter,
  authLimiter,
  requestLimiter,
  eventLimiter,
};
