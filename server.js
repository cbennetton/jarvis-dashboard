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

// Basic in-memory rate limiter (IP-based)
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '300', 10);
const LOGIN_RATE_LIMIT_MAX = parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '5', 10);
const SETUP_RATE_LIMIT_MAX = parseInt(process.env.SETUP_RATE_LIMIT_MAX || '3', 10);

function createRateLimiter({ windowMs, max, keyFn }) {
  const buckets = new Map();
  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const key = keyFn ? keyFn(req) : req.ip;
    let bucket = buckets.get(key);
    if (!bucket || now > bucket.reset) {
      bucket = { count: 0, reset: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(remaining));
    res.set('X-RateLimit-Reset', String(Math.ceil(bucket.reset / 1000)));
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.reset - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many requests', retryAfter });
    }
    // Opportunistic cleanup to avoid unbounded growth
    if (buckets.size > 5000) {
      for (const [k, v] of buckets.entries()) {
        if (now > v.reset) buckets.delete(k);
      }
    }
    next();
  };
}

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

// General API rate limit (helps reduce abuse/DOS on API routes)
const apiLimiter = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX });
app.use('/api/', apiLimiter);

// Stricter limits for auth/setup endpoints
const loginLimiter = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: LOGIN_RATE_LIMIT_MAX, keyFn: (req) => `login:${req.ip}` });
const setupLimiter = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: SETUP_RATE_LIMIT_MAX, keyFn: (req) => `setup:${req.ip}` });

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

