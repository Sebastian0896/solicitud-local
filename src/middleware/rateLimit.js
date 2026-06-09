const rateLimit = require('express-rate-limit');

// Límite general para todas las rutas
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 peticiones por IP
  message: { error: 'Demasiadas peticiones. Intenta de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Límite estricto para autenticación
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 intentos de login/registro
  message: { error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.' },
  skipSuccessfulRequests: true, // No contar peticiones exitosas
});

// Límite para creación de pedidos
const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 20, // 20 pedidos por hora
  message: { error: 'Has alcanzado el límite de pedidos por hora.' },
});

// Límite para eventos (chat, precios)
const eventLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 30, // 30 eventos por minuto
  message: { error: 'Demasiadas acciones. Espera un momento.' },
});

module.exports = {
  generalLimiter,
  authLimiter,
  requestLimiter,
  eventLimiter,
};