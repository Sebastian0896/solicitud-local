const express = require('express')
const router = express.Router();

const { authenticate} = require('../middleware/auth'); // Ajusta la ruta según tu middleware
const {
  getRequestLocations,
  getNearbyProviders
} = require('../controllers/locationController');

// Ruta para obtener ubicaciones de un pedido específico
// GET /api/locations/request/:requestId
router.get('/request/:requestId', authenticate, getRequestLocations);

// Ruta para obtener proveedores cercanos
// GET /api/locations/nearby-providers?lat=xxx&lng=xxx&radius=5&limit=10
router.get('/nearby-providers', authenticate, getNearbyProviders);

module.exports = router;