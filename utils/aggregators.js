// Aggregate usage data from multiple session files
function aggregateUsage(parsedFiles) {
  const aggregated = {};
  const allTimeSeriesData = [];
  
  for (const { usage, timeSeriesData } of parsedFiles) {
    for (const [model, data] of Object.entries(usage)) {
      if (!aggregated[model]) {
        aggregated[model] = {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: 0,
          calls: 0
        };
      }
      
      aggregated[model].input += data.input;
      aggregated[model].output += data.output;
      aggregated[model].cacheRead += data.cacheRead;
      aggregated[model].cacheWrite += data.cacheWrite;
      aggregated[model].totalTokens += data.totalTokens;
      aggregated[model].cost += data.cost;
      aggregated[model].calls += data.calls;
    }
    
    allTimeSeriesData.push(...timeSeriesData);
  }
  
  return { aggregated, allTimeSeriesData };
}

// Build time series for charting
function buildTimeSeries(allTimeSeriesData, days) {
  const usdToEur = 0.92;
  const now = Date.now();
  const cutoff = now - (days * 24 * 60 * 60 * 1000);
  
  const dateModelMap = {};
  
  for (const { timestamp, model, tokens, cost } of allTimeSeriesData) {
    if (timestamp < cutoff) continue;
    
    const date = new Date(timestamp).toISOString().split('T')[0];
    
    if (!dateModelMap[date]) {
      dateModelMap[date] = {};
    }
    if (!dateModelMap[date][model]) {
      dateModelMap[date][model] = { tokens: 0, cost: 0 };
    }
    
    dateModelMap[date][model].tokens += tokens;
    dateModelMap[date][model].cost += cost * usdToEur;
  }
  
  // Generate all dates in range
  const dates = [];
  const startDate = new Date(cutoff);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(now);
  endDate.setHours(0, 0, 0, 0);
  
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split('T')[0]);
  }
  
  const timeSeries = dates.map(date => {
    const entry = { date };
    const dayData = dateModelMap[date] || {};
    
    for (const [model, data] of Object.entries(dayData)) {
      entry[model] = {
        tokens: data.tokens,
        cost: data.cost
      };
    }
    
    return entry;
  });
  
  return timeSeries;
}

// Build task time series for charting
function buildTaskTimeSeries(allTaskTimeSeriesData, days, usdToEur) {
  const now = Date.now();
  const dateTaskMap = {};
  
  for (const { timestamp, taskId, tokens, cost } of allTaskTimeSeriesData) {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    const dateStr = date.toISOString().split('T')[0];
    
    if (!dateTaskMap[dateStr]) {
      dateTaskMap[dateStr] = {};
    }
    
    if (!dateTaskMap[dateStr][taskId]) {
      dateTaskMap[dateStr][taskId] = { tokens: 0, cost: 0 };
    }
    
    dateTaskMap[dateStr][taskId].tokens += tokens;
    dateTaskMap[dateStr][taskId].cost += cost;
  }
  
  const dates = [];
  const startDate = new Date(now - days * 24 * 60 * 60 * 1000);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(now);
  endDate.setHours(0, 0, 0, 0);
  
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split('T')[0]);
  }
  
  const timeSeries = dates.map(date => {
    const entry = { date };
    const dayData = dateTaskMap[date] || {};
    
    for (const [taskId, data] of Object.entries(dayData)) {
      entry[taskId] = {
        tokens: data.tokens,
        cost: data.cost,
        costEur: data.cost * usdToEur
      };
    }
    
    return entry;
  });
  
  return timeSeries;
}

module.exports = {
  aggregateUsage,
  buildTimeSeries,
  buildTaskTimeSeries
};
