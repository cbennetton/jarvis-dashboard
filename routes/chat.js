const express = require('express');
const http = require('http');
const router = express.Router();
const { loadChats, saveChats } = require('../utils/db');
const { requireAuth, requireApiKey } = require('../middleware/auth');

// Get chat messages for an activity
router.get('/:activityId', requireAuth, (req, res) => {
  const chats = loadChats();
  res.json(chats[req.params.activityId] || []);
});

// Post new chat message
router.post('/', requireAuth, (req, res) => {
  const { activityId, task, message } = req.body;
  const chats = loadChats();
  
  if (!chats[activityId]) {
    chats[activityId] = [];
  }
  
  chats[activityId].push({ 
    from: 'user', 
    text: message, 
    task, 
    time: Date.now() 
  });
  
  saveChats(chats);
  
  // Webhook: wake Jarvis via OpenClaw hooks endpoint
  const payload = JSON.stringify({ 
    text: `🖥️ DASHBOARD CHAT from Christopher:\nTask: "${task}"\nMessage: ${message}\nActivityId: ${activityId}\n\nRespond using: ~/.openclaw/workspace/scripts/dashboard-chat-reply.sh ${activityId} "your response"`,
    mode: 'now'
  });
  
  const webhookReq = http.request({
    hostname: 'localhost', 
    port: 18789, 
    path: '/hooks/wake',
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json', 
      'Authorization': 'Bearer jarvis-webhook-secret-2026' 
    }
  }, (webhookRes) => {
    let data = '';
    webhookRes.on('data', chunk => data += chunk);
    webhookRes.on('end', () => console.log('Wake response:', webhookRes.statusCode, data));
  });
  
  webhookReq.on('error', (e) => console.error('Wake error:', e.message));
  webhookReq.write(payload);
  webhookReq.end();
  
  res.json({ success: true, webhookSent: true });
});

// Internal: post response to chat (for Jarvis)
router.post('/internal/reply', requireApiKey, (req, res) => {
  const { activityId, message } = req.body;
  const chats = loadChats();
  
  if (!chats[activityId]) {
    chats[activityId] = [];
  }
  
  chats[activityId].push({ 
    from: 'jarvis', 
    text: message, 
    time: Date.now() 
  });
  
  saveChats(chats);
  res.json({ success: true });
});

module.exports = router;
