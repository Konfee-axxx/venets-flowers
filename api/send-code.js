/**
 * send-code.js
 * Генерирует код и пытается отправить через Telegram.
 * 
 * Telegram ограничение: бот не может отправить сообщение по номеру телефона.
 * Пользователь должен сначала написать боту /start, тогда его chat_id запомнится.
 * 
 * Для регистрации: код показывается прямо в WebApp.
 * Когда пользователь пишет боту — его tg_id привязывается к телефону.
 */

if (!global._phoneCodes)   global._phoneCodes   = {};
if (!global._phoneToTgId)  global._phoneToTgId  = {};

const CODES  = global._phoneCodes;
const PH2TG  = global._phoneToTgId;

const TOKEN = process.env.BOT_TOKEN || '';
const TG    = 'https://api.telegram.org/bot' + TOKEN;

async function tg(method, body) {
  try {
    const r = await fetch(`${TG}/${method}`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    return r.json();
  } catch(e) { return {ok:false}; }
}

module.exports = async function(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end('{}');

  const { phone } = req.body || {};
  if (!phone) return res.status(200).end(JSON.stringify({ok:false}));

  const code = String(Math.floor(10000 + Math.random() * 90000));
  CODES[phone] = { code, expires: Date.now() + 10 * 60 * 1000 };

  // Пробуем отправить через TG если есть chat_id для этого телефона
  const tgId = PH2TG[phone.replace(/\D/g,'')];
  if (tgId && TOKEN) {
    const sent = await tg('sendMessage', {
      chat_id: tgId,
      text: `🔐 Ваш код подтверждения:\n\n<b>${code}</b>\n\nДействует 10 минут.`,
      parse_mode: 'HTML'
    });
    if (sent.ok) {
      return res.status(200).end(JSON.stringify({ ok: true, sent: 'telegram' }));
    }
  }

  // Fallback: возвращаем код в ответе (WebApp покажет его пользователю)
  return res.status(200).end(JSON.stringify({ ok: true, sent: 'inline', code }));
};

// Экспортируем PH2TG для использования из webhook
module.exports.PH2TG = PH2TG;
