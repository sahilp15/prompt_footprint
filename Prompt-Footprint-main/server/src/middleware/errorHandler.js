function errorHandler(err, req, res, _next) {
  console.error('Server error:', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
}

module.exports = errorHandler;
