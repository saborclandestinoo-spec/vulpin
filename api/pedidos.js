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
 
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'token obrigatorio' });
 
  const headers = {
    'X-API-KEY': token,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
 
  const BASE = 'https://integracao.cardapioweb.com';
 
  try {
    // 1. Busca lista resumida
    const listRes = await fetchJSON(`${BASE}/api/partner/v1/orders`, headers);
    if (listRes.status !== 200) {
      return res.status(listRes.status).json({ error: 'Erro ao buscar pedidos', status: listRes.status });
    }
 
    const list = Array.isArray(listRes.data) ? listRes.data : [];
 
    // 2. Busca detalhes de cada pedido (max 20)
    const limited = list.slice(0, 20);
    const detailed = await Promise.all(
      limited.map(async (p) => {
        try {
          const det = await fetchJSON(`${BASE}/api/partner/v1/orders/${p.id}`, headers);
          return det.status === 200 && det.data ? det.data : p;
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
 
