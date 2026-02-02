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

// Repos endpoint
app.get('/api/repos', requireAuth, (req, res) => {
  res.json(db.repos || []);
});

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

app.get('/api/status', requireAuth, (req, res) => {
  res.json(db.currentStatus);
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
  const pending = path.join(__dirname, 'pending-chats.json');
  let p = []; try { p = JSON.parse(fs.readFileSync(pending, 'utf8')); } catch(e) {}
  p.push({ activityId, task, message, time: Date.now() });
  fs.writeFileSync(pending, JSON.stringify(p, null, 2));
  res.json({ success: true });
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

// Internal API
const API_KEY = 'jarvis-secret-key-xK9mP2nQ7vL4';
app.post('/api/internal/status', (req, res) => {
  if (req.headers.authorization !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  const { active, task } = req.body;
  if (db.currentStatus.active && !active && db.currentStatus.startedAt) {
    db.activities.push({
      task: db.currentStatus.task,
      timestamp: db.currentStatus.startedAt,
      duration: Date.now() - db.currentStatus.startedAt,
      endedAt: Date.now()
    });
    if (db.activities.length > 1000) db.activities = db.activities.slice(-1000);
  }
  db.currentStatus = { active: !!active, task: active ? task : null, startedAt: active ? Date.now() : null };
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
