const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = (process.env.WEBAPP_URL || '').replace(/\/$/, '');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (!BOT_TOKEN) {
    return res.status(200).end(JSON.stringify({
      ok: false,
      error: 'BOT_TOKEN не задан — добавьте в Vercel → Settings → Environment Variables'
    }));
  }

  try {
    const meRes  = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    const whRes  = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    const me     = await meRes.json();
    const wh     = await whRes.json();
    const hasWH  = !!(wh.result && wh.result.url);

    return res.status(200).end(JSON.stringify({
      ok: true,
      status:          hasWH ? '✅ Бот работает' : '⚠️ Вебхук не задан — откройте /api/setup',
      bot:             me.result  ? `@${me.result.username}` : 'не найден',
      webhook_url:     wh.result?.url  || 'не задан',
      webapp_url:      WEBAPP_URL || 'не задан',
      pending_updates: wh.result?.pending_update_count || 0
    }));
  } catch (e) {
    return res.status(200).end(JSON.stringify({ ok: false, error: String(e.message) }));
  }
};
