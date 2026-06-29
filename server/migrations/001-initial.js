'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('sessions', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      user_id: {
        type: Sequelize.STRING,
        allowNull: false
      },
      start_time: {
        type: Sequelize.DATE,
        allowNull: false
      },
      end_time: {
        type: Sequelize.DATE,
        allowNull: true
      },
      total_tokens: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      total_energy_wh: {
        type: Sequelize.FLOAT,
        defaultValue: 0
      },
      total_water_ml: {
        type: Sequelize.FLOAT,
        defaultValue: 0
      },
      total_co2_g: {
        type: Sequelize.FLOAT,
        defaultValue: 0
      },
      query_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });

    await queryInterface.addIndex('sessions', ['user_id']);

    await queryInterface.createTable('queries', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      session_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'sessions', key: 'id' },
        onDelete: 'CASCADE'
      },
      timestamp: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW
      },
      prompt_tokens: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      response_tokens: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      total_tokens: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      energy_wh: {
        type: Sequelize.FLOAT,
        allowNull: false
      },
      water_ml: {
        type: Sequelize.FLOAT,
        allowNull: false
      },
      co2_g: {
        type: Sequelize.FLOAT,
        allowNull: false
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });

    await queryInterface.addIndex('queries', ['session_id']);

    await queryInterface.createTable('user_configs', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      user_id: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true
      },
      overlay_enabled: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      energy_per_token_multiplier: {
        type: Sequelize.FLOAT,
        defaultValue: 1.0
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('queries');
    await queryInterface.dropTable('sessions');
    await queryInterface.dropTable('user_configs');
  }
};
