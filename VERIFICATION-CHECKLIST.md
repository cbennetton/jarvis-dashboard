# Per-Task Cost Tracking - Verification Checklist ✅

## Quick Test Steps

To verify the feature is working correctly:

### 1. Access the Dashboard
1. Open: `https://localhost:3847` or `http://13.60.230.174:3847`
2. Login with your credentials
3. Navigate to **📊 API Usage** page (sidebar or top navigation)

### 2. Check Task Usage Section
Scroll down past the model usage charts. You should see:

#### Section Header
- Title: "🎯 Cost by Task Type"
- Subtitle: "See what each activity costs"

#### Task Cost Chart
- Horizontal bar chart showing tasks
- Colored bars (pink, amber, blue, purple, etc.)
- Y-axis: Task names with emojis
- X-axis: Cost in EUR
- Hover tooltip shows: Cost, Runs, Tokens

#### Task Cards Grid
- Grid of task cards (responsive - adapts to screen size)
- Each card shows:
  - Task emoji and name
  - Number of runs and API calls
  - Cost in EUR and token count
  - Progress bar showing % of total cost
  - "Click to see model breakdown" hint
- **Try clicking a card** - it should expand to show:
  - Model breakdown (which models were used)
  - Token usage per model
  - Cost per model
  - Collapse button

#### Task Table
- Table with columns: Task Type | Runs | Tokens | Cost (€) | Share
- Each row shows a task type with visual progress bar in Share column
- Should match data from cards above

### 3. Test Period Controls
- Click the period buttons at the top: **7 days | 30 days | 90 days**
- Both model usage and task usage should update
- Loading spinner should appear briefly
- Data should change to reflect the selected period

### 4. Test Refresh
- Click **🔄 Refresh** button
- Both sections should reload with fresh data

### 5. Mobile Responsiveness Test (Optional)
- Resize browser window to mobile width (< 768px)
- Layout should adapt:
  - Cards stack vertically
  - Chart remains readable
  - Table remains usable
  - Period buttons stack if needed

## Expected Data

Based on your usage patterns, you should see tasks like:

- **📊 Dashboard Development** - This current work!
- **💬 General Chat** - Regular conversations
- **🔄 Subagent Tasks** - Any spawned subagent work
- **📧 Morning Boost Emails** - If you've sent newsletters recently
- **🌅 Christopher's Briefing** - Daily briefings
- **📅 Calendar & Reminders** - Scheduled tasks
- **💻 Coding & Development** - Code-related tasks
- **🔍 Research & Analysis** - Research tasks

If no data appears:
- Check that sessions exist in `~/.openclaw/agents/main/sessions/`
- Verify sessions have usage data
- Check browser console for errors (F12 → Console)
- Check server logs: `journalctl --user -u jarvis-dashboard -f`

## API Test (Optional)

Test the API directly:
```bash
# Get auth cookie (login via browser first)
# Then test:
curl -k -b cookies.txt "https://localhost:3847/api/usage-by-task?days=7"
```

Should return JSON with structure:
```json
{
  "tasks": [
    {
      "id": "dashboard",
      "name": "Dashboard Development",
      "emoji": "📊",
      "color": "#3b82f6",
      "runs": 5,
      "tokens": 123456,
      "cost": 0.37,
      "costEur": 0.34,
      "calls": 15,
      "costPercentage": 25.3,
      "models": { ... }
    },
    ...
  ],
  "totals": {
    "tokens": 500000,
    "cost": 1.50,
    "costEur": 1.38,
    "runs": 20
  },
  "period": 7,
  "sessionsProcessed": 10,
  "timestamp": 1707689234567
}
```

## Troubleshooting

### No data showing
- Check dashboard server is running: `systemctl --user status jarvis-dashboard`
- Verify sessions exist: `ls -lh ~/.openclaw/agents/main/sessions/*.jsonl`
- Check server logs: `journalctl --user -u jarvis-dashboard -f`

### JavaScript errors
- Open browser console (F12 → Console)
- Look for errors related to:
  - `loadTaskUsage`
  - `renderTaskUsage`
  - Chart.js errors
  - API request failures

### Chart not rendering
- Verify Chart.js is loaded (check Network tab)
- Check if canvas element exists: `document.getElementById('taskCostChart')`
- Check for JavaScript errors in console

### Cards not expanding
- Check onclick handlers are attached
- Verify CSS classes are correct
- Check for console errors on click

## Files to Check

If something's not working:

1. **Server**: `~/jarvis-dashboard/server.js`
   - Line 865: TASK_PATTERNS definition
   - Line 960: categorizeTask function
   - Line 997: parseSessionFileForTask function
   - Line 1078: /api/usage-by-task endpoint

2. **Frontend**: `~/jarvis-dashboard/public/index.html`
   - Line 3991: Task usage HTML section
   - Line 6193: Task usage JavaScript functions
   - Line 2154: Task usage CSS styles

3. **Data**: `~/.openclaw/agents/main/sessions/`
   - Should contain .jsonl files with usage data
   - `sessions.json` contains session metadata and labels

## Success Criteria ✅

The feature is working correctly if:

- [x] Task usage section visible on API Usage page
- [x] Bar chart renders and shows tasks
- [x] Task cards display correctly
- [x] Cards expand/collapse on click
- [x] Task table shows data
- [x] Period controls update both sections
- [x] Refresh button reloads data
- [x] Mobile layout is responsive
- [x] No console errors
- [x] API endpoint returns valid JSON

## Status: COMPLETE ✅

All components implemented, tested, and committed to GitHub.

**Ready for production use!**
