const express = require('express');
const {
  createPaymentSession,
  cardnetWebhook,
  cardnetReturn,
  activateSubscription,
  checkSubscription,
} = require('../controllers/subscriptionController');
const { authenticate, requireProvider } = require('../middleware/auth');

const router = express.Router();

// ── Flujo de pago CardNet ─────────────────────────────────────────────────────
// Inicia sesión de pago → devuelve la URL de la página de Azul
router.post('/pay', authenticate, requireProvider, createPaymentSession);

// Webhook de CardNet — NO lleva JWT (CardNet llama directamente)
router.post('/cardnet/webhook', cardnetWebhook);

// URL de retorno — Azul redirige aquí; el WebView de Flutter la intercepta
router.get('/cardnet/return', cardnetReturn);

// ── Rutas existentes ──────────────────────────────────────────────────────────
router.post('/activate', authenticate, requireProvider, activateSubscription);
router.get('/status', authenticate, requireProvider, checkSubscription);

module.exports = router;
