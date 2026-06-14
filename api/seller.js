/**
 * seller.js — API кабинета продавца
 */
const { dbGet, dbSet, dbScan } = require('./db');
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
  const base=(shopName||'seller').toLowerCase()
    .replace(/[^a-z]/g,'x').slice(0,6)||'seller';
  return base+'_'+Math.floor(Math.random()*9000+1000);
}

// Короткий числовой ID вместо длинного appId для callback_data
function makeShortId(){
  return String(Date.now()).slice(-8)+String(Math.floor(Math.random()*999)+1).padStart(3,'0');
}

async function handleApprove(shortId){
  console.log('[seller] approve shortId:', shortId);
  
  // Ищем заявку по shortId
  const app = await dbGet('sapp:'+shortId).catch(()=>null);
  console.log('[seller] found app:', app ? 'yes' : 'null');
  
  if(!app) return {ok:false, error:'not_found', shortId};
  if(app.status==='approved') return {ok:true, already:true, login:app.login, pass:app.pass};

  const login = mkLogin(app.shopName);
  const pass  = mkPass();
  const seller = { ...app, login, password:pass, status:'approved', approvedAt:Date.now() };

  await dbSet('seller:'+login, seller, 60*60*24*365);
  app.status='approved'; app.login=login; app.pass=pass;
  await dbSet('sapp:'+shortId, app, 60*60*24*30);

  // Уведомляем продавца
  if(app.tgId && TOKEN){
    await tg('sendMessage',{
      chat_id: app.tgId, parse_mode:'HTML',
      text:
        `🎉 <b>Ваша заявка одобрена!</b>\n\n`+
        `Добро пожаловать в Venets!\n\n`+
        `🔐 <b>Данные для входа в кабинет продавца:</b>\n\n`+
        `Логин: <code>${login}</code>\n`+
        `Пароль: <code>${pass}</code>\n\n`+
        `Сохраните эти данные и войдите в кабинет:`,
      reply_markup:{inline_keyboard:[[
        {text:'🏪 Открыть кабинет продавца', web_app:{url:WURL}}
      ]]}
    });
  }
  return {ok:true, login, pass};
}

async function handleReject(shortId){
  const app = await dbGet('sapp:'+shortId).catch(()=>null);
  if(!app) return {ok:false};
  if(app.tgId && TOKEN){
    await tg('sendMessage',{
      chat_id:app.tgId, parse_mode:'HTML',
      text:`😔 <b>Ваша заявка отклонена</b>\n\nК сожалению, на данный момент мы не можем принять вашу заявку. Вы можете обратиться в поддержку или подать заявку повторно позже.`
    });
  }
  app.status='rejected';
  await dbSet('sapp:'+shortId, app, 60*60*24*30);
  return {ok:true};
}

module.exports = async function(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end('{}');

  const { action, form, login, password, tgId, userName, shortId, appId } = req.body || {};
  const sid = shortId || appId; // поддержка обоих полей

  // ── Подача заявки ─────────────────────────────────────────
  if(action==='apply' && form){
    const sid = makeShortId();
    const app = { shortId:sid, ...form, tgId, userName, status:'pending', createdAt:Date.now() };
    
    // Сохраняем под коротким ключом
    await dbSet('sapp:'+sid, app, 60*60*24*30);
    console.log('[seller] saved app sapp:'+sid);

    // Уведомление администратору
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
        `🆔 <code>${sid}</code>`;
      
      const cbApprove = 'sa_'+sid;   // "sa" = seller approve
      const cbReject  = 'sr_'+sid;   // "sr" = seller reject
      console.log('[seller] callback_data lengths:', cbApprove.length, cbReject.length);
      
      await tg('sendMessage',{
        chat_id:ADMIN, parse_mode:'HTML', text:txt,
        reply_markup:{inline_keyboard:[[
          {text:'✅ Принять', callback_data: cbApprove},
          {text:'❌ Отклонить', callback_data: cbReject}
        ]]}
      });
    }
    return res.status(200).end(JSON.stringify({ok:true, shortId:sid}));
  }

  // ── Проверка статуса заявки (polling из WebApp) ──────────
  if(action==='check_app' && sid){
    const app = await dbGet('sapp:'+sid).catch(()=>null);
    if(!app) return res.status(200).end(JSON.stringify({ok:true, status:'pending'}));
    return res.status(200).end(JSON.stringify({
      ok:true,
      status: app.status||'pending',
      login:  app.login||null,
      pass:   app.pass||null
    }));
  }

  // ── Одобрение ─────────────────────────────────────────────
  if(action==='approve' && sid){
    const result = await handleApprove(sid);
    return res.status(200).end(JSON.stringify(result));
  }

  // ── Отклонение ────────────────────────────────────────────
  if(action==='reject' && sid){
    const result = await handleReject(sid);
    return res.status(200).end(JSON.stringify(result));
  }

  // ── Вход ─────────────────────────────────────────────────
  if(action==='login' && login && password){
    const seller = await dbGet('seller:'+login).catch(()=>null);
    if(!seller || seller.password!==password){
      return res.status(200).end(JSON.stringify({ok:false, error:'wrong'}));
    }
    return res.status(200).end(JSON.stringify({
      ok:true,
      seller:{login, shopName:seller.shopName, segment:seller.segment, inn:seller.inn}
    }));
  }

  return res.status(200).end(JSON.stringify({ok:false, error:'unknown_action'}));
};

module.exports.handleApprove = handleApprove;
module.exports.handleReject  = handleReject;
