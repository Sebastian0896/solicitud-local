const express = require('express');
const { submitRating } = require('../controllers/ratingController');
const { authenticate, requireCustomer } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticate, requireCustomer, submitRating);

module.exports = router;
