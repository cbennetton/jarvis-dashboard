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
  'claude-haiku-3-5': { emoji: '🌸', name: 'Claude Haiku 3.5', color: '#f472b6' },
  'claude-3-5-sonnet': { emoji: '🎵', name: 'Claude 3.5 Sonnet', color: '#10b981' },
  'claude-3-opus': { emoji: '🎼', name: 'Claude 3 Opus', color: '#8b5cf6' },
  'claude-3-haiku': { emoji: '🌸', name: 'Claude 3 Haiku', color: '#f472b6' }
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

// ==================== END API USAGE API ====================

// ==================== NEWSLETTERS API ====================
const NEWSLETTERS_FILE = path.join(process.env.HOME, '.openclaw', 'workspace', 'newsletters.json');

function loadNewsletters() {
  try {
    if (fs.existsSync(NEWSLETTERS_FILE)) {
      return JSON.parse(fs.readFileSync(NEWSLETTERS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Newsletters load error:', e);
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
    console.error('Newsletters API error:', e);
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
    console.error('Newsletter create error:', e);
    res.status(500).json({ error: 'Failed to create newsletter' });
  }
});

// PUT update newsletter
app.put('/api/newsletters/:id', requireAuth, (req, res) => {
  try {
    const newsletters = loadNewsletters();
    const idx = newsletters.findIndex(n => n.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Newsletter not found' });
    }
    
    // Update fields
    const updates = req.body;
    if (updates.recipient) newsletters[idx].recipient = updates.recipient;
    if (updates.schedule) newsletters[idx].schedule = updates.schedule;
    if (updates.prompt !== undefined) newsletters[idx].prompt = updates.prompt;
    if (updates.language) newsletters[idx].language = updates.language;
    if (updates.enabled !== undefined) newsletters[idx].enabled = updates.enabled;
    if (updates.lastSent) newsletters[idx].lastSent = updates.lastSent;
    
    saveNewsletters(newsletters);
    res.json({ success: true, newsletter: newsletters[idx] });
  } catch (e) {
    console.error('Newsletter update error:', e);
    res.status(500).json({ error: 'Failed to update newsletter' });
  }
});

// DELETE newsletter
app.delete('/api/newsletters/:id', requireAuth, (req, res) => {
  try {
    const newsletters = loadNewsletters();
    const idx = newsletters.findIndex(n => n.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Newsletter not found' });
    }
    
    newsletters.splice(idx, 1);
    saveNewsletters(newsletters);
    res.json({ success: true });
  } catch (e) {
    console.error('Newsletter delete error:', e);
    res.status(500).json({ error: 'Failed to delete newsletter' });
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
    const SUBAGENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes - consider subagent inactive if no recent activity
    const now = Date.now();
    const subagents = [];
    
    if (!fs.existsSync(SESSIONS_DIR)) {
      return res.json({ subagents: [], timestamp: now });
    }
    
    const files = fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.jsonl') && !f.includes('.lock') && !f.includes('.deleted'))
      .map(f => ({
        name: f,
        path: path.join(SESSIONS_DIR, f),
        stat: fs.statSync(path.join(SESSIONS_DIR, f))
      }))
      // Only consider files modified in last 30 minutes
      .filter(f => now - f.stat.mtimeMs < 30 * 60 * 1000);
    
    for (const file of files) {
      try {
        const content = fs.readFileSync(file.path, 'utf8');
        const lines = content.split('\n').filter(l => l.trim());
        
        // Check if this is a subagent session
        let isSubagent = false;
        let subagentId = null;
        let task = null;
        let startedAt = null;
        let lastActivity = file.stat.mtimeMs;
        
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            
            // Look for subagent session key
            if (entry.sessionKey && entry.sessionKey.includes(':subagent:')) {
              isSubagent = true;
              // Extract subagent ID from sessionKey like "agent:main:subagent:UUID"
              const parts = entry.sessionKey.split(':subagent:');
              if (parts[1]) {
                subagentId = parts[1].split(':')[0]; // Get UUID part
              }
            }
            
            // Look for task/context in the session
            if (entry.type === 'session' && entry.timestamp) {
              startedAt = new Date(entry.timestamp).getTime();
            }
            
            // Look for subagent context or task description in messages
            if (entry.message && entry.message.role === 'user' && entry.message.content) {
              const content = typeof entry.message.content === 'string' 
                ? entry.message.content 
                : JSON.stringify(entry.message.content);
              // Try to extract task from subagent context
              if (content.includes('# Subagent Context') || content.includes('You were created to handle:')) {
                const taskMatch = content.match(/You were created to handle:\s*(.+?)(?:\n|$)/);
                if (taskMatch) {
                  task = taskMatch[1].substring(0, 100); // Limit task length
                }
              }
              // Fallback: use first user message as task hint
              if (!task && content.length > 0 && content.length < 200) {
                task = content.substring(0, 80);
              }
            }
            
            // Track latest timestamp
            if (entry.timestamp) {
              const ts = new Date(entry.timestamp).getTime();
              if (ts > lastActivity) lastActivity = ts;
            }
          } catch (e) {
            // Skip malformed lines
          }
        }
        
        if (isSubagent && subagentId) {
          const isActive = (now - lastActivity) < SUBAGENT_TIMEOUT_MS;
          subagents.push({
            id: subagentId,
            shortId: subagentId.substring(0, 8),
            task: task || 'Working...',
            startedAt,
            lastActivity,
            duration: startedAt ? now - startedAt : null,
            active: isActive,
            sessionFile: file.name
          });
        }
      } catch (e) {
        console.error(`Error parsing session file ${file.name}:`, e.message);
      }
    }
    
    // Sort by activity (most recent first), active ones first
    subagents.sort((a, b) => {
      if (a.active !== b.active) return b.active ? 1 : -1;
      return b.lastActivity - a.lastActivity;
    });
    
    // Limit to most recent 10 subagents
    res.json({ 
      subagents: subagents.slice(0, 10),
      activeCount: subagents.filter(s => s.active).length,
      totalCount: subagents.length,
      timestamp: now
    });
  } catch (e) {
    console.error('Subagents API error:', e);
    res.status(500).json({ error: 'Failed to get subagent status', subagents: [] });
  }
});

// ==================== END SUBAGENT STATUS API ====================

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
