// Chart.js initialization and management

window.Charts = {
  hourlyChart: null,
  dailyChart: null,
  
  init() {
    const chartOpts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { 
          grid: { color: 'rgba(255,255,255,0.05)' }, 
          ticks: { color: 'rgba(255,255,255,0.5)' } 
        },
        y: { 
          grid: { color: 'rgba(255,255,255,0.05)' }, 
          ticks: { color: 'rgba(255,255,255,0.5)' }, 
          beginAtZero: true 
        }
      }
    };
    
    this.hourlyChart = new Chart(document.getElementById('hourlyChart'), {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{
          data: [],
          backgroundColor: 'rgba(16, 185, 129, 0.6)',
          borderColor: 'rgba(16, 185, 129, 1)',
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: chartOpts
    });
    
    this.dailyChart = new Chart(document.getElementById('dailyChart'), {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          data: [],
          borderColor: 'rgba(59, 130, 246, 1)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
          tension: 0.4
        }]
      },
      options: chartOpts
    });
  },
  
  initToggle() {
    document.querySelectorAll('.chart-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.chart-toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const chart = btn.dataset.chart;
        document.getElementById('hourlyChartContainer').style.display = chart === 'hourly' ? 'block' : 'none';
        document.getElementById('dailyChartContainer').style.display = chart === 'daily' ? 'block' : 'none';
      });
    });
  },
  
  updateHourly(hourlyData) {
    if (!this.hourlyChart || !hourlyData) return;
    
    this.hourlyChart.data.labels = hourlyData.map(h => `${h.hour}:00`);
    this.hourlyChart.data.datasets[0].data = hourlyData.map(h => h.activeMinutes);
    this.hourlyChart.update();
  },
  
  updateDaily(dailyData) {
    if (!this.dailyChart || !dailyData) return;
    
    this.dailyChart.data.labels = dailyData.map(d => d.date);
    this.dailyChart.data.datasets[0].data = dailyData.map(d => d.activeMinutes);
    this.dailyChart.update();
  }
};
