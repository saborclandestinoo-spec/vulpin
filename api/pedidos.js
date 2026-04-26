export default async function handler(req, res) {
  // Allow requests from your Vercel domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, store-code, token');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { storeCode, token, status, limit = 100 } = req.query;

  if (!storeCode || !token) {
    return res.status(400).json({ error: 'storeCode e token obrigatórios' });
  }

  const statusParam = status || 'PENDING,CONFIRMED,DELIVERED';
  const url = `https://api.cardapioweb.com/orders?status=${statusParam}&limit=${limit}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'store-code': storeCode,
        'token': token,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    const data = await response.json();
    return res.status(response.status).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
