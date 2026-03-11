// api/webhook.js
// Vercel Serverless Function — обрабатывает сообщения от Telegram

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL; // Ваш Vercel URL

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ==================== БАЗА ДАННЫХ (KV через Vercel) ====================
// Мы используем простой in-memory стор для демо.
// Для продакшна подключите Vercel KV или PlanetScale.
// Данные хранятся в памяти между запросами (не персистентно для демо).
// Подключение Vercel KV описано в README.

const db = global._db || (global._db = {
  users: {},    // { telegramId: { name, phone, petals, buds, refCode, addr, orders: [] } }
  orders: [],   // все заказы
  admins: ['AdminAdmin'], // список admin username
});

// ==================== УТИЛИТЫ ====================
async function sendMessage(chatId, text, extra = {}) {
  const body = { chat_id: chatId, text, parse_mode: 'HTML', ...extra };
  const res = await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function answerCallback(callbackQueryId, text = '') {
  await fetch(`${API}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

async function editMessage(chatId, messageId, text, extra = {}) {
  const body = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', ...body2(extra) };
  await fetch(`${API}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function body2(extra){ return extra; }

// ==================== КЛАВИАТУРЫ ====================
function mainKeyboard(user) {
  return {
    inline_keyboard: [
      [{ text: '🌸 Открыть магазин', web_app: { url: WEBAPP_URL } }],
      [
        { text: '☘️ ' + (user?.petals || 0) + ' лепестков', callback_data: 'my_points' },
        { text: '🌹 ' + (user?.buds || 0) + ' бутонов', callback_data: 'my_buds' }
      ],
      [
        { text: '📦 Мои заказы', callback_data: 'my_orders' },
        { text: '🔗 Рефералка', callback_data: 'referral' }
      ],
      [{ text: '📞 Поддержка', callback_data: 'support' }]
    ]
  };
}

function backKeyboard() {
  return {
    inline_keyboard: [[{ text: '← Назад в меню', callback_data: 'main_menu' }]]
  };
}

// ==================== ОБРАБОТЧИК ====================
async function handleUpdate(update) {
  // Сообщение
  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text || '';
    const firstName = msg.from.first_name || 'Друг';

    // Получаем или создаём пользователя
    let user = db.users[userId];

    // /start — приветствие
    if (text.startsWith('/start')) {
      const refCode = text.split(' ')[1]; // /start REF_CODE

      if (!user) {
        // Новый пользователь
        const myCode = 'VNT' + Math.random().toString(36).slice(2, 8).toUpperCase();
        user = {
          id: userId,
          name: firstName,
          username: msg.from.username || '',
          petals: 0,
          buds: 0,
          refCode: myCode,
          referred: 0,
          orders: [],
          regDate: new Date().toISOString(),
        };
        db.users[userId] = user;

        // Начисляем бутоны тому, кто пригласил
        if (refCode) {
          const referrer = Object.values(db.users).find(u => u.refCode === refCode);
          if (referrer && referrer.id !== userId) {
            referrer.buds = (referrer.buds || 0) + 1000;
            referrer.referred = (referrer.referred || 0) + 1;
            await sendMessage(referrer.id,
              `🎉 По вашей реферальной ссылке зарегистрировался новый пользователь!\n` +
              `💰 Вам начислено <b>+1000 🌹 бутонов</b>`
            );
          }
        }

        await sendMessage(chatId,
          `🌸 <b>Добро пожаловать в Venets Flowers, ${firstName}!</b>\n\n` +
          `Мы рады видеть тебя в нашем магазине цветов и подарков 💐\n\n` +
          `🎁 За регистрацию тебе уже начислено <b>1000 ☘️ лепестков</b> — это стартовый бонус!\n\n` +
          `Открой магазин, чтобы выбрать букет или подарок 👇`,
          { reply_markup: mainKeyboard({ petals: 1000, buds: 0 }) }
        );

        // Обновляем лепестки
        user.petals = 1000;
        return;
      }

      // Уже зарегистрирован
      await sendMessage(chatId,
        `🌸 <b>С возвращением, ${user.name}!</b>\n\n` +
        `Твой баланс:\n` +
        `☘️ <b>${(user.petals || 0).toLocaleString('ru')} лепестков</b>\n` +
        `🌹 <b>${(user.buds || 0).toLocaleString('ru')} бутонов</b>\n\n` +
        `Открой магазин и выбери что-нибудь красивое 💐`,
        { reply_markup: mainKeyboard(user) }
      );
      return;
    }

    // /admin — панель администратора
    if (text === '/admin') {
      if (!user) { await sendMessage(chatId, '⚠️ Сначала зарегистрируйтесь: /start'); return; }
      await sendAdminPanel(chatId, userId);
      return;
    }

    // /stats — статистика
    if (text === '/stats') {
      const usersCount = Object.keys(db.users).length;
      const ordersCount = db.orders.length;
      const revenue = db.orders.reduce((a, o) => a + (o.total || 0), 0);
      await sendMessage(chatId,
        `📊 <b>Статистика магазина</b>\n\n` +
        `👥 Клиентов: <b>${usersCount}</b>\n` +
        `📦 Заказов: <b>${ordersCount}</b>\n` +
        `💰 Выручка: <b>${revenue.toLocaleString('ru')} ₽</b>`
      );
      return;
    }

    // /balance — баланс
    if (text === '/balance') {
      if (!user) { await sendMessage(chatId, '⚠️ Сначала зарегистрируйтесь: /start'); return; }
      await sendMessage(chatId,
        `💰 <b>Твой баланс</b>\n\n` +
        `☘️ Лепестки: <b>${(user.petals || 0).toLocaleString('ru')}</b>\n` +
        `🌹 Бутоны: <b>${(user.buds || 0).toLocaleString('ru')}</b>\n\n` +
        `<i>Лепестки тратятся на скидки (до 75% от заказа)\n` +
        `Бутоны можно вывести деньгами (СБП)</i>`,
        { reply_markup: backKeyboard() }
      );
      return;
    }

    // По умолчанию — меню
    await sendMessage(chatId,
      `🌸 <b>Venets Flowers</b>\n\nВыберите действие:`,
      { reply_markup: mainKeyboard(user) }
    );
  }

  // Callback кнопки
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message.chat.id;
    const userId = cb.from.id;
    const data = cb.data;
    const user = db.users[userId];

    await answerCallback(cb.id);

    if (data === 'main_menu') {
      await sendMessage(chatId,
        `🌸 <b>Venets Flowers</b>\n\nВыберите действие:`,
        { reply_markup: mainKeyboard(user) }
      );
      return;
    }

    if (data === 'my_points') {
      await sendMessage(chatId,
        `☘️ <b>Лепестки</b>\n\n` +
        `У тебя: <b>${(user?.petals || 0).toLocaleString('ru')} ☘️</b>\n\n` +
        `<b>Как получить:</b>\n` +
        `• 5% кэшбек с каждой покупки\n` +
        `• Бонус за первый заказ\n\n` +
        `<b>Как потратить:</b>\n` +
        `• До 75% от суммы заказа\n` +
        `• Автоматически при оформлении\n\n` +
        `<b>Обмен ☘️→🌹:</b> курс 3:1`,
        { reply_markup: backKeyboard() }
      );
      return;
    }

    if (data === 'my_buds') {
      await sendMessage(chatId,
        `🌹 <b>Бутоны</b>\n\n` +
        `У тебя: <b>${(user?.buds || 0).toLocaleString('ru')} 🌹</b>\n\n` +
        `<b>Как получить:</b>\n` +
        `• За каждого приглашённого друга: от <b>1000 бутонов</b>\n\n` +
        `<b>Как потратить:</b>\n` +
        `• Вывести деньгами через СБП\n` +
        `• Обменять на ☘️ лепестки (курс 1:2)\n` +
        `• Потратить на покупки`,
        { reply_markup: backKeyboard() }
      );
      return;
    }

    if (data === 'my_orders') {
      const orders = user?.orders || [];
      if (!orders.length) {
        await sendMessage(chatId,
          `📦 <b>Мои заказы</b>\n\nУ тебя пока нет заказов.\n\nОткрой магазин и сделай первый заказ! 🌸`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🌸 Открыть магазин', web_app: { url: WEBAPP_URL } }],
                [{ text: '← Назад', callback_data: 'main_menu' }]
              ]
            }
          }
        );
      } else {
        const statusEmoji = { 'В обработке': '⏳', 'Доставляется': '🚚', 'Доставлен': '✅', 'Отменён': '❌' };
        const list = orders.slice(0, 5).map(o =>
          `${statusEmoji[o.status] || '📦'} <b>#${o.id}</b> — ${o.total?.toLocaleString('ru')} ₽\n` +
          `   ${o.date} · ${o.status}`
        ).join('\n\n');
        await sendMessage(chatId,
          `📦 <b>Мои заказы</b>\n\n${list}`,
          { reply_markup: backKeyboard() }
        );
      }
      return;
    }

    if (data === 'referral') {
      const code = user?.refCode || 'нет';
      const botUrl = `https://t.me/venets_bot?start=${code}`;
      await sendMessage(chatId,
        `🔗 <b>Реферальная программа</b>\n\n` +
        `Твой код: <code>${code}</code>\n\n` +
        `Твоя ссылка:\n<code>${botUrl}</code>\n\n` +
        `<b>За каждого приглашённого друга:</b>\n` +
        `💰 <b>1000 🌹 бутонов</b> — можно вывести деньгами!\n\n` +
        `Приглашено друзей: <b>${user?.referred || 0}</b>\n` +
        `Заработано бутонов: <b>${user?.buds || 0}</b>`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📤 Поделиться ссылкой', url: `https://t.me/share/url?url=${encodeURIComponent(botUrl)}&text=${encodeURIComponent('Цветы и подарки с доставкой 🌸')}` }],
              [{ text: '← Назад', callback_data: 'main_menu' }]
            ]
          }
        }
      );
      return;
    }

    if (data === 'support') {
      await sendMessage(chatId,
        `🆘 <b>Поддержка</b>\n\n` +
        `Мы работаем каждый день с 9:00 до 21:00\n\n` +
        `📞 Телефон: +7 (495) 123-45-67\n` +
        `📧 Email: support@venets.ru\n` +
        `💬 Напишите нам прямо здесь, и мы ответим в течение 15 минут`,
        { reply_markup: backKeyboard() }
      );
      return;
    }

    // Админские callback
    if (data.startsWith('admin_')) {
      await handleAdminCallback(chatId, userId, data);
      return;
    }
  }

  // Web App данные (заказ из Mini App)
  if (update.message?.web_app_data) {
    const chatId = update.message.chat.id;
    const userId = update.message.from.id;
    try {
      const data = JSON.parse(update.message.web_app_data.data);
      
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
          address: data.address || user?.addr || '—',
        };
        db.orders.unshift(order);
        if (user) {
          if (!user.orders) user.orders = [];
          user.orders.unshift(order);
          const earned = Math.floor(data.total * 0.05);
          user.petals = (user.petals || 0) + earned;
        }

        await sendMessage(chatId,
          `✅ <b>Заказ #${order.id} оформлен!</b>\n\n` +
          `💰 Сумма: <b>${data.total.toLocaleString('ru')} ₽</b>\n` +
          `📍 Адрес: ${order.address}\n` +
          `⏳ Статус: <b>В обработке</b>\n\n` +
          `☘️ Начислено лепестков: <b>+${Math.floor(data.total * 0.05)}</b>\n\n` +
          `Мы свяжемся с вами в ближайшее время!`,
          { reply_markup: mainKeyboard(user) }
        );

        // Уведомление администратору (если задан ADMIN_CHAT_ID)
        if (process.env.ADMIN_CHAT_ID) {
          await sendMessage(process.env.ADMIN_CHAT_ID,
            `🔔 <b>Новый заказ #${order.id}</b>\n\n` +
            `👤 Клиент: ${user?.name || 'Гость'} (${user?.phone || '—'})\n` +
            `💰 Сумма: <b>${data.total.toLocaleString('ru')} ₽</b>\n` +
            `📍 Адрес: ${order.address}\n` +
            `🕐 Время: ${new Date().toLocaleString('ru')}`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '✅ Принять', callback_data: `admin_accept_${order.id}` },
                    { text: '❌ Отменить', callback_data: `admin_cancel_${order.id}` }
                  ],
                  [{ text: '🚚 Передать курьеру', callback_data: `admin_deliver_${order.id}` }]
                ]
              }
            }
          );
        }
      }
    } catch (e) {
      console.error('Ошибка обработки web_app_data:', e);
    }
  }
}

