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

// SECURITY: Restrict CORS to known origins only
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (extensions, server-to-server, curl)
    if (!origin) {
      callback(null, true);
      return;
    }

    // Allow Chrome extensions
    if (origin.startsWith('chrome-extension://')) {
      callback(null, true);
      return;
    }

    // Allow the stats site
    if (origin === 'https://prompt-footprint-2bjl.vercel.app') {
      callback(null, true);
      return;
    }

    // Allow localhost in development only
    if (process.env.NODE_ENV !== 'production' &&
        (origin.startsWith('http://localhost') || origin.startsWith('https://localhost'))) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS: Origin ${origin} not allowed`));
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

    // SECURITY: Only auto-sync schema in development; use migrations in production
    if (process.env.NODE_ENV === 'production') {
      console.log('Production mode — skipping schema sync (use migrations)');
    } else {
      await sequelize.sync({ alter: true });
      console.log('Models synced (dev mode)');
    }

    app.listen(PORT, () => {
      console.log(`PromptFootprint API running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
