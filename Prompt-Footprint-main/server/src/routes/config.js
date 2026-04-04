const express = require('express');
const router = express.Router();
const { getConfig, updateConfig } = require('../controllers/configController');

router.get('/', getConfig);
router.put('/', updateConfig);

module.exports = router;
