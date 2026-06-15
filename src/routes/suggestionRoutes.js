const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { createSuggestion, getSuggestions } = require('../controllers/suggestionController');

const router = express.Router();

router.post('/', authenticate, createSuggestion);
router.get('/', authenticate, requireAdmin, getSuggestions);

module.exports = router;
