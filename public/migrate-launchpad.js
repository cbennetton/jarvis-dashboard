// Migration script for LaunchPad tasks
// Run this in browser console to update existing localStorage

(function() {
  const stored = localStorage.getItem('launchpadTasks');
  if (!stored) {
    console.log('No existing LaunchPad data found. Fresh install will use new defaults.');
    return;
  }

  const tasks = JSON.parse(stored);
  let updated = false;

  // Find the landing page task
  const landingPageTask = tasks.find(t => 
    t.text.toLowerCase().includes('landing page') && 
    t.text.toLowerCase().includes('briefing')
  );

  if (landingPageTask) {
    // Update the task
    landingPageTask.text = 'Create landing page for Executive AI Briefing service (Game plan ready: ~/workspace/projects/ai-briefing/GAME-PLAN.md)';
    landingPageTask.status = 'progress';
    updated = true;
    console.log('✅ Updated landing page task to "In Progress" with game plan reference');
  }

  if (updated) {
    localStorage.setItem('launchpadTasks', JSON.stringify(tasks));
    console.log('💾 Changes saved to localStorage');
    console.log('🔄 Refresh the page to see updates');
  } else {
    console.log('ℹ️ No matching task found to update');
  }
})();
