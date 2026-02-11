// UI helper functions

const UI = {
  elements: {
    loginScreen: null,
    dashboard: null,
    sidebar: null,
    sidebarOverlay: null,
    tooltip: null
  },
  
  init() {
    this.elements.loginScreen = document.getElementById('loginScreen');
    this.elements.dashboard = document.getElementById('dashboard');
    this.elements.sidebar = document.getElementById('sidebar');
    this.elements.sidebarOverlay = document.getElementById('sidebarOverlay');
    this.elements.tooltip = document.getElementById('tooltip');
    
    this.initSidebar();
    this.initNavigation();
  },
  
  initSidebar() {
    document.getElementById('hamburgerBtn').addEventListener('click', () => {
      this.openSidebar();
    });
    
    document.getElementById('sidebarClose').addEventListener('click', () => {
      this.closeSidebar();
    });
    
    this.elements.sidebarOverlay.addEventListener('click', () => {
      this.closeSidebar();
    });
  },
  
  openSidebar() {
    this.elements.sidebar.classList.add('open');
    this.elements.sidebarOverlay.classList.add('open');
  },
  
  closeSidebar() {
    this.elements.sidebar.classList.remove('open');
    this.elements.sidebarOverlay.classList.remove('open');
  },
  
  initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const page = item.dataset.page;
        this.navigateToPage(page);
        this.closeSidebar();
      });
    });
  },
  
  navigateToPage(pageName) {
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navItem = document.querySelector(`.nav-item[data-page="${pageName}"]`);
    if (navItem) navItem.classList.add('active');
    
    // Update pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById(`${pageName}Page`);
    if (page) page.classList.add('active');
    
    // Update header title
    const titles = {
      home: 'Dashboard',
      calendar: 'Activity Calendar',
      repositories: 'Repositories',
      markdowns: 'Markdown Files',
      skills: 'Skills',
      newsletters: 'Morning Boost',
      usage: 'API Usage',
      launchpad: 'Launch Pad'
    };
    document.getElementById('headerPageTitle').textContent = titles[pageName] || 'Dashboard';
    
    // Load page-specific content
    this.loadPageContent(pageName);
  },
  
  loadPageContent(pageName) {
    switch (pageName) {
      case 'calendar':
        if (window.Calendar) {
          Calendar.updateMobileViewVisibility();
          Calendar.render();
        }
        break;
      case 'repositories':
        if (window.loadRepositoriesPage) window.loadRepositoriesPage();
        break;
      case 'markdowns':
        if (window.Markdown) Markdown.load();
        break;
      case 'skills':
        if (window.Skills) Skills.load();
        break;
      case 'newsletters':
        if (window.Newsletters) Newsletters.load();
        break;
      case 'launchpad':
        if (window.loadLaunchPad) window.loadLaunchPad();
        break;
      case 'usage':
        if (window.Usage) {
          Usage.load();
          Usage.loadTaskUsage();
        }
        break;
    }
  },
  
  showDashboard() {
    this.elements.loginScreen.style.display = 'none';
    this.elements.dashboard.style.display = 'block';
  },
  
  showLogin() {
    this.elements.loginScreen.style.display = 'flex';
    this.elements.dashboard.style.display = 'none';
  },
  
  // Tooltip helpers
  showTooltip(event, text) {
    if (!this.elements.tooltip) return;
    this.elements.tooltip.textContent = text;
    this.elements.tooltip.style.display = 'block';
    this.updateTooltipPosition(event);
  },
  
  hideTooltip() {
    if (this.elements.tooltip) {
      this.elements.tooltip.style.display = 'none';
    }
  },
  
  updateTooltipPosition(event) {
    if (!this.elements.tooltip) return;
    const tooltip = this.elements.tooltip;
    tooltip.style.left = (event.pageX + 10) + 'px';
    tooltip.style.top = (event.pageY + 10) + 'px';
  },
  
  // Loading state helpers
  setLoading(element, loading = true) {
    if (loading) {
      element.classList.add('loading');
    } else {
      element.classList.remove('loading');
    }
  }
};
