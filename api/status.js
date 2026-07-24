const TOKEN = process.env.BOT_TOKEN;
const WURL  = process.env.WEBAPP_URL;
const { dbDiag } = require('./db');

module.exports = async function(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const diag = await dbDiag();
  const storageOk = diag.kv_working || diag.blob_working;

  if (!TOKEN) return res.status(200).end(JSON.stringify({
    ok: false, error: 'нет BOT_TOKEN', storage: diag,
    fix: 'Vercel Dashboard → Settings → Environment Variables → добавьте BOT_TOKEN и WEBAPP_URL'
  }));

  const r1 = await fetch('https://api.telegram.org/bot' + TOKEN + '/getMe');
  const r2 = await fetch('https://api.telegram.org/bot' + TOKEN + '/getWebhookInfo');
  const me = await r1.json();
  const wh = await r2.json();
  const allowedUpdates = wh.result ? (wh.result.allowed_updates || []) : [];
  const hasCallbackQuery = allowedUpdates.length === 0 || allowedUpdates.includes('callback_query');

  const problems = [];
  if (!storageOk && !diag.kv_configured && !diag.blob_configured) {
    problems.push('⚠️ Нет постоянного хранилища — данные теряются при перезапуске! Подключите Vercel KV или Blob в Dashboard → Storage');
  } else if (!storageOk) {
    problems.push('⚠️ Хранилище подключено (переменные окружения заданы), но тестовая запись/чтение не проходит. Проверьте логи функции в Vercel Dashboard → Deployments → Functions, и что после подключения Storage был сделан Redeploy.');
  }
  if (!hasCallbackQuery) problems.push('⚠️ callback_query не включён — кнопки в боте не работают. Откройте /api/setup');

  return res.status(200).end(JSON.stringify({
    ok: true,
    bot: me.result ? '@' + me.result.username : 'ошибка',
    webhook: wh.result ? wh.result.url : 'не задан',
    webapp_url: WURL || 'не задан',
    storage: diag,
    storage_ok: storageOk,
    callback_query_ok: hasCallbackQuery,
    last_error: wh.result ? (wh.result.last_error_message || 'нет ошибок') : null,
    problems: problems.length ? problems : null,
    status: problems.length === 0 ? '✅ Всё работает корректно' : '⚠️ Есть проблемы (см. problems)'
  }));
};
