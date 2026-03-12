const BOT_TOKEN  = process.env.BOT_TOKEN;
const WEBAPP_URL = (process.env.WEBAPP_URL || '').replace(/\/$/, '');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (!BOT_TOKEN) {
    return res.status(200).end(JSON.stringify({
      ok: false, error: 'BOT_TOKEN не задан в Environment Variables!'
    }));
  }
  if (!WEBAPP_URL) {
    return res.status(200).end(JSON.stringify({
      ok: false,
      error: 'WEBAPP_URL не задан!',
      fix:   'Добавьте WEBAPP_URL = https://venets-flowers.vercel.app  (без слэша в конце!)'
    }));
  }

  const webhookUrl = `${WEBAPP_URL}/api/webhook`;

  try {
    const setRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        url:              webhookUrl,
        allowed_updates:  ['message', 'callback_query'],
        drop_pending_updates: true
      })
    });
    const setResult = await setRes.json();

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        commands: [
          { command: 'start',    description: '🌸 Открыть магазин'          },
          { command: 'balance',  description: '💰 Мой баланс'               },
          { command: 'orders',   description: '📦 Мои заказы'               },
          { command: 'referral', description: '🔗 Реферальная ссылка'       },
          { command: 'admin',    description: '⚙️ Панель администратора'    }
        ]
      })
    });

    const meRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    const me    = await meRes.json();

    return res.status(200).end(JSON.stringify({
      ok:          setResult.ok,
      message:     setResult.ok
                     ? '✅ Бот успешно настроен! Напишите /start боту @venets_bot'
                     : '❌ Ошибка регистрации вебхука',
      webhook_url: webhookUrl,
      bot:         me.result ? `@${me.result.username}` : 'неизвестен',
      detail:      setResult
    }));
  } catch (e) {
    return res.status(200).end(JSON.stringify({ ok: false, error: String(e.message) }));
  }
};
