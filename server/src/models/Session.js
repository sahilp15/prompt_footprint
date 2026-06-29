const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Session = sequelize.define('Session', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'user_id'
  },
  startTime: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'start_time'
  },
  endTime: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'end_time'
  },
  totalTokens: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    field: 'total_tokens'
  },
  totalEnergyWh: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
    field: 'total_energy_wh'
  },
  totalWaterMl: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
    field: 'total_water_ml'
  },
  totalCo2G: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
    field: 'total_co2_g'
  },
  queryCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    field: 'query_count'
  }
}, {
  tableName: 'sessions',
  underscored: true,
  indexes: [{ fields: ['user_id'] }]
});

module.exports = Session;
