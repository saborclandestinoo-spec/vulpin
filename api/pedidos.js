const https = require('https');
 
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
 
  if (req.method === 'OPTIONS') return res.status(200).end();
 
  const { storeCode, token, status = 'PENDING,CONFIRMED,DELIVERED', limit = 100 } = req.query;
 
  if (!storeCode || !token) {
    return res.status(400).json({ error: 'storeCode e token obrigatórios' });
  }
 
  try {
    const data = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.cardapioweb.com',
        path: `/orders?status=${status}&limit=${limit}`,
        method: 'GET',
        headers: {
          'store-code': storeCode,
          'token': token,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        }
      };
 
      const req2 = https.request(options, (r) => {
        let body = '';
        r.on('data', chunk => body += chunk);
        r.on('end', () => {
          try { resolve({ status: r.statusCode, body: JSON.parse(body) }); }
          catch(e) { resolve({ status: r.statusCode, body: { error: body } }); }
        });
      });
      req2.on('error', reject);
      req2.end();
    });
 
    return res.status(data.status).json(data.body);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
