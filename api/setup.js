// api/setup.js
// Открой в браузере: https://ВАШ_САЙТ.vercel.app/api/setup
// Это автоматически зарегистрирует вебхук в Telegram

export default async function handler(req, res) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const WEBAPP_URL = process.env.WEBAPP_URL;

  if (!BOT_TOKEN) {
    return res.status(500).json({ error: 'BOT_TOKEN не задан в переменных окружения!' });
  }

  const webhookUrl = `${WEBAPP_URL}/api/webhook`;

  // Регистрируем вебхук
  const setWebhook = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true,
      }),
    }
  );
  const webhookResult = await setWebhook.json();

  // Устанавливаем команды бота
  const setCommands = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: [
          { command: 'start', description: '🌸 Открыть магазин' },
          { command: 'balance', description: '💰 Мой баланс' },
          { command: 'admin', description: '⚙️ Панель администратора' },
          { command: 'stats', description: '📊 Статистика' },
        ],
      }),
    }
  );
  const commandsResult = await setCommands.json();

  // Получаем информацию о боте
  const getMe = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
  const botInfo = await getMe.json();

  return res.status(200).json({
    success: true,
    message: '✅ Бот успешно настроен!',
    bot: botInfo.result,
    webhook: {
      url: webhookUrl,
      result: webhookResult,
    },
    commands: commandsResult,
  });
}
