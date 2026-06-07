const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const {
  getCategories,
  getProviderCategories,
  assignCategoriesToProvider
} = require('../controllers/categoryController');

// Obtener todas las categorías (cualquier usuario autenticado)
router.get('/', authenticate, getCategories);

// Obtener categorías de un proveedor (opcional: pasar ID)
router.get('/provider/:providerId?', authenticate, getProviderCategories);

// Asignar categorías al proveedor autenticado
router.put('/provider/categories', authenticate, assignCategoriesToProvider);

module.exports = router;