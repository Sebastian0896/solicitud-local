const express = require('express');
const {
  getStats,
  getUsers,
  toggleUserStatus,
  getRequests,
  cancelRequest,
  getSubscriptions,
  getOrdersReport,
  getReports,
} = require('../controllers/adminController');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Todas las rutas requieren autenticación y rol admin
router.use(authenticate);
router.use(requireAdmin);

// Dashboard
router.get('/stats', getStats);
router.get('/reports/orders', getOrdersReport);

// Usuarios
router.get('/users', getUsers);
router.put('/users/:userId/toggle', toggleUserStatus);

// Pedidos
router.get('/requests', getRequests);
router.delete('/requests/:requestId', cancelRequest);

// Suscripciones
router.get('/subscriptions', getSubscriptions);

// Reportes de usuarios
router.get('/user-reports', getReports);

module.exports = router;