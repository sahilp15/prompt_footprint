const express = require('express');
const router = express.Router();
const { createSession, getSessions, getWeeklyStats, updateSession } = require('../controllers/sessionsController');

router.post('/', createSession);
router.get('/weekly', getWeeklyStats);
router.get('/', getSessions);
router.patch('/:id', updateSession);

module.exports = router;
