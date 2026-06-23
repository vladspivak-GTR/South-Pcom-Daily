// TEMP endpoint for cross-company brand-gap analysis.
// Pulls Voluum groupBy=trafficSource,customVariable8 for a date range and
// returns per (network|blog|merchant|country) aggregates with traffic-source
// split. customVariable8 encodes: [country] [campaign] [network] [blog] merchant.com # id
// Auth: light query guard ?k=gapscan2026.  Will be removed after the one-off pull.

const BLOG_TO_COMPANY = {
  inn: 'Innovate', sab: 'Innovate', fbc: 'Innovate', tds: 'Innovate', tcs: 'Innovate',
  spr: 'Spread', dsz: 'Spread', ppz: 'Spread', ugz: 'Spread', pms: 'Spread',
  qbv: 'Spirion', tbs: 'Spirion', ddd: 'Spirion', dsj: 'Spirion',
  fdw: 'Galatea', sdc: 'Galatea', dls: 'Galatea', imp: 'Galatea', klv: 'Galatea',
  shp: 'Omnia',
  atr: 'SMART',
  wak: 'WAK',
};

const BLOG_FULL_NAMES = {
  ppz: 'priceplungezone.com', spr: 'dealingoo.com', inn: 'unbeatablepicks.com',
  qbv: 'quickbuyvault.com', sab: 'shopabound.com', dsz: 'dealstormzone.com',
  tbs: 'trendbuyspot.com', fdw: 'flashdealwizard.com', shp: 'shopswiz.com',
  sdc: 'savvydealcentral.com', fbc: 'flashbuycentral.com', ddd: 'discoverdealsdaily.com',
  ugz: 'urbanbargainzone.com', tds: 'trendingdealspot.com', imp: 'impulsprom.uk',
  tcs: 'thecurationspot.com', dsj: 'dailyshopjourney.com', dls: 'deallinkshop.com',
  klv: 'klayven.com', pms: 'pricemaniashop.com', atr: 'atriumset.com',
};

const AFFILIATE_NETWORKS = {
  lbx: 'LinkBux', br: 'Brandreward', noc: 'Noctemque', cue: 'Cuelinks',
  rwd: 'Rewardoo', lh: 'LinkHaitao', wep: 'Webe', yk: 'Yieldkit',
  td: 'TradeDoubler', ecl: 'Eclicklink', pm: 'partnermatic', adm: 'Admitad',
  ba: 'BonusArrive', blu: 'BlueAff', imp: 'Impact', flx: 'FlexOffers',
  awin: 'Awin', snx: 'shopnomix', ta: 'TakeAds', ta1: 'TakeAds',
  tt: 'TradeTracker', clg: 'collabglow', lux: '? (lux)',
  cs: 'Convert Social', lom: 'Lomadee', pa: 'Partner Ads', kwa: 'Kwanko',
};

function parseMerchantString(v8) {
  if (!v8) return null;
  const bracketRe = /\[([^\]]*)\]/g;
  const brackets = [];
  let m;
  while ((m = bracketRe.exec(v8)) !== null) brackets.push(m[1]);
  if (brackets.length < 4) return null;
  const country = brackets[0] || '';
  const campaign = brackets[1] || '';
  const network = brackets[2] || '';
  const blog = brackets[3] || '';
  const tail = v8.replace(bracketRe, '').trim();
  const hashIdx = tail.lastIndexOf('#');
  const merchant = (hashIdx >= 0 ? tail.slice(0, hashIdx) : tail).trim() || '(unknown)';
  return { country, campaign, network, blog, merchant };
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

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const q = req.query || {};
  if (q.k !== 'gapscan2026') return res.status(401).json({ error: 'Unauthorized' });

  try {
    const accessId = (process.env.VOLUUM_ACCESS_ID || '').trim();
    const accessKey = (process.env.VOLUUM_ACCESS_KEY || '').trim();
    if (!accessId || !accessKey) return res.status(500).json({ error: 'Missing Voluum env vars' });

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const from = q.from || today;
    const to = q.to || today;
    const limit = Math.min(parseInt(q.limit || '50000', 10) || 50000, 50000);

    const token = await voluumAuth(accessId, accessKey);
    const report = await fetchRange(token, from, to, limit);

    // Aggregate per network|blog|merchant|country with traffic-source split.
    const agg = {};
    let unparsed = 0;
    for (const row of report.rows || []) {
      const p = parseMerchantString(row.customVariable8);
      if (!p) { unparsed++; continue; }
      const v = row.visits || 0;
      if (v <= 0) continue; // only brands with traffic
      const ts = (row.trafficSourceName || '').toLowerCase();
      const key = `${p.network}|${p.blog}|${p.merchant}|${p.country}`;
      if (!agg[key]) {
        agg[key] = {
          network: p.network,
          network_name: AFFILIATE_NETWORKS[p.network] || p.network,
          blog: p.blog,
          blog_domain: BLOG_FULL_NAMES[p.blog] || p.blog,
          company: BLOG_TO_COMPANY[p.blog] || 'Unknown',
          merchant: p.merchant,
          country: p.country,
          total: { visits: 0, conv: 0, cost: 0, revenue: 0 },
          yenoti: { visits: 0, conv: 0, cost: 0, revenue: 0 },
          mgmx: { visits: 0, conv: 0, cost: 0, revenue: 0 },
          yenomix: { visits: 0, conv: 0, cost: 0, revenue: 0 },
        };
      }
      const a = agg[key];
      const r = { visits: v, conv: row.conversions || 0, cost: row.cost || 0, revenue: row.revenue || 0 };
      a.total.visits += r.visits; a.total.conv += r.conv; a.total.cost += r.cost; a.total.revenue += r.revenue;
      if (ts === 'yenoti' || ts === 'mgmx' || ts === 'yenomix') {
        a[ts].visits += r.visits; a[ts].conv += r.conv; a[ts].cost += r.cost; a[ts].revenue += r.revenue;
      }
    }

    const rows = Object.values(agg).map(a => {
      const profit = a.total.revenue - a.total.cost;
      const roi = a.total.cost > 0 ? (profit / a.total.cost) * 100 : 0;
      const cr = a.total.visits > 0 ? (a.total.conv / a.total.visits) * 100 : 0;
      return {
        network: a.network, network_name: a.network_name,
        company: a.company, blog: a.blog, blog_domain: a.blog_domain,
        merchant: a.merchant, country: a.country,
        visits: a.total.visits, conv: a.total.conv,
        cost: Math.round(a.total.cost * 100) / 100,
        revenue: Math.round(a.total.revenue * 100) / 100,
        profit: Math.round(profit * 100) / 100,
        roi: Math.round(roi * 100) / 100,
        cr: Math.round(cr * 10000) / 10000,
        yenoti_rev: Math.round(a.yenoti.revenue * 100) / 100,
        mgmx_rev: Math.round(a.mgmx.revenue * 100) / 100,
        yenomix_rev: Math.round(a.yenomix.revenue * 100) / 100,
      };
    });

    res.status(200).json({
      ok: true, from, to,
      raw_rows: (report.rows || []).length,
      unique_keys: rows.length,
      unparsed,
      rows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
