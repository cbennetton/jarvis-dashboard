const express = require('express');
const router = express.Router();
const { loadDB } = require('../utils/db');
const { requireAuth } = require('../middleware/auth');

// Get repos
router.get('/', requireAuth, (req, res) => {
  const db = loadDB();
  res.json(db.repos || []);
});

module.exports = router;
