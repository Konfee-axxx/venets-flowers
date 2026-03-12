const BOT_TOKEN  = process.env.BOT_TOKEN;
const WEBAPP_URL = (process.env.WEBAPP_URL || '').replace(/\/$/, '');
const API_URL    = `https://api.telegram.org/bot${BOT_TOKEN}`;

// In-memory база (живёт пока работает инстанс Vercel)
if (!global._vdb) global._vdb = { users: {}, orders: [] };
const db = global._vdb;

// ─── HTTP утилиты ────────────────────────────────────────────────────────────
async function tg(method, body) {
  const r = await fetch(`${API_URL}/${method}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body)
  });
  return r.json();
}

const send    = (chat_id, text, extra = {}) => tg('sendMessage',       { chat_id, text, parse_mode: 'HTML', ...extra });
const answerCb = (callback_query_id, text = '') => tg('answerCallbackQuery', { callback_query_id, text });

// ─── Клавиатуры ──────────────────────────────────────────────────────────────
const mainKb = (u) => ({
  inline_keyboard: [
    [{ text: '🌸 Открыть магазин', web_app: { url: WEBAPP_URL } }],
    [
      { text: `☘️ ${(u?.petals||0).toLocaleString('ru')} лепестков`, callback_data: 'points'   },
      { text: `🌹 ${(u?.buds  ||0).toLocaleString('ru')} бутонов`,   callback_data: 'buds'     }
    ],
    [
      { text: '📦 Мои заказы',  callback_data: 'orders'   },
      { text: '🔗 Рефералка',   callback_data: 'referral' }
    ],
    [{ text: '🆘 Поддержка', callback_data: 'support' }]
  ]
});

const backKb = () => ({ inline_keyboard: [[{ text: '← Назад', callback_data: 'menu' }]] });

// ─── Обработчик ──────────────────────────────────────────────────────────────
async function handle(upd) {

  // ── СООБЩЕНИЯ ────────────────────────────────────────────────────────────
  if (upd.message) {
    const { chat, from, text = '', web_app_data } = upd.message;
    const chatId = chat.id;
    const uid    = String(from.id);
    let   user   = db.users[uid];

    // Данные из WebApp (заказ)
    if (web_app_data) {
      try {
        const data = JSON.parse(web_app_data.data);
        if (data.type === 'order') {
          const order = {
            id:       Date.now(),
            uid,
            userName: user?.name  || from.first_name || 'Гость',
            phone:    user?.phone || '—',
            total:    data.total,
            items:    data.items,
            status:   'В обработке',
            date:     new Date().toLocaleDateString('ru'),
            address:  data.address || user?.addr || '—'
          };
          db.orders.unshift(order);
          if (user) {
            user.orders = user.orders || [];
            user.orders.unshift(order);
            const earned     = Math.floor(data.total * 0.05);
            user.petals      = (user.petals || 0) + earned;
          }
          await send(chatId,
            `✅ <b>Заказ #${order.id} оформлен!</b>\n\n` +
            `💰 Сумма: <b>${data.total.toLocaleString('ru')} ₽</b>\n` +
            `📍 Адрес: ${order.address}\n` +
            `⏳ Статус: <b>В обработке</b>\n\n` +
            `☘️ Кэшбек: <b>+${Math.floor(data.total * 0.05)}</b> лепестков`,
            { reply_markup: mainKb(user) }
          );
          if (process.env.ADMIN_CHAT_ID) {
            await send(process.env.ADMIN_CHAT_ID,
              `🔔 <b>Новый заказ #${order.id}</b>\n` +
              `👤 ${order.userName} · ${order.phone}\n` +
              `💰 ${order.total.toLocaleString('ru')} ₽\n📍 ${order.address}`,
              { reply_markup: { inline_keyboard: [[
                { text: '✅ Принять',  callback_data: `adm_accept_${order.id}`  },
                { text: '🚚 Курьер',  callback_data: `adm_deliver_${order.id}` },
                { text: '✔️ Доставлен', callback_data: `adm_done_${order.id}` },
                { text: '❌ Отмена',  callback_data: `adm_cancel_${order.id}`  }
              ]] } }
            );
          }
        }
      } catch (e) { console.error('web_app_data:', e.message); }
      return;
    }

    // /start
    if (text.startsWith('/start')) {
      const refCode = text.split(' ')[1];
      if (!user) {
        user = {
          id: uid, name: from.first_name || 'Друг',
          username: from.username || '',
          petals: 1000, buds: 0,
          refCode: 'VNT' + Math.random().toString(36).slice(2,8).toUpperCase(),
          referred: 0, orders: [],
          regDate: new Date().toLocaleDateString('ru')
        };
        db.users[uid] = user;
        if (refCode) {
          const ref = Object.values(db.users).find(u => u.refCode === refCode && u.id !== uid);
          if (ref) {
            ref.buds     = (ref.buds     || 0) + 1000;
            ref.referred = (ref.referred || 0) + 1;
            await send(ref.id,
              `🎉 По вашей ссылке зарегистрировался новый пользователь!\n` +
              `💰 Вам начислено <b>+1000 🌹 бутонов</b>`
            );
          }
        }
        await send(chatId,
          `🌸 <b>Добро пожаловать в Venets Flowers, ${user.name}!</b>\n\n` +
          `🎁 Вам начислено <b>1000 ☘️ лепестков</b> за регистрацию!\n\n` +
          `Нажмите кнопку ниже, чтобы открыть магазин 👇`,
          { reply_markup: mainKb(user) }
        );
        return;
      }
      await send(chatId,
        `🌸 <b>С возвращением, ${user.name}!</b>\n\n` +
        `☘️ Лепестки: <b>${user.petals.toLocaleString('ru')}</b>\n` +
        `🌹 Бутоны:   <b>${user.buds.toLocaleString('ru')}</b>`,
        { reply_markup: mainKb(user) }
      );
      return;
    }

    if (text === '/balance') {
      if (!user) { await send(chatId, '⚠️ Сначала напишите /start'); return; }
      await send(chatId,
        `💰 <b>Ваш баланс</b>\n\n` +
        `☘️ Лепестки: <b>${user.petals.toLocaleString('ru')}</b>\n` +
        `🌹 Бутоны:   <b>${user.buds.toLocaleString('ru')}</b>`,
        { reply_markup: backKb() }
      );
      return;
    }

    if (text === '/orders') {
      if (!user) { await send(chatId, '⚠️ Сначала напишите /start'); return; }
      const ords = user.orders || [];
      if (!ords.length) {
        await send(chatId, '📦 Пока нет заказов. Откройте магазин! 🌸', {
          reply_markup: { inline_keyboard: [
            [{ text: '🌸 Открыть магазин', web_app: { url: WEBAPP_URL } }]
          ] }
        });
      } else {
        const ico = { 'В обработке':'⏳','Доставляется':'🚚','Доставлен':'✅','Отменён':'❌' };
        const list = ords.slice(0,5).map(o =>
          `${ico[o.status]||'📦'} <b>#${o.id}</b> — ${o.total.toLocaleString('ru')} ₽\n   ${o.date} · ${o.status}`
        ).join('\n\n');
        await send(chatId, `📦 <b>Ваши заказы:</b>\n\n${list}`, { reply_markup: backKb() });
      }
      return;
    }

    if (text === '/referral') {
      if (!user) { await send(chatId, '⚠️ Сначала напишите /start'); return; }
      const link = `https://t.me/venets_bot?start=${user.refCode}`;
      await send(chatId,
        `🔗 <b>Ваша реферальная ссылка:</b>\n\n<code>${link}</code>\n\n` +
        `За каждого друга: <b>+1000 🌹 бутонов</b>\n` +
        `Приглашено: <b>${user.referred}</b>`,
        { reply_markup: { inline_keyboard: [
          [{ text: '📤 Поделиться', url: `https://t.me/share/url?url=${encodeURIComponent(link)}` }],
          [{ text: '← Назад', callback_data: 'menu' }]
        ] } }
      );
      return;
    }

    if (text === '/admin') {
      await sendAdmin(chatId);
      return;
    }

    // любое другое сообщение
    await send(chatId, `🌸 <b>Venets Flowers</b>\n\nВыберите действие:`, { reply_markup: mainKb(user) });
  }

  // ── CALLBACK КНОПКИ ──────────────────────────────────────────────────────
  if (upd.callback_query) {
    const { id: cbId, message, from, data } = upd.callback_query;
    const chatId = message.chat.id;
    const uid    = String(from.id);
    const user   = db.users[uid];
    await answerCb(cbId);

    if (data === 'menu') {
      await send(chatId, `🌸 <b>Venets Flowers</b>`, { reply_markup: mainKb(user) });
      return;
    }
    if (data === 'points') {
      await send(chatId,
        `☘️ <b>Лепестки</b>\n\nУ вас: <b>${(user?.petals||0).toLocaleString('ru')}</b>\n\n` +
        `• Кэшбек 5% с каждой покупки\n• До 75% скидки на заказ\n• Обмен на 🌹 по курсу 3:1`,
        { reply_markup: backKb() }
      );
      return;
    }
    if (data === 'buds') {
      await send(chatId,
        `🌹 <b>Бутоны</b>\n\nУ вас: <b>${(user?.buds||0).toLocaleString('ru')}</b>\n\n` +
        `• +1000 за каждого приглашённого друга\n• Вывод деньгами (СБП)\n• Обмен на ☘️ по курсу 1:2`,
        { reply_markup: backKb() }
      );
      return;
    }
    if (data === 'orders') {
      const ords = user?.orders || [];
      if (!ords.length) {
        await send(chatId, '📦 Пока нет заказов.', { reply_markup: { inline_keyboard: [
          [{ text: '🌸 В магазин', web_app: { url: WEBAPP_URL } }],
          [{ text: '← Назад', callback_data: 'menu' }]
        ] } });
      } else {
        const ico = { 'В обработке':'⏳','Доставляется':'🚚','Доставлен':'✅','Отменён':'❌' };
        const list = ords.slice(0,5).map(o =>
          `${ico[o.status]||'📦'} #${o.id} — ${o.total.toLocaleString('ru')} ₽ · ${o.status}`
        ).join('\n');
        await send(chatId, `📦 <b>Ваши заказы:</b>\n\n${list}`, { reply_markup: backKb() });
      }
      return;
    }
    if (data === 'referral') {
      if (!user) { await send(chatId, '⚠️ /start'); return; }
      const link = `https://t.me/venets_bot?start=${user.refCode}`;
      await send(chatId,
        `🔗 Ваша ссылка:\n<code>${link}</code>\n\nПриглашено: <b>${user.referred}</b>`,
        { reply_markup: { inline_keyboard: [
          [{ text: '📤 Поделиться', url: `https://t.me/share/url?url=${encodeURIComponent(link)}` }],
          [{ text: '← Назад', callback_data: 'menu' }]
        ] } }
      );
      return;
    }
    if (data === 'support') {
      await send(chatId,
        `🆘 <b>Поддержка</b>\n\nПн–Пт 9:00–21:00, Сб–Вс 10:00–20:00\n\n📞 +7 (495) 123-45-67`,
        { reply_markup: backKb() }
      );
      return;
    }

    // Смена статуса заказа (для администратора)
    const m = data.match(/^adm_(accept|deliver|done|cancel)_(\d+)$/);
    if (m) {
      const statusMap = { accept:'В обработке', deliver:'Доставляется', done:'Доставлен', cancel:'Отменён' };
      const icoMap    = { accept:'✅', deliver:'🚚', done:'🎉', cancel:'❌' };
      const order = db.orders.find(o => o.id === Number(m[2]));
      if (!order) { await send(chatId, '❌ Заказ не найден'); return; }
      order.status = statusMap[m[1]];
      if (order.uid) await send(order.uid, `${icoMap[m[1]]} Статус заказа <b>#${order.id}</b>: <b>${order.status}</b>`);
      await send(chatId, `${icoMap[m[1]]} Заказ #${order.id} → <b>${order.status}</b>`);
      return;
    }

    if (data === 'adm_orders') {
      const list = db.orders.filter(o => o.status === 'В обработке').slice(0,5);
      if (!list.length) { await send(chatId, '📦 Новых заказов нет'); return; }
      for (const o of list) {
        await send(chatId,
          `📦 <b>#${o.id}</b> · ${o.userName} · ${o.total.toLocaleString('ru')} ₽\n📍 ${o.address}\n🕐 ${o.date}`,
          { reply_markup: { inline_keyboard: [[
            { text:'✅', callback_data:`adm_accept_${o.id}` },
            { text:'🚚', callback_data:`adm_deliver_${o.id}` },
            { text:'✔️', callback_data:`adm_done_${o.id}` },
            { text:'❌', callback_data:`adm_cancel_${o.id}` }
          ]] } }
        );
      }
      return;
    }
    if (data === 'adm_users') {
      const list = Object.values(db.users).slice(0,10);
      if (!list.length) { await send(chatId, '👥 Клиентов пока нет'); return; }
      const txt = list.map(u =>
        `👤 <b>${u.name}</b> · ☘️${u.petals} 🌹${u.buds} · заказов: ${u.orders?.length||0}`
      ).join('\n');
      await send(chatId, `👥 <b>Клиенты (${list.length}):</b>\n\n${txt}`);
      return;
    }
    if (data === 'adm_panel') {
      await sendAdmin(chatId);
      return;
    }
  }
}