app.post('/api/login', loginLimiter, async (req, res) => {
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

app.post('/api/call-me', requireAuth, async (req, res) => {
  const https = require('https');
  const phoneNumber = '+4915164506619'; // Christopher's phone number
  
  console.log('📞 Initiating call to', phoneNumber);
  
  // Call via OpenClaw Gateway API
  const payload = JSON.stringify({
    method: 'voicecall.initiate',
    params: {
      to: phoneNumber,
      message: 'Hi Christopher! You clicked the Call Me Now button on the dashboard. Ready to talk!',
      mode: 'conversation'
    }
  });
  
  const options = {
    hostname: '127.0.0.1',
    port: 18789,
    path: '/rpc',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': payload.length,
      'Authorization': 'Bearer 6444179f636ff5a7a1818db88b90e0e253d32dfa1a42e23b'
    },
    rejectUnauthorized: false
  };
  
  const gatewayReq = https.request(options, (gatewayRes) => {
    let data = '';
    gatewayRes.on('data', (chunk) => { data += chunk; });
    gatewayRes.on('end', () => {
      try {
        const result = JSON.parse(data);
        if (result.error) {
          console.error('Gateway error:', result.error);
          return res.status(500).json({ success: false, error: result.error });
        }
        console.log('Call initiated:', result);
        res.json({ success: true, callId: result.result?.callId });
      } catch (e) {
        console.error('Parse error:', e);
        res.status(500).json({ success: false, error: 'Failed to parse gateway response' });
      }
    });
  });
  
  gatewayReq.on('error', (error) => {
    console.error('Gateway request error:', error);
    res.status(500).json({ success: false, error: error.message });
  });
  
  gatewayReq.write(payload);
  gatewayReq.end();
});

app.post('/api/setup', setupLimiter, async (req, res) => {
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

// ==================== API USAGE API ====================
const SESSIONS_DIR = path.join(process.env.HOME, '.openclaw', 'agents', 'main', 'sessions');

// Pricing per million tokens (as of 2026)
const MODEL_PRICING = {
  'claude-sonnet-4-5': { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  'claude-opus-4-5': { input: 15.00, output: 75.00, cacheRead: 1.50, cacheWrite: 18.75 },
  'claude-haiku-3-5': { input: 0.80, output: 4.00, cacheRead: 0.08, cacheWrite: 1.00 },
  'claude-3-5-sonnet': { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  'claude-3-opus': { input: 15.00, output: 75.00, cacheRead: 1.50, cacheWrite: 18.75 },
  'claude-3-haiku': { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.30 }
};

// Model display info
const MODEL_INFO = {
  'claude-sonnet-4-5': { emoji: '🎵', name: 'Claude Sonnet 4.5', color: '#10b981' },
  'claude-opus-4-5': { emoji: '🎼', name: 'Claude Opus 4.5', color: '#8b5cf6' },
  'claude-haiku-4-5': { emoji: '🐇', name: 'Claude Haiku 4.5', color: '#3b82f6' },
  'claude-haiku-3-5': { emoji: '🌸', name: 'Claude Haiku 3.5', color: '#f472b6' },
  'claude-3-5-sonnet': { emoji: '🎵', name: 'Claude 3.5 Sonnet', color: '#10b981' },
  'claude-3-opus': { emoji: '🎼', name: 'Claude 3 Opus', color: '#8b5cf6' },
  'claude-3-haiku': { emoji: '🌸', name: 'Claude 3 Haiku', color: '#f472b6' }
  // Note: Any model not listed here will auto-display with default styling (🤖, gray, raw name)
};

function parseSessionFile(filePath) {
  const usage = {};
  const timeSeriesData = []; // Array of { timestamp, model, tokens, cost }
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        
        // Check for usage data in message
        if (entry.message && entry.message.usage && entry.message.model) {
          const model = entry.message.model;
          const u = entry.message.usage;
          // Parse timestamp - can be ISO string or Unix timestamp
          let timestamp = Date.now();
          if (entry.timestamp) {
            timestamp = typeof entry.timestamp === 'string' 
              ? new Date(entry.timestamp).getTime() 
              : entry.timestamp;
          } else if (entry.ts) {
            timestamp = typeof entry.ts === 'string' 
              ? new Date(entry.ts).getTime() 
              : entry.ts;
          }
          
          if (!usage[model]) {
            usage[model] = {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: 0,
              calls: 0
            };
          }
          
          const tokens = u.totalTokens || (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
          
          usage[model].input += u.input || 0;
          usage[model].output += u.output || 0;
          usage[model].cacheRead += u.cacheRead || 0;
          usage[model].cacheWrite += u.cacheWrite || 0;
          usage[model].totalTokens += tokens;
          
          // Calculate cost
          let cost;
          if (u.cost && u.cost.total) {
            cost = u.cost.total;
          } else {
            const pricing = MODEL_PRICING[model] || MODEL_PRICING['claude-sonnet-4-5'];
            cost = (
              ((u.input || 0) / 1000000) * pricing.input +
              ((u.output || 0) / 1000000) * pricing.output +
              ((u.cacheRead || 0) / 1000000) * pricing.cacheRead +
              ((u.cacheWrite || 0) / 1000000) * pricing.cacheWrite
            );
          }
          usage[model].cost += cost;
          usage[model].calls++;
          
          // Store for time series
          timeSeriesData.push({ timestamp, model, tokens, cost });
        }
      } catch (e) {
        // Skip malformed lines
      }
    }
  } catch (e) {
    console.error(`Error reading session file ${filePath}:`, e.message);
  }
  
  return { usage, timeSeriesData };
}

function aggregateUsage(parsedFiles) {
  const aggregated = {};
  const allTimeSeriesData = [];
  
  for (const { usage, timeSeriesData } of parsedFiles) {
    // Aggregate model totals
    for (const [model, data] of Object.entries(usage)) {
      if (!aggregated[model]) {
        aggregated[model] = {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: 0,
          calls: 0
        };
      }
      
      aggregated[model].input += data.input;
      aggregated[model].output += data.output;
      aggregated[model].cacheRead += data.cacheRead;
      aggregated[model].cacheWrite += data.cacheWrite;
      aggregated[model].totalTokens += data.totalTokens;
      aggregated[model].cost += data.cost;
      aggregated[model].calls += data.calls;
    }
    
    // Collect all time series data
    allTimeSeriesData.push(...timeSeriesData);
  }
  
  return { aggregated, allTimeSeriesData };
}

function buildTimeSeries(allTimeSeriesData, days) {
  const usdToEur = 0.92;
  const now = Date.now();
  const cutoff = now - (days * 24 * 60 * 60 * 1000);
  
  // Create a map of date -> model -> { tokens, cost }
  const dateModelMap = {};
  
  for (const { timestamp, model, tokens, cost } of allTimeSeriesData) {
    if (timestamp < cutoff) continue;
    
    // Get date string (YYYY-MM-DD)
    const date = new Date(timestamp).toISOString().split('T')[0];
    
    if (!dateModelMap[date]) {
      dateModelMap[date] = {};
    }
    if (!dateModelMap[date][model]) {
      dateModelMap[date][model] = { tokens: 0, cost: 0 };
    }
    
    dateModelMap[date][model].tokens += tokens;
    dateModelMap[date][model].cost += cost * usdToEur; // Convert to EUR
  }
  
  // Generate all dates in range for continuity
  const dates = [];
  const startDate = new Date(cutoff);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(now);
  endDate.setHours(0, 0, 0, 0);
  
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split('T')[0]);
  }
  
  // Build time series array
  const timeSeries = dates.map(date => {
    const entry = { date };
    const dayData = dateModelMap[date] || {};
    
    // Add each model's data for this date
    for (const [model, data] of Object.entries(dayData)) {
      entry[model] = {
        tokens: data.tokens,
        cost: data.cost
      };
    }
    
    return entry;
  });
  
  return timeSeries;
}

// GET /api/usage - Aggregate usage data
app.get('/api/usage', requireAuth, (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    
    if (!fs.existsSync(SESSIONS_DIR)) {
      return res.json({ models: {}, totals: { tokens: 0, cost: 0, calls: 0 }, timeSeries: [], period: days });
    }
    
    const files = fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.jsonl') && !f.includes('.lock'))
      .map(f => {
        const filePath = path.join(SESSIONS_DIR, f);
        const stat = fs.statSync(filePath);
        return { name: f, path: filePath, mtime: stat.mtimeMs };
      })
      .filter(f => f.mtime >= cutoffTime);
    
    const parsedFiles = files.map(f => parseSessionFile(f.path));
    const { aggregated, allTimeSeriesData } = aggregateUsage(parsedFiles);
    
    // Build time series for chart
    const timeSeries = buildTimeSeries(allTimeSeriesData, days);
    
    // Calculate totals
    let totalTokens = 0;
    let totalCost = 0;
    let totalCalls = 0;
    
    for (const data of Object.values(aggregated)) {
      totalTokens += data.totalTokens;
      totalCost += data.cost;
      totalCalls += data.calls;
    }
    
    // Add model info and percentage
    const models = {};
    for (const [model, data] of Object.entries(aggregated)) {
      const info = MODEL_INFO[model] || { emoji: '🤖', name: model, color: '#6b7280' };
      models[model] = {
        ...data,
        displayName: info.name,
        emoji: info.emoji,
        color: info.color,
        percentage: totalTokens > 0 ? (data.totalTokens / totalTokens * 100) : 0,
        costPercentage: totalCost > 0 ? (data.cost / totalCost * 100) : 0
      };
    }
    
    // Convert cost from USD to EUR (approximate rate)
    const usdToEur = 0.92;
    for (const model of Object.values(models)) {
      model.costEur = model.cost * usdToEur;
    }
    
    res.json({
      models,
      totals: {
        tokens: totalTokens,
        cost: totalCost,
        costEur: totalCost * usdToEur,
        calls: totalCalls
      },
      timeSeries,
      period: days,
      sessionsProcessed: files.length,
      timestamp: Date.now()
    });
  } catch (e) {
    console.error('Usage API error:', e);
    res.status(500).json({ error: 'Failed to aggregate usage data' });
  }
});

