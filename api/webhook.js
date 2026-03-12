const TOKEN = process.env.BOT_TOKEN;
const WURL  = (process.env.WEBAPP_URL || '').replace(/\/+$/, '');
const TG    = 'https://api.telegram.org/bot' + TOKEN;

async function tg(method, body) {
  const r = await fetch(TG + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.json();
}

module.exports = async function(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    return res.status(200).end(JSON.stringify({ ok: true }));
  }

  try {
    const upd = req.body;

    if (upd.message) {
      const chatId = upd.message.chat.id;
      const name   = upd.message.from.first_name || 'Друг';
      const text   = upd.message.text || '';

      if (text.startsWith('/start') || text === '/help') {
        await tg('sendMessage', {
          chat_id:    chatId,
          text:       '🌸 <b>Venets Flowers</b>\n\nДоставка цветов и подарков по Москве.\n\nНажмите кнопку ниже, чтобы открыть магазин 👇',
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '🌸 Открыть магазин', web_app: { url: WURL } }
            ]]
          }
        });
      } else {
        await tg('sendMessage', {
          chat_id:    chatId,
          text:       '🌸 Открывайте магазин и выбирайте цветы!',
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '🌸 Открыть магазин', web_app: { url: WURL } }
            ]]
          }
        });
      }
    }

    if (upd.callback_query) {
      await tg('answerCallbackQuery', { callback_query_id: upd.callback_query.id });
    }

  } catch(e) {
    console.error(e.message);
  }

  return res.status(200).end(JSON.stringify({ ok: true }));
};
