const { UserConfig } = require('../models');

async function getConfig(req, res, next) {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId query param is required' });

    const [config] = await UserConfig.findOrCreate({
      where: { userId },
      defaults: { userId, overlayEnabled: true, energyPerTokenMultiplier: 1.0 }
    });
    res.json(config);
  } catch (err) {
    next(err);
  }
}

async function updateConfig(req, res, next) {
  try {
    const { userId, overlayEnabled, energyPerTokenMultiplier } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const [config, created] = await UserConfig.findOrCreate({
      where: { userId },
      defaults: { userId, overlayEnabled, energyPerTokenMultiplier }
    });

    if (!created) {
      if (overlayEnabled !== undefined) config.overlayEnabled = overlayEnabled;
      if (energyPerTokenMultiplier !== undefined) config.energyPerTokenMultiplier = energyPerTokenMultiplier;
      await config.save();
    }

    res.json(config);
  } catch (err) {
    next(err);
  }
}

module.exports = { getConfig, updateConfig };
