const https = require('https');
 
function httpsGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'GET', headers }, (r) => {
      let body = '';
      r.on('data', c => body += c);
      r.on('end', () => resolve({ status: r.statusCode, body, headers: r.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}
 
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
 
  const { storeCode, token, status = 'PENDING,CONFIRMED,DELIVERED', limit = 100, debug } = req.query;
  if (!storeCode || !token) return res.status(400).json({ error: 'storeCode e token obrigatórios' });
 
  const headers = {
    'store-code': storeCode,
    'token': token,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
 
  // Se debug=1, testa vários endpoints e retorna resultados
  if (debug === '1') {
    const endpoints = [
      `/orders?status=${status}&limit=${limit}`,
      `/v1/orders?status=${status}&limit=${limit}`,
      `/api/orders?status=${status}&limit=${limit}`,
      `/pedidos?status=${status}&limit=${limit}`,
      `/stores/${storeCode}/orders?status=${status}&limit=${limit}`,
    ];
    const results = [];
    for (const path of endpoints) {
      try {
        const r = await httpsGet('api.cardapioweb.com', path, headers);
        results.push({ path, status: r.status, body: r.body.slice(0, 200) });
      } catch(e) {
        results.push({ path, error: e.message });
      }
    }
    return res.status(200).json(results);
  }
 
  try {
    const r = await httpsGet('api.cardapioweb.com', `/orders?status=${status}&limit=${limit}`, headers);
    try { return res.status(r.status).json(JSON.parse(r.body)); }
    catch(e) { return res.status(r.status).json({ error: r.body.slice(0, 500) }); }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
 
