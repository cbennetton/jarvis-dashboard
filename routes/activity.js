const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { SESSIONS_DIR } = require('../config/paths');
const { parseRecentActivity } = require('../utils/parsers');

// Helper to find main agent session file
function getMainAgentSessionFile() {
  const sessionsFile = path.join(SESSIONS_DIR, 'sessions.json');
  if (!fs.existsSync(sessionsFile)) return null;
  
  try {
    const sessionsData = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
    
    // Find main agent session (discord channel)
    for (const [sessionKey, sessionData] of Object.entries(sessionsData)) {
      if (sessionKey.includes('discord:channel:') && !sessionKey.includes(':subagent:')) {
        const sessionFile = path.join(SESSIONS_DIR, `${sessionData.sessionId}.jsonl`);
        if (fs.existsSync(sessionFile)) {
          return sessionFile;
        }
      }
    }
    
    // Fallback: newest non-subagent session
    let newestSession = null;
    let newestTime = 0;
    for (const [sessionKey, sessionData] of Object.entries(sessionsData)) {
      if (sessionKey.includes(':subagent:')) continue;
      const sessionFile = path.join(SESSIONS_DIR, `${sessionData.sessionId}.jsonl`);
      if (fs.existsSync(sessionFile)) {
        const mtime = fs.statSync(sessionFile).mtimeMs;
        if (mtime > newestTime) {
          newestTime = mtime;
          newestSession = sessionFile;
        }
      }
    }
    return newestSession;
  } catch (e) {
    console.error('Error finding main agent session:', e);
    return null;
  }
}

// GET /api/main-agent-activity - Get recent main agent activity
router.get('/', requireAuth, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const sessionFile = getMainAgentSessionFile();
    
    if (!sessionFile) {
      return res.json({ activities: [], timestamp: Date.now() });
    }
    
    const activities = parseRecentActivity(sessionFile, limit);
    
    res.json({
      activities,
      count: activities.length,
      timestamp: Date.now()
    });
  } catch (e) {
    console.error('Main agent activity API error:', e);
    res.status(500).json({ 
      error: 'Failed to get main agent activity', 
      activities: [] 
    });
  }
});

module.exports = router;