// ==================== USAGE BY TASK API ====================

// Task categorization patterns
const TASK_PATTERNS = [
  {
    id: 'morning-boost',
    name: 'Morning Boost Emails',
    emoji: '📧',
    color: '#f472b6',
    patterns: [
      /morning\s*boost/i,
      /newsletter.*(?:doris|sabrina|uta|liwei)/i,
      /(?:doris|sabrina|uta|liwei).*newsletter/i,
      /send.*email.*(?:doris|sabrina|uta|liwei)/i
    ]
  },
  {
    id: 'morning-briefing',
    name: "Christopher's Briefing",
    emoji: '🌅',
    color: '#fbbf24',
    patterns: [
      /morning\s*briefing/i,
      /christopher.*briefing/i,
      /daily\s*briefing/i
    ]
  },
  {
    id: 'dashboard',
    name: 'Dashboard Development',
    emoji: '📊',
    color: '#3b82f6',
    patterns: [
      /dashboard/i,
      /jarvis.*dashboard/i,
      /api\s*usage/i,
      /visualization/i,
      /cost.*tracking/i
    ]
  },
  {
    id: 'subagent',
    name: 'Subagent Tasks',
    emoji: '🔄',
    color: '#8b5cf6',
    patterns: [
      /subagent/i,
      /sub-agent/i,
      /spawned.*task/i
    ],
    sessionKeyPattern: /:subagent:/
  },
  {
    id: 'calendar-reminder',
    name: 'Calendar & Reminders',
    emoji: '📅',
    color: '#14b8a6',
    patterns: [
      /reminder/i,
      /calendar/i,
      /scheduled/i,
      /\[cron:/i
    ]
  },
  {
    id: 'coding',
    name: 'Coding & Development',
    emoji: '💻',
    color: '#22c55e',
    patterns: [
      /code|coding|programming/i,
      /implement|build|create.*(?:api|endpoint|feature)/i,
      /fix.*bug/i,
      /refactor/i,
      /git.*commit/i
    ]
  },
  {
    id: 'research',
    name: 'Research & Analysis',
    emoji: '🔍',
    color: '#06b6d4',
    patterns: [
      /search|research|analyze/i,
      /web.*search/i,
      /look.*up/i,
      /find.*information/i
    ]
  },
  {
    id: 'chat',
    name: 'General Chat',
    emoji: '💬',
    color: '#6b7280',
    patterns: [] // Fallback category
  }
];

function categorizeTask(sessionData, firstMessage) {
  // Check session key first for subagents
  const sessionKey = sessionData.sessionKey || '';
  
  for (const taskType of TASK_PATTERNS) {
    // Check session key pattern (e.g., for subagents)
    if (taskType.sessionKeyPattern && taskType.sessionKeyPattern.test(sessionKey)) {
      return taskType;
    }
  }
  
  // Check label if available
  const label = sessionData.label || '';
  
  for (const taskType of TASK_PATTERNS) {
    for (const pattern of taskType.patterns) {
      if (pattern.test(label)) {
        return taskType;
      }
    }
  }
  
  // Check first message content
  const messageText = firstMessage || '';
  
  for (const taskType of TASK_PATTERNS) {
    for (const pattern of taskType.patterns) {
      if (pattern.test(messageText)) {
        return taskType;
      }
    }
  }
  
  // Default to general chat
  return TASK_PATTERNS.find(t => t.id === 'chat');
}

function parseSessionFileForTask(filePath) {
  const result = {
    taskType: null,
    label: null,
    firstMessage: null,
    totalTokens: 0,
    cost: 0,
    calls: 0,
    models: {},
    timestamp: null,
    sessionKey: null
  };
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        
        // Get session info
        if (entry.type === 'session') {
          result.timestamp = new Date(entry.timestamp).getTime();
        }
        
        // Get first user message for categorization
        if (!result.firstMessage && entry.type === 'message' && entry.message?.role === 'user') {
          const content = entry.message.content;
          if (Array.isArray(content)) {
            result.firstMessage = content.find(c => c.type === 'text')?.text || '';
          } else if (typeof content === 'string') {
            result.firstMessage = content;
          }
        }
        
        // Extract usage data
        if (entry.message?.usage && entry.message?.model) {
          const model = entry.message.model;
          const u = entry.message.usage;
          
          const tokens = u.totalTokens || (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
          
          if (!result.models[model]) {
            result.models[model] = { tokens: 0, cost: 0, calls: 0 };
          }
          
          result.models[model].tokens += tokens;
          result.models[model].calls += 1;
          
          // Calculate cost
          let cost;
          if (u.cost?.total) {
            cost = u.cost.total;
          } else {
            const pricing = MODEL_PRICING[model] || MODEL_PRICING['claude-sonnet-4-5'];
            cost = (
              ((u.input || 0) / 1000000) * pricing.input +
              ((u.output || 0) / 1000000) * pricing.output +
              ((u.cacheRead || 0) / 1000000) * pricing.cacheRead +
              ((u.cacheWrite || 0) / 1000000) * pricing.cacheWrite
            );
          }
          
          result.models[model].cost += cost;
          result.totalTokens += tokens;
          result.cost += cost;
          result.calls += 1;
        }
      } catch (e) {
        // Skip malformed lines
      }
    }
  } catch (e) {
    console.error(`Error parsing session file ${filePath}:`, e.message);
  }
  
  return result;
}

