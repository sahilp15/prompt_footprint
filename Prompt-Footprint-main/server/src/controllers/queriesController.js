const { Session, Query } = require('../models');
const sequelize = require('../config/database');

async function createQuery(req, res, next) {
  try {
    const { sessionId, promptTokens, responseTokens, totalTokens, energyWh, waterMl, co2G } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const result = await sequelize.transaction(async (t) => {
      const query = await Query.create({
        sessionId,
        promptTokens,
        responseTokens,
        totalTokens,
        energyWh,
        waterMl,
        co2G,
        timestamp: new Date().toISOString()
      }, { transaction: t });

      await Session.increment({
        totalTokens: totalTokens,
        totalEnergyWh: energyWh,
        totalWaterMl: waterMl,
        totalCo2G: co2G,
        queryCount: 1
      }, {
        where: { id: sessionId },
        transaction: t
      });

      return query;
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function getQueries(req, res, next) {
  try {
    const { sessionId } = req.query;
    if (!sessionId) return res.status(400).json({ error: 'sessionId query param is required' });

    const queries = await Query.findAll({
      where: { sessionId },
      order: [['timestamp', 'ASC']]
    });
    res.json(queries);
  } catch (err) {
    next(err);
  }
}

module.exports = { createQuery, getQueries };
