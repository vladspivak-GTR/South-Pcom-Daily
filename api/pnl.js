// Monthly P&L + top affiliate-networks endpoint (management presentation).
// For a date range, returns:
//   - totals: Voluum report.totals (exact UI match: visits, conversions, cost, revenue) + derived profit/roi/cr
//   - summed: same metrics summed from all returned rows (sanity cross-check vs totals)
//   - networks: per-affiliate-network aggregates (from customVariable8), sorted by profit desc
// Uses tz=Etc/GMT + conversionTimeMode=CONVERSION to match the Voluum UI exactly.
// Guarded by ?k=gapscan2026 (low-sensitivity aggregated data; same Voluum creds as gap-data).

const AFFILIATE_NETWORKS = {
  lbx: 'LinkBux', br: 'Brandreward', noc: 'Noctemque', cue: 'Cuelinks',
  rwd: 'Rewardoo', lh: 'LinkHaitao', wep: 'Webe', yk: 'Yieldkit',
  td: 'TradeDoubler', ecl: 'Eclicklink', pm: 'partnermatic', adm: 'Admitad',
  ba: 'BonusArrive', blu: 'BlueAff', imp: 'Impact', flx: 'FlexOffers',
  awin: 'Awin', snx: 'shopnomix', ta: 'TakeAds', ta1: 'TakeAds',
  tt: 'TradeTracker', clg: 'collabglow', lux: '? (lux)',
  cs: 'Convert Social', lom: 'Lomadee', pa: 'Partner Ads', kwa: 'Kwanko',
};

function parseNetwork(v8) {
  if (!v8) return null;
  const bracketRe = /\[([^\]]*)\]/g;
  const brackets = [];
  let m;
  while ((m = bracketRe.exec(v8)) !== null) brackets.push(m[1]);
  if (brackets.length < 4) return null;
  return brackets[2] || ''; // [country] [campaign] [network] [blog]
}

async function voluumAuth(accessId, accessKey) {
  const res = await fetch('https://api.voluum.com/auth/access/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessId, accessKey }),
  });
  if (!res.ok) throw new Error(`Voluum auth failed: ${res.status}`);
  return (await res.json()).token;
}

async function fetchRange(token, from, to, limit) {
  const toExclusive = new Date(to + 'T12:00:00Z');
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  const toStr = toExclusive.toISOString().split('T')[0];
  const params = [
    `from=${from}T00:00:00Z`, `to=${toStr}T00:00:00Z`,
    'tz=Etc/GMT', 'conversionTimeMode=CONVERSION',
    'groupBy=trafficSource,customVariable8',
    'columns=trafficSourceName,customVariable8,visits,conversions,cost,revenue',
    'sort=revenue', 'direction=desc', `limit=${limit}`,
  ].join('&');
  const res = await fetch(`https://api.voluum.com/report?${params}`, { headers: { 'cwauth-token': token } });
  if (!res.ok) throw new Error(`Report failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function metrics(visits, conv, cost, revenue) {
  const profit = revenue - cost;
  const roi = cost > 0 ? (profit / cost) * 100 : 0;
  const cr = visits > 0 ? (conv / visits) * 100 : 0;
  return {
    visits, conv,
    cost: Math.round(cost * 100) / 100,
    revenue: Math.round(revenue * 100) / 100,
    profit: Math.round(profit * 100) / 100,
    roi: Math.round(roi * 100) / 100,
    cr: Math.round(cr * 10000) / 10000,
  };
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const q = req.query || {};
  if (q.k !== 'gapscan2026') return res.status(401).json({ error: 'Unauthorized' });

  try {
    const accessId = (process.env.VOLUUM_ACCESS_ID || '').trim();
    const accessKey = (process.env.VOLUUM_ACCESS_KEY || '').trim();
    if (!accessId || !accessKey) return res.status(500).json({ error: 'Missing Voluum env vars' });

    const today = new Date().toISOString().split('T')[0];
    const from = q.from || today;
    const to = q.to || today;
    const limit = Math.min(parseInt(q.limit || '50000', 10) || 50000, 50000);

    const token = await voluumAuth(accessId, accessKey);
    const report = await fetchRange(token, from, to, limit);

    // --- Voluum's own totals (exact UI match) ---
    const t = report.totals || {};
    const totals = metrics(t.visits || 0, t.conversions || 0, t.cost || 0, t.revenue || 0);

    // --- Sum from rows (cross-check) + per-network aggregation ---
    const netAgg = {};
    let sv = 0, sc = 0, sco = 0, sr = 0, unparsed = 0;
    for (const row of report.rows || []) {
      const v = row.visits || 0, c = row.conversions || 0, co = row.cost || 0, r = row.revenue || 0;
      sv += v; sc += c; sco += co; sr += r;
      const code = parseNetwork(row.customVariable8);
      if (code === null) { unparsed++; continue; }
      const name = AFFILIATE_NETWORKS[code] || code || '(none)';
      if (!netAgg[name]) netAgg[name] = { network_name: name, visits: 0, conv: 0, cost: 0, revenue: 0 };
      const a = netAgg[name];
      a.visits += v; a.conv += c; a.cost += co; a.revenue += r;
    }

    const networks = Object.values(netAgg)
      .map(a => ({ network_name: a.network_name, ...metrics(a.visits, a.conv, a.cost, a.revenue) }))
      .sort((x, y) => y.profit - x.profit);

    const summed = metrics(sv, sc, sco, sr);

    res.status(200).json({
      ok: true, from, to,
      raw_rows: (report.rows || []).length,
      unparsed,
      totals,   // use these for headline KPIs (exact UI match)
      summed,   // should be ~equal to totals; gap = rows beyond limit or null cv8
      networks, // sorted by profit desc
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
