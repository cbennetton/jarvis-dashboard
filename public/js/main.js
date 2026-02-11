// Main application initialization and state management

// Global state
window.AppState = {
  hourlyChart: null,
  dailyChart: null,
  currentMonth: new Date(),
  allActivities: [],
  currentMarkdownHash: '',
  currentSkillsHash: '',
  changeCheckInterval: null
};

// Initialize app
async function initApp() {
  // Initialize UI
  UI.init();
  
  // Check authentication
  try {
    const { authenticated } = await API.checkAuth();
    if (authenticated) {
      showDashboard();
    }
  } catch (e) {
    console.log('Auth check failed, showing login');
  }
  
  // Setup logout handler
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
      await API.logout();
    } catch(e) {}
    location.reload();
  });
  
  // Setup Call Me button
  setupCallMeButton();
  
  // Setup refresh button
  document.getElementById('refreshDashboard').addEventListener('click', async function() {
    const btn = this;
    UI.setLoading(btn, true);
    try {
      await Promise.all([loadData(), loadSubagents(), loadMainAgentActivity()]);
    } catch (e) {
      console.error('Refresh failed:', e);
    } finally {
      UI.setLoading(btn, false);
    }
  });
}

function setupCallMeButton() {
  document.getElementById('callMeBtn').addEventListener('click', async () => {
    const btn = document.getElementById('callMeBtn');
    const icon = btn.querySelector('.icon');
    const text = btn.querySelector('span:not(.icon)');
    
    try {
      btn.disabled = true;
      btn.classList.add('calling');
      text.textContent = 'Calling...';
      
      const data = await API.callMe();
      
      if (data.success) {
        text.textContent = 'Calling! 📱';
        setTimeout(() => {
          text.textContent = 'Call Me Now';
          btn.classList.remove('calling');
          btn.disabled = false;
        }, 5000);
      } else {
        text.textContent = 'Failed';
        setTimeout(() => {
          text.textContent = 'Call Me Now';
          btn.classList.remove('calling');
          btn.disabled = false;
        }, 3000);
      }
    } catch (e) {
      console.error('Call failed:', e);
      text.textContent = 'Error';
      setTimeout(() => {
        text.textContent = 'Call Me Now';
        btn.classList.remove('calling');
        btn.disabled = false;
      }, 3000);
    }
  });
}

function showDashboard() {
  UI.showDashboard();
  
  // Initialize components
  if (window.Charts) Charts.init();
  if (window.Charts) Charts.initToggle();
  if (window.Calendar) Calendar.render();
  
  // Load initial data
  loadData();
  loadSubagents();
  loadMainAgentActivity();
  
  // Poll for updates every 5 seconds
  setInterval(() => {
    loadData();
    loadSubagents();
    loadMainAgentActivity();
  }, 5000);
  
  // Start change detection for markdown/skills
  startChangeDetection();
}

async function loadData() {
  try {
    const [status, activities, stats] = await Promise.all([
      API.getStatus(),
      API.getActivities(24),
      API.getStats()
    ]);
    
    // Update status display
    updateStatusDisplay(status);
    
    // Update activities
    AppState.allActivities = activities;
    
    // Update charts
    if (window.Charts) {
      Charts.updateHourly(stats.hourly);
      Charts.updateDaily(stats.daily);
    }
    
    // Update stats
    updateStatsDisplay(stats);
  } catch (e) {
    console.error('Load data failed:', e);
  }
}

function updateStatusDisplay(status) {
  const indicator = document.querySelector('.status-indicator');
  const statusTask = document.querySelector('.status-task');
  const statusTime = document.querySelector('.status-time');
  
  if (status.active) {
    indicator.classList.add('active');
    indicator.classList.remove('inactive');
    statusTask.textContent = status.task || 'Working...';
    
    const duration = Math.floor((Date.now() - status.startedAt) / 1000);
    statusTime.innerHTML = `<span class="duration">${formatDuration(duration)}</span> active`;
  } else {
    indicator.classList.remove('active');
    indicator.classList.add('inactive');
    statusTask.textContent = 'Idle';
    statusTime.textContent = 'Waiting for task...';
  }
}

function updateStatsDisplay(stats) {
  const activityCount = document.getElementById('activityCount');
  const activeHours = document.getElementById('activeHours');
  
  if (activityCount) {
    activityCount.textContent = stats.total.activities || 0;
  }
  if (activeHours) {
    activeHours.textContent = stats.total.activeHours || 0;
  }
}

async function loadSubagents() {
  try {
    const data = await API.getSubagents();
    displaySubagents(data.subagents, data.activeCount);
  } catch (e) {
    console.error('Load subagents failed:', e);
  }
}

function displaySubagents(subagents, count) {
  const countBadge = document.getElementById('subagentsCount');
  const container = document.getElementById('subagentsList');
  
  if (countBadge) {
    countBadge.textContent = count || 0;
    countBadge.style.display = count > 0 ? 'inline-block' : 'none';
  }
  
  if (!container) return;
  
  if (subagents.length === 0) {
    container.innerHTML = '<div class="empty-state">No active subagents</div>';
    return;
  }
  
  container.innerHTML = subagents.map(sub => `
    <div class="subagent-item">
      <div class="subagent-icon">🤖</div>
      <div class="subagent-info">
        <div class="subagent-task">${escapeHtml(sub.task)}</div>
        <div class="subagent-meta">
          <span class="subagent-model">${sub.model}</span>
          <span class="subagent-duration">${formatDuration(sub.duration)}</span>
        </div>
      </div>
    </div>
  `).join('');
}

async function loadMainAgentActivity() {
  try {
    const data = await API.getMainAgentActivity(10);
    displayMainAgentActivity(data.activities);
  } catch (e) {
    console.error('Load activity failed:', e);
  }
}

function displayMainAgentActivity(activities) {
  const container = document.getElementById('mainAgentActivityFeed');
  if (!container) return;
  
  if (activities.length === 0) {
    container.innerHTML = '<div class="empty-state">No recent activity</div>';
    return;
  }
  
  container.innerHTML = activities.map(act => `
    <div class="activity-item">
      <div class="activity-icon">${act.icon}</div>
      <div class="activity-description">${escapeHtml(act.description)}</div>
      <div class="activity-time">${formatRelativeTime(act.timestamp)}</div>
    </div>
  `).join('');
}

function startChangeDetection() {
  // Poll for file changes every 30 seconds
  AppState.changeCheckInterval = setInterval(async () => {
    try {
      const data = await API.checkChanges(
        AppState.currentMarkdownHash,
        AppState.currentSkillsHash
      );
      
      if (data.markdownsChanged) {
        console.log('Markdowns changed, reloading...');
        if (window.Markdown) Markdown.load();
      }
      
      if (data.skillsChanged) {
        console.log('Skills changed, reloading...');
        if (window.Skills) Skills.load();
      }
      
      AppState.currentMarkdownHash = data.newMarkdownHash;
      AppState.currentSkillsHash = data.newSkillsHash;
    } catch (e) {
      // Silently fail, don't spam console
    }
  }, 30000);
}

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', initApp);
