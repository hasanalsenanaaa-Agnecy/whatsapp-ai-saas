import { config } from './config.js';

export function generateDashboardHTML(stats: {
  totalLeads: number;
  leadsToday: number;
  leadsThisWeek: number;
  leadsByCity: Record<string, number>;
  leadsByProperty: Record<string, number>;
  recentLeads: any[];
}): string {
  const cityRows = Object.entries(stats.leadsByCity)
    .sort((a, b) => b[1] - a[1])
    .map(([city, count]) => `<tr><td>${city}</td><td>${count}</td></tr>`)
    .join('');

  const propertyRows = Object.entries(stats.leadsByProperty)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `<tr><td>${type}</td><td>${count}</td></tr>`)
    .join('');

  const leadRows = stats.recentLeads
    .map(lead => `
      <tr>
        <td>${lead.name || 'N/A'}</td>
        <td>${lead.phone || 'N/A'}</td>
        <td>${lead.propertyType || 'N/A'}</td>
        <td>${lead.city || 'N/A'}</td>
        <td>${lead.budget || 'N/A'}</td>
        <td>${new Date(lead.timestamp).toLocaleDateString('en-SA')}</td>
      </tr>
    `)
    .join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.agencyName} - Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { color: #1a1a1a; margin-bottom: 10px; }
    .subtitle { color: #666; margin-bottom: 30px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .stat-card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .stat-card h3 { color: #666; font-size: 14px; margin-bottom: 5px; }
    .stat-card .number { font-size: 32px; font-weight: bold; color: #25D366; }
    .section { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px; }
    .section h2 { margin-bottom: 15px; color: #1a1a1a; font-size: 18px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f9f9f9; font-weight: 600; color: #666; }
    tr:hover { background: #f9f9f9; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    @media (max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } }
    .refresh { color: #666; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 ${config.agencyName}</h1>
    <p class="subtitle">Lead Dashboard</p>

    <div class="stats">
      <div class="stat-card">
        <h3>Total Leads</h3>
        <div class="number">${stats.totalLeads}</div>
      </div>
      <div class="stat-card">
        <h3>Today</h3>
        <div class="number">${stats.leadsToday}</div>
      </div>
      <div class="stat-card">
        <h3>This Week</h3>
        <div class="number">${stats.leadsThisWeek}</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="section">
        <h2>📍 Leads by City</h2>
        <table>
          <tr><th>City</th><th>Count</th></tr>
          ${cityRows || '<tr><td colspan="2">No data yet</td></tr>'}
        </table>
      </div>
      <div class="section">
        <h2>🏠 Leads by Property Type</h2>
        <table>
          <tr><th>Type</th><th>Count</th></tr>
          ${propertyRows || '<tr><td colspan="2">No data yet</td></tr>'}
        </table>
      </div>
    </div>

    <div class="section">
      <h2>📋 Recent Leads</h2>
      <table>
        <tr>
          <th>Name</th>
          <th>Phone</th>
          <th>Property</th>
          <th>City</th>
          <th>Budget</th>
          <th>Date</th>
        </tr>
        ${leadRows || '<tr><td colspan="6">No leads yet</td></tr>'}
      </table>
    </div>

    <p class="refresh">Auto-refreshes every 60 seconds. Last updated: ${new Date().toLocaleString('en-SA', { timeZone: 'Asia/Riyadh' })}</p>
  </div>
  <script>setTimeout(() => location.reload(), 60000);</script>
</body>
</html>
  `;
}
