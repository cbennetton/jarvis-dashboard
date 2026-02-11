const { API_KEY } = require('../config/constants');

// Require user session authentication
function requireAuth(req, res, next) {
  if (req.session.authenticated) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

// Require API key for internal endpoints
function requireApiKey(req, res, next) {
  if (req.headers.authorization === `Bearer ${API_KEY}`) {
    return next();
  }
  res.status(401).json({ error: 'Invalid API key' });
}

module.exports = {
  requireAuth,
  requireApiKey
};
