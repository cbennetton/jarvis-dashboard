const express = require('express');
const router = express.Router();
const { loadDB, saveDB } = require('../utils/db');
const { requireAuth, requireApiKey } = require('../middleware/auth');

// Get current status
router.get('/', requireAuth, (req, res) => {
  const TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
  const db = loadDB();
  const status = { ...db.currentStatus };
  
  // Auto-timeout: if active but no update for 15 minutes, show as inactive (grey)
  const lastUpdate = status.updatedAt || status.startedAt;
  if (status.active && lastUpdate && (Date.now() - lastUpdate > TIMEOUT_MS)) {
    status.active = false;
    status.timedOut = true;
  }
  
  res.json(status);
});

// Get activities
router.get('/activities', requireAuth, (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const since = Date.now() - (hours * 60 * 60 * 1000);
  const db = loadDB();
  res.json(db.activities.filter(a => a.timestamp >= since));
});

// Get stats
router.get('/stats', requireAuth, (req, res) => {
  const db = loadDB();
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  
  const hourlyStats = [];
  for (let i = 23; i >= 0; i--) {
    const hourStart = now - (i + 1) * hourMs;
    const hourEnd = now - i * hourMs;
    const activities = db.activities.filter(a => a.timestamp >= hourStart && a.timestamp < hourEnd);
    const activeTime = activities.reduce((sum, a) => sum + (a.duration || 0), 0);
    hourlyStats.push({ 
      hour: new Date(hourEnd).getHours(), 
      activeMinutes: Math.round(activeTime / 60000), 
      count: activities.length 
    });
  }
  
  const dailyStats = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = now - (i + 1) * dayMs;
    const dayEnd = now - i * dayMs;
    const activities = db.activities.filter(a => a.timestamp >= dayStart && a.timestamp < dayEnd);
    const activeTime = activities.reduce((sum, a) => sum + (a.duration || 0), 0);
    dailyStats.push({ 
      date: new Date(dayEnd).toLocaleDateString('en-US', { weekday: 'short' }), 
      activeMinutes: Math.round(activeTime / 60000), 
      count: activities.length 
    });
  }
  
  const totalActiveTime = db.activities.reduce((sum, a) => sum + (a.duration || 0), 0);
  res.json({
    hourly: hourlyStats,
    daily: dailyStats,
    total: { 
      activities: db.activities.length, 
      activeHours: Math.round(totalActiveTime / 3600000 * 10) / 10 
    }
  });
});

// Internal API: Update status
router.post('/internal', requireApiKey, (req, res) => {
  const { active, task } = req.body;
  const db = loadDB();
  const now = Date.now();
  
  // If going from active to inactive, log the activity
  if (db.currentStatus.active && !active && db.currentStatus.startedAt) {
    db.activities.push({
      task: db.currentStatus.task,
      timestamp: db.currentStatus.startedAt,
      duration: now - db.currentStatus.startedAt,
      endedAt: now
    });
    if (db.activities.length > 1000) {
      db.activities = db.activities.slice(-1000);
    }
  }
  
  // Update status with updatedAt timestamp for timeout tracking
  db.currentStatus = { 
    active: !!active, 
    task: active ? task : null, 
    startedAt: active ? (db.currentStatus.startedAt || now) : null,
    updatedAt: now
  };
  
  saveDB(db);
  res.json({ success: true });
});

module.exports = router;
