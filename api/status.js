const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!BOT_TOKEN) {
    return res.status(200).json({
      ok: false,
      error: 'BOT_TOKEN не задан',
      fix: 'Vercel → Settings → Environment Variables → добавить BOT_TOKEN'
    });
  }

  try {
    const [meRes, whRes] = await Promise.all([
      fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`),
      fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`)
    ]);

    const me = await meRes.json();
    const wh = await whRes.json();

    return res.status(200).json({
      ok: true,
      status: wh.result?.url ? '✅ Бот работает' : '⚠️ Вебхук не зарегистрирован — откройте /api/setup',
      bot: me.result ? `@${me.result.username}` : 'не найден',
      webhook_url: wh.result?.url || 'не задан',
      webapp_url: WEBAPP_URL || 'не задан',
      pending_updates: wh.result?.pending_update_count || 0
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
