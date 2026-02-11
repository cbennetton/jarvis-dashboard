const express = require('express');
const https = require('https');
const session = require('express-session');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Configuration
const { SSL_KEY, SSL_CERT } = require('./config/paths');
const PORT = process.env.PORT || 3847;

// Middleware
const { requestLogger } = require('./middleware/logging');
const { apiLimiter } = require('./middleware/rateLimit');

// Routes
const authRoutes = require('./routes/auth');
const statusRoutes = require('./routes/status');
const reposRoutes = require('./routes/repos');
const callRoutes = require('./routes/call');
const chatRoutes = require('./routes/chat');
const markdownRoutes = require('./routes/markdown');
const newslettersRoutes = require('./routes/newsletters');
const usageRoutes = require('./routes/usage');
const subagentsRoutes = require('./routes/subagents');
const activityRoutes = require('./routes/activity');

// Initialize Express app
const app = express();

// Request logging
app.use(requestLogger);

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

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session management
app.use(session({
  secret: 'jarvis-dashboard-secret-fixed-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, 
    httpOnly: true, 
    maxAge: 7 * 24 * 60 * 60 * 1000, 
    sameSite: 'lax' 
  }
}));

// API rate limiting (general)
app.use('/api/', apiLimiter);

// Mount API routes
app.use('/api', authRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/repos', reposRoutes);
app.use('/api/call-me', callRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api', markdownRoutes);
app.use('/api/newsletters', newslettersRoutes);
app.use('/api/usage', usageRoutes);
app.use('/api/subagents', subagentsRoutes);
app.use('/api/main-agent-activity', activityRoutes);

// Static files AFTER API routes
app.use(express.static(path.join(__dirname, 'public')));

// HTTPS server
const httpsServer = https.createServer({
  key: fs.readFileSync(SSL_KEY),
  cert: fs.readFileSync(SSL_CERT)
}, app);

httpsServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🦊 Jarvis Dashboard running on https://0.0.0.0:${PORT}`);
  console.log(`📁 Refactored modular architecture loaded`);
});
