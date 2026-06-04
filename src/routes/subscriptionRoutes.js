const express = require('express');
const { activateSubscription, checkSubscription } = require('../controllers/subscriptionController');
const { authenticate, requireProvider } = require('../middleware/auth');

const router = express.Router();

router.post('/activate', authenticate, requireProvider, activateSubscription);
router.get('/status', authenticate, requireProvider, checkSubscription);

module.exports = router;