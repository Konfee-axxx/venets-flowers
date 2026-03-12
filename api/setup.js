const TOKEN = process.env.BOT_TOKEN;
const WURL  = (process.env.WEBAPP_URL || '').replace(/\/+$/, '');

module.exports = async function(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (!TOKEN || !WURL) {
    return res.status(200).end(JSON.stringify({ ok: false, error: 'Нет BOT_TOKEN или WEBAPP_URL' }));
  }
  const hookUrl = WURL + '/api/webhook';
  const r = await fetch('https://api.telegram.org/bot' + TOKEN + '/setWebhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: hookUrl, drop_pending_updates: true, allowed_updates: ['message','callback_query'] })
  });
  const result = await r.json();

  await fetch('https://api.telegram.org/bot' + TOKEN + '/setMyCommands', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands: [{ command: 'start', description: '🌸 Открыть магазин' }] })
  });

  await fetch('https://api.telegram.org/bot' + TOKEN + '/setChatMenuButton', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ menu_button: { type: 'web_app', text: '🌸 Магазин', web_app: { url: WURL } } })
  });

  return res.status(200).end(JSON.stringify({
    ok: result.ok,
    message: result.ok ? '✅ Готово! Напишите /start боту' : '❌ Ошибка',
    hook: hookUrl
  }));
};
