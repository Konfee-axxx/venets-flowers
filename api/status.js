// api/status.js
// Открой в браузере: https://ВАШ_САЙТ.vercel.app/api/status

export default async function handler(req, res) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const WEBAPP_URL = process.env.WEBAPP_URL;

  if (!BOT_TOKEN) {
    return res.status(500).json({
      ok: false,
      error: 'BOT_TOKEN не задан',
      fix: 'Добавьте BOT_TOKEN в Vercel → Settings → Environment Variables'
    });
  }

  const getMe = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
  const botInfo = await getMe.json();

  const getWebhook = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
  const webhookInfo = await getWebhook.json();

  return res.status(200).json({
    ok: true,
    bot: botInfo.result,
    webhook: webhookInfo.result,
    webapp_url: WEBAPP_URL,
    status: webhookInfo.result?.url ? '✅ Бот работает' : '⚠️ Вебхук не зарегистрирован. Откройте /api/setup',
  });
}
