const express = require('express');
const router = express.Router();
const { loadNewsletters, saveNewsletters } = require('../utils/db');
const { requireAuth } = require('../middleware/auth');

// GET all newsletters
router.get('/', requireAuth, (req, res) => {
  try {
    const newsletters = loadNewsletters();
    res.json(newsletters);
  } catch (e) {
    console.error('Newsletters API error:', e);
    res.status(500).json({ error: 'Failed to load newsletters' });
  }
});

// POST new newsletter
router.post('/', requireAuth, (req, res) => {
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
router.put('/:id', requireAuth, (req, res) => {
  try {
    const newsletters = loadNewsletters();
    const idx = newsletters.findIndex(n => n.id === req.params.id);
    
    if (idx === -1) {
      return res.status(404).json({ error: 'Newsletter not found' });
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
    console.error('Newsletter update error:', e);
    res.status(500).json({ error: 'Failed to update newsletter' });
  }
});

// DELETE newsletter
router.delete('/:id', requireAuth, (req, res) => {
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

// POST regenerate prompt from content toggles
router.post('/:id/regenerate-prompt', requireAuth, (req, res) => {
  try {
    const newsletters = loadNewsletters();
    const idx = newsletters.findIndex(n => n.id === req.params.id);
    
    if (idx === -1) {
      return res.status(404).json({ error: 'Newsletter not found' });
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

module.exports = router;
