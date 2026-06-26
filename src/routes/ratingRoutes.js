const express = require('express');
const { submitRating, getProviderRatings, submitProviderRating } = require('../controllers/ratingController');
const { authenticate, requireCustomer, requireProvider } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticate, requireCustomer, submitRating);
router.post('/provider-rates', authenticate, requireProvider, submitProviderRating);
router.get('/provider/:providerId', authenticate, getProviderRatings);

module.exports = router;
