// src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const {
  register,
  login,
  refreshToken,
  logout,
  revokeAllUserTokens,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPasswordPage,
  resetPassword,
} = require('../controllers/authController');

router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refreshToken);
router.post('/logout', authenticate, logout);
router.post('/revoke-all', authenticate, revokeAllUserTokens);
router.post('/verify-email', verifyEmail);
router.post('/resend-verification', resendVerification);
router.post('/forgot-password', forgotPassword);
router.get('/reset-page', resetPasswordPage);
router.post('/reset-password', resetPassword);

module.exports = router;