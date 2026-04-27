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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { token, date } = req.query;
  if (!token) return res.status(400).json({ error: 'token obrigatorio' });

  const headers = {
    'X-API-KEY': token,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  const BASE = 'https://integracao.cardapioweb.com';

  try {
    let allOrders = [];
    const seenIds = new Set();

    // 1. Pedidos ATIVOS (sem date = modo polling ao vivo)
    if (!date) {
      for (let page = 1; page <= 5; page++) {
        const r = await fetchJSON(`${BASE}/api/partner/v1/orders?per_page=50&page=${page}`, headers);
        if (r.status !== 200 || !r.data) break;
        const list = Array.isArray(r.data) ? r.data : [];
        if (!list.length) break;
        list.forEach(p => { if (!seenIds.has(p.id)) { seenIds.add(p.id); allOrders.push(p); } });
        if (list.length < 50) break;
      }
      // sem date: busca detalhes (lista pequena, ok)
      const detailed = await Promise.all(
        allOrders.map(async (p) => {
          try {
            const det = await fetchJSON(`${BASE}/api/partner/v1/orders/${p.id}`, headers);
            return (det.status === 200 && det.data) ? det.data : p;
          } catch(e) { return p; }
        })
      );
      return res.status(200).json(detailed);
    }

    // 2. Histórico COM PAGINAÇÃO — retorna direto sem buscar detalhe individual
    const start = `${date}T00:00:00-03:00`;
    const end   = `${date}T23:59:59-03:00`;

    for (let page = 1; page <= 20; page++) {
      const url = `${BASE}/api/partner/v1/orders/history?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&per_page=100&page=${page}`;
      const r = await fetchJSON(url, headers);

      if (r.status !== 200 || !r.data) break;

      const list = Array.isArray(r.data)
        ? r.data
        : (Array.isArray(r.data.orders) ? r.data.orders : []);

      if (!list.length) break;

      list.forEach(p => {
        if (!seenIds.has(p.id)) { seenIds.add(p.id); allOrders.push(p); }
      });

      if (list.length < 100) break; // última página
    }

    // Filtrar pelo dia exato
    allOrders = allOrders.filter(p => (p.created_at || '').startsWith(date));

    return res.status(200).json(allOrders);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