// ==================== ПАНЕЛЬ АДМИНИСТРАТОРА ====================
async function sendAdminPanel(chatId, userId) {
  const usersCount = Object.keys(db.users).length;
  const ordersCount = db.orders.length;
  const revenue = db.orders.reduce((a, o) => a + (o.total || 0), 0);
  const pending = db.orders.filter(o => o.status === 'В обработке').length;

  await sendMessage(chatId,
    `⚙️ <b>Панель администратора</b>\n\n` +
    `📊 <b>Статистика:</b>\n` +
    `👥 Клиентов: <b>${usersCount}</b>\n` +
    `📦 Всего заказов: <b>${ordersCount}</b>\n` +
    `⏳ Ожидают обработки: <b>${pending}</b>\n` +
    `💰 Общая выручка: <b>${revenue.toLocaleString('ru')} ₽</b>`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📦 Новые заказы (' + pending + ')', callback_data: 'admin_orders' },
            { text: '👥 Клиенты', callback_data: 'admin_users' }
          ],
          [
            { text: '📊 Полная статистика', callback_data: 'admin_stats' },
            { text: '🌸 Открыть магазин', web_app: { url: WEBAPP_URL } }
          ]
        ]
      }
    }
  );
}

async function handleAdminCallback(chatId, userId, data) {
  if (data === 'admin_orders') {
    const pending = db.orders.filter(o => o.status === 'В обработке').slice(0, 10);
    if (!pending.length) {
      await sendMessage(chatId, '📦 Нет новых заказов!', { reply_markup: backKeyboard() });
      return;
    }
    for (const o of pending) {
      await sendMessage(chatId,
        `📦 <b>Заказ #${o.id}</b>\n` +
        `👤 ${o.userName} · ${o.phone}\n` +
        `💰 ${o.total?.toLocaleString('ru')} ₽\n` +
        `📍 ${o.address}\n` +
        `🕐 ${o.date}`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Принять', callback_data: `admin_accept_${o.id}` },
              { text: '🚚 Доставляется', callback_data: `admin_deliver_${o.id}` },
              { text: '❌ Отменить', callback_data: `admin_cancel_${o.id}` }
            ]]
          }
        }
      );
    }
    return;
  }

  if (data === 'admin_users') {
    const users = Object.values(db.users).slice(0, 10);
    if (!users.length) { await sendMessage(chatId, '👥 Нет клиентов пока.', { reply_markup: backKeyboard() }); return; }
    const list = users.map(u =>
      `👤 <b>${u.name}</b> (${u.username ? '@' + u.username : u.id})\n` +
      `   ☘️${u.petals || 0} · 🌹${u.buds || 0} · заказов: ${u.orders?.length || 0}`
    ).join('\n\n');
    await sendMessage(chatId, `👥 <b>Клиенты (${users.length}):</b>\n\n${list}`, { reply_markup: backKeyboard() });
    return;
  }

  if (data === 'admin_stats') {
    const revenue = db.orders.reduce((a, o) => a + (o.total || 0), 0);
    const avgOrder = db.orders.length ? Math.round(revenue / db.orders.length) : 0;
    await sendMessage(chatId,
      `📊 <b>Полная статистика</b>\n\n` +
      `👥 Клиентов: <b>${Object.keys(db.users).length}</b>\n` +
      `📦 Заказов: <b>${db.orders.length}</b>\n` +
      `💰 Выручка: <b>${revenue.toLocaleString('ru')} ₽</b>\n` +
      `📈 Средний чек: <b>${avgOrder.toLocaleString('ru')} ₽</b>\n` +
      `⏳ В обработке: <b>${db.orders.filter(o => o.status === 'В обработке').length}</b>\n` +
      `✅ Доставлено: <b>${db.orders.filter(o => o.status === 'Доставлен').length}</b>`,
      { reply_markup: backKeyboard() }
    );
    return;
  }

  // Смена статусов заказов
  const match = data.match(/^admin_(accept|deliver|cancel|done)_(\d+)$/);
  if (match) {
    const action = match[1];
    const orderId = parseInt(match[2]);
    const order = db.orders.find(o => o.id === orderId);
    if (!order) { await sendMessage(chatId, '❌ Заказ не найден'); return; }

    const statusMap = {
      accept: 'В обработке',
      deliver: 'Доставляется',
      cancel: 'Отменён',
      done: 'Доставлен',
    };
    const emojiMap = { accept: '✅', deliver: '🚚', cancel: '❌', done: '🎉' };
    order.status = statusMap[action];

    // Уведомляем клиента
    if (order.userId) {
      await sendMessage(order.userId,
        `${emojiMap[action]} <b>Статус заказа #${order.id} обновлён</b>\n\n` +
        `Новый статус: <b>${order.status}</b>`
      );
    }

    await sendMessage(chatId, `${emojiMap[action]} Заказ #${orderId} → <b>${order.status}</b>`);
    return;
  }
}

// ==================== VERCEL HANDLER ====================
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, message: 'Venets Flowers Bot работает!' });
  }

  try {
    await handleUpdate(req.body);
  } catch (err) {
    console.error('Ошибка обработки:', err);
  }

  res.status(200).json({ ok: true });
}
