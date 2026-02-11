const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { loadDB, saveDB } = require('../utils/db');
const { loginLimiter, setupLimiter } = require('../middleware/rateLimit');

// Check if setup is needed
router.get('/needs-setup', (req, res) => {
  const db = loadDB();
  console.log('needs-setup called, users:', db.users.length);
  res.json({ needsSetup: db.users.length === 0 });
});

// Check authentication status
router.get('/auth-check', (req, res) => {
  res.json({ authenticated: !!req.session.authenticated });
});

// Login endpoint
router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  console.log('Login attempt for:', username);
  
  const db = loadDB();
  const user = db.users.find(u => u.username === username);
  
  if (user && await bcrypt.compare(password, user.password)) {
    req.session.authenticated = true;
    req.session.username = username;
    console.log('Login success');
    
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      res.json({ success: true });
    } else if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
      res.json({ success: true });
    } else {
      res.redirect('/');
    }
  } else {
    console.log('Login failed');
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      res.status(401).json({ error: 'Invalid credentials' });
    } else if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
      res.status(401).json({ error: 'Invalid credentials' });
    } else {
      res.redirect('/?error=invalid');
    }
  }
});

// Logout endpoint
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Setup endpoint (first-time configuration)
router.post('/setup', setupLimiter, async (req, res) => {
  const db = loadDB();
  
  if (db.users.length > 0) {
    return res.status(403).json({ error: 'Already configured' });
  }
  
  const { username, password } = req.body;
  
  if (!username || !password || password.length < 6) {
    return res.status(400).json({ error: 'Username and password (min 6 chars) required' });
  }
  
  const hash = await bcrypt.hash(password, 10);
  db.users.push({ username, password: hash });
  saveDB(db);
  
  req.session.authenticated = true;
  res.json({ success: true });
});

module.exports = router;
