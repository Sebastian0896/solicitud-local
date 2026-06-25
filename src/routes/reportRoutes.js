const express = require('express');
const { submitReport } = require('../controllers/reportController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticate, submitReport);

module.exports = router;
