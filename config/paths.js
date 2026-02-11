const path = require('path');

// Database and data files
const DB_FILE = path.join(__dirname, '..', 'data.json');
const CHAT_FILE = path.join(__dirname, '..', 'chats.json');
const NEWSLETTERS_FILE = path.join(process.env.HOME, '.openclaw', 'workspace', 'newsletters.json');

// SSL certificates
const SSL_KEY = path.join(__dirname, '..', 'key.pem');
const SSL_CERT = path.join(__dirname, '..', 'cert.pem');

// OpenClaw directories
const WORKSPACE_DIR = path.join(process.env.HOME, '.openclaw', 'workspace');
const SKILLS_DIR = '/home/ubuntu/.npm-global/lib/node_modules/openclaw/skills';
const SESSIONS_DIR = path.join(process.env.HOME, '.openclaw', 'agents', 'main', 'sessions');

module.exports = {
  DB_FILE,
  CHAT_FILE,
  NEWSLETTERS_FILE,
  SSL_KEY,
  SSL_CERT,
  WORKSPACE_DIR,
  SKILLS_DIR,
  SESSIONS_DIR
};
