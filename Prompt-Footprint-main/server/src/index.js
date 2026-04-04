require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { sequelize } = require('./models');
const sessionsRouter = require('./routes/sessions');
const queriesRouter = require('./routes/queries');
const configRouter = require('./routes/config');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: (origin, callback) => {
    // Allow Chrome extensions, localhost dev servers, and no-origin requests
    if (!origin ||
        origin.startsWith('chrome-extension://') ||
        origin.startsWith('http://localhost') ||
        origin.startsWith('https://localhost')) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all in dev; restrict in production
    }
  },
  credentials: true
}));

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/sessions', sessionsRouter);
app.use('/api/queries', queriesRouter);
app.use('/api/config', configRouter);

app.use(errorHandler);

async function start() {
  try {
    await sequelize.authenticate();
    console.log('Database connected');
    await sequelize.sync({ alter: true });
    console.log('Models synced');
    app.listen(PORT, () => {
      console.log(`PromptFootprint API running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
