const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Query = sequelize.define('Query', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  sessionId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'session_id'
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  promptTokens: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'prompt_tokens'
  },
  responseTokens: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'response_tokens'
  },
  totalTokens: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'total_tokens'
  },
  energyWh: {
    type: DataTypes.FLOAT,
    allowNull: false,
    field: 'energy_wh'
  },
  waterMl: {
    type: DataTypes.FLOAT,
    allowNull: false,
    field: 'water_ml'
  },
  co2G: {
    type: DataTypes.FLOAT,
    allowNull: false,
    field: 'co2_g'
  }
}, {
  tableName: 'queries',
  underscored: true,
  indexes: [{ fields: ['session_id'] }]
});

module.exports = Query;
