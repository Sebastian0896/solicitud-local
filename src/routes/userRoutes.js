const express = require('express');
const { 
  toggleAvailability, 
  updateProfile, 
  updateLocation,
  getProviderStats,
  getProfile,
  saveFcmToken
} = require('../controllers/userController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.put('/availability', authenticate, toggleAvailability);
router.put('/profile', authenticate, updateProfile);
router.put('/location', authenticate, updateLocation);
router.get('/provider/stats', authenticate, getProviderStats);
router.get('/profile', authenticate, getProfile);
router.post('/fcm-token', authenticate, saveFcmToken);

module.exports = router;