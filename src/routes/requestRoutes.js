// src/routes/requestRoutes.js
const express = require('express');
const {
  createRequest,
  getPendingRequests,
  acceptRequest,
  getCustomerRequests,
  getCustomerHistory,
  getProviderAssignedRequests,
  updateRequestStatus,
  cancelRequest,
  deleteRequest,
  repeatRequest,
  getProviderHistory,
} = require('../controllers/requests');
const { authenticate, requireCustomer, requireProvider } = require('../middleware/auth');

const router = express.Router();

// Rutas de cliente
router.post('/', authenticate, requireCustomer, createRequest);
router.get('/customer', authenticate, requireCustomer, getCustomerRequests);
router.get('/customer/history', authenticate, requireCustomer, getCustomerHistory);
router.delete('/:requestId/cancel', authenticate, requireCustomer, cancelRequest);

// Rutas de proveedor
router.get('/provider/history', authenticate, requireProvider, getProviderHistory);
router.get('/pending', authenticate, requireProvider, getPendingRequests);
router.post('/:requestId/accept', authenticate, requireProvider, acceptRequest);
router.get('/provider/assigned', authenticate, requireProvider, getProviderAssignedRequests);
router.put('/:requestId/status', authenticate, requireProvider, updateRequestStatus);

//Ruta delete request o repeat request
// routes/requestRoutes.js
router.delete('/:requestId/delete', authenticate, deleteRequest);
router.post('/:requestId/repeat', authenticate, repeatRequest);

module.exports = router;