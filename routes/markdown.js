const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { WORKSPACE_DIR, SKILLS_DIR } = require('../config/paths');

// Helper functions
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
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });
}

// List all markdown files
router.get('/markdowns', requireAuth, (req, res) => {
  try {
    const files = scanMarkdownFiles();
    const hash = files.reduce((h, f) => h + f.modified, 0).toString(36);
    res.json({ files, hash, timestamp: Date.now() });
  } catch (e) {
    console.error('Markdowns API error:', e);
    res.status(500).json({ error: 'Failed to list markdown files' });
  }
});

// Get specific markdown content
router.get('/markdown', requireAuth, (req, res) => {
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
router.post('/markdown/save', requireAuth, (req, res) => {
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
    
    // Skills files are read-only
    if (requestedPath.startsWith('skills/')) {
      return res.status(403).json({ error: 'Skills files are read-only' });
    } else {
      filePath = path.join(WORKSPACE_DIR, requestedPath);
    }
    
    // Ensure file exists (don't create new files via this endpoint)
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
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
router.get('/skills', requireAuth, (req, res) => {
  try {
    const skills = scanSkillsDirectory();
    
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

// Check for changes
router.get('/changes', requireAuth, (req, res) => {
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
    res.json({ 
      markdownsChanged: false, 
      skillsChanged: false, 
      timestamp: Date.now() 
    });
  }
});

module.exports = router;
