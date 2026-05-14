/**
 * referral.js — API реферальной системы
 * 
 * Хранит реферальные коды пользователей в Vercel KV.
 * 
 * Действия:
 *   register { code, tgId, name }      — регистрирует код при создании аккаунта
 *   check    { code }                  — проверяет существование кода
 *   use      { code, newUserName }     — фиксирует использование кода, уведомляет владельца
 */

const { dbGet, dbSet } = require('./db');

const TOKEN = process.env.BOT_TOKEN || '';
const WURL  = (process.env.WEBAPP_URL || '').replace(/\/+$/, '');
const TG    = 'https://api.telegram.org/bot' + TOKEN;

async function tg(method, body) {
  try {
    const r = await fetch(`${TG}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return r.json();
  } catch(e) { return { ok: false }; }
}

module.exports = async function(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end('{}');

  const { action, code, tgId, name, newUserName } = req.body || {};

  // ── Регистрация кода ───────────────────────────────────────────
  if (action === 'register' && code) {
    const key = `ref:${code.toUpperCase()}`;
    const existing = await dbGet(key).catch(() => null);
    if (!existing) {
      await dbSet(key, { code: code.toUpperCase(), tgId: tgId || null, name: name || 'Пользователь', uses: 0 }, 60 * 60 * 24 * 365);
    }
    return res.status(200).end(JSON.stringify({ ok: true }));
  }

  // ── Проверка кода ─────────────────────────────────────────────
  if (action === 'check' && code) {
    const key = `ref:${code.toUpperCase()}`;
    let data = null;
    try { data = await dbGet(key); } catch(e) {}
    return res.status(200).end(JSON.stringify({ ok: true, valid: !!data }));
  }

  // ── Использование кода ────────────────────────────────────────
  if (action === 'use' && code) {
    const key = `ref:${code.toUpperCase()}`;
    let data = null;
    try { data = await dbGet(key); } catch(e) {}

    if (!data) {
      return res.status(200).end(JSON.stringify({ ok: false, error: 'not_found' }));
    }

    // Обновляем счётчик
    data.uses = (data.uses || 0) + 1;
    await dbSet(key, data, 60 * 60 * 24 * 365);

    // Уведомляем пригласившего в Telegram
    if (data.tgId && TOKEN) {
      const friendName = newUserName || 'Новый пользователь';
      await tg('sendMessage', {
        chat_id: data.tgId,
        parse_mode: 'HTML',
        text: `🎉 <b>По вашему реферальному коду пришёл новый клиент!</b>\n\n👤 ${friendName} зарегистрировался по вашему коду <code>${code.toUpperCase()}</code>\n\n🌹 <b>Вам начислено 1000 бутонов!</b>\n\nОткройте магазин, чтобы проверить баланс:`,
        reply_markup: {
          inline_keyboard: [[{ text: '🌸 Открыть магазин', web_app: { url: WURL } }]]
        }
      });
    }

    return res.status(200).end(JSON.stringify({ ok: true, uses: data.uses }));
  }

  return res.status(200).end(JSON.stringify({ ok: false, error: 'unknown_action' }));
};
