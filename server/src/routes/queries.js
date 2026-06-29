const express = require('express');
const router = express.Router();
const { createQuery, getQueries } = require('../controllers/queriesController');

router.post('/', createQuery);
router.get('/', getQueries);

module.exports = router;
