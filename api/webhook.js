const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// In-memory хранилище (сбрасывается при cold start — для прода нужен Vercel KV)
if (!global._vdb) {
  global._vdb = { users: {}, orders: [] };
}
const db = global._vdb;

// ── утилиты ──────────────────────────────────────────────
async function send(chatId, text, extra = {}) {
  await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...extra })
  });
}

async function answerCb(id, text = '') {
  await fetch(`${API}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: id, text })
  });
}

// ── клавиатуры ────────────────────────────────────────────
function mainKb(user) {
  return {
    inline_keyboard: [
      [{ text: '🌸 Открыть магазин', web_app: { url: WEBAPP_URL } }],
      [
        { text: `☘️ ${(user?.petals || 0).toLocaleString('ru')} лепестков`, callback_data: 'points' },
        { text: `🌹 ${(user?.buds || 0).toLocaleString('ru')} бутонов`, callback_data: 'buds' }
      ],
      [
        { text: '📦 Мои заказы', callback_data: 'orders' },
        { text: '🔗 Рефералка', callback_data: 'referral' }
      ],
      [{ text: '🆘 Поддержка', callback_data: 'support' }]
    ]
  };
}

function backKb() {
  return { inline_keyboard: [[{ text: '← Назад', callback_data: 'menu' }]] };
}

// ── обработчик обновлений ─────────────────────────────────
async function handleUpdate(upd) {

  // ── Сообщение ─────────────────────────────────────────
  if (upd.message) {
    const msg = upd.message;
    const chatId = msg.chat.id;
    const userId = String(msg.from.id);
    const text = msg.text || '';
    const firstName = msg.from.first_name || 'Друг';

    let user = db.users[userId];

    // /start
    if (text.startsWith('/start')) {
      const refCode = text.split(' ')[1];

      if (!user) {
        const code = 'VNT' + Math.random().toString(36).slice(2, 8).toUpperCase();
        user = {
          id: userId, name: firstName,
          username: msg.from.username || '',
          petals: 1000, buds: 0,
          refCode: code, referred: 0,
          orders: [], regDate: new Date().toLocaleDateString('ru')
        };
        db.users[userId] = user;

        // Начисляем пригласившему
        if (refCode) {
          const ref = Object.values(db.users).find(u => u.refCode === refCode && u.id !== userId);
          if (ref) {
            ref.buds = (ref.buds || 0) + 1000;
            ref.referred = (ref.referred || 0) + 1;
            await send(ref.id, `🎉 По вашей ссылке зарегистрировался новый пользователь!\n💰 Вам начислено <b>+1000 🌹 бутонов</b>`);
          }
        }

        await send(chatId,
          `🌸 <b>Добро пожаловать в Venets Flowers, ${firstName}!</b>\n\n` +
          `🎁 За регистрацию вам начислено <b>1000 ☘️ лепестков</b>!\n\n` +
          `Нажмите кнопку ниже, чтобы открыть магазин 👇`,
          { reply_markup: mainKb(user) }
        );
        return;
      }

      await send(chatId,
        `🌸 <b>С возвращением, ${user.name}!</b>\n\n` +
        `☘️ Лепестки: <b>${user.petals.toLocaleString('ru')}</b>\n` +
        `🌹 Бутоны: <b>${user.buds.toLocaleString('ru')}</b>`,
        { reply_markup: mainKb(user) }
      );
      return;
    }

    // /balance
    if (text === '/balance') {
      if (!user) { await send(chatId, '⚠️ Сначала напишите /start'); return; }
      await send(chatId,
        `💰 <b>Ваш баланс</b>\n\n` +
        `☘️ Лепестки: <b>${user.petals.toLocaleString('ru')}</b>\n` +
        `🌹 Бутоны: <b>${user.buds.toLocaleString('ru')}</b>`,
        { reply_markup: backKb() }
      );
      return;
    }

    // /orders
    if (text === '/orders') {
      if (!user) { await send(chatId, '⚠️ Сначала напишите /start'); return; }
      const ords = user.orders || [];
      if (!ords.length) {
        await send(chatId, '📦 Пока нет заказов. Откройте магазин! 🌸', {
          reply_markup: { inline_keyboard: [[{ text: '🌸 Открыть магазин', web_app: { url: WEBAPP_URL } }]] }
        });
      } else {
        const em = { 'В обработке': '⏳', 'Доставляется': '🚚', 'Доставлен': '✅', 'Отменён': '❌' };
        const list = ords.slice(0, 5).map(o =>
          `${em[o.status] || '📦'} <b>#${o.id}</b> — ${o.total.toLocaleString('ru')} ₽\n   ${o.date} · ${o.status}`
        ).join('\n\n');
        await send(chatId, `📦 <b>Ваши заказы:</b>\n\n${list}`, { reply_markup: backKb() });
      }
      return;
    }

    // /referral
    if (text === '/referral') {
      if (!user) { await send(chatId, '⚠️ Сначала напишите /start'); return; }
      const link = `https://t.me/venets_bot?start=${user.refCode}`;
      await send(chatId,
        `🔗 <b>Ваша реферальная ссылка:</b>\n\n<code>${link}</code>\n\n` +
        `За каждого друга: <b>+1000 🌹 бутонов</b>\n` +
        `Приглашено: <b>${user.referred}</b>`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📤 Поделиться', url: `https://t.me/share/url?url=${encodeURIComponent(link)}` }],
              [{ text: '← Назад', callback_data: 'menu' }]
            ]
          }
        }
      );
      return;
    }

    // /admin
    if (text === '/admin') {
      await sendAdminPanel(chatId);
      return;
    }

    // Дефолт
    await send(chatId, `🌸 <b>Venets Flowers</b>\n\nВыберите действие:`, { reply_markup: mainKb(user) });
  }

  // ── Callback кнопки ────────────────────────────────────
  if (upd.callback_query) {
    const cb = upd.callback_query;
    const chatId = cb.message.chat.id;
    const userId = String(cb.from.id);
    const data = cb.data;
    const user = db.users[userId];
    await answerCb(cb.id);

    if (data === 'menu') {
      await send(chatId, `🌸 <b>Venets Flowers</b>`, { reply_markup: mainKb(user) });
      return;
    }

    if (data === 'points') {
      await send(chatId,
        `☘️ <b>Лепестки</b>\n\nУ вас: <b>${(user?.petals || 0).toLocaleString('ru')} ☘️</b>\n\n` +
        `• Получаете 5% кэшбек с каждого заказа\n` +
        `• Тратите при покупке (до 75% от суммы)\n` +
        `• Обмен на 🌹 бутоны по курсу 3:1`,
        { reply_markup: backKb() }
      );
      return;
    }

    if (data === 'buds') {
      await send(chatId,
        `🌹 <b>Бутоны</b>\n\nУ вас: <b>${(user?.buds || 0).toLocaleString('ru')} 🌹</b>\n\n` +
        `• За каждого приглашённого друга: <b>1000 бутонов</b>\n` +
        `• Можно вывести деньгами (СБП)\n` +
        `• Обмен на ☘️ лепестки по курсу 1:2`,
        { reply_markup: backKb() }
      );
      return;
    }

    if (data === 'orders') {
      const ords = user?.orders || [];
      if (!ords.length) {
        await send(chatId, '📦 Пока нет заказов.', {
          reply_markup: { inline_keyboard: [[{ text: '🌸 В магазин', web_app: { url: WEBAPP_URL } }], [{ text: '← Назад', callback_data: 'menu' }]] }
        });
      } else {
        const em = { 'В обработке': '⏳', 'Доставляется': '🚚', 'Доставлен': '✅', 'Отменён': '❌' };
        const list = ords.slice(0, 5).map(o =>
          `${em[o.status] || '📦'} #${o.id} — ${o.total.toLocaleString('ru')} ₽ · ${o.status}`
        ).join('\n');
        await send(chatId, `📦 <b>Ваши заказы:</b>\n\n${list}`, { reply_markup: backKb() });
      }
      return;
    }

    if (data === 'referral') {
      if (!user) { await send(chatId, '⚠️ Сначала /start'); return; }
      const link = `https://t.me/venets_bot?start=${user.refCode}`;
      await send(chatId,
        `🔗 <b>Ваша реферальная ссылка:</b>\n<code>${link}</code>\n\nПриглашено: <b>${user.referred}</b>`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📤 Поделиться', url: `https://t.me/share/url?url=${encodeURIComponent(link)}` }],
              [{ text: '← Назад', callback_data: 'menu' }]
            ]
          }
        }
      );
      return;
    }

    if (data === 'support') {
      await send(chatId,
        `🆘 <b>Поддержка</b>\n\nРаботаем: пн–пт 9:00–21:00, сб–вс 10:00–20:00\n\n📞 +7 (495) 123-45-67`,
        { reply_markup: backKb() }
      );
      return;
    }

    // Админские callback
    if (data.startsWith('adm_')) {
      await handleAdmin(chatId, data);
      return;
    }
  }

  // ── Данные из Web App ──────────────────────────────────
  if (upd.message?.web_app_data) {
    const chatId = upd.message.chat.id;
    const userId = String(upd.message.from.id);
    try {
      const data = JSON.parse(upd.message.web_app_data.data);
      if (data.type === 'order') {
        const user = db.users[userId];
        const order = {
          id: Date.now(),
          userId,
          userName: user?.name || 'Гость',
          phone: user?.phone || '—',
          total: data.total,
          items: data.items,
          status: 'В обработке',
          date: new Date().toLocaleDateString('ru'),
          address: data.address || user?.addr || '—'
        };
        db.orders.unshift(order);
        if (user) {
          if (!user.orders) user.orders = [];
          user.orders.unshift(order);
          const earned = Math.floor(data.total * 0.05);
          user.petals = (user.petals || 0) + earned;
        }
        await send(chatId,
          `✅ <b>Заказ #${order.id} оформлен!</b>\n\n` +
          `💰 Сумма: <b>${data.total.toLocaleString('ru')} ₽</b>\n` +
          `📍 Адрес: ${order.address}\n` +
          `⏳ Статус: В обработке\n\n` +
          `☘️ Начислен кэшбек: <b>+${Math.floor(data.total * 0.05)}</b>`,
          { reply_markup: mainKb(user) }
        );

        if (process.env.ADMIN_CHAT_ID) {
          await send(process.env.ADMIN_CHAT_ID,
            `🔔 <b>Новый заказ #${order.id}</b>\n` +
            `👤 ${order.userName} · ${order.phone}\n` +
            `💰 ${order.total.toLocaleString('ru')} ₽\n` +
            `📍 ${order.address}`,
            {
              reply_markup: {
                inline_keyboard: [[
                  { text: '✅ Принять', callback_data: `adm_accept_${order.id}` },
                  { text: '🚚 Доставка', callback_data: `adm_deliver_${order.id}` },
                  { text: '❌ Отмена', callback_data: `adm_cancel_${order.id}` }
                ]]
              }
            }
          );
        }
      }
    } catch (e) {
      console.error('web_app_data error:', e.message);
    }
  }
}

