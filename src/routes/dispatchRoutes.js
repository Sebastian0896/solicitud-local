// src/routes/dispatchRoutes.js
const express = require('express');
const { authenticate, requireProvider, requireDelivery } = require('../middleware/auth');
const {
  createDispatchCode,
  getProviderDispatchCodes,
  getDispatchCode,
  addRequestToDispatch,
  removeRequestFromDispatch,
  assignDelivery,
  getDeliveryDispatchCodes,
  confirmDispatch,
  departDispatch,
  deliverRequest,
  closeDispatch,
  reopenDispatch,
  rejectDispatch,
  lookupDelivery,
  deleteDispatchCode,
  getAvailableRequests,
} = require('../controllers/dispatchController');

const router = express.Router();

// ── Proveedor ──────────────────────────────────────────────
router.post('/', authenticate, requireProvider, createDispatchCode);
router.get('/', authenticate, requireProvider, getProviderDispatchCodes);
router.get('/lookup-delivery', authenticate, requireProvider, lookupDelivery);
router.post('/:id/requests', authenticate, requireProvider, addRequestToDispatch);
router.delete('/:id/requests/:requestId', authenticate, requireProvider, removeRequestFromDispatch);
router.post('/:id/assign', authenticate, requireProvider, assignDelivery);
router.delete('/:id', authenticate, requireProvider, deleteDispatchCode);
router.post('/:id/close', authenticate, requireProvider, closeDispatch);
router.post('/:id/reopen', authenticate, requireProvider, reopenDispatch);
router.get('/:id/available-requests', authenticate, requireProvider, getAvailableRequests);

// ── Delivery ───────────────────────────────────────────────
router.get('/my', authenticate, requireDelivery, getDeliveryDispatchCodes);
router.post('/:id/confirm', authenticate, requireDelivery, confirmDispatch);
router.post('/:id/reject', authenticate, requireDelivery, rejectDispatch);
router.post('/:id/depart', authenticate, requireDelivery, departDispatch);
router.post('/:id/deliver/:requestId', authenticate, requireDelivery, deliverRequest);

// ── Compartido (proveedor o delivery pueden ver el detalle) ─
router.get('/:id', authenticate, getDispatchCode);

module.exports = router;
