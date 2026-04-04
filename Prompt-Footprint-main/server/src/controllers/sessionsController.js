const { Op } = require('sequelize');
const { Session, Query } = require('../models');

async function createSession(req, res, next) {
  try {
    const { userId, startTime } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const session = await Session.create({
      userId,
      startTime: startTime || new Date().toISOString()
    });
    res.status(201).json(session);
  } catch (err) {
    next(err);
  }
}

async function getSessions(req, res, next) {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId query param is required' });

    const sessions = await Session.findAll({
      where: { userId },
      order: [['start_time', 'DESC']],
      include: [{ model: Query, as: 'queries', order: [['timestamp', 'ASC']] }]
    });
    res.json(sessions);
  } catch (err) {
    next(err);
  }
}

async function getWeeklyStats(req, res, next) {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId query param is required' });

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const sessions = await Session.findAll({
      where: {
        userId,
        startTime: { [Op.gte]: oneWeekAgo }
      },
      order: [['start_time', 'ASC']]
    });

    const totals = sessions.reduce((acc, s) => ({
      totalTokens: acc.totalTokens + s.totalTokens,
      totalEnergyWh: acc.totalEnergyWh + s.totalEnergyWh,
      totalWaterMl: acc.totalWaterMl + s.totalWaterMl,
      totalCo2G: acc.totalCo2G + s.totalCo2G,
      sessionCount: acc.sessionCount + 1,
      queryCount: acc.queryCount + s.queryCount
    }), { totalTokens: 0, totalEnergyWh: 0, totalWaterMl: 0, totalCo2G: 0, sessionCount: 0, queryCount: 0 });

    // Daily breakdown for charts
    const dailyMap = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      dailyMap[key] = { date: key, tokens: 0, energyWh: 0, waterMl: 0, co2G: 0, queries: 0 };
    }

    sessions.forEach(s => {
      const key = new Date(s.startTime).toISOString().split('T')[0];
      if (dailyMap[key]) {
        dailyMap[key].tokens += s.totalTokens;
        dailyMap[key].energyWh += s.totalEnergyWh;
        dailyMap[key].waterMl += s.totalWaterMl;
        dailyMap[key].co2G += s.totalCo2G;
        dailyMap[key].queries += s.queryCount;
      }
    });

    res.json({
      totals,
      daily: Object.values(dailyMap)
    });
  } catch (err) {
    next(err);
  }
}

async function updateSession(req, res, next) {
  try {
    const { id } = req.params;
    const updates = {};
    if (req.body.endTime) updates.endTime = req.body.endTime;
    if (req.body.totalTokens !== undefined) updates.totalTokens = req.body.totalTokens;
    if (req.body.totalEnergyWh !== undefined) updates.totalEnergyWh = req.body.totalEnergyWh;
    if (req.body.totalWaterMl !== undefined) updates.totalWaterMl = req.body.totalWaterMl;
    if (req.body.totalCo2G !== undefined) updates.totalCo2G = req.body.totalCo2G;
    if (req.body.queryCount !== undefined) updates.queryCount = req.body.queryCount;

    const [count] = await Session.update(updates, { where: { id } });
    if (count === 0) return res.status(404).json({ error: 'Session not found' });

    const session = await Session.findByPk(id);
    res.json(session);
  } catch (err) {
    next(err);
  }
}

module.exports = { createSession, getSessions, getWeeklyStats, updateSession };
