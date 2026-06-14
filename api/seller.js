/**
 * seller.js — API кабинета продавца
 */
const { dbGet, dbSet } = require('./db');
const TOKEN = process.env.BOT_TOKEN || '';
const WURL  = (process.env.WEBAPP_URL || '').replace(/\/+$/, '');
const ADMIN = process.env.ADMIN_TG_ID || '1146926337';
const TG    = 'https://api.telegram.org/bot' + TOKEN;

async function tg(method, body) {
  try {
    const r = await fetch(`${TG}/${method}`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
    });
    return r.json();
  } catch(e) { return {ok:false}; }
}

function mkPass(len=10){
  const c='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let r='';for(let i=0;i<len;i++)r+=c[Math.floor(Math.random()*c.length)];return r;
}
function mkLogin(shopName){
  return (shopName||'seller').slice(0,8).toLowerCase()
    .replace(/[^a-zа-яё]/gi,'').replace(/[а-яё]/gi,'s')
    +'_'+Math.floor(Math.random()*9000+1000);
}

async function handleApprove(appId){
  const app = await dbGet(appId);
  if(!app) return {ok:false,error:'not_found'};
  if(app.status==='approved') return {ok:true,already:true,login:app.login};

  const login = mkLogin(app.shopName);
  const pass  = mkPass();
  const seller = { ...app, login, password:pass, status:'approved', approvedAt:Date.now() };

  await dbSet('seller:'+login, seller, 60*60*24*365);
  app.status='approved'; app.login=login; app.pass=pass;
  await dbSet(appId, app, 60*60*24*30);

  // Уведомляем продавца в Telegram
  if(app.tgId && TOKEN){
    await tg('sendMessage',{
      chat_id:app.tgId, parse_mode:'HTML',
      text:`🎉 <b>Ваша заявка одобрена!</b>\n\nДобро пожаловать в Venets!\n\n🔐 <b>Данные для входа в кабинет продавца:</b>\n\nЛогин: <code>${login}</code>\nПароль: <code>${pass}</code>\n\nСохраните эти данные и войдите в кабинет:`,
      reply_markup:{inline_keyboard:[[{text:'🏪 Открыть кабинет продавца',web_app:{url:WURL}}]]}
    });
  }
  return {ok:true,login,pass};
}

async function handleReject(appId){
  const app = await dbGet(appId);
  if(!app) return {ok:false};
  if(app.tgId && TOKEN){
    await tg('sendMessage',{
      chat_id:app.tgId, parse_mode:'HTML',
      text:`😔 <b>Ваша заявка отклонена</b>\n\nК сожалению, на данный момент мы не можем принять вашу заявку. Вы можете обратиться в поддержку или подать заявку повторно позже.`
    });
  }
  app.status='rejected';
  await dbSet(appId, app, 60*60*24*30);
  return {ok:true};
}

module.exports = async function(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end('{}');

  const { action, form, login, password, tgId, userName, appId } = req.body || {};

  // ── Подача заявки ─────────────────────────────────────────
  if(action==='apply' && form){
    const id = 'seller_app_'+Date.now()+'_'+Math.floor(Math.random()*9999);
    const app = { id, ...form, tgId, userName, status:'pending', createdAt:Date.now() };
    await dbSet(id, app, 60*60*24*30);

    let apps = await dbGet('seller:apps') || [];
    if(!Array.isArray(apps)) apps=[];
    apps.push(id);
    await dbSet('seller:apps', apps, 60*60*24*60);

    // Уведомление администратору с кнопками
    if(TOKEN){
      const flowers = (form.flowers||[]).join(', ')||'—';
      const txt =
        `🏪 <b>Новая заявка продавца</b>\n\n`+
        `🏷 <b>${form.shopName||'—'}</b>\n`+
        `📋 ИНН: <code>${form.inn||'—'}</code>\n`+
        `📞 ${form.phone||'—'}\n`+
        `📍 ${form.address||'—'}\n`+
        `🌸 Ассортимент: ${flowers}\n`+
        `💰 Сегмент: ${form.segment||'—'}\n`+
        `💬 ${form.comment||'—'}\n\n`+
        `👤 ${userName||'—'} (TG: ${tgId||'—'})\n`+
        `🆔 ID заявки: <code>${id}</code>`;
      await tg('sendMessage',{
        chat_id:ADMIN, parse_mode:'HTML', text:txt,
        reply_markup:{inline_keyboard:[[
          {text:'✅ Принять', callback_data:'seller_approve_'+id},
          {text:'❌ Отклонить', callback_data:'seller_reject_'+id}
        ]]}
      });
    }
    return res.status(200).end(JSON.stringify({ok:true, appId:id}));
  }

  // ── Проверка статуса заявки (polling из WebApp) ──────────
  if(action==='check_app' && appId){
    const app = await dbGet(appId).catch(()=>null);
    if(!app) return res.status(200).end(JSON.stringify({ok:true,status:'pending'}));
    return res.status(200).end(JSON.stringify({
      ok:true,
      status:app.status||'pending',
      login:app.login||null,
      pass:app.pass||null
    }));
  }

  // ── Одобрение (из webhook callback или вручную) ──────────
  if(action==='approve' && appId){
    const result = await handleApprove(appId);
    return res.status(200).end(JSON.stringify(result));
  }

  // ── Отклонение ────────────────────────────────────────────
  if(action==='reject' && appId){
    const result = await handleReject(appId);
    return res.status(200).end(JSON.stringify(result));
  }

  // ── Вход ─────────────────────────────────────────────────
  if(action==='login' && login && password){
    const seller = await dbGet('seller:'+login).catch(()=>null);
    if(!seller||seller.password!==password){
      return res.status(200).end(JSON.stringify({ok:false,error:'wrong'}));
    }
    return res.status(200).end(JSON.stringify({
      ok:true,
      seller:{login, shopName:seller.shopName, segment:seller.segment, inn:seller.inn}
    }));
  }

  return res.status(200).end(JSON.stringify({ok:false,error:'unknown_action'}));
};

// Экспортируем для вызова из webhook
module.exports.handleApprove = handleApprove;
module.exports.handleReject  = handleReject;
