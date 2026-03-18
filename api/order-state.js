/**
 * order-state.js
 * 
 * Используется ТОЛЬКО для:
 * 1. Отправки TG уведомления пользователю с реквизитами (когда admin нажал "Отправить")
 * 2. Логирования событий
 *
 * Основное хранилище состояний — localStorage в браузере.
 * Polling между пользователем и администратором работает через localStorage.
 */

const TOKEN = process.env.BOT_TOKEN || '';
const WURL  = (process.env.WEBAPP_URL || '').replace(/\/+$/, '');
const TG    = 'https://api.telegram.org/bot' + TOKEN;

async function tg(method, body) {
  try {
    const r = await fetch(TG + '/' + method, {
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

  // Отправить реквизиты пользователю через TG бот
  if (action === 'send_requisites' && orderId && data) {
    const userTgId = data.userTgId;
    if (!userTgId) {
      return res.status(200).end(JSON.stringify({ ok: false, error: 'no userTgId' }));
    }

    const bankName = data.payBank  || 'Банк';
    const payName  = data.payName  || '—';
    const payPhone = data.payPhone || '—';
    const bankId   = data.payBankId || 'sber';

    // Кодируем реквизиты в base64 для URL параметра
    let param = '';
    try {
      const obj = { t:'req', oid: String(orderId), bank: bankName, name: payName, phone: payPhone, bankId };
      param = Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
      if (param.length > 64) param = param.slice(0, 64);
    } catch(e) {}

    const result = await tg('sendMessage', {
      chat_id: userTgId,
      parse_mode: 'HTML',
      text:
        '💳 <b>Реквизиты по заказу №' + orderId + ' готовы!</b>\n\n' +
        '🏦 ' + bankName + '\n' +
        '👤 ' + payName + '\n' +
        '📞 <code>' + payPhone + '</code>\n\n' +
        'Нажмите кнопку ниже чтобы перейти к оплате:',
      reply_markup: {
        inline_keyboard: [[{
          text: '💳 Перейти к оплате',
          web_app: { url: WURL + (param ? '?req=' + param : '') }
        }]]
      }
    });

    return res.status(200).end(JSON.stringify({ ok: result.ok, msgId: result.result?.message_id }));
  }

  return res.status(200).end(JSON.stringify({ ok: true }));
};
