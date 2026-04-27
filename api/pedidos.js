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

  // Se não veio date, usa hoje (fuso BR)
  const targetDate = date || new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

  try {
    let allOrders = [];
    const seenIds = new Set();

    // 1. Pedidos ATIVOS (polling) — sempre busca pra pegar pendentes em tempo real
    for (let page = 1; page <= 5; page++) {
      const r = await fetchJSON(`${BASE}/api/partner/v1/orders?per_page=50&page=${page}`, headers);
      if (r.status !== 200 || !r.data) break;
      const list = Array.isArray(r.data) ? r.data : [];
      if (!list.length) break;
      list.forEach(p => { if (!seenIds.has(p.id)) { seenIds.add(p.id); allOrders.push(p); } });
      if (list.length < 50) break;
    }

    // 2. Histórico do dia (paginado) — pega fechados/cancelados
    const start = `${targetDate}T00:00:00-03:00`;
    const end   = `${targetDate}T23:59:59-03:00`;

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

      if (list.length < 100) break;
    }

    // 3. Filtrar pelo dia alvo
    allOrders = allOrders.filter(p => (p.created_at || '').startsWith(targetDate));

    // 4. Busca detalhes individuais SÓ pra ativos (lista pequena)
    //    Histórico já vem com dados suficientes — não busca detalhe pra não dar timeout
    const activeIds = new Set();
    for (let page = 1; page <= 5; page++) {
      const r = await fetchJSON(`${BASE}/api/partner/v1/orders?per_page=50&page=${page}`, headers);
      if (r.status !== 200 || !r.data) break;
      const list = Array.isArray(r.data) ? r.data : [];
      if (!list.length) break;
      list.forEach(p => activeIds.add(p.id));
      if (list.length < 50) break;
    }

    const detailed = await Promise.all(
      allOrders.map(async (p) => {
        if (!activeIds.has(p.id)) return p; // histórico: retorna direto
        try {
          const det = await fetchJSON(`${BASE}/api/partner/v1/orders/${p.id}`, headers);
          return (det.status === 200 && det.data) ? det.data : p;
        } catch(e) { return p; }
      })
    );

    return res.status(200).json(detailed);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
