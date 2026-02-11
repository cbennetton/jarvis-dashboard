const fs = require('fs');
const { DB_FILE, CHAT_FILE, NEWSLETTERS_FILE } = require('../config/paths');

// Main database operations
function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('DB load error:', e);
  }
  return { 
    users: [], 
    activities: [], 
    currentStatus: { active: false, task: null, startedAt: null }, 
    repos: [] 
  };
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Chat messages operations
function loadChats() {
  try {
    if (fs.existsSync(CHAT_FILE)) {
      return JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Chats load error:', e);
  }
  return {};
}

function saveChats(chats) {
  fs.writeFileSync(CHAT_FILE, JSON.stringify(chats, null, 2));
}

// Newsletters operations
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

module.exports = {
  loadDB,
  saveDB,
  loadChats,
  saveChats,
  loadNewsletters,
  saveNewsletters
};
