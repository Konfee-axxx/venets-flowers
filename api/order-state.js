// Centralized order state storage
// Uses global variable — persists within same Vercel instance
// For production, replace with Vercel KV / Redis

if (!global._orderState) global._orderState = {};
if (!global._chatState)  global._chatState  = {};

const STATE = global._orderState;
const CHATS = global._chatState;

module.exports = async function(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end('{}');

  const { action, orderId, chatId, data } = req.body || {};

  // Записать состояние заказа (от admin или user)
  if (action === 'set_order' && orderId) {
    const key = String(orderId);
    STATE[key] = { ...(STATE[key] || {}), ...data, updatedAt: Date.now() };
    return res.status(200).end(JSON.stringify({ ok: true, state: STATE[key] }));
  }

  // Прочитать состояние заказа (polling)
  if (action === 'get_order' && orderId) {
    const key = String(orderId);
    return res.status(200).end(JSON.stringify({ ok: true, state: STATE[key] || null }));
  }

  // Прочитать все pending заказы (для админ-панели)
  if (action === 'get_pending') {
    const pending = Object.values(STATE).filter(o =>
      o.payState === 'waiting_requisites' || o.payState === 'paid'
    );
    return res.status(200).end(JSON.stringify({ ok: true, orders: pending }));
  }

  // Chat state
  if (action === 'set_chat' && chatId) {
    const key = String(chatId);
    CHATS[key] = { ...(CHATS[key] || {}), ...data, updatedAt: Date.now() };
    return res.status(200).end(JSON.stringify({ ok: true }));
  }
  if (action === 'get_chat' && chatId) {
    const key = String(chatId);
    return res.status(200).end(JSON.stringify({ ok: true, state: CHATS[key] || null }));
  }

  return res.status(200).end(JSON.stringify({ ok: true }));
};
