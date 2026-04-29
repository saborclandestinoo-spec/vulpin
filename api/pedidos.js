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

async function fetchDetail(id, headers, BASE) {
  try {
    const r = await fetchJSON(`${BASE}/api/partner/v1/orders/${id}`, headers);
    return (r.status === 200 && r.data) ? r.data : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { token, date, start_date, end_date, id } = req.query;
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

    // ── MODO RANGE — busca historico + detalhes completos ──
    if (start_date && end_date) {
      for (let page = 1; page <= 100; page++) {
        const url = `${BASE}/api/partner/v1/orders/history?start_date=${encodeURIComponent(start_date)}&end_date=${encodeURIComponent(end_date)}&per_page=100&page=${page}`;
        const r = await fetchJSON(url, headers);
        if (r.status !== 200 || !r.data) break;
        const list = Array.isArray(r.data) ? r.data : (Array.isArray(r.data.orders) ? r.data.orders : []);
        if (!list.length) break;
        list.forEach(p => { if (!seenIds.has(p.id)) { seenIds.add(p.id); allOrders.push(p); } });
        const hasMore = r.data.hasMore === true;
        if (!hasMore && list.length < 100) break;
      }

      // Busca detalhes completos em paralelo (chunks de 5 para nao estourar)
      const detailed = [];
      const CHUNK = 5;
      for (let i = 0; i < allOrders.length; i += CHUNK) {
        const chunk = allOrders.slice(i, i + CHUNK);
        const results = await Promise.all(chunk.map(p => fetchDetail(p.id, headers, BASE)));
        results.forEach((det, j) => detailed.push(det || chunk[j]));
      }

      return res.status(200).json(detailed);
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

    // Historico do dia
    const start = `${targetDate}T00:00:00-03:00`;
    const end   = `${targetDate}T23:59:59-03:00`;
    for (let page = 1; page <= 20; page++) {
      const url = `${BASE}/api/partner/v1/orders/history?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&per_page=100&page=${page}`;
      const r = await fetchJSON(url, headers);
      if (r.status !== 200 || !r.data) break;
      const list = Array.isArray(r.data) ? r.data : (Array.isArray(r.data.orders) ? r.data.orders : []);
      if (!list.length) break;
      list.forEach(p => { if (!seenIds.has(p.id)) { seenIds.add(p.id); allOrders.push(p); } });
      const hasMore = r.data.hasMore === true;
      if (!hasMore && list.length < 100) break;
    }

    // Filtra pelo dia em fuso BR
    allOrders = allOrders.filter(p => toBRDate(p.created_at || p.createdAt || '') === targetDate);

    // Detalhes para todos (ativos e historico do dia)
    const detailed = await Promise.all(
      allOrders.map(p => fetchDetail(p.id, headers, BASE).then(det => det || p))
    );

    return res.status(200).json(detailed);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
