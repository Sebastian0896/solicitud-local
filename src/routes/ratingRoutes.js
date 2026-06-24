const express = require('express');
const { submitRating, getProviderRatings } = require('../controllers/ratingController');
const { authenticate, requireCustomer } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticate, requireCustomer, submitRating);
router.get('/provider/:providerId', authenticate, getProviderRatings);

module.exports = router;