// Helper function to build task time series
function buildTaskTimeSeries(allTaskTimeSeriesData, days, usdToEur) {
  const now = Date.now();
  const dateTaskMap = {};
  
  // Group by date and task
  for (const { timestamp, taskId, tokens, cost } of allTaskTimeSeriesData) {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    const dateStr = date.toISOString().split('T')[0];
    
    if (!dateTaskMap[dateStr]) {
      dateTaskMap[dateStr] = {};
    }
    
    if (!dateTaskMap[dateStr][taskId]) {
      dateTaskMap[dateStr][taskId] = { tokens: 0, cost: 0 };
    }
    
    dateTaskMap[dateStr][taskId].tokens += tokens;
    dateTaskMap[dateStr][taskId].cost += cost;
  }
  
  // Build array of dates in range
  const dates = [];
  const startDate = new Date(now - days * 24 * 60 * 60 * 1000);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(now);
  endDate.setHours(0, 0, 0, 0);
  
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split('T')[0]);
  }
  
  // Build time series array
  const timeSeries = dates.map(date => {
    const entry = { date };
    const dayData = dateTaskMap[date] || {};
    
    // Add each task's data for this date
    for (const [taskId, data] of Object.entries(dayData)) {
      entry[taskId] = {
        tokens: data.tokens,
        cost: data.cost,
        costEur: data.cost * usdToEur
      };
    }
    
    return entry;
  });
  
  return timeSeries;
}

