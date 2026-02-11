const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { SESSIONS_DIR } = require('../config/paths');

// GET /api/subagents - Get active subagents
router.get('/', requireAuth, (req, res) => {
  try {
    const SUBAGENT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    const now = Date.now();
    const subagents = [];
    
    const sessionsFile = path.join(SESSIONS_DIR, 'sessions.json');
    if (!fs.existsSync(sessionsFile)) {
      return res.json({ 
        subagents: [], 
        timestamp: now, 
        activeCount: 0, 
        totalCount: 0 
      });
    }
    
    // Read sessions.json which contains all active sessions
    const sessionsData = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
    
    // Filter for subagent sessions
    for (const [sessionKey, sessionData] of Object.entries(sessionsData)) {
      if (!sessionKey.includes(':subagent:')) continue;
      
      const lastActivity = sessionData.updatedAt || 0;
      const isActive = (now - lastActivity) < SUBAGENT_TIMEOUT_MS;
      
      if (!isActive) continue; // Skip inactive
      
      // Extract subagent ID
      const fullId = sessionKey.split(':subagent:')[1] || sessionKey;
      
      // Get start time from transcript
      let startedAt = lastActivity; // fallback
      try {
        const transcriptPath = path.join(SESSIONS_DIR, `${sessionData.sessionId}.jsonl`);
        if (fs.existsSync(transcriptPath)) {
          const firstLine = fs.readFileSync(transcriptPath, 'utf8').split('\n')[0];
          if (firstLine) {
            const firstMsg = JSON.parse(firstLine);
            if (firstMsg.timestamp) {
              startedAt = new Date(firstMsg.timestamp).getTime();
            }
          }
        }
      } catch (e) {
        // Fallback to updatedAt if transcript read fails
      }
      
      // Format model name nicely
      const rawModel = sessionData.model || sessionData.modelOverride || 'default';
      let modelName = rawModel;
      if (rawModel.includes('opus')) modelName = 'Opus';
      else if (rawModel.includes('sonnet')) modelName = 'Sonnet';
      else if (rawModel.includes('haiku')) modelName = 'Haiku';
      else if (rawModel.includes('gpt-4')) modelName = 'GPT-4';
      else if (rawModel.includes('gpt-3')) modelName = 'GPT-3.5';
      
      subagents.push({
        id: fullId,
        shortId: fullId.substring(0, 8),
        task: sessionData.label || 'Running...',
        model: modelName,
        rawModel: rawModel,
        startedAt: startedAt,
        lastActivity: lastActivity,
        duration: Math.floor((now - startedAt) / 1000), // Duration from start
        active: true,
        sessionKey: sessionKey
      });
    }
    
    // Sort by most recent activity
    subagents.sort((a, b) => b.lastActivity - a.lastActivity);
    
    res.json({ 
      subagents: subagents.slice(0, 10),
      activeCount: subagents.length,
      totalCount: subagents.length,
      timestamp: now
    });
  } catch (e) {
    console.error('Subagents API error:', e);
    res.status(500).json({ 
      error: 'Failed to get subagent status', 
      subagents: [], 
      activeCount: 0, 
      totalCount: 0 
    });
  }
});

module.exports = router;
