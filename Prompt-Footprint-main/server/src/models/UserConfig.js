const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const UserConfig = sequelize.define('UserConfig', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    field: 'user_id'
  },
  overlayEnabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    field: 'overlay_enabled'
  },
  energyPerTokenMultiplier: {
    type: DataTypes.FLOAT,
    defaultValue: 1.0,
    field: 'energy_per_token_multiplier'
  }
}, {
  tableName: 'user_configs',
  underscored: true
});

module.exports = UserConfig;
