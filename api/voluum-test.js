export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  try {
    // Step 1 — Authenticate with Voluum
    const authRes = await fetch('https://api.voluum.com/auth/access/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessId: process.env.VOLUUM_ACCESS_ID,
        accessKey: process.env.VOLUUM_ACCESS_KEY,
      }),
    });

    if (!authRes.ok) {
      const errText = await authRes.text();
      return res.status(401).json({ error: 'Auth failed', status: authRes.status, detail: errText });
    }

    const auth = await authRes.json();
    const token = auth.token;

    // Step 2 — Fetch campaigns report (last 30 days) to see all active campaign names
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - 30);

    const fromStr = from.toISOString().split('T')[0] + 'T00:00:00Z';
    const toStr = now.toISOString().split('T')[0] + 'T00:00:00Z';

    const reportUrl = `https://api.voluum.com/report?from=${fromStr}&to=${toStr}&groupBy=campaign&columns=visits,clicks,conversions,revenue,cost,profit,roi&tz=Etc/GMT`;

    const reportRes = await fetch(reportUrl, {
      headers: { 'cwauth-token': token },
    });

    if (!reportRes.ok) {
      const errText = await reportRes.text();
      return res.status(500).json({ error: 'Report fetch failed', status: reportRes.status, detail: errText });
    }

    const report = await reportRes.json();

    // Step 3 — Extract campaign names and IDs for mapping
    const campaigns = (report.rows || []).map(row => ({
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      cost: row.cost,
      revenue: row.revenue,
      profit: row.profit,
      visits: row.visits,
    }));

    // Step 4 — Show which 3-letter codes we can detect
    const blogCodes = {
      inn: 'Innovate', sab: 'Innovate', fbc: 'Innovate', tds: 'Innovate', tcs: 'Innovate',
      spr: 'Spread', dsz: 'Spread', ppz: 'Spread', ugz: 'Spread',
      qbz: 'Spirion', tbs: 'Spirion', ddd: 'Spirion', dsj: 'Spirion',
      fdw: 'Galatea', sdc: 'Galatea', dls: 'Galatea',
      shp: 'omnia',
      imp: 'IMPULSPROM',
    };

    const mapped = campaigns.map(c => {
      const nameLower = (c.campaignName || '').toLowerCase();
      let matchedCode = null;
      let matchedCompany = null;
      for (const [code, company] of Object.entries(blogCodes)) {
        if (nameLower.includes(code)) {
          matchedCode = code;
          matchedCompany = company;
          break;
        }
      }
      return {
        ...c,
        detectedCode: matchedCode,
        detectedCompany: matchedCompany,
        unmapped: !matchedCompany,
      };
    });

    const unmapped = mapped.filter(c => c.unmapped);
    const byCompany = {};
    mapped.filter(c => !c.unmapped).forEach(c => {
      if (!byCompany[c.detectedCompany]) byCompany[c.detectedCompany] = [];
      byCompany[c.detectedCompany].push(c.campaignName);
    });

    res.status(200).json({
      totalCampaigns: campaigns.length,
      mappedByCompany: byCompany,
      unmappedCampaigns: unmapped,
      allCampaigns: mapped,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