// GET /api/usage-by-task - Aggregate usage by task type
app.get('/api/usage-by-task', requireAuth, (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    const usdToEur = 0.92;
    
    if (!fs.existsSync(SESSIONS_DIR)) {
      return res.json({ tasks: {}, totals: { tokens: 0, cost: 0, runs: 0 }, timeSeries: [], period: days });
    }
    
    // Load sessions.json for labels
    const sessionsFile = path.join(SESSIONS_DIR, 'sessions.json');
    let sessionsData = {};
    try {
      if (fs.existsSync(sessionsFile)) {
        sessionsData = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
      }
    } catch (e) {
      console.error('Error reading sessions.json:', e.message);
    }
    
    // Get all session files in time range
    const files = fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.jsonl') && !f.includes('.lock'))
      .map(f => {
        const filePath = path.join(SESSIONS_DIR, f);
        const stat = fs.statSync(filePath);
        const sessionId = f.replace('.jsonl', '');
        return { name: f, path: filePath, mtime: stat.mtimeMs, sessionId };
      })
      .filter(f => f.mtime >= cutoffTime);
    
    // Aggregate by task type
    const taskAggregates = {};
    const allTaskTimeSeriesData = []; // For time series chart
    
    for (const file of files) {
      const parsed = parseSessionFileForTask(file.path);
      
      if (parsed.calls === 0) continue;
      
      // Find session data for label
      let sessionInfo = { sessionKey: '', label: '' };
      for (const [key, data] of Object.entries(sessionsData)) {
        if (data.sessionId === file.sessionId) {
          sessionInfo = { sessionKey: key, label: data.label || data.origin?.label || '' };
          break;
        }
      }
      
      // Categorize the task
      const taskType = categorizeTask(sessionInfo, parsed.firstMessage);
      const taskId = taskType.id;
      
      if (!taskAggregates[taskId]) {
        taskAggregates[taskId] = {
          id: taskId,
          name: taskType.name,
          emoji: taskType.emoji,
          color: taskType.color,
          runs: 0,
          tokens: 0,
          cost: 0,
          costEur: 0,
          calls: 0,
          models: {},
          sessions: []
        };
      }
      
      taskAggregates[taskId].runs += 1;
      taskAggregates[taskId].tokens += parsed.totalTokens;
      taskAggregates[taskId].cost += parsed.cost;
      taskAggregates[taskId].costEur += parsed.cost * usdToEur;
      taskAggregates[taskId].calls += parsed.calls;
      
      // Store for time series
      const timestamp = parsed.timestamp || file.mtime;
      allTaskTimeSeriesData.push({
        timestamp,
        taskId,
        tokens: parsed.totalTokens,
        cost: parsed.cost
      });
      
      // Aggregate model usage per task
      for (const [model, data] of Object.entries(parsed.models)) {
        if (!taskAggregates[taskId].models[model]) {
          taskAggregates[taskId].models[model] = { tokens: 0, cost: 0, costEur: 0, calls: 0 };
        }
        taskAggregates[taskId].models[model].tokens += data.tokens;
        taskAggregates[taskId].models[model].cost += data.cost;
        taskAggregates[taskId].models[model].costEur += data.cost * usdToEur;
        taskAggregates[taskId].models[model].calls += data.calls;
      }
      
      // Store session reference (limited to save memory)
      if (taskAggregates[taskId].sessions.length < 10) {
        taskAggregates[taskId].sessions.push({
          id: file.sessionId,
          label: sessionInfo.label,
          tokens: parsed.totalTokens,
          cost: parsed.cost * usdToEur,
          timestamp: parsed.timestamp || file.mtime
        });
      }
    }
    
    // Build time series for chart
    const timeSeries = buildTaskTimeSeries(allTaskTimeSeriesData, days, usdToEur);
    
    // Calculate totals and percentages
    let totalTokens = 0;
    let totalCost = 0;
    let totalRuns = 0;
    
    for (const task of Object.values(taskAggregates)) {
      totalTokens += task.tokens;
      totalCost += task.cost;
      totalRuns += task.runs;
    }
    
    // Add percentages and model info
    for (const task of Object.values(taskAggregates)) {
      task.tokenPercentage = totalTokens > 0 ? (task.tokens / totalTokens * 100) : 0;
      task.costPercentage = totalCost > 0 ? (task.cost / totalCost * 100) : 0;
      
      // Add model display info to each model in the task
      for (const [modelId, modelData] of Object.entries(task.models)) {
        const info = MODEL_INFO[modelId] || { emoji: '🤖', name: modelId, color: '#6b7280' };
        modelData.displayName = info.name;
        modelData.emoji = info.emoji;
        modelData.color = info.color;
      }
      
      // Sort sessions by most recent
      task.sessions.sort((a, b) => b.timestamp - a.timestamp);
    }
    
    // Sort tasks by cost (most expensive first)
    const sortedTasks = Object.values(taskAggregates)
      .sort((a, b) => b.costEur - a.costEur);
    
    res.json({
      tasks: sortedTasks,
      totals: {
        tokens: totalTokens,
        cost: totalCost,
        costEur: totalCost * usdToEur,
        runs: totalRuns
      },
      timeSeries,
      taskTypes: TASK_PATTERNS.map(t => ({ id: t.id, name: t.name, emoji: t.emoji, color: t.color })),
      period: days,
      sessionsProcessed: files.length,
      timestamp: Date.now()
    });
  } catch (e) {
    console.error('Usage by task API error:', e);
    res.status(500).json({ error: 'Failed to aggregate usage by task' });
  }
});

