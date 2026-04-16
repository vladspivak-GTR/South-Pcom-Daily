const fs = require('fs');
const path = require('path');

const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/1bpbzmpMbJA31L4-gKJsBjGLOEYdgr_ezk6IjGoEB6us/export?format=csv';

const ACTIVE_COMPANIES = ['Spirion', 'Spread', 'Innovate', 'Galatea', 'IMPULSPROM', 'omnia'];

const COMPANY_COLORS = {
  Spirion: '#38bdf8',
  Spread: '#34d399',
  Innovate: '#818cf8',
  Galatea: '#fbbf24',
  IMPULSPROM: '#fb7185',
  omnia: '#f472b6',
};

const GOALS = {
  'Total Portfolio': 408000,
  Spirion: 138000,
  Innovate: 122000,
  Spread: 71000,
  Galatea: 63000,
  IMPULSPROM: 13000,
  omnia: 1000,
};

// Parse a value that could be raw number, $1,234.56, or 694.34%
function parseNum(val) {
  if (val == null || val === '') return 0;
  const s = String(val).replace(/[$,%"]/g, '').replace(/,/g, '').trim();
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// Parse CSV row handling quoted fields (for values like "$2,410.88")
function parseCSVRow(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

// Detect if ROI value is a multiplier (raw) or already percentage
function parseROI(roiVal, spend, profit) {
  const s = String(roiVal);
  if (s.includes('%')) {
    // Already percentage: "694.34%"
    return parseNum(roiVal);
  }
  // Raw multiplier: 12.89 means 1289%
  const raw = parseNum(roiVal);
  // Sanity check: if raw > 100, it's likely already percentage
  // If spend is 0, ROI is 0
  if (spend === 0) return 0;
  // Calculate from profit/spend to be safe
  return (profit / spend) * 100;
}

async function main() {
  console.log('Fetching Google Sheet...');
  const res = await fetch(SHEET_CSV_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);
  const csv = await res.text();

  const lines = csv.trim().split('\n');
  const header = lines[0];
  const rows = lines.slice(1).map(line => {
    const f = parseCSVRow(line);
    const spend = parseNum(f[3]);
    const revenue = parseNum(f[4]);
    const profit = parseNum(f[5]);
    const roi = parseROI(f[6], spend, profit);
    return {
      date: f[0],
      company: f[1],
      channel: f[2],
      spend,
      revenue,
      profit,
      roi,
      manager: f[7],
    };
  });

  // Filter to active companies only
  const active = rows.filter(r => ACTIVE_COMPANIES.includes(r.company));

  // Get all unique dates, sorted
  const dates = [...new Set(active.map(r => r.date))].sort();
  const yesterday = dates[dates.length - 1];

  // Month info
  const firstDate = new Date(dates[0] + 'T00:00:00Z');
  const lastDate = new Date(yesterday + 'T00:00:00Z');
  const year = firstDate.getUTCFullYear();
  const month = firstDate.getUTCMonth(); // 0-based
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthName = monthNames[month];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysPassed = dates.length;
  const monthShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month];

  console.log(`Month: ${monthName} ${year}, Days: ${daysPassed}/${daysInMonth}, Last date: ${yesterday}`);

  // --- Daily data (aggregate all companies per day) ---
  const dailyData = dates.map(date => {
    const dayRows = active.filter(r => r.date === date);
    const spend = dayRows.reduce((s, r) => s + r.spend, 0);
    const revenue = dayRows.reduce((s, r) => s + r.revenue, 0);
    const profit = dayRows.reduce((s, r) => s + r.profit, 0);
    const roi = spend > 0 ? (profit / spend) * 100 : 0;
    const day = new Date(date + 'T00:00:00Z').getUTCDate();
    return {
      date: `${monthShort} ${String(day).padStart(2, '0')}`,
      spend: Math.round(spend),
      revenue: Math.round(revenue),
      profit: Math.round(profit),
      roi: Math.round(roi * 100) / 100,
    };
  });

  // --- Monthly companies (aggregate entire month per company) ---
  const monthlyCompanies = ACTIVE_COMPANIES.map(name => {
    const compRows = active.filter(r => r.company === name);
    const spend = compRows.reduce((s, r) => s + r.spend, 0);
    const revenue = compRows.reduce((s, r) => s + r.revenue, 0);
    const profit = compRows.reduce((s, r) => s + r.profit, 0);
    const roi = spend > 0 ? (profit / spend) * 100 : 0;
    const runRate = daysPassed > 0 ? (profit / daysPassed) * daysInMonth : 0;
    return {
      name,
      spend: Math.round(spend),
      revenue: Math.round(revenue),
      profit: Math.round(profit),
      roi: Math.round(roi * 100) / 100,
      runRate: Math.round(runRate),
      color: COMPANY_COLORS[name],
    };
  }).filter(c => c.spend > 0 || c.revenue > 0 || c.profit > 0);

  // --- Yesterday companies ---
  const yesterdayCompanies = ACTIVE_COMPANIES.map(name => {
    const compRows = active.filter(r => r.company === name && r.date === yesterday);
    const spend = compRows.reduce((s, r) => s + r.spend, 0);
    const revenue = compRows.reduce((s, r) => s + r.revenue, 0);
    const profit = compRows.reduce((s, r) => s + r.profit, 0);
    const roi = spend > 0 ? (profit / spend) * 100 : 0;
    return {
      name,
      spend: Math.round(spend),
      revenue: Math.round(revenue),
      profit: Math.round(profit),
      roi: Math.round(roi * 100) / 100,
      color: COMPANY_COLORS[name],
    };
  }).filter(c => c.spend > 0 || c.revenue > 0 || c.profit > 0);

  // --- Totals ---
  const totalSpend = monthlyCompanies.reduce((s, c) => s + c.spend, 0);
  const totalRevenue = monthlyCompanies.reduce((s, c) => s + c.revenue, 0);
  const totalProfit = monthlyCompanies.reduce((s, c) => s + c.profit, 0);
  const totalROI = totalSpend > 0 ? (totalProfit / totalSpend) * 100 : 0;
  const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
  const avgDailyRevenue = daysPassed > 0 ? Math.round(totalRevenue / daysPassed) : 0;
  const avgDailyProfit = daysPassed > 0 ? Math.round(totalProfit / daysPassed) : 0;
  const companiesInProfit = monthlyCompanies.filter(c => c.profit > 0).length;
  const runRate = daysPassed > 0 ? Math.round((totalProfit / daysPassed) * daysInMonth) : 0;

  // Yesterday totals
  const ySpend = yesterdayCompanies.reduce((s, c) => s + c.spend, 0);
  const yRevenue = yesterdayCompanies.reduce((s, c) => s + c.revenue, 0);
  const yProfit = yesterdayCompanies.reduce((s, c) => s + c.profit, 0);
  const yROI = ySpend > 0 ? Math.round((yProfit / ySpend) * 100 * 10) / 10 : 0;
  const yDate = new Date(yesterday + 'T00:00:00Z');
  const yDay = yDate.getUTCDate();
  const yDateStr = `${monthShort} ${yDay}, ${year}`;

  // Format last day number for date badge
  const lastDay = new Date(yesterday + 'T00:00:00Z').getUTCDate();
  const firstDay = new Date(dates[0] + 'T00:00:00Z').getUTCDate();

  // --- Goals ---
  const goals = [
    { name: 'Total Portfolio', current: totalProfit, target: GOALS['Total Portfolio'], color: 'linear-gradient(90deg,#2dd4bf,#38bdf8,#a78bfa)', dotColor: '#2dd4bf', isTotal: true },
    ...monthlyCompanies.map(c => ({
      name: c.name,
      current: c.profit,
      target: GOALS[c.name] || 0,
      color: `linear-gradient(90deg,${c.color},${lighten(c.color)})`,
      dotColor: c.color,
      isTotal: false,
    })),
  ];

  console.log(`Total: Spend=$${totalSpend}, Revenue=$${totalRevenue}, Profit=$${totalProfit}, ROI=${totalROI.toFixed(1)}%`);
  console.log(`Yesterday (${yesterday}): Profit=$${yProfit}, ROI=${yROI}%`);

  // --- Build the data block for index.html ---
  const dataBlock = `const dailyData=${JSON.stringify(dailyData)};
const monthlyCompanies=${JSON.stringify(monthlyCompanies)};
const yesterdayCompanies=${JSON.stringify(yesterdayCompanies)};
const DASH_CONFIG=${JSON.stringify({
    month: `${monthName} ${year}`,
    monthShort,
    year,
    daysPassed,
    daysInMonth,
    firstDay: `${String(firstDay).padStart(2,'0')}`,
    lastDay: `${String(lastDay).padStart(2,'0')}`,
    totalSpend,
    totalRevenue,
    totalProfit,
    totalROI: Math.round(totalROI * 10) / 10,
    profitMargin: Math.round(profitMargin * 10) / 10,
    avgDailyRevenue,
    avgDailyProfit,
    companiesInProfit,
    runRate,
    ySpend,
    yRevenue,
    yProfit,
    yROI,
    yDateStr,
    yActiveCompanies: yesterdayCompanies.length,
    goals,
  })};`;

  // --- Update index.html ---
  // Helper: safe replace that doesn't interpret $ in replacement
  function safeReplace(str, pattern, replacement) {
    return str.replace(pattern, () => replacement);
  }

  const htmlPath = path.join(__dirname, '..', 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  // Replace the data block: starts with "const dailyData=" ends before "Chart.register("
  const dataStart = html.indexOf('const dailyData=');
  const dataEnd = html.indexOf('Chart.register(');
  if (dataStart === -1 || dataEnd === -1) {
    throw new Error('Could not find data markers in index.html');
  }
  html = html.substring(0, dataStart) + dataBlock + '\n' + html.substring(dataEnd);

  // Helper to update a KPI card by label text
  function updateKPI(label, valueStyle, value, sub) {
    const re = new RegExp(
      `(<div class="label">${label.replace(/[()]/g, '\\$&')}</div>)\\s*<div class="value"[^>]*>.*?</div>\\s*<div class="sub">.*?</div>`
    );
    html = safeReplace(html, re,
      `<div class="label">${label}</div><div class="value" style="color:var(${valueStyle})">${value}</div><div class="sub">${sub}</div>`
    );
  }

  const fmtD = n => '$' + n.toLocaleString();
  const profitK = Math.round(totalProfit / 1000);
  const runRateK = Math.round(runRate / 1000);

  // Title & header
  html = safeReplace(html, /<title>.*?<\/title>/, `<title>${monthName} ${year} \u2014 Performance Dashboard</title>`);
  html = safeReplace(html, /<div class="gate-logo">.*?<\/div>/, `<div class="gate-logo">${monthName} ${year}</div>`);
  html = safeReplace(html, /<div class="gate-sub">.*?<\/div>/, `<div class="gate-sub">Performance Dashboard</div>`);
  html = safeReplace(html, /<h1>.*?<\/h1>/, `<h1>${monthName} ${year}</h1>`);
  html = safeReplace(html, /<div class="date-badge">.*?<\/div>/,
    `<div class="date-badge">${String(firstDay).padStart(2,'0')} \u2013 ${String(lastDay).padStart(2,'0')} ${monthShort} ${year} \u00b7 Day ${daysPassed}</div>`);

  // Early notice
  html = safeReplace(html, /<div class="text"><strong>.*?<\/strong>.*?<\/div>/,
    `<div class="text"><strong>${daysPassed === Math.floor(daysInMonth/2) ? 'Halfway through' : daysPassed + ' days into'} ${monthName} \u2014 ${daysPassed} days in.</strong> ${companiesInProfit} companies active and profitable. ${fmtD(profitK)}K total profit at ${Math.round(totalROI)}% ROI. Run rate ${fmtD(runRateK)}K.</div>`);

  // Monthly Overview KPIs
  updateKPI('Total Spend', '--text', fmtD(totalSpend), `${daysPassed} days tracked`);
  updateKPI('Total Revenue', '--accent2', fmtD(totalRevenue), `Avg ${fmtD(avgDailyRevenue)}/day`);
  updateKPI('Total Profit', '--green', fmtD(totalProfit), `Avg ${fmtD(avgDailyProfit)}/day`);
  updateKPI('Overall ROI', '--purple', `${Math.round(totalROI)}%`, 'Return on investment');
  updateKPI('Profit Margin', '--amber', `${(Math.round(profitMargin * 10) / 10).toFixed(1)}%`, 'Profit / Revenue ratio');

  // Company section KPIs
  updateKPI('Run Rate (Monthly)', '--amber', fmtD(runRate), 'Projected monthly profit');
  updateKPI('Companies in Profit', '--green', `${companiesInProfit}`, `of ${companiesInProfit} active companies`);
  updateKPI('Monthly ROI', '--purple', `${Math.round(totalROI)}%`, 'Grand total ROI');
  updateKPI('Total Profit (MTD)', '--accent', fmtD(totalProfit), 'Month to date');

  // Yesterday KPIs
  updateKPI('Yesterday Profit', '--green', fmtD(yProfit), yDateStr);
  updateKPI('Yesterday ROI', '--purple', `${yROI}%`, `Return on ${fmtD(ySpend)} spend`);
  updateKPI('Active Companies', '--accent', `${yesterdayCompanies.length}`, 'Generating revenue');

  // Grand total rows in tables
  const roiRound = Math.round(totalROI * 10) / 10;
  html = safeReplace(html,
    /mt\.innerHTML\+='<tr style="border-top:2px solid var\(--accent\);font-weight:800">.*?';/,
    `mt.innerHTML+='<tr style="border-top:2px solid var(--accent);font-weight:800"><td>Grand Total</td><td>${fmtD(totalSpend)}</td><td>${fmtD(totalRevenue)}</td><td style="color:#34d399">${fmtD(totalProfit)}</td><td><span class="roi-badge" style="'+rc(${roiRound})+'">${roiRound.toFixed(1)}%</span></td><td>${fmtD(runRate)}</td></tr>';`
  );
  html = safeReplace(html,
    /yt\.innerHTML\+='<tr style="border-top:2px solid var\(--rose\);font-weight:800">.*?';/,
    `yt.innerHTML+='<tr style="border-top:2px solid var(--rose);font-weight:800"><td>Grand Total</td><td>${fmtD(ySpend)}</td><td>${fmtD(yRevenue)}</td><td style="color:#34d399">${fmtD(yProfit)}</td><td><span class="roi-badge" style="'+rc(${yROI})+'">${yROI.toFixed(1)}%</span></td></tr>';`
  );

  // Goals array
  html = html.replace(/const goals=\[[\s\S]*?\];/, () => `const goals=${JSON.stringify(goals)};`);

  // Days config
  html = safeReplace(html,
    /const daysInMonth=\d+,daysPassed=\d+,daysLeft=daysInMonth-daysPassed;/,
    `const daysInMonth=${daysInMonth},daysPassed=${daysPassed},daysLeft=daysInMonth-daysPassed;`
  );

  // Goals header text
  html = safeReplace(html,
    /Monthly Profit Goals<\/h3><div class="goals-sub">.*?<\/div>/,
    `Monthly Profit Goals</h3><div class="goals-sub">${monthName} ${year} \u00b7 Progress Tracker</div>`
  );

  // Footer
  html = safeReplace(html,
    /DASHBOARD · .*? · ALL FIGURES IN USD/,
    `DASHBOARD \u00b7 ${monthName.toUpperCase()} ${year} \u00b7 ALL FIGURES IN USD`
  );

  // Password gate session key
  html = html.replace(/dash_mar_unlocked/g, () => 'dash_unlocked');

  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log('index.html updated successfully!');
}

// Simple color lightener for gradient endpoints
function lighten(hex) {
  const map = {
    '#38bdf8': '#7dd3fc',
    '#34d399': '#6ee7b7',
    '#818cf8': '#a78bfa',
    '#fbbf24': '#fcd34d',
    '#fb7185': '#fda4af',
    '#f472b6': '#f9a8d4',
  };
  return map[hex] || hex;
}

main().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
