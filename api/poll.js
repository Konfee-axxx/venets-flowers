const wh = require('./webhook');
const { dbGet, dbSet } = require('./db');

async function getList(key) {
  try { const v = await dbGet(key); return Array.isArray(v) ? v : []; } catch(e) { return []; }
}
async function setList(key, arr) {
  await dbSet(key, arr, 60 * 60 * 24 * 365);
}

module.exports = async function(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end('{}');

  const body = req.body || {};
  const { action, orderId, chatId, orderData, chatData, userData } = body;

  // ══ ЗАКАЗЫ ══════════════════════════════════════════════════════════════════

  if (action === 'new_order' && orderData) {
    try { await wh.notifyAdminNewOrder(orderData); } catch(e) { console.error(e.message); }
    try {
      const orders = await getList('orders:list');
      const idx = orders.findIndex(o => String(o.id) === String(orderData.id));
      if (idx >= 0) orders[idx] = { ...orders[idx], ...orderData };
      else orders.unshift({ ...orderData, _created: Date.now() });
      await setList('orders:list', orders);
    } catch(e) { console.error('orders KV err:', e.message); }
    return res.status(200).end(JSON.stringify({ ok: true }));
  }

  if (action === 'update_order' && orderId && body.data) {
    try {
      const orders = await getList('orders:list');
      const idx = orders.findIndex(o => String(o.id) === String(orderId));
      if (idx >= 0) { orders[idx] = { ...orders[idx], ...body.data, _updated: Date.now() }; await setList('orders:list', orders); }
    } catch(e) {}
    return res.status(200).end(JSON.stringify({ ok: true }));
  }

  if (action === 'paid' && orderId) {
    try { await wh.notifyAdminPaid(orderId); } catch(e) {}
    try {
      const orders = await getList('orders:list');
      const idx = orders.findIndex(o => String(o.id) === String(orderId));
      if (idx >= 0) { orders[idx].payState = 'paid'; orders[idx].status = 'Ожидаем подтверждения'; await setList('orders:list', orders); }
    } catch(e) {}
    return res.status(200).end(JSON.stringify({ ok: true }));
  }

  if (action === 'requisites_sent' && orderId) {
    try {
      const orders = await getList('orders:list');
      const idx = orders.findIndex(o => String(o.id) === String(orderId));
      if (idx >= 0) { orders[idx].payState = 'requisites_sent'; orders[idx].status = 'Ожидаем оплаты'; await setList('orders:list', orders); }
    } catch(e) {}
    return res.status(200).end(JSON.stringify({ ok: true }));
  }

  if (action === 'order_confirmed' && orderId) {
    try {
      const orders = await getList('orders:list');
      const idx = orders.findIndex(o => String(o.id) === String(orderId));
      if (idx >= 0) { orders[idx].payState = 'confirmed'; orders[idx].status = 'Доставляется'; await setList('orders:list', orders); }
    } catch(e) {}
    return res.status(200).end(JSON.stringify({ ok: true }));
  }

  if (action === 'order_cancelled' && orderId) {
    try {
      const orders = await getList('orders:list');
      const idx = orders.findIndex(o => String(o.id) === String(orderId));
      if (idx >= 0) { orders[idx].payState = 'cancelled'; orders[idx].status = 'Отменён'; await setList('orders:list', orders); }
    } catch(e) {}
    return res.status(200).end(JSON.stringify({ ok: true }));
  }

  if (action === 'order_status' && orderId && body.status) {
    try {
      const orders = await getList('orders:list');
      const idx = orders.findIndex(o => String(o.id) === String(orderId));
      if (idx >= 0) {
        orders[idx].status = body.status;
        if (body.payState) orders[idx].payState = body.payState;
        await setList('orders:list', orders);
      }
    } catch(e) {}
    return res.status(200).end(JSON.stringify({ ok: true }));
  }

  // ══ ПОЛЬЗОВАТЕЛИ ════════════════════════════════════════════════════════════

  if (action === 'register_user' && userData) {
    try {
      const users = await getList('users:list');
      // Ищем по уникальному uid (promoCode), затем по tgId, затем по телефону
      const idx = users.findIndex(u =>
        (userData.uid && u.uid && u.uid === userData.uid) ||
        (userData.tgId && u.tgId && u.tgId === userData.tgId) ||
        (userData.phone && u.phone && u.phone === userData.phone && userData.phone.length > 5)
      );
      if (idx >= 0) {
        users[idx] = { ...users[idx], ...userData, _updated: Date.now() };
      } else {
        users.push({ ...userData, _created: Date.now() });
      }
      await setList('users:list', users);
    } catch(e) { console.error('users KV err:', e.message); }
    return res.status(200).end(JSON.stringify({ ok: true }));
  }

  // ══ ЧАТЫ ════════════════════════════════════════════════════════════════════

  if (action === 'new_chat' && chatData) {
    try { await wh.notifyAdminChat(chatData.id, chatData.topic, chatData.user || {}); } catch(e) {}
    try {
      const chats = await getList('chats:list');
      const chatEntry = {
        id: chatData.id, topic: chatData.topic, status: chatData.status || 'Активный',
        user: chatData.user || {}, userTgId: chatData.userTgId || null,
        created: chatData.created || new Date().toLocaleDateString('ru'),
        msgs: chatData.msgs || [], _updated: Date.now()
      };
      const idx = chats.findIndex(c => String(c.id) === String(chatData.id));
      if (idx >= 0) chats[idx] = chatEntry; else chats.unshift(chatEntry);
      await setList('chats:list', chats);
      await dbSet('chat:' + String(chatData.id), chatEntry, 60 * 60 * 24 * 90);
    } catch(e) { console.error('chats KV err:', e.message); }
    return res.status(200).end(JSON.stringify({ ok: true }));
  }

  if (action === 'chat_msg' && chatId) {
    try {
      const chatKey = 'chat:' + String(chatId);
      const chat = await dbGet(chatKey).catch(() => null);
      if (chat) {
        if (!chat.msgs) chat.msgs = [];
        if (body.msgData) { chat.msgs.push({ ...body.msgData, adminUnread: true }); }
        chat._updated = Date.now();
        await dbSet(chatKey, chat, 60 * 60 * 24 * 90);
        const chats = await getList('chats:list');
        const idx = chats.findIndex(c => String(c.id) === String(chatId));
        if (idx >= 0) { chats[idx].msgs = chat.msgs; chats[idx]._updated = chat._updated; await setList('chats:list', chats); }
        try { await wh.notifyAdminChatMsg(chatId, chat.topic || '?'); } catch(e) {}
      } else {
        const chats = await getList('chats:list');
        const ch = chats.find(c => String(c.id) === String(chatId));
        try { await wh.notifyAdminChatMsg(chatId, ch ? ch.topic : '?'); } catch(e) {}
      }
    } catch(e) {}
    return res.status(200).end(JSON.stringify({ ok: true }));
  }

  if (action === 'admin_reply' && chatId) {
    try {
      const chatKey = 'chat:' + String(chatId);
      const chat = await dbGet(chatKey).catch(() => null);
      if (chat && body.msg) {
        if (!chat.msgs) chat.msgs = [];
        chat.msgs.push({ from: 'admin', text: body.msg, time: new Date().toLocaleTimeString('ru', {hour:'2-digit',minute:'2-digit'}), unread: true });
        chat._updated = Date.now();
        await dbSet(chatKey, chat, 60 * 60 * 24 * 90);
        const chats = await getList('chats:list');
        const idx = chats.findIndex(c => String(c.id) === String(chatId));
        if (idx >= 0) { chats[idx].msgs = chat.msgs; chats[idx]._updated = chat._updated; await setList('chats:list', chats); }
      }
    } catch(e) {}
    if (body.userTgId) { try { await wh.notifyUserReply(body.userTgId, chatId); } catch(e) {} }
    return res.status(200).end(JSON.stringify({ ok: true }));
  }

  if (action === 'close_chat' && chatId) {
    try {
      const chatKey = 'chat:' + String(chatId);
      const chat = await dbGet(chatKey).catch(() => null);
      if (chat) { chat.status = 'Закрыт'; await dbSet(chatKey, chat, 60 * 60 * 24 * 90); }
      const chats = await getList('chats:list');
      const idx = chats.findIndex(c => String(c.id) === String(chatId));
      if (idx >= 0) { chats[idx].status = 'Закрыт'; chats[idx]._updated = Date.now(); await setList('chats:list', chats); }
    } catch(e) {}
    return res.status(200).end(JSON.stringify({ ok: true }));
  }

  // ══ ЧТЕНИЕ (для синхронизации) ═══════════════════════════════════════════

  if (action === 'get_orders') {
    try { return res.status(200).end(JSON.stringify({ ok: true, orders: await getList('orders:list') })); }
    catch(e) { return res.status(200).end(JSON.stringify({ ok: true, orders: [] })); }
  }

  // ── Заказы конкретного продавца (для кабинета селлера) ──
  if (action === 'get_seller_orders' && body.sellerLogin) {
    try {
      const all = await getList('orders:list');
      const mine = all.filter(o => o.sellerLogin === body.sellerLogin);
      return res.status(200).end(JSON.stringify({ ok: true, orders: mine }));
    } catch(e) { return res.status(200).end(JSON.stringify({ ok: true, orders: [] })); }
  }

  if (action === 'get_users') {
    try { return res.status(200).end(JSON.stringify({ ok: true, users: await getList('users:list') })); }
    catch(e) { return res.status(200).end(JSON.stringify({ ok: true, users: [] })); }
  }

  if (action === 'get_chats') {
    try { return res.status(200).end(JSON.stringify({ ok: true, chats: await getList('chats:list') })); }
    catch(e) { return res.status(200).end(JSON.stringify({ ok: true, chats: [] })); }
  }

  if (action === 'get_chat' && chatId) {
    try {
      const chat = await dbGet('chat:' + String(chatId));
      return res.status(200).end(JSON.stringify({ ok: true, chat: chat || null }));
    } catch(e) { return res.status(200).end(JSON.stringify({ ok: true, chat: null })); }
  }

  return res.status(200).end(JSON.stringify({ ok: true }));
};
