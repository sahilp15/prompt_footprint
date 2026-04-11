// SECURITY: Sanitize error responses — never leak internal details in production
function errorHandler(err, req, res, _next) {
  console.error('Server error:', err);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message || 'Internal server error'
  });
}

module.exports = errorHandler;
