// Model pricing per million tokens (as of 2026)
const MODEL_PRICING = {
  'claude-sonnet-4-5': { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  'claude-opus-4-5': { input: 15.00, output: 75.00, cacheRead: 1.50, cacheWrite: 18.75 },
  'claude-haiku-3-5': { input: 0.80, output: 4.00, cacheRead: 0.08, cacheWrite: 1.00 },
  'claude-3-5-sonnet': { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  'claude-3-opus': { input: 15.00, output: 75.00, cacheRead: 1.50, cacheWrite: 18.75 },
  'claude-3-haiku': { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.30 }
};

// Model display information
const MODEL_INFO = {
  'claude-sonnet-4-5': { emoji: '🎵', name: 'Claude Sonnet 4.5', color: '#10b981' },
  'claude-opus-4-5': { emoji: '🎼', name: 'Claude Opus 4.5', color: '#8b5cf6' },
  'claude-haiku-4-5': { emoji: '🐇', name: 'Claude Haiku 4.5', color: '#3b82f6' },
  'claude-haiku-3-5': { emoji: '🌸', name: 'Claude Haiku 3.5', color: '#f472b6' },
  'claude-3-5-sonnet': { emoji: '🎵', name: 'Claude 3.5 Sonnet', color: '#10b981' },
  'claude-3-opus': { emoji: '🎼', name: 'Claude 3 Opus', color: '#8b5cf6' },
  'claude-3-haiku': { emoji: '🌸', name: 'Claude 3 Haiku', color: '#f472b6' }
};

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

// Tool icons for activity feed
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

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '300', 10);
const LOGIN_RATE_LIMIT_MAX = parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '5', 10);
const SETUP_RATE_LIMIT_MAX = parseInt(process.env.SETUP_RATE_LIMIT_MAX || '3', 10);

// API Key
const API_KEY = 'jarvis-secret-key-xK9mP2nQ7vL4';

module.exports = {
  MODEL_PRICING,
  MODEL_INFO,
  TASK_PATTERNS,
  TOOL_ICONS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX,
  LOGIN_RATE_LIMIT_MAX,
  SETUP_RATE_LIMIT_MAX,
  API_KEY
};
