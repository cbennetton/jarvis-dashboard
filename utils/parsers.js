const fs = require('fs');
const { MODEL_PRICING, TASK_PATTERNS, TOOL_ICONS } = require('../config/constants');

// Parse session file for API usage
function parseSessionFile(filePath) {
  const usage = {};
  const timeSeriesData = [];
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        
        if (entry.message && entry.message.usage && entry.message.model) {
          const model = entry.message.model;
          const u = entry.message.usage;
          
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

// Parse session file for task categorization
function parseSessionFileForTask(filePath) {
  const result = {
    taskType: null,
    label: null,
    firstMessage: null,
    totalTokens: 0,
    cost: 0,
    calls: 0,
    models: {},
    timestamp: null,
    sessionKey: null
  };
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        
        if (entry.type === 'session') {
          result.timestamp = new Date(entry.timestamp).getTime();
        }
        
        if (!result.firstMessage && entry.type === 'message' && entry.message?.role === 'user') {
          const content = entry.message.content;
          if (Array.isArray(content)) {
            result.firstMessage = content.find(c => c.type === 'text')?.text || '';
          } else if (typeof content === 'string') {
            result.firstMessage = content;
          }
        }
        
        if (entry.message?.usage && entry.message?.model) {
          const model = entry.message.model;
          const u = entry.message.usage;
          
          const tokens = u.totalTokens || (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
          
          if (!result.models[model]) {
            result.models[model] = { tokens: 0, cost: 0, calls: 0 };
          }
          
          result.models[model].tokens += tokens;
          result.models[model].calls += 1;
          
          let cost;
          if (u.cost?.total) {
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
          
          result.models[model].cost += cost;
          result.totalTokens += tokens;
          result.cost += cost;
          result.calls += 1;
        }
      } catch (e) {
        // Skip malformed lines
      }
    }
  } catch (e) {
    console.error(`Error parsing session file ${filePath}:`, e.message);
  }
  
  return result;
}

// Categorize task based on session data and first message
function categorizeTask(sessionData, firstMessage) {
  const sessionKey = sessionData.sessionKey || '';
  
  for (const taskType of TASK_PATTERNS) {
    if (taskType.sessionKeyPattern && taskType.sessionKeyPattern.test(sessionKey)) {
      return taskType;
    }
  }
  
  const label = sessionData.label || '';
  
  for (const taskType of TASK_PATTERNS) {
    for (const pattern of taskType.patterns) {
      if (pattern.test(label)) {
        return taskType;
      }
    }
  }
  
  const messageText = firstMessage || '';
  
  for (const taskType of TASK_PATTERNS) {
    for (const pattern of taskType.patterns) {
      if (pattern.test(messageText)) {
        return taskType;
      }
    }
  }
  
  return TASK_PATTERNS.find(t => t.id === 'chat');
}

// Utility functions for activity parsing
function cleanFilePath(filePath) {
  if (!filePath) return 'file';
  
  const cleaned = filePath
    .replace(/^\/home\/ubuntu\/.openclaw\/workspace\//, '')
    .replace(/^~\/\.openclaw\/workspace\//, '')
    .replace(/^\.\//, '')
    .replace(/^\//, '');
  
  if (cleaned.length > 40) {
    const parts = cleaned.split('/');
    return parts[parts.length - 1];
  }
  
  return cleaned;
}

function smartTruncate(text, maxLen = 45) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

// Parse recent activity from session file
function parseRecentActivity(sessionFile, limit = 10) {
  const activities = [];
  
  try {
    const content = fs.readFileSync(sessionFile, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    const recentLines = lines.slice(-200);
    
    for (const line of recentLines) {
      try {
        const entry = JSON.parse(line);
        
        if (entry.type === 'session') continue;
        
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
        
        if (entry.type === 'message' && entry.message?.role === 'assistant') {
          const content = entry.message.content;
          if (Array.isArray(content)) {
            let hasToolCalls = false;
            let assistantText = '';
            
            for (const block of content) {
              if (block.type === 'tool_use' || block.type === 'toolCall') {
                hasToolCalls = true;
                const toolName = block.name || 'unknown';
                const toolInput = block.input || block.arguments || {};
                
                let description = toolName;
                
                if (toolName === 'read') {
                  const file = cleanFilePath(toolInput.path || toolInput.file_path);
                  description = `Read ${file}`;
                } else if (toolName === 'write') {
                  const file = cleanFilePath(toolInput.path || toolInput.file_path);
                  description = `Write ${file}`;
                } else if (toolName === 'edit') {
                  const file = cleanFilePath(toolInput.path || toolInput.file_path);
                  description = `Edit ${file}`;
                } else if (toolName === 'exec') {
                  const cmd = (toolInput.command || '').split(' ')[0];
                  description = `Run ${cmd}`;
                } else if (toolName === 'web_search') {
                  const query = smartTruncate(toolInput.query || '', 30);
                  description = `Search: ${query}`;
                } else if (toolName === 'web_fetch') {
                  let domain = toolInput.url || 'webpage';
                  try {
                    const url = new URL(toolInput.url);
                    domain = url.hostname.replace('www.', '');
                  } catch (e) {}
                  description = `Fetch ${domain}`;
                } else if (toolName === 'message') {
                  const action = toolInput.action || '';
                  description = action === 'send' ? `Send message` : `Message: ${action}`;
                } else if (toolName === 'sessions_spawn') {
                  const label = smartTruncate(toolInput.label || 'task', 30);
                  description = `Spawn: ${label}`;
                } else if (toolName === 'sessions_list') {
                  description = `List sessions`;
                } else if (toolName === 'sessions_info') {
                  description = `Check session info`;
                } else if (toolName === 'sessions_send') {
                  description = `Send to session`;
                } else if (toolName === 'browser') {
                  const action = toolInput.action || 'action';
                  description = `Browser ${action}`;
                } else if (toolName === 'tts') {
                  description = `Speak`;
                } else if (toolName === 'nodes') {
                  const action = toolInput.action || 'action';
                  description = `Node ${action}`;
                } else if (toolName === 'canvas') {
                  const action = toolInput.action || 'action';
                  description = `Canvas ${action}`;
                } else if (toolName === 'image') {
                  description = `Analyze image`;
                } else if (toolName === 'voice_call') {
                  description = `Voice call`;
                }
                
                activities.push({
                  type: 'tool_call',
                  tool: toolName,
                  description: smartTruncate(description, 45),
                  icon: TOOL_ICONS[toolName] || TOOL_ICONS.default,
                  timestamp
                });
              } else if (block.type === 'text') {
                assistantText += block.text || '';
              }
            }
            
            if (!hasToolCalls && assistantText.trim()) {
              const text = assistantText.trim();
              const isMetaMessage = text.match(/^🧠.*Using (Sonnet|Opus|Haiku)/i) || 
                                    text.match(/^\*\*using (sonnet|opus|haiku)\*\*/i);
              
              if (!isMetaMessage) {
                const firstSentence = text.split(/[.!?]\s/)[0] || text;
                let summary = smartTruncate(firstSentence, 40);
                
                if (summary.toLowerCase().startsWith('i ')) {
                  summary = summary.substring(2);
                }
                
                activities.push({
                  type: 'assistant_response',
                  description: `Replied: ${summary}`,
                  icon: '💬',
                  timestamp
                });
              }
            }
          }
        }
      } catch (e) {
        // Skip malformed lines
      }
    }
  } catch (e) {
    console.error('Error parsing activity:', e);
  }
  
  return activities
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

module.exports = {
  parseSessionFile,
  parseSessionFileForTask,
  categorizeTask,
  parseRecentActivity,
  cleanFilePath,
  smartTruncate
};
