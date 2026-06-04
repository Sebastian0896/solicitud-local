// src/routes/requestRoutes.js
const express = require('express');
const { 
  createRequest, 
  getPendingRequests, 
  acceptRequest,
  getCustomerRequests,
  getProviderAssignedRequests,
  updateRequestStatus,
  cancelRequest
} = require('../controllers/requestController');
const { authenticate, requireCustomer, requireProvider } = require('../middleware/auth');

const router = express.Router();

// Rutas de cliente
router.post('/', authenticate, requireCustomer, createRequest);
router.get('/customer', authenticate, requireCustomer, getCustomerRequests);
router.delete('/:requestId/cancel', authenticate, requireCustomer, cancelRequest);

// Rutas de proveedor
router.get('/pending', authenticate, requireProvider, getPendingRequests);
router.post('/:requestId/accept', authenticate, requireProvider, acceptRequest);
router.get('/provider/assigned', authenticate, requireProvider, getProviderAssignedRequests);
router.put('/:requestId/status', authenticate, requireProvider, updateRequestStatus);

module.exports = router;