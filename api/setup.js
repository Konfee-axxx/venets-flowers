const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!BOT_TOKEN) {
    return res.status(200).json({
      ok: false,
      error: 'BOT_TOKEN не задан в Environment Variables!'
    });
  }

  if (!WEBAPP_URL) {
    return res.status(200).json({
      ok: false,
      error: 'WEBAPP_URL не задан в Environment Variables!',
      fix: 'Добавьте WEBAPP_URL = https://venets-flowers.vercel.app'
    });
  }

  const webhookUrl = `${WEBAPP_URL}/api/webhook`;

  try {
    // Ставим вебхук
    const setRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true
      })
    });
    const setResult = await setRes.json();

    // Ставим команды
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: [
          { command: 'start', description: '🌸 Открыть магазин' },
          { command: 'balance', description: '💰 Мой баланс' },
          { command: 'orders', description: '📦 Мои заказы' },
          { command: 'referral', description: '🔗 Реферальная ссылка' },
          { command: 'admin', description: '⚙️ Панель администратора' }
        ]
      })
    });

    // Инфо о боте
    const meRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    const me = await meRes.json();

    return res.status(200).json({
      ok: setResult.ok,
      message: setResult.ok ? '✅ Бот успешно настроен! Теперь напишите /start боту.' : '❌ Ошибка',
      webhook_url: webhookUrl,
      bot: me.result ? `@${me.result.username}` : 'неизвестен',
      detail: setResult
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
