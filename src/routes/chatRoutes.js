const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const {
  sendMessage,
  getMessages,
  markAsRead,
  getUnreadCount
} = require('../controllers/chatController');

// Enviar mensaje
router.post('/requests/:requestId/messages', authenticate, sendMessage);

// Obtener mensajes de un pedido
router.get('/requests/:requestId/messages', authenticate, getMessages);

// Marcar mensajes como leídos
router.put('/requests/:requestId/read', authenticate, markAsRead);

// Obtener contador de mensajes no leídos
router.get('/unread', authenticate, getUnreadCount);

module.exports = router;