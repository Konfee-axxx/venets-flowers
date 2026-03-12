module.exports = async function (req, res) {
  const TOKEN = process.env.BOT_TOKEN;
  const WURL  = (process.env.WEBAPP_URL || '').replace(/\/+$/, '');

  res.setHeader('Content-Type', 'application/json');

  if (!TOKEN || !WURL) {
    return res.status(200).end(JSON.stringify({
      ok: false,
      error: 'Нет BOT_TOKEN или WEBAPP_URL',
      token_ok: !!TOKEN,
      url_ok: !!WURL
    }));
  }

  const hookUrl = WURL + '/api/webhook';

  try {
    const r = await fetch('https://api.telegram.org/bot' + TOKEN + '/setWebhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: hookUrl,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true
      })
    });
    const result = await r.json();

    await fetch('https://api.telegram.org/bot' + TOKEN + '/setMyCommands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: [
        { command: 'start',    description: '🌸 Открыть магазин'       },
        { command: 'balance',  description: '💰 Мой баланс'            },
        { command: 'orders',   description: '📦 Мои заказы'            },
        { command: 'referral', description: '🔗 Реферальная ссылка'    },
        { command: 'admin',    description: '⚙️ Администратор'         }
      ]})
    });

    return res.status(200).end(JSON.stringify({
      ok: result.ok,
      message: result.ok ? '✅ Готово! Напишите /start боту' : '❌ Ошибка',
      hook_url: hookUrl,
      tg_result: result
    }));
  } catch (e) {
    return res.status(200).end(JSON.stringify({ ok: false, error: e.message }));
  }
};
