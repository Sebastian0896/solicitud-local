const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const {
  addRequestEvent,
  getRequestTimeline,
  getRecentEvents
} = require('../controllers/eventController');

// Agregar evento a un pedido
router.post('/requests/:id/events', authenticate, addRequestEvent);

// Obtener timeline completo de un pedido
router.get('/requests/:id/timeline', authenticate, getRequestTimeline);

// Obtener eventos recientes (para polling)
router.get('/requests/:id/events/recent', authenticate, getRecentEvents);

module.exports = router;