// ── Панель администратора ──────────────────────────────────
async function sendAdminPanel(chatId) {
  const uCount = Object.keys(db.users).length;
  const oCount = db.orders.length;
  const rev = db.orders.reduce((a, o) => a + (o.total || 0), 0);
  const pending = db.orders.filter(o => o.status === 'В обработке').length;

  await send(chatId,
    `⚙️ <b>Панель администратора</b>\n\n` +
    `👥 Клиентов: <b>${uCount}</b>\n` +
    `📦 Заказов: <b>${oCount}</b>\n` +
    `⏳ Ожидают: <b>${pending}</b>\n` +
    `💰 Выручка: <b>${rev.toLocaleString('ru')} ₽</b>`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: `📦 Новые заказы (${pending})`, callback_data: 'adm_orders' }],
          [{ text: '👥 Клиенты', callback_data: 'adm_users' }],
          [{ text: '🌸 Открыть магазин', web_app: { url: WEBAPP_URL } }]
        ]
      }
    }
  );
}

async function handleAdmin(chatId, data) {
  if (data === 'adm_orders') {
    const list = db.orders.filter(o => o.status === 'В обработке').slice(0, 5);
    if (!list.length) { await send(chatId, '📦 Нет новых заказов!'); return; }
    for (const o of list) {
      await send(chatId,
        `📦 <b>#${o.id}</b>\n👤 ${o.userName}\n💰 ${o.total.toLocaleString('ru')} ₽\n📍 ${o.address}\n🕐 ${o.date}`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: '✅', callback_data: `adm_accept_${o.id}` },
              { text: '🚚', callback_data: `adm_deliver_${o.id}` },
              { text: '✔️', callback_data: `adm_done_${o.id}` },
              { text: '❌', callback_data: `adm_cancel_${o.id}` }
            ]]
          }
        }
      );
    }
    return;
  }

  if (data === 'adm_users') {
    const users = Object.values(db.users).slice(0, 10);
    if (!users.length) { await send(chatId, '👥 Клиентов пока нет.'); return; }
    const list = users.map(u => `👤 <b>${u.name}</b> · ☘️${u.petals} 🌹${u.buds} · заказов: ${u.orders?.length || 0}`).join('\n');
    await send(chatId, `👥 <b>Клиенты (${users.length}):</b>\n\n${list}`);
    return;
  }

  // Смена статуса заказа
  const m = data.match(/^adm_(accept|deliver|done|cancel)_(\d+)$/);
  if (m) {
    const map = { accept: 'В обработке', deliver: 'Доставляется', done: 'Доставлен', cancel: 'Отменён' };
    const ico = { accept: '✅', deliver: '🚚', done: '🎉', cancel: '❌' };
    const order = db.orders.find(o => o.id === Number(m[2]));
    if (!order) { await send(chatId, '❌ Заказ не найден'); return; }
    order.status = map[m[1]];
    if (order.userId) {
      await send(order.userId, `${ico[m[1]]} Статус заказа <b>#${order.id}</b> обновлён: <b>${order.status}</b>`);
    }
    await send(chatId, `${ico[m[1]]} Заказ #${order.id} → <b>${order.status}</b>`);
  }
}

// ── Vercel handler ─────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, message: 'Venets Flowers бот работает!' });
  }

  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true });
  }

  try {
    await handleUpdate(req.body);
  } catch (e) {
    console.error('webhook error:', e.message);
  }

  return res.status(200).json({ ok: true });
};
