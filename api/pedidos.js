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

// Busca UMA página do histórico — frontend controla paginação
// GET /api/pedidos-page?token=X&start_date=Y&end_date=Z&page=1
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { token, start_date, end_date, page = '1' } = req.query;
  if (!token || !start_date || !end_date) {
    return res.status(400).json({ error: 'token, start_date e end_date obrigatorios' });
  }

  const headers = {
    'X-API-KEY': token,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  const BASE = 'https://integracao.cardapioweb.com';
  const url = `${BASE}/api/partner/v1/orders/history?start_date=${encodeURIComponent(start_date)}&end_date=${encodeURIComponent(end_date)}&per_page=100&page=${page}`;

  try {
    let r = await fetchJSON(url, headers);
    if (r.status === 429 || r.status >= 500) {
      await new Promise(x => setTimeout(x, 1500));
      r = await fetchJSON(url, headers);
    }
    if (r.status !== 200 || !r.data) {
      return res.status(r.status).json({ orders: [], hasMore: false });
    }
    const list = Array.isArray(r.data) ? r.data : (Array.isArray(r.data.orders) ? r.data.orders : []);
    return res.status(200).json({ orders: list, hasMore: list.length === 100 });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
}
