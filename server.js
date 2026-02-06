const express = require('express');
const https = require('https');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const SSL_KEY = path.join(__dirname, 'key.pem');
const SSL_CERT = path.join(__dirname, 'cert.pem');

const app = express();
const PORT = process.env.PORT || 3847;

// Database file
const DB_FILE = path.join(__dirname, 'data.json');

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('DB load error:', e);
  }
  return { users: [], activities: [], currentStatus: { active: false, task: null, startedAt: null }, repos: [] };
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

let db = loadDB();

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// CORS - allow all
app.use(cors({ origin: true, credentials: true }));

// Security headers (relaxed for compatibility)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// No caching
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'jarvis-dashboard-secret-fixed-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' }
}));

function requireAuth(req, res, next) {
  if (req.session.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// API Routes
app.get('/api/needs-setup', (req, res) => {
  console.log('needs-setup called, users:', db.users.length);
  res.json({ needsSetup: db.users.length === 0 });
});

app.get('/api/auth-check', (req, res) => {
  res.json({ authenticated: !!req.session.authenticated });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  console.log('Login attempt for:', username);
  const user = db.users.find(u => u.username === username);
  if (user && await bcrypt.compare(password, user.password)) {
    req.session.authenticated = true;
    req.session.username = username;
    console.log('Login success');
    // If request expects JSON, send JSON; otherwise redirect
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

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.post('/api/setup', async (req, res) => {
  if (db.users.length > 0) return res.status(403).json({ error: 'Already configured' });
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

app.get('/api/repos', requireAuth, (req, res) => {
  res.json(db.repos || []);
});

app.get('/api/status', requireAuth, (req, res) => {
  const TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
  const status = { ...db.currentStatus };
  
  // Auto-timeout: if active but no update for 15 minutes, show as inactive (grey)
  const lastUpdate = status.updatedAt || status.startedAt;
  if (status.active && lastUpdate && (Date.now() - lastUpdate > TIMEOUT_MS)) {
    status.active = false;
    status.timedOut = true;
  }
  
  res.json(status);
});

app.get('/api/activities', requireAuth, (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const since = Date.now() - (hours * 60 * 60 * 1000);
  res.json(db.activities.filter(a => a.timestamp >= since));
});

app.get('/api/stats', requireAuth, (req, res) => {
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  
  const hourlyStats = [];
  for (let i = 23; i >= 0; i--) {
    const hourStart = now - (i + 1) * hourMs;
    const hourEnd = now - i * hourMs;
    const activities = db.activities.filter(a => a.timestamp >= hourStart && a.timestamp < hourEnd);
    const activeTime = activities.reduce((sum, a) => sum + (a.duration || 0), 0);
    hourlyStats.push({ hour: new Date(hourEnd).getHours(), activeMinutes: Math.round(activeTime / 60000), count: activities.length });
  }
  
  const dailyStats = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = now - (i + 1) * dayMs;
    const dayEnd = now - i * dayMs;
    const activities = db.activities.filter(a => a.timestamp >= dayStart && a.timestamp < dayEnd);
    const activeTime = activities.reduce((sum, a) => sum + (a.duration || 0), 0);
    dailyStats.push({ date: new Date(dayEnd).toLocaleDateString('en-US', { weekday: 'short' }), activeMinutes: Math.round(activeTime / 60000), count: activities.length });
  }
  
  const totalActiveTime = db.activities.reduce((sum, a) => sum + (a.duration || 0), 0);
  res.json({
    hourly: hourlyStats,
    daily: dailyStats,
    total: { activities: db.activities.length, activeHours: Math.round(totalActiveTime / 3600000 * 10) / 10 }
  });
});

// Chat messages storage
const CHAT_FILE = path.join(__dirname, 'chats.json');
function loadChats() { try { return JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8')); } catch(e) { return {}; } }
function saveChats(c) { fs.writeFileSync(CHAT_FILE, JSON.stringify(c, null, 2)); }

app.get('/api/chat/:activityId', requireAuth, (req, res) => {
  const chats = loadChats();
  res.json(chats[req.params.activityId] || []);
});

app.post('/api/chat', requireAuth, (req, res) => {
  const { activityId, task, message } = req.body;
  const chats = loadChats();
  if (!chats[activityId]) chats[activityId] = [];
  chats[activityId].push({ from: 'user', text: message, task, time: Date.now() });
  saveChats(chats);
  
  // Webhook: wake Jarvis via OpenClaw hooks endpoint
  const http = require('http');
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
app.post('/api/internal/chat-reply', (req, res) => {
  if (req.headers.authorization !== `Bearer ${API_KEY}`) return res.status(401).json({ error: 'Invalid API key' });
  const { activityId, message } = req.body;
  const chats = loadChats();
  if (!chats[activityId]) chats[activityId] = [];
  chats[activityId].push({ from: 'jarvis', text: message, time: Date.now() });
  saveChats(chats);
  res.json({ success: true });
});

// ==================== MARKDOWN & SKILLS API ====================
const WORKSPACE_DIR = path.join(process.env.HOME, '.openclaw', 'workspace');
const SKILLS_DIR = '/home/ubuntu/.npm-global/lib/node_modules/openclaw/skills';

// Cache for file modification times to support change detection
let fileModTimes = {};

function getFileModTime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch (e) {
    return 0;
  }
}

function scanMarkdownFiles() {
  const files = [];
  const rootMdFiles = ['AGENTS.md', 'MEMORY.md', 'TOOLS.md', 'USER.md', 'SOUL.md', 'HEARTBEAT.md'];
  
  // Root markdown files
  rootMdFiles.forEach(name => {
    const filePath = path.join(WORKSPACE_DIR, name);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      files.push({
        name,
        path: name,
        size: stat.size,
        modified: stat.mtimeMs,
        category: 'root'
      });
    }
  });
  
  // Memory directory files
  const memoryDir = path.join(WORKSPACE_DIR, 'memory');
  if (fs.existsSync(memoryDir)) {
    const memoryFiles = fs.readdirSync(memoryDir).filter(f => f.endsWith('.md') || f.endsWith('.json'));
    memoryFiles.forEach(name => {
      const filePath = path.join(memoryDir, name);
      const stat = fs.statSync(filePath);
      files.push({
        name,
        path: `memory/${name}`,
        size: stat.size,
        modified: stat.mtimeMs,
        category: 'memory'
      });
    });
  }
  
  return files.sort((a, b) => b.modified - a.modified);
}

function scanSkillsDirectory(dir = SKILLS_DIR, basePath = '') {
  const items = [];
  
  if (!fs.existsSync(dir)) return items;
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.forEach(entry => {
    const fullPath = path.join(dir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    
    if (entry.isDirectory()) {
      // Check if it's a skill directory (has SKILL.md)
      const skillMd = path.join(fullPath, 'SKILL.md');
      const isSkill = fs.existsSync(skillMd);
      
      items.push({
        name: entry.name,
        path: relativePath,
        type: 'directory',
        isSkill,
        children: scanSkillsDirectory(fullPath, relativePath)
      });
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.js') || entry.name.endsWith('.sh') || entry.name.endsWith('.py')) {
      const stat = fs.statSync(fullPath);
      items.push({
        name: entry.name,
        path: relativePath,
        type: 'file',
        size: stat.size,
        modified: stat.mtimeMs
      });
    }
  });
  
  return items.sort((a, b) => {
    // Directories first, then files
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });
}

// List all markdown files
app.get('/api/markdowns', requireAuth, (req, res) => {
  try {
    const files = scanMarkdownFiles();
    // Calculate hash of modification times for change detection
    const hash = files.reduce((h, f) => h + f.modified, 0).toString(36);
    res.json({ files, hash, timestamp: Date.now() });
  } catch (e) {
    console.error('Markdowns API error:', e);
    res.status(500).json({ error: 'Failed to list markdown files' });
  }
});

// Get specific markdown content (using query param for path to work with Express 5)
app.get('/api/markdown', requireAuth, (req, res) => {
  try {
    const requestedPath = req.query.path;
    
    if (!requestedPath) {
      return res.status(400).json({ error: 'Path parameter required' });
    }
    
    // Security: prevent directory traversal
    if (requestedPath.includes('..')) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    
    let filePath;
    
    // Check if it's a skill file
    if (requestedPath.startsWith('skills/')) {
      filePath = path.join(SKILLS_DIR, requestedPath.replace('skills/', ''));
    } else {
      filePath = path.join(WORKSPACE_DIR, requestedPath);
    }
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    const stat = fs.statSync(filePath);
    
    res.json({
      path: requestedPath,
      content,
      size: stat.size,
      modified: stat.mtimeMs
    });
  } catch (e) {
    console.error('Markdown API error:', e);
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// Save markdown content
app.post('/api/markdown/save', requireAuth, (req, res) => {
  try {
    const { path: requestedPath, content } = req.body;
    
    if (!requestedPath) {
      return res.status(400).json({ error: 'Path parameter required' });
    }
    
    if (content === undefined || content === null) {
      return res.status(400).json({ error: 'Content parameter required' });
    }
    
    // Security: prevent directory traversal
    if (requestedPath.includes('..')) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    
    let filePath;
    
    // Check if it's a skill file (read-only for safety)
    if (requestedPath.startsWith('skills/')) {
      return res.status(403).json({ error: 'Skills files are read-only' });
    } else {
      filePath = path.join(WORKSPACE_DIR, requestedPath);
    }
    
    // Ensure file exists (don't create new files via this endpoint)
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Write the file
    fs.writeFileSync(filePath, content, 'utf8');
    
    const stat = fs.statSync(filePath);
    console.log(`Saved file: ${filePath} (${stat.size} bytes)`);
    
    res.json({
      success: true,
      path: requestedPath,
      size: stat.size,
      modified: stat.mtimeMs
    });
  } catch (e) {
    console.error('Markdown save error:', e);
    res.status(500).json({ error: 'Failed to save file: ' + e.message });
  }
});

// List skills directory
app.get('/api/skills', requireAuth, (req, res) => {
  try {
    const skills = scanSkillsDirectory();
    // Calculate hash for change detection
    const hashSkills = (items) => {
      let h = 0;
      items.forEach(i => {
        h += (i.modified || 0);
        if (i.children) h += hashSkills(i.children);
      });
      return h;
    };
    const hash = hashSkills(skills).toString(36);
    res.json({ skills, hash, timestamp: Date.now() });
  } catch (e) {
    console.error('Skills API error:', e);
    res.status(500).json({ error: 'Failed to list skills' });
  }
});

// Check for changes endpoint (for polling)
app.get('/api/changes', requireAuth, (req, res) => {
  const { markdownHash, skillsHash } = req.query;
  
  try {
    const currentMarkdowns = scanMarkdownFiles();
    const currentSkills = scanSkillsDirectory();
    
    const newMarkdownHash = currentMarkdowns.reduce((h, f) => h + f.modified, 0).toString(36);
    const hashSkills = (items) => {
      let h = 0;
      items.forEach(i => {
        h += (i.modified || 0);
        if (i.children) h += hashSkills(i.children);
      });
      return h;
    };
    const newSkillsHash = hashSkills(currentSkills).toString(36);
    
    res.json({
      markdownsChanged: markdownHash !== newMarkdownHash,
      skillsChanged: skillsHash !== newSkillsHash,
      newMarkdownHash,
      newSkillsHash,
      timestamp: Date.now()
    });
  } catch (e) {
    res.json({ markdownsChanged: false, skillsChanged: false, timestamp: Date.now() });
  }
});

// ==================== END MARKDOWN & SKILLS API ====================

// Internal API
const API_KEY = 'jarvis-secret-key-xK9mP2nQ7vL4';
app.post('/api/internal/status', (req, res) => {
  if (req.headers.authorization !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  const { active, task } = req.body;
  const now = Date.now();
  
  // If going from active to inactive, log the activity
  if (db.currentStatus.active && !active && db.currentStatus.startedAt) {
    db.activities.push({
      task: db.currentStatus.task,
      timestamp: db.currentStatus.startedAt,
      duration: now - db.currentStatus.startedAt,
      endedAt: now
    });
    if (db.activities.length > 1000) db.activities = db.activities.slice(-1000);
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

// Static files AFTER API routes
app.use(express.static(path.join(__dirname, 'public')));

// HTTPS server
const httpsServer = https.createServer({
  key: fs.readFileSync(SSL_KEY),
  cert: fs.readFileSync(SSL_CERT)
}, app);

httpsServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🦊 Jarvis Dashboard running on https://0.0.0.0:${PORT}`);
});

// Webhook: notify Jarvis via OpenClaw gateway
