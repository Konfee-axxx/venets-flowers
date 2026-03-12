const TOKEN = process.env.BOT_TOKEN;
const WURL  = (process.env.WEBAPP_URL || '').replace(/\/+$/, '');
const TG    = 'https://api.telegram.org/bot' + TOKEN;

if (!global._db) global._db = { users: {}, orders: [] };
const db = global._db;

async function api(method, body) {
  const r = await fetch(TG + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.json();
}

const msg = (chat_id, text, extra) =>
  api('sendMessage', Object.assign({ chat_id, text, parse_mode: 'HTML' }, extra));

const ack = (callback_query_id) =>
  api('answerCallbackQuery', { callback_query_id });

function mainKb(u) {
  return { inline_keyboard: [
    [{ text: '🌸 Открыть магазин', web_app: { url: WURL } }],
    [
      { text: '☘️ ' + ((u && u.petals) || 0) + ' лепестков', callback_data: 'cb_petals'   },
      { text: '🌹 ' + ((u && u.buds)   || 0) + ' бутонов',   callback_data: 'cb_buds'     }
    ],
    [
      { text: '📦 Заказы',   callback_data: 'cb_orders'   },
      { text: '🔗 Рефералка', callback_data: 'cb_ref'    }
    ],
    [{ text: '🆘 Поддержка', callback_data: 'cb_support' }]
  ]};
}

function backKb() {
  return { inline_keyboard: [[{ text: '← Назад', callback_data: 'cb_menu' }]] };
}

async function handleUpdate(upd) {
  // ── СООБЩЕНИЕ ──────────────────────────────────────────────────────────
  if (upd.message) {
    const chatId = upd.message.chat.id;
    const uid    = String(upd.message.from.id);
    const text   = upd.message.text || '';
    const name   = upd.message.from.first_name || 'Друг';
    let   user   = db.users[uid];

    // Данные из WebApp
    if (upd.message.web_app_data) {
      try {
        const data = JSON.parse(upd.message.web_app_data.data);
        if (data.type === 'order') {
          const order = {
            id: Date.now(), uid,
            userName: (user && user.name) || name,
            total: data.total,
            items: data.items,
            status: 'В обработке',
            date: new Date().toLocaleDateString('ru'),
            address: data.address || (user && user.addr) || '—'
          };
          db.orders.unshift(order);
          if (user) {
            user.orders = user.orders || [];
            user.orders.unshift(order);
            user.petals = (user.petals || 0) + Math.floor(data.total * 0.05);
          }
          await msg(chatId,
            '✅ <b>Заказ #' + order.id + ' оформлен!</b>\n\n' +
            '💰 Сумма: <b>' + data.total.toLocaleString('ru') + ' ₽</b>\n' +
            '📍 ' + order.address + '\n\n' +
            '☘️ Кэшбек: <b>+' + Math.floor(data.total * 0.05) + '</b>',
            { reply_markup: mainKb(user) }
          );
        }
      } catch(e) { console.error(e.message); }
      return;
    }

    // /start
    if (text.startsWith('/start')) {
      const ref = text.split(' ')[1];
      if (!user) {
        user = {
          id: uid, name,
          petals: 1000, buds: 0,
          refCode: 'VNT' + Math.random().toString(36).slice(2,8).toUpperCase(),
          referred: 0, orders: [],
          regDate: new Date().toLocaleDateString('ru')
        };
        db.users[uid] = user;
        if (ref) {
          const referrer = Object.values(db.users).find(function(u) {
            return u.refCode === ref && u.id !== uid;
          });
          if (referrer) {
            referrer.buds = (referrer.buds || 0) + 1000;
            referrer.referred = (referrer.referred || 0) + 1;
            await msg(referrer.id,
              '🎉 Новый пользователь по вашей ссылке!\n💰 <b>+1000 🌹 бутонов</b>'
            );
          }
        }
        await msg(chatId,
          '🌸 <b>Добро пожаловать, ' + name + '!</b>\n\n' +
          '🎁 Вам начислено <b>1000 ☘️ лепестков</b>!\n\nОткройте магазин 👇',
          { reply_markup: mainKb(user) }
        );
        return;
      }
      await msg(chatId,
        '🌸 <b>С возвращением, ' + user.name + '!</b>\n\n' +
        '☘️ ' + user.petals + ' лепестков\n🌹 ' + user.buds + ' бутонов',
        { reply_markup: mainKb(user) }
      );
      return;
    }

    if (text === '/balance') {
      if (!user) { await msg(chatId, '⚠️ Напишите /start'); return; }
      await msg(chatId,
        '💰 <b>Баланс</b>\n\n☘️ ' + user.petals + ' лепестков\n🌹 ' + user.buds + ' бутонов',
        { reply_markup: backKb() }
      );
      return;
    }

    if (text === '/orders') {
      if (!user) { await msg(chatId, '⚠️ Напишите /start'); return; }
      const ords = user.orders || [];
      if (!ords.length) {
        await msg(chatId, '📦 Заказов пока нет', {
          reply_markup: { inline_keyboard: [[{ text: '🌸 В магазин', web_app: { url: WURL } }]] }
        });
      } else {
        const ico = { 'В обработке':'⏳','Доставляется':'🚚','Доставлен':'✅','Отменён':'❌' };
        const list = ords.slice(0,5).map(function(o) {
          return (ico[o.status]||'📦') + ' #' + o.id + ' — ' + o.total.toLocaleString('ru') + ' ₽\n   ' + o.date + ' · ' + o.status;
        }).join('\n\n');
        await msg(chatId, '📦 <b>Ваши заказы:</b>\n\n' + list, { reply_markup: backKb() });
      }
      return;
    }

    if (text === '/referral') {
      if (!user) { await msg(chatId, '⚠️ Напишите /start'); return; }
      const link = 'https://t.me/venets_bot?start=' + user.refCode;
      await msg(chatId,
        '🔗 <b>Ваша ссылка:</b>\n<code>' + link + '</code>\n\n' +
        'За каждого друга: <b>+1000 🌹</b>\nПриглашено: <b>' + user.referred + '</b>',
        { reply_markup: { inline_keyboard: [
          [{ text: '📤 Поделиться', url: 'https://t.me/share/url?url=' + encodeURIComponent(link) }],
          [{ text: '← Назад', callback_data: 'cb_menu' }]
        ]}}
      );
      return;
    }

    if (text === '/admin') {
      await sendAdmin(chatId);
      return;
    }

    await msg(chatId, '🌸 <b>Venets Flowers</b>', { reply_markup: mainKb(user) });
  }

  // ── CALLBACK ───────────────────────────────────────────────────────────
  if (upd.callback_query) {
    const cb     = upd.callback_query;
    const chatId = cb.message.chat.id;
    const uid    = String(cb.from.id);
    const data   = cb.data;
    const user   = db.users[uid];
    await ack(cb.id);

    if (data === 'cb_menu') {
      await msg(chatId, '🌸 <b>Venets Flowers</b>', { reply_markup: mainKb(user) });
      return;
    }
    if (data === 'cb_petals') {
      await msg(chatId,
        '☘️ <b>Лепестки</b>\n\nУ вас: <b>' + ((user && user.petals) || 0) + '</b>\n\n' +
        '• 5% кэшбек с каждого заказа\n• Тратить до 75% суммы заказа\n• Обмен 3:1 → 🌹',
        { reply_markup: backKb() }
      );
      return;
    }
    if (data === 'cb_buds') {
      await msg(chatId,
        '🌹 <b>Бутоны</b>\n\nУ вас: <b>' + ((user && user.buds) || 0) + '</b>\n\n' +
        '• +1000 за каждого приглашённого\n• Вывод на СБП\n• Обмен 1:2 → ☘️',
        { reply_markup: backKb() }
      );
      return;
    }
    if (data === 'cb_orders') {
      const ords = (user && user.orders) || [];
      if (!ords.length) {
        await msg(chatId, '📦 Заказов нет', { reply_markup: { inline_keyboard: [
          [{ text: '🌸 В магазин', web_app: { url: WURL } }],
          [{ text: '← Назад', callback_data: 'cb_menu' }]
        ]}});
      } else {
        const ico = { 'В обработке':'⏳','Доставляется':'🚚','Доставлен':'✅','Отменён':'❌' };
        const list = ords.slice(0,5).map(function(o) {
          return (ico[o.status]||'📦') + ' #' + o.id + ' — ' + o.total.toLocaleString('ru') + ' ₽ · ' + o.status;
        }).join('\n');
        await msg(chatId, '📦 <b>Заказы:</b>\n\n' + list, { reply_markup: backKb() });
      }
      return;
    }
    if (data === 'cb_ref') {
      if (!user) { await msg(chatId, '⚠️ Напишите /start'); return; }
      const link = 'https://t.me/venets_bot?start=' + user.refCode;
      await msg(chatId,
        '🔗 <code>' + link + '</code>\n\nПриглашено: <b>' + user.referred + '</b>',
        { reply_markup: { inline_keyboard: [
          [{ text: '📤 Поделиться', url: 'https://t.me/share/url?url=' + encodeURIComponent(link) }],
          [{ text: '← Назад', callback_data: 'cb_menu' }]
        ]}}
      );
      return;
    }
    if (data === 'cb_support') {
      await msg(chatId,
        '🆘 <b>Поддержка</b>\n\nПн–Пт 9:00–21:00\n\n📞 +7 (495) 123-45-67',
        { reply_markup: backKb() }
      );
      return;
    }

    // Смена статуса заказа (адмін)
    var m = data.match(/^adm_(accept|deliver|done|cancel)_(\d+)$/);
    if (m) {
      var statMap = { accept:'В обработке', deliver:'Доставляется', done:'Доставлен', cancel:'Отменён' };
      var icoMap  = { accept:'✅', deliver:'🚚', done:'🎉', cancel:'❌' };
      var order   = db.orders.find(function(o) { return o.id === Number(m[2]); });
      if (!order) { await msg(chatId, '❌ Заказ не найден'); return; }
      order.status = statMap[m[1]];
      if (order.uid) await msg(order.uid, icoMap[m[1]] + ' Заказ <b>#' + order.id + '</b>: <b>' + order.status + '</b>');
      await msg(chatId, icoMap[m[1]] + ' #' + order.id + ' → <b>' + order.status + '</b>');
      return;
    }
    if (data === 'adm_orders') { await showAdminOrders(chatId); return; }
    if (data === 'adm_panel')  { await sendAdmin(chatId);       return; }
  }
}

async function sendAdmin(chatId) {
  const uc = Object.keys(db.users).length;
  const oc = db.orders.length;
  const rv = db.orders.reduce(function(a,o){ return a+(o.total||0); }, 0);
  const pn = db.orders.filter(function(o){ return o.status==='В обработке'; }).length;
  await msg(chatId,
    '⚙️ <b>Администратор</b>\n\n' +
    '👥 Клиентов: <b>' + uc + '</b>\n' +
    '📦 Заказов: <b>'  + oc + '</b>\n' +
    '⏳ Ожидают: <b>'  + pn + '</b>\n' +
    '💰 Выручка: <b>'  + rv.toLocaleString('ru') + ' ₽</b>',
    { reply_markup: { inline_keyboard: [
      [{ text: '📦 Новые заказы (' + pn + ')', callback_data: 'adm_orders' }],
      [{ text: '🌸 Открыть магазин', web_app: { url: WURL } }]
    ]}}
  );
}

async function showAdminOrders(chatId) {
  var list = db.orders.filter(function(o){ return o.status==='В обработке'; }).slice(0,5);
  if (!list.length) { await msg(chatId, '📦 Новых заказов нет'); return; }
  for (var i=0; i<list.length; i++) {
    var o = list[i];
    await msg(chatId,
      '📦 <b>#' + o.id + '</b> · ' + o.userName + '\n' +
      '💰 ' + o.total.toLocaleString('ru') + ' ₽\n📍 ' + o.address + '\n🕐 ' + o.date,
      { reply_markup: { inline_keyboard: [[
        { text:'✅', callback_data:'adm_accept_'+o.id  },
        { text:'🚚', callback_data:'adm_deliver_'+o.id },
        { text:'✔️', callback_data:'adm_done_'+o.id   },
        { text:'❌', callback_data:'adm_cancel_'+o.id  }
      ]]}}
    );
  }
}

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(200).end(JSON.stringify({ ok: true, info: 'venets webhook alive' }));
  }

  try { await handleUpdate(req.body); } catch(e) { console.error(e.message); }
  return res.status(200).end(JSON.stringify({ ok: true }));
};
