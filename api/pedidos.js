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
    // Busca até 5 páginas
    let allOrders = [];
    for (let page = 1; page <= 5; page++) {
      const r = await fetchJSON(`${BASE}/api/partner/v1/orders?per_page=20&page=${page}`, headers);
      if (r.status !== 200 || !r.data) break;
      const list = Array.isArray(r.data) ? r.data : [];
      if (!list.length) break;
      allOrders = allOrders.concat(list);
      if (list.length < 20) break;
    }

    // Filtrar por data se fornecida (YYYY-MM-DD)
    if (date) {
      // API retorna datas em horário local BR (-03:00), comparar só o prefixo da data local
      allOrders = allOrders.filter(p => {
        const d = p.created_at || '';
        return d.startsWith(date);
      });
    }

    // Buscar detalhes de cada pedido (items, payments, customer completo)
    const detailed = await Promise.all(
      allOrders.slice(0, 30).map(async (p) => {
        try {
          const det = await fetchJSON(`${BASE}/api/partner/v1/orders/${p.id}`, headers);
          return (det.status === 200 && det.data) ? det.data : p;
        } catch(e) {
          return p;
        }
      })
    );

    return res.status(200).json(detailed);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
