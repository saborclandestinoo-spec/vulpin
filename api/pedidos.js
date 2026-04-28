const https = require('https');

function request(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (r) => {
      let body = '';
      r.on('data', c => body += c);
      r.on('end', () => resolve({ status: r.statusCode, body }));
    }).on('error', reject);
  });
}

async function fetchJSON(url, headers) {
  const r = await request(url, headers);
  try { return { status: r.status, data: JSON.parse(r.body) }; }
  catch(e) { return { status: r.status, data: null }; }
}

function toBRDate(isoStr) {
  if (!isoStr) return '';
  try { return new Date(isoStr).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }); }
  catch { return isoStr.slice(0, 10); }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { token, date, start_date, end_date, id, page } = req.query;
  if (!token) return res.status(400).json({ error: 'token obrigatorio' });

  const headers = {
    'X-API-KEY': token,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  const BASE = 'https://integracao.cardapioweb.com';

  try {
    // ── DETALHE INDIVIDUAL ──
    if (id) {
      const r = await fetchJSON(`${BASE}/api/partner/v1/orders/${id}`, headers);
      if (r.status === 200 && r.data) return res.status(200).json(r.data);
      return res.status(404).json({ error: 'nao encontrado' });
    }

    const seenIds = new Set();
    let allOrders = [];

    // ── MODO RANGE — 1 página por request, frontend pagina ──
    if (start_date && end_date) {
      const pageNum = parseInt(page || '1', 10);
      const url = `${BASE}/api/partner/v1/orders/history?start_date=${encodeURIComponent(start_date)}&end_date=${encodeURIComponent(end_date)}&per_page=100&page=${pageNum}`;
      let r = await fetchJSON(url, headers);
      if (r.status === 429 || r.status >= 500) {
        await new Promise(x => setTimeout(x, 1500));
        r = await fetchJSON(url, headers);
      }
      if (r.status !== 200 || !r.data) {
        return res.status(200).json({ orders: [], hasMore: false });
      }
      const list = Array.isArray(r.data) ? r.data : (Array.isArray(r.data.orders) ? r.data.orders : []);
      return res.status(200).json({ orders: list, hasMore: list.length === 100 });
    }

    // ── MODO DIA ──
    const targetDate = date || new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

    // Ativos (tempo real)
    for (let page = 1; page <= 10; page++) {
      const r = await fetchJSON(`${BASE}/api/partner/v1/orders?per_page=50&page=${page}`, headers);
      if (r.status !== 200 || !r.data) break;
      const list = Array.isArray(r.data) ? r.data : [];
      if (!list.length) break;
      list.forEach(p => { if (!seenIds.has(p.id)) { seenIds.add(p.id); allOrders.push(p); } });
      if (list.length < 50) break;
    }

    // Histórico do dia — janela BRT (00h-23:59 BRT = 03h-02:59 UTC next day)
    const start = `${targetDate}T00:00:00-03:00`;
    const end   = `${targetDate}T23:59:59-03:00`;
    for (let page = 1; page <= 20; page++) {
      const url = `${BASE}/api/partner/v1/orders/history?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&per_page=100&page=${page}`;
      const r = await fetchJSON(url, headers);
      if (r.status !== 200 || !r.data) break;
      const list = Array.isArray(r.data) ? r.data : (Array.isArray(r.data.orders) ? r.data.orders : []);
      if (!list.length) break;
      list.forEach(p => { if (!seenIds.has(p.id)) { seenIds.add(p.id); allOrders.push(p); } });
      if (list.length < 100) break;
    }

    // Filtra pelo dia em fuso BR
    allOrders = allOrders.filter(p => toBRDate(p.created_at || p.createdAt || '') === targetDate);

    // Detalhes só para ativos
    const activeStatuses = new Set(['PENDING','CONFIRMED','PREPARING','READY','SCHEDULED_CONFIRMED','pending','confirmed','preparing','ready','scheduled_confirmed','scheduled']);
    const detailed = await Promise.all(
      allOrders.map(async (p) => {
        if (!activeStatuses.has(p.status || '')) return p;
        try {
          const det = await fetchJSON(`${BASE}/api/partner/v1/orders/${p.id}`, headers);
          return (det.status === 200 && det.data) ? det.data : p;
        } catch { return p; }
      })
    );

    return res.status(200).json(detailed);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
