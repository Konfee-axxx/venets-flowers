const TOKEN = process.env.BOT_TOKEN || '';
const TG = 'https://api.telegram.org/bot' + TOKEN;

// Храним коды в памяти (TTL 10 мин)
if (!global._phoneCodes) global._phoneCodes = {};
const CODES = global._phoneCodes;

async function findTgUserByPhone(phone) {
  // Telegram не даёт искать по телефону напрямую из бота.
  // Вместо этого используем кастомный подход:
  // Бот отправляет код в чат если пользователь ранее написал боту.
  // Для демо: код сохраняется и пользователь вводит его в WebApp.
  return null;
}

module.exports = async function(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end('{}');

  const { phone } = req.body || {};
  if (!phone) return res.status(200).end(JSON.stringify({ ok: false, error: 'no phone' }));

  // Генерируем 5-значный код
  const code = String(Math.floor(10000 + Math.random() * 90000));
  const expires = Date.now() + 10 * 60 * 1000; // 10 мин

  CODES[phone] = { code, expires };

  const clean = phone.replace(/\D/g, '');

  // Пробуем отправить через бота (если пользователь писал боту)
  // Telegram Bot API не позволяет отправлять сообщение по номеру телефона,
  // только по chat_id. Поэтому отправляем администратору с кодом для ручной передачи,
  // и дополнительно сохраняем код чтобы WebApp мог его верифицировать.

  const ADMIN = process.env.ADMIN_CHAT_ID || '1146926337';

  try {
    if (TOKEN) {
      await fetch(`${TG}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: ADMIN,
          text: `🔐 Код подтверждения для ${phone}:\n\n<b>${code}</b>\n\nИстекает через 10 минут.`,
          parse_mode: 'HTML'
        })
      });
    }
  } catch(e) {}

  // Возвращаем код клиенту для dev-режима (в продакшене убрать code из ответа)
  return res.status(200).end(JSON.stringify({
    ok: true,
    // В продакшене убрать следующую строку:
    devCode: process.env.NODE_ENV !== 'production' ? code : undefined,
    message: 'Код отправлен'
  }));
};
