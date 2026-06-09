// src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { 
  register, 
  login, 
  refreshToken, 
  logout,
  revokeAllUserTokens 
} = require('../controllers/authController');

router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refreshToken);
router.post('/logout', authenticate, logout);
router.post('/revoke-all', authenticate, revokeAllUserTokens);

module.exports = router;