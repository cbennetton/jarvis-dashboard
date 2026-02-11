// API wrapper functions for dashboard

const API = {
  // Auth endpoints
  async checkAuth() {
    const res = await fetch('/api/auth-check', { credentials: 'same-origin' });
    return res.json();
  },
  
  async login(username, password) {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username, password })
    });
    return res.json();
  },
  
  async logout() {
    await fetch('/api/logout', { 
      method: 'POST', 
      credentials: 'same-origin' 
    });
  },
  
  // Status endpoints
  async getStatus() {
    const res = await fetch('/api/status', { credentials: 'same-origin' });
    return res.json();
  },
  
  async getActivities(hours = 24) {
    const res = await fetch(`/api/status/activities?hours=${hours}`, { 
      credentials: 'same-origin' 
    });
    return res.json();
  },
  
  async getStats() {
    const res = await fetch('/api/status/stats', { credentials: 'same-origin' });
    return res.json();
  },
  
  // Repos
  async getRepos() {
    const res = await fetch('/api/repos', { credentials: 'same-origin' });
    return res.json();
  },
  
  // Call endpoint
  async callMe() {
    const res = await fetch('/api/call-me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin'
    });
    return res.json();
  },
  
  // Chat endpoints
  async getChat(activityId) {
    const res = await fetch(`/api/chat/${activityId}`, { 
      credentials: 'same-origin' 
    });
    return res.json();
  },
  
  async sendChat(activityId, task, message) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ activityId, task, message })
    });
    return res.json();
  },
  
  // Markdown endpoints
  async getMarkdowns() {
    const res = await fetch('/api/markdowns', { credentials: 'same-origin' });
    return res.json();
  },
  
  async getMarkdown(path) {
    const res = await fetch(`/api/markdown?path=${encodeURIComponent(path)}`, {
      credentials: 'same-origin'
    });
    return res.json();
  },
  
  async saveMarkdown(path, content) {
    const res = await fetch('/api/markdown/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ path, content })
    });
    return res.json();
  },
  
  async getSkills() {
    const res = await fetch('/api/skills', { credentials: 'same-origin' });
    return res.json();
  },
  
  async checkChanges(markdownHash, skillsHash) {
    const res = await fetch(
      `/api/changes?markdownHash=${markdownHash}&skillsHash=${skillsHash}`, 
      { credentials: 'same-origin' }
    );
    return res.json();
  },
  
  // Newsletters endpoints
  async getNewsletters() {
    const res = await fetch('/api/newsletters', { credentials: 'same-origin' });
    return res.json();
  },
  
  async createNewsletter(newsletter) {
    const res = await fetch('/api/newsletters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(newsletter)
    });
    return res.json();
  },
  
  async updateNewsletter(id, updates) {
    const res = await fetch(`/api/newsletters/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(updates)
    });
    return res.json();
  },
  
  async deleteNewsletter(id) {
    const res = await fetch(`/api/newsletters/${id}`, {
      method: 'DELETE',
      credentials: 'same-origin'
    });
    return res.json();
  },
  
  async regeneratePrompt(id, contentToggles, language, location) {
    const res = await fetch(`/api/newsletters/${id}/regenerate-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ contentToggles, language, location })
    });
    return res.json();
  },
  
  // Usage endpoints
  async getUsage(days = 30) {
    const res = await fetch(`/api/usage?days=${days}`, { 
      credentials: 'same-origin' 
    });
    return res.json();
  },
  
  async getUsageByTask(days = 30) {
    const res = await fetch(`/api/usage/by-task?days=${days}`, {
      credentials: 'same-origin'
    });
    return res.json();
  },
  
  // Subagents
  async getSubagents() {
    const res = await fetch('/api/subagents', { credentials: 'same-origin' });
    return res.json();
  },
  
  // Main agent activity
  async getMainAgentActivity(limit = 10) {
    const res = await fetch(`/api/main-agent-activity?limit=${limit}`, {
      credentials: 'same-origin'
    });
    return res.json();
  }
};
