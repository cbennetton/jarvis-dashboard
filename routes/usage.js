const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { SESSIONS_DIR } = require('../config/paths');
const { MODEL_INFO, TASK_PATTERNS } = require('../config/constants');
const { parseSessionFile, parseSessionFileForTask, categorizeTask } = require('../utils/parsers');
const { aggregateUsage, buildTimeSeries, buildTaskTimeSeries } = require('../utils/aggregators');

// GET /api/usage - Aggregate usage data
router.get('/', requireAuth, (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    
    // For "Today" view (days=1), use start of current UTC day
    let cutoffTime;
    if (days === 1) {
      const now = new Date();
      const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
      cutoffTime = startOfToday.getTime();
    } else {
      cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    }
    
    if (!fs.existsSync(SESSIONS_DIR)) {
      return res.json({ 
        models: {}, 
        totals: { tokens: 0, cost: 0, calls: 0 }, 
        timeSeries: [], 
        period: days 
      });
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
    
    // Convert cost from USD to EUR
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

// GET /api/usage-by-task - Aggregate usage by task type
router.get('/by-task', requireAuth, (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const usdToEur = 0.92;
    
    // For "Today" view (days=1), use start of current UTC day
    let cutoffTime;
    if (days === 1) {
      const now = new Date();
      const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
      cutoffTime = startOfToday.getTime();
    } else {
      cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    }
    
    if (!fs.existsSync(SESSIONS_DIR)) {
      return res.json({ 
        tasks: {}, 
        totals: { tokens: 0, cost: 0, runs: 0 }, 
        timeSeries: [], 
        period: days 
      });
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
    const allTaskTimeSeriesData = [];
    
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
      
      // Add model display info
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

module.exports = router;
