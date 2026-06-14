/**
 * seller.js — API для кабинета продавца
 * Действия: apply, login, approve, reject
 */
const { dbGet, dbSet } = require('./db');
const TOKEN = process.env.BOT_TOKEN || '';
const WURL  = (process.env.WEBAPP_URL || '').replace(/\/+$/, '');
const ADMIN  = process.env.ADMIN_TG_ID || '1146926337';
const TG    = 'https://api.telegram.org/bot' + TOKEN;

async function tg(method, body) {
  try {
    const r = await fetch(`${TG}/${method}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    return r.json();
  } catch(e) { return {ok:false}; }
}

function mkPass(len=10){ const c='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; let r=''; for(let i=0;i<len;i++)r+=c[Math.floor(Math.random()*c.length)]; return r; }

module.exports = async function(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end('{}');

  const { action, form, login, password, tgId, userName, appId } = req.body || {};

  // ── Подача заявки ───────────────────────────────────────
  if (action === 'apply' && form) {
    const id = 'seller_app_' + Date.now();
    const app = { id, ...form, tgId, userName, status: 'pending', createdAt: Date.now() };
    await dbSet(id, app, 60*60*24*30);

    // Список всех заявок
    let apps = await dbGet('seller:apps') || [];
    apps.push(id);
    await dbSet('seller:apps', apps, 60*60*24*30);

    // Уведомление админу
    if (TOKEN) {
      const flowers = (form.flowers||[]).join(', ') || '—';
      const txt = `🏪 <b>Новая заявка продавца</b>\n\n` +
        `🏷 <b>${form.shopName||'—'}</b>\n` +
        `📋 ИНН: <code>${form.inn||'—'}</code>\n` +
        `📞 ${form.phone||'—'}\n` +
        `📍 ${form.address||'—'}\n` +
        `🌸 Ассортимент: ${flowers}\n` +
        `💰 Сегмент: ${form.segment||'—'}\n` +
        `💬 Комментарий: ${form.comment||'—'}\n\n` +
        `👤 Telegram: ${userName||'—'} (ID: ${tgId||'—'})`;
      await tg('sendMessage', {
        chat_id: ADMIN, parse_mode: 'HTML', text: txt,
        reply_markup: { inline_keyboard: [[
          { text: '✅ Принять', callback_data: 'seller_approve_' + id },
          { text: '❌ Отклонить', callback_data: 'seller_reject_' + id }
        ]]}
      });
    }
    return res.status(200).end(JSON.stringify({ ok: true }));
  }

  // ── Одобрение/отклонение (через webhook callback) ──────
  if (action === 'approve' && appId) {
    const app = await dbGet(appId);
    if (!app) return res.status(200).end(JSON.stringify({ ok: false }));
    const login = app.shopName.slice(0,6).toLowerCase().replace(/\s/g,'') + Math.floor(Math.random()*9000+1000);
    const pass = mkPass();
    await dbSet('seller:' + login, { ...app, login, password: pass, status: 'approved' }, 60*60*24*365);
    app.status = 'approved';
    await dbSet(appId, app, 60*60*24*30);
    // Отправляем логин/пароль продавцу
    if (app.tgId && TOKEN) {
      await tg('sendMessage', {
        chat_id: app.tgId, parse_mode: 'HTML',
        text: `🎉 <b>Ваша заявка одобрена!</b>\n\nДобро пожаловать в Venets!\n\n🔐 <b>Данные для входа:</b>\nЛогин: <code>${login}</code>\nПароль: <code>${pass}</code>\n\nОткройте приложение и войдите в кабинет продавца:`,
        reply_markup: { inline_keyboard: [[{ text: '🏪 Открыть кабинет', web_app: { url: WURL } }]]}
      });
    }
    return res.status(200).end(JSON.stringify({ ok: true }));
  }

  if (action === 'reject' && appId) {
    const app = await dbGet(appId);
    if (app && app.tgId && TOKEN) {
      await tg('sendMessage', {
        chat_id: app.tgId, parse_mode: 'HTML',
        text: `😔 <b>Ваша заявка отклонена</b>\n\nК сожалению, мы не можем принять вашу заявку на данный момент. Вы можете подать новую заявку позже.`
      });
      app.status = 'rejected';
      await dbSet(appId, app, 60*60*24*30);
    }
    return res.status(200).end(JSON.stringify({ ok: true }));
  }

  // ── Вход ───────────────────────────────────────────────
  if (action === 'login' && login && password) {
    const seller = await dbGet('seller:' + login);
    if (!seller || seller.password !== password) {
      return res.status(200).end(JSON.stringify({ ok: false, error: 'wrong' }));
    }
    return res.status(200).end(JSON.stringify({ ok: true, seller: { login, shopName: seller.shopName, segment: seller.segment } }));
  }

  return res.status(200).end(JSON.stringify({ ok: false }));
};
