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

// Converte data ISO para data local BR (America/Sao_Paulo)
function toBRDate(isoStr) {
  if (!isoStr) return '';
  try {
    return new Date(isoStr).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  } catch { return isoStr.slice(0, 10); }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { token, date, start_date, end_date, id } = req.query;
  if (!token) return res.status(400).json({ error: 'token obrigatorio' });

  const headers = {
    'X-API-KEY': token,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  const BASE = 'https://integracao.cardapioweb.com';

  try {
    // ── MODO DETALHE: id único ──
    if (id) {
      const r = await fetchJSON(`${BASE}/api/partner/v1/orders/${id}`, headers);
      if (r.status === 200 && r.data) return res.status(200).json(r.data);
      return res.status(r.status || 404).json({ error: 'pedido nao encontrado' });
    }

    const seenIds = new Set();
    let allOrders = [];

    // ── MODO RANGE: mês inteiro ──
    if (start_date && end_date) {
      for (let page = 1; page <= 60; page++) {
        const url = `${BASE}/api/partner/v1/orders/history?start_date=${encodeURIComponent(start_date)}&end_date=${encodeURIComponent(end_date)}&per_page=100&page=${page}`;
        const r = await fetchJSON(url, headers);
        if (r.status !== 200 || !r.data) break;
        const list = Array.isArray(r.data) ? r.data : (Array.isArray(r.data.orders) ? r.data.orders : []);
        if (!list.length) break;
        list.forEach(p => { if (!seenIds.has(p.id)) { seenIds.add(p.id); allOrders.push(p); } });
        if (list.length < 100) break;
      }
      return res.status(200).json(allOrders);
    }

    // ── MODO DIA (com ou sem date) ──
    // Data alvo em BR
    const targetDate = date || new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

    // 1. Pedidos ATIVOS (polling tempo real)
    for (let page = 1; page <= 10; page++) {
      const r = await fetchJSON(`${BASE}/api/partner/v1/orders?per_page=50&page=${page}`, headers);
      if (r.status !== 200 || !r.data) break;
      const list = Array.isArray(r.data) ? r.data : [];
      if (!list.length) break;
      list.forEach(p => { if (!seenIds.has(p.id)) { seenIds.add(p.id); allOrders.push(p); } });
      if (list.length < 50) break;
    }

    // 2. Histórico do dia — janela ampliada ±1 dia em UTC para pegar fuso BR
    const [y, m, d2] = targetDate.split('-').map(Number);
    // dia anterior em UTC para pegar pedidos de madrugada BR
    const prevDay = new Date(Date.UTC(y, m - 1, d2 - 1));
    const nextDay = new Date(Date.UTC(y, m - 1, d2 + 1));
    const fmt = (dt) => dt.toISOString().slice(0, 10);

    const start = `${fmt(prevDay)}T03:00:00-00:00`; // meia-noite BR = 03:00 UTC
    const end   = `${targetDate}T23:59:59-03:00`;

    for (let page = 1; page <= 20; page++) {
      const url = `${BASE}/api/partner/v1/orders/history?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&per_page=100&page=${page}`;
      const r = await fetchJSON(url, headers);
      if (r.status !== 200 || !r.data) break;
      const list = Array.isArray(r.data) ? r.data : (Array.isArray(r.data.orders) ? r.data.orders : []);
      if (!list.length) break;
      list.forEach(p => { if (!seenIds.has(p.id)) { seenIds.add(p.id); allOrders.push(p); } });
      if (list.length < 100) break;
    }

    // 3. Filtrar pelo dia alvo em horário BR (não UTC)
    allOrders = allOrders.filter(p => {
      const dt = p.created_at || p.createdAt || '';
      return toBRDate(dt) === targetDate;
    });

    // 4. Busca detalhes só para ativos (lista pequena)
    const activeStatuses = new Set(['PENDING','CONFIRMED','PREPARING','READY','SCHEDULED_CONFIRMED','pending','confirmed','preparing','ready','scheduled_confirmed']);
    const detailed = await Promise.all(
      allOrders.map(async (p) => {
        if (!activeStatuses.has(p.status || '')) return p;
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
