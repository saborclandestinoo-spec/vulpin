const https = require('https');
const http = require('http');
 
function request(url, headers, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        const next = r.headers.location.startsWith('http')
          ? r.headers.location
          : `https://api.cardapioweb.com${r.headers.location}`;
        return resolve(request(next, headers, redirects + 1));
      }
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
 
  const { storeCode, token, status, limit = 100 } = req.query;
  if (!storeCode || !token) return res.status(400).json({ error: 'storeCode e token obrigatórios' });
 
  const headers = {
    'Companyid': storeCode,
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
 
  const statusParam = status ? `&status=${status}` : '';
  const url = `https://api.cardapioweb.com/api/v1/company/orders?limit=${limit}${statusParam}`;
 
  try {
    const r = await request(url, headers);
    try { return res.status(r.status).json(JSON.parse(r.body)); }
    catch(e) { return res.status(r.status).json({ error: r.body.slice(0, 500) }); }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
 
