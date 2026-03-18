/**
 * Хранилище состояний заказов.
 * Использует глобальную переменную + Telegram как backup storage.
 * 
 * При set_order: пишем в global + шлём команду пользователю через бот
 * При get_order: сначала global, fallback — ищем в TG
 */

const TOKEN = process.env.BOT_TOKEN || '';
const WURL  = (process.env.WEBAPP_URL || '').replace(/\/+$/, '');
const ADMIN = process.env.ADMIN_CHAT_ID || '1146926337';
const TG    = 'https://api.telegram.org/bot' + TOKEN;

if (!global._OS3) global._OS3 = {};
const MEM = global._OS3;

async function tgApi(method, body) {
  try {
    const r = await fetch(TG + '/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return r.json();
  } catch(e) { return { ok: false, error: e.message }; }
}

module.exports = async function(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end('{}');

  const body = req.body || {};
  const { action, orderId, data } = body;

  // ── SET: Администратор отправляет реквизиты ──────────────────────────
  if (action === 'set_order' && orderId) {
    const key = String(orderId);
    const merged = { ...(MEM[key] || {}), ...data, _ts: Date.now() };
    MEM[key] = merged;

    // Если отправляются реквизиты — уведомляем пользователя через бот
    if (data && data.payState === 'requisites_sent' && data.userTgId) {
      const bankName  = data.payBank  || 'Банк';
      const payName   = data.payName  || '—';
      const payPhone  = data.payPhone || '—';

      // Кодируем реквизиты в startapp параметр (base64)
      const params = Buffer.from(JSON.stringify({
        t: 'req',
        oid: key,
        bank: bankName,
        name: payName,
        phone: payPhone,
        bankId: data.payBankId || 'sber'
      })).toString('base64url').slice(0, 64); // TG limit 64 chars

      // Отправляем пользователю через бот
      await tgApi('sendMessage', {
        chat_id: data.userTgId,
        text: '💳 <b>Реквизиты по заказу №' + orderId + ' готовы!</b>\n\n' +
              '🏦 ' + bankName + '\n' +
              '👤 ' + payName + '\n' +
              '📞 <code>' + payPhone + '</code>\n\n' +
              'Нажмите кнопку ниже чтобы оплатить:',
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{
            text: '💳 Перейти к оплате',
            web_app: { url: WURL + '?req=' + encodeURIComponent(params) }
          }]]
        }
      });
    }

    // Если пользователь оплатил — уведомляем администратора
    if (data && data.payState === 'paid') {
      await tgApi('sendMessage', {
        chat_id: ADMIN,
        text: '💰 <b>Заказ №' + orderId + ' оплачен!</b>\n\nПроверьте получение средств и подтвердите в WebApp.',
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '✅ Проверить в WebApp', web_app: { url: WURL } }]]
        }
      });
    }

    return res.status(200).end(JSON.stringify({ ok: true, state: merged }));
  }

  // ── GET: Пользователь проверяет статус ──────────────────────────────
  if (action === 'get_order' && orderId) {
    const key   = String(orderId);
    const state = MEM[key] || { payState: 'waiting_requisites' };
    return res.status(200).end(JSON.stringify({ ok: true, state }));
  }

  // ── PENDING LIST ─────────────────────────────────────────────────────
  if (action === 'get_pending') {
    const list = Object.values(MEM).filter(o =>
      o.payState === 'waiting_requisites' || o.payState === 'paid'
    );
    return res.status(200).end(JSON.stringify({ ok: true, orders: list }));
  }

  return res.status(200).end(JSON.stringify({ ok: true }));
};
