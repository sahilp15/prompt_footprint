const sequelize = require('../config/database');
const Session = require('./Session');
const Query = require('./Query');
const UserConfig = require('./UserConfig');

Session.hasMany(Query, { foreignKey: 'session_id', as: 'queries' });
Query.belongsTo(Session, { foreignKey: 'session_id', as: 'session' });

module.exports = { sequelize, Session, Query, UserConfig };
