/**
 * order-state.js — централизованное хранилище состояний заказов через Vercel KV
 * 
 * Теперь polling работает МЕЖДУ УСТРОЙСТВАМИ:
 * Admin WebApp пишет → KV → User WebApp читает
 */

const { dbGet, dbSet } = require('./db');
const TOKEN = process.env.BOT_TOKEN || '';
const WURL  = (process.env.WEBAPP_URL || '').replace(/\/+$/, '');
const TG    = 'https://api.telegram.org/bot' + TOKEN;

async function tg(method, body) {
  try {
    const r = await fetch(`${TG}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return r.json();
  } catch(e) { return { ok: false }; }
}

module.exports = async function(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end('{}');

  const { action, orderId, data } = req.body || {};
  const key = orderId ? `order:${String(orderId)}` : null;

  // ── SET ─────────────────────────────────────────────────────────
  if (action === 'set_order' && key) {
    const existing = await dbGet(key) || {};
    const merged = { ...existing, ...data, _ts: Date.now() };
    await dbSet(key, merged, 60 * 60 * 24 * 7); // TTL 7 дней

    // Если отправляются реквизиты — уведомляем пользователя
    if (data?.payState === 'requisites_sent' && data?.userTgId) {
      const bank = data.payBank || 'Банк';
      const name = data.payName || '—';
      const phone = data.payPhone || '—';
      const bid = data.payBankId || 'sber';
      let param = '';
      try {
        param = Buffer.from(JSON.stringify({
          t:'req', oid: String(orderId), bank, name, phone, bankId: bid
        })).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'').slice(0,64);
      } catch(e) {}
      await tg('sendMessage', {
        chat_id: data.userTgId,
        parse_mode: 'HTML',
        text: `💳 <b>Реквизиты по заказу №${orderId} готовы!</b>\n\n🏦 ${bank}\n👤 ${name}\n📞 <code>${phone}</code>\n\nНажмите кнопку ниже:`,
        reply_markup: { inline_keyboard: [[{
          text: '💳 Перейти к оплате',
          web_app: { url: WURL + (param ? '?req=' + param : '') }
        }]]}
      });
    }
    return res.status(200).end(JSON.stringify({ ok: true, state: merged }));
  }

  // ── GET ─────────────────────────────────────────────────────────
  if (action === 'get_order' && key) {
    const state = await dbGet(key);
    return res.status(200).end(JSON.stringify({
      ok: true,
      state: state || { payState: 'waiting_requisites' }
    }));
  }

  return res.status(200).end(JSON.stringify({ ok: true }));
};
