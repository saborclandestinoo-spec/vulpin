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
  catch(e) { return { status: r.status, data: null, raw: r.body }; }
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

    // ── MODO RANGE com paginação no BACKEND ──
    // Frontend manda page=N — backend retorna {orders, hasMore}
    if (start_date && end_date) {
      const pageNum = parseInt(page || '1', 10);
      const PER_PAGE = 100;

      const url = `${BASE}/api/partner/v1/orders/history?start_date=${encodeURIComponent(start_date)}&end_date=${encodeURIComponent(end_date)}&per_page=${PER_PAGE}&page=${pageNum}`;
      const r = await fetchJSON(url, headers);

      if (r.status !== 200 || !r.data) {
        // Tenta sem paginação (alguns planos não suportam)
        const r2 = await fetchJSON(`${BASE}/api/partner/v1/orders/history?start_date=${encodeURIComponent(start_date)}&end_date=${encodeURIComponent(end_date)}`, headers);
        if (r2.status === 200 && r2.data) {
          const list = Array.isArray(r2.data) ? r2.data : (r2.data.orders || []);
          return res.status(200).json({ orders: list, hasMore: false });
        }
        return res.status(200).json({ orders: [], hasMore: false });
      }

      const list = Array.isArray(r.data) ? r.data : (Array.isArray(r.data.orders) ? r.data.orders : []);
      // hasMore: se veio lista cheia, pode ter mais
      // Também respeita flag explícita da API se existir
      const hasMore = r.data.hasMore !== undefined
        ? !!r.data.hasMore
        : list.length >= PER_PAGE;

      return res.status(200).json({ orders: list, hasMore });
    }

    // ── MODO DIA ──
    const targetDate = date || new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

    // Ativos (tempo real)
    for (let pg = 1; pg <= 10; pg++) {
      const r = await fetchJSON(`${BASE}/api/partner/v1/orders?per_page=50&page=${pg}`, headers);
      if (r.status !== 200 || !r.data) break;
      const list = Array.isArray(r.data) ? r.data : [];
      if (!list.length) break;
      list.forEach(p => { if (!seenIds.has(p.id)) { seenIds.add(p.id); allOrders.push(p); } });
      if (list.length < 50) break;
    }

    // Historico do dia — pagina até acabar
    const start = `${targetDate}T00:00:00-03:00`;
    const end   = `${targetDate}T23:59:59-03:00`;
    for (let pg = 1; pg <= 50; pg++) {
      const url = `${BASE}/api/partner/v1/orders/history?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&per_page=100&page=${pg}`;
      const r = await fetchJSON(url, headers);
      if (r.status !== 200 || !r.data) break;
      const list = Array.isArray(r.data) ? r.data : (Array.isArray(r.data.orders) ? r.data.orders : []);
      if (!list.length) break;
      list.forEach(p => { if (!seenIds.has(p.id)) { seenIds.add(p.id); allOrders.push(p); } });
      if (list.length < 100) break; // ultima pagina
    }

    allOrders = allOrders.filter(p => toBRDate(p.created_at || p.createdAt || '') === targetDate);

    // Detalhes em paralelo (chunks de 10)
    const detailed = [];
    const CHUNK = 10;
    for (let i = 0; i < allOrders.length; i += CHUNK) {
      const lote = allOrders.slice(i, i + CHUNK);
      const results = await Promise.all(
        lote.map(async p => {
          try {
            const det = await fetchJSON(`${BASE}/api/partner/v1/orders/${p.id}`, headers);
            return (det.status === 200 && det.data) ? det.data : p;
          } catch { return p; }
        })
      );
      detailed.push(...results);
    }

    return res.status(200).json(detailed);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