// ==================== END USAGE BY TASK API ====================

// ==================== END API USAGE API ====================


// ==================== NEWSLETTERS API ====================
const NEWSLETTERS_FILE = path.join(process.env.HOME, '.openclaw', 'workspace', 'newsletters.json');

function loadNewsletters() {
  try {
    if (fs.existsSync(NEWSLETTERS_FILE)) {
      return JSON.parse(fs.readFileSync(NEWSLETTERS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Morning Boost load error:', e);
  }
  return [];
}

function saveNewsletters(data) {
  fs.writeFileSync(NEWSLETTERS_FILE, JSON.stringify(data, null, 2));
}

// GET all newsletters
app.get('/api/newsletters', requireAuth, (req, res) => {
  try {
    const newsletters = loadNewsletters();
    res.json(newsletters);
  } catch (e) {
    console.error('Morning Boost API error:', e);
    res.status(500).json({ error: 'Failed to load newsletters' });
  }
});

// POST new newsletter
app.post('/api/newsletters', requireAuth, (req, res) => {
  try {
    const newsletters = loadNewsletters();
    const newNewsletter = {
      id: 'newsletter-' + Date.now().toString(36),
      recipient: req.body.recipient || { name: '', email: '' },
      schedule: req.body.schedule || { time: '9:00 AM', timezone: 'UTC', cron: '0 9 * * *' },
      prompt: req.body.prompt || '',
      language: req.body.language || 'English',
      enabled: req.body.enabled !== false,
      createdAt: new Date().toISOString(),
      cronJobId: null
    };
    newsletters.push(newNewsletter);
    saveNewsletters(newsletters);
    res.json({ success: true, newsletter: newNewsletter });
  } catch (e) {
    console.error('Morning Boost create error:', e);
    res.status(500).json({ error: 'Failed to create newsletter' });
  }
});

// PUT update newsletter
app.put('/api/newsletters/:id', requireAuth, (req, res) => {
  try {
    const newsletters = loadNewsletters();
    const idx = newsletters.findIndex(n => n.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Morning Boost not found' });
    }
    
    // Update fields
    const updates = req.body;
    if (updates.recipient) newsletters[idx].recipient = updates.recipient;
    if (updates.cc !== undefined) newsletters[idx].cc = updates.cc;
    if (updates.schedule) newsletters[idx].schedule = updates.schedule;
    if (updates.prompt !== undefined) newsletters[idx].prompt = updates.prompt;
    if (updates.language) newsletters[idx].language = updates.language;
    if (updates.location) newsletters[idx].location = updates.location;
    if (updates.contentToggles) newsletters[idx].contentToggles = updates.contentToggles;
    if (updates.enabled !== undefined) newsletters[idx].enabled = updates.enabled;
    if (updates.lastSent) newsletters[idx].lastSent = updates.lastSent;
    
    saveNewsletters(newsletters);
    res.json({ success: true, newsletter: newsletters[idx] });
  } catch (e) {
    console.error('Morning Boost update error:', e);
    res.status(500).json({ error: 'Failed to update newsletter' });
  }
});

// DELETE newsletter
app.delete('/api/newsletters/:id', requireAuth, (req, res) => {
  try {
    const newsletters = loadNewsletters();
    const idx = newsletters.findIndex(n => n.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Morning Boost not found' });
    }
    
    newsletters.splice(idx, 1);
    saveNewsletters(newsletters);
    res.json({ success: true });
  } catch (e) {
    console.error('Morning Boost delete error:', e);
    res.status(500).json({ error: 'Failed to delete newsletter' });
  }
});

// POST regenerate prompt from content toggles
app.post('/api/newsletters/:id/regenerate-prompt', requireAuth, (req, res) => {
  try {
    const newsletters = loadNewsletters();
    const idx = newsletters.findIndex(n => n.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Morning Boost not found' });
    }
    
    const newsletter = newsletters[idx];
    const { contentToggles, language, location } = req.body;
    
    // Build prompt dynamically based on toggles
    let prompt = `Send morning newsletter to ${newsletter.recipient.name} at ${newsletter.recipient.email}`;
    if (newsletter.cc) {
      prompt += ` with CC to ${newsletter.cc}`;
    }
    prompt += '.\n\n';
    
    const lang = language || newsletter.language || 'English';
    const isGerman = lang === 'German';
    
    // Add content sections based on toggles
    if (contentToggles.weather) {
      const loc = location || 'München';
      prompt += `1. Start with weather for ${loc} (1 sentence + emoji`;
      if (isGerman) {
        prompt += '; wenn bemerkenswertes Wetter in 1-2 Wochen, kurz erwähnen';
      }
      prompt += ').\n';
    }
    
    // News sections
    const newsSections = [];
    if (contentToggles.newsGermany) newsSections.push('Germany');
    if (contentToggles.newsWorld) newsSections.push('world');
    if (contentToggles.newsCanada) newsSections.push('Canada');
    
    if (newsSections.length > 0) {
      prompt += `2. Use web_search to find 3-4 positive news from ${newsSections.join(' and ')} (erfreuliche, hoffnungsvolle News).\n`;
    }
    
    // Autonomous driving
    if (contentToggles.autonomousDriving) {
      prompt += `3. Add autonomous driving news section (brief, 2-3 recent developments).\n`;
    }
    
    // Special sections
    if (contentToggles.specialSections && contentToggles.specialSections.length > 0) {
      contentToggles.specialSections.forEach((section, i) => {
        prompt += `${3 + (contentToggles.autonomousDriving ? 1 : 0) + i}. ${section}\n`;
      });
    }
    
    // Joke
    if (contentToggles.joke) {
      const nextNum = 3 + (contentToggles.autonomousDriving ? 1 : 0) + (contentToggles.specialSections?.length || 0);
      if (isGerman) {
        prompt += `${nextNum}. Add 'Witz des Tages' (funny joke in German - clever, NOT boring wordplay like 'Treffen sich zwei Berge').\n`;
      } else {
        prompt += `${nextNum}. Add 'Joke of the day' (funny, clever humor).\n`;
      }
    }
    
    // Language and tone
    prompt += `\nWrite in ${lang}, warm and personal tone. `;
    if (isGerman) {
      prompt += `Schönes HTML Format mit LINKS zu allen Quellen. `;
    } else {
      prompt += `Beautiful HTML format with LINKS to all sources. `;
    }
    
    // Signature
    if (isGerman) {
      prompt += `Ende mit: 'Liebe Grüße, Jarvis 🦊 (Christophers KI)'.`;
    } else {
      prompt += `End with: 'Best regards, Jarvis 🦊 (Christopher's AI)'.`;
    }
    
    prompt += `\n\nSend via: node ~/.openclaw/workspace/scripts/send-email.js --to "${newsletter.recipient.email}" --cc "${newsletter.cc || 'christopherbennett92@gmail.com'}" --subject "Your Morning Boost ☀️"`;
    
    res.json({ success: true, prompt });
  } catch (e) {
    console.error('Prompt regeneration error:', e);
    res.status(500).json({ error: 'Failed to regenerate prompt' });
  }
});

// ==================== END NEWSLETTERS API ====================

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

// ==================== SUBAGENT STATUS API ====================
// Scans session files to find active subagents
app.get('/api/subagents', requireAuth, (req, res) => {
  try {
    const SUBAGENT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    const now = Date.now();
    const subagents = [];
    
    const sessionsFile = path.join(SESSIONS_DIR, 'sessions.json');
    if (!fs.existsSync(sessionsFile)) {
      return res.json({ subagents: [], timestamp: now, activeCount: 0, totalCount: 0 });
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
        duration: Math.floor((now - startedAt) / 1000), // Duration from start, not last activity
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
    res.status(500).json({ error: 'Failed to get subagent status', subagents: [], activeCount: 0, totalCount: 0 });
  }
});


// ==================== END SUBAGENT STATUS API ====================

// ==================== MAIN AGENT ACTIVITY API ====================
// Parses recent main agent session to show real-time activity

const TOOL_ICONS = {
  read: '📄',
  write: '✍️',
  edit: '✏️',
  exec: '⚙️',
  web_search: '🔍',
  web_fetch: '🌐',
  browser: '🌐',
  message: '💬',
  tts: '🔊',
  nodes: '📱',
  canvas: '🖼️',
  sessions_spawn: '🤖',
  image: '🖼️',
  voice_call: '📞',
  default: '🔧'
};

function getMainAgentSessionFile() {
  // Find the most recent main agent session file (not subagent)
  const sessionsFile = path.join(SESSIONS_DIR, 'sessions.json');
  if (!fs.existsSync(sessionsFile)) return null;
  
  try {
    const sessionsData = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
    
    // Find main agent session (discord channel)
    for (const [sessionKey, sessionData] of Object.entries(sessionsData)) {
      // Main agent is usually discord:channel:XXX
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

function parseRecentActivity(sessionFile, limit = 10) {
  const activities = [];
  
  try {
    const content = fs.readFileSync(sessionFile, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    
    // Read recent lines (last 200 to ensure we get enough activities)
    const recentLines = lines.slice(-200);
    
    for (const line of recentLines) {
      try {
        const entry = JSON.parse(line);
        
        // Skip session metadata
        if (entry.type === 'session') continue;
        
        // Extract timestamp
        let timestamp = Date.now();
        if (entry.timestamp) {
          timestamp = typeof entry.timestamp === 'string' 
            ? new Date(entry.timestamp).getTime() 
            : entry.timestamp;
        } else if (entry.ts) {
          timestamp = typeof entry.ts === 'string' 
            ? new Date(entry.ts).getTime() 
            : entry.ts;
        }
        
        // Parse user messages (Christopher talking to Jarvis)
        if (entry.type === 'message' && entry.message?.role === 'user') {
          const content = entry.message.content;
          let text = '';
          if (Array.isArray(content)) {
            text = content.find(c => c.type === 'text')?.text || '';
          } else if (typeof content === 'string') {
            text = content;
          }
          
          if (text.trim()) {
            activities.push({
              type: 'user_message',
              description: text.slice(0, 100) + (text.length > 100 ? '...' : ''),
              icon: '💬',
              timestamp
            });
          }
        }
        
        // Parse tool calls
        if (entry.type === 'message' && entry.message?.role === 'assistant') {
          const content = entry.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_use') {
                const toolName = block.name || 'unknown';
                const toolInput = block.input || {};
                
                let description = toolName;
                
                // Customize description based on tool
                if (toolName === 'read') {
                  description = `Reading ${toolInput.path || toolInput.file_path || 'file'}`;
                } else if (toolName === 'write') {
                  description = `Writing ${toolInput.path || toolInput.file_path || 'file'}`;
                } else if (toolName === 'edit') {
                  description = `Editing ${toolInput.path || toolInput.file_path || 'file'}`;
                } else if (toolName === 'exec') {
                  const cmd = (toolInput.command || '').split(' ')[0];
                  description = `Running: ${cmd}`;
                } else if (toolName === 'web_search') {
                  description = `Searching: ${(toolInput.query || '').slice(0, 40)}`;
                } else if (toolName === 'web_fetch') {
                  description = `Fetching: ${toolInput.url || 'webpage'}`;
                } else if (toolName === 'message') {
                  const action = toolInput.action || '';
                  description = `Message: ${action}`;
                } else if (toolName === 'sessions_spawn') {
                  description = `Spawning subagent: ${toolInput.label || 'task'}`;
                } else if (toolName === 'browser') {
                  description = `Browser: ${toolInput.action || 'action'}`;
                } else if (toolName === 'tts') {
                  description = `Speaking: ${(toolInput.text || '').slice(0, 40)}`;
                }
                
                activities.push({
                  type: 'tool_call',
                  tool: toolName,
                  description,
                  icon: TOOL_ICONS[toolName] || TOOL_ICONS.default,
                  timestamp
                });
              }
            }
          }
        }
        
        // Parse assistant responses (text only, to track conversation flow)
        if (entry.type === 'message' && entry.message?.role === 'assistant') {
          const content = entry.message.content;
          if (Array.isArray(content)) {
            const textBlock = content.find(c => c.type === 'text');
            if (textBlock?.text && textBlock.text.trim()) {
              activities.push({
                type: 'assistant_response',
                description: textBlock.text.slice(0, 100) + (textBlock.text.length > 100 ? '...' : ''),
                icon: '🦊',
                timestamp
              });
            }
          }
        }
        
      } catch (e) {
        // Skip malformed lines
      }
    }
  } catch (e) {
    console.error('Error parsing activity:', e);
  }
  
  // Sort by timestamp (newest first) and return limited set
  return activities
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

app.get('/api/main-agent-activity', requireAuth, (req, res) => {
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
    res.status(500).json({ error: 'Failed to get main agent activity', activities: [] });
  }
});

// ==================== END MAIN AGENT ACTIVITY API ====================

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
