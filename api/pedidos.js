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
 
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
 
  const { token, status } = req.query;
  if (!token) return res.status(400).json({ error: 'token obrigatório' });
 
  const headers = {
    'X-API-KEY': token,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
 
  const statusParam = status ? `?status[]=${status}` : '';
  const url = `https://integracao.cardapioweb.com/api/partner/v1/orders${statusParam}`;
 
  try {
    const r = await request(url, headers);
    try { return res.status(r.status).json(JSON.parse(r.body)); }
    catch(e) { return res.status(r.status).json({ error: r.body.slice(0, 500) }); }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
 
