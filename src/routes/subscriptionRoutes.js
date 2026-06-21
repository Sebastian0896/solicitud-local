const express = require('express');
const {
  createCheckoutSession,
  lsWebhook,
  lsReturn,
  getManagement,
  activateSubscription,
  checkSubscription,
} = require('../controllers/subscriptionController');
const { authenticate, requireProvider } = require('../middleware/auth');

const router = express.Router();

// ── Lemon Squeezy ─────────────────────────────────────────────────────────────
// Crea sesión de checkout → devuelve la URL de la página de LS
router.post('/checkout', authenticate, requireProvider, createCheckoutSession);

// Webhook de LS — NO lleva JWT (LS llama directamente)
router.post('/ls/webhook', lsWebhook);

// URL de retorno — LS redirige aquí; el WebView de Flutter la intercepta
router.get('/ls/return', lsReturn);

// ── Rutas comunes ─────────────────────────────────────────────────────────────
router.get('/manage', authenticate, requireProvider, getManagement);
router.post('/activate', authenticate, requireProvider, activateSubscription);
router.get('/status', authenticate, requireProvider, checkSubscription);

module.exports = router;