async function sendAdmin(chatId) {
  const uCount  = Object.keys(db.users).length;
  const oCount  = db.orders.length;
  const rev     = db.orders.reduce((a,o) => a + (o.total||0), 0);
  const pending = db.orders.filter(o => o.status === 'В обработке').length;
  await send(chatId,
    `⚙️ <b>Панель администратора</b>\n\n` +
    `👥 Клиентов:  <b>${uCount}</b>\n` +
    `📦 Заказов:   <b>${oCount}</b>\n` +
    `⏳ Ожидают:   <b>${pending}</b>\n` +
    `💰 Выручка:   <b>${rev.toLocaleString('ru')} ₽</b>`,
    { reply_markup: { inline_keyboard: [
      [{ text: `📦 Новые заказы (${pending})`, callback_data: 'adm_orders' }],
      [{ text: '👥 Клиенты',                  callback_data: 'adm_users'  }],
      [{ text: '🌸 Открыть магазин', web_app: { url: WEBAPP_URL }          }]
    ] } }
  );
}

// ─── Vercel serverless handler ────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    return res.status(200).end(JSON.stringify({ ok: true, message: 'Venets Flowers webhook online' }));
  }
  if (req.method !== 'POST') {
    return res.status(200).end(JSON.stringify({ ok: true }));
  }

  try { await handle(req.body); } catch (e) { console.error('handle error:', e.message); }
  return res.status(200).end(JSON.stringify({ ok: true }));
};
