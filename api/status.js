const TOKEN = process.env.BOT_TOKEN;
const WURL  = process.env.WEBAPP_URL;

module.exports = async function(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (!TOKEN) return res.status(200).end(JSON.stringify({ ok: false, error: 'нет BOT_TOKEN' }));
  const r1 = await fetch('https://api.telegram.org/bot' + TOKEN + '/getMe');
  const r2 = await fetch('https://api.telegram.org/bot' + TOKEN + '/getWebhookInfo');
  const me = await r1.json();
  const wh = await r2.json();
  return res.status(200).end(JSON.stringify({
    ok: true,
    bot: me.result ? '@' + me.result.username : 'ошибка',
    webhook: wh.result ? wh.result.url : 'не задан',
    webapp_url: WURL || 'не задан'
  }));
};
