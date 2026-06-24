/**
 * seller.js — API кабинета продавца
 *
 * КЛЮЧИ В KV:
 *   sapp:<shortId>       — заявка (pending/approved/rejected)
 *   seller:<login>       — аккаунт продавца (логин/пароль/данные магазина)
 *   sellers:index        — массив логинов всех продавцов (для списка в админке)
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
  const base=(shopName||'seller').toLowerCase()
    .replace(/[^a-z]/g,'x').slice(0,6)||'seller';
  return base+'_'+Math.floor(Math.random()*9000+1000);
}
function makeShortId(){
  return String(Date.now()).slice(-8)+String(Math.floor(Math.random()*999)+1).padStart(3,'0');
}

async function addToSellerIndex(login){
  let idx = await dbGet('sellers:index').catch(()=>null);
  if(!Array.isArray(idx)) idx=[];
  if(!idx.includes(login)){ idx.push(login); await dbSet('sellers:index', idx, 60*60*24*365); }
}

// ── Одобрение: аккаунт уже существует (создан при подаче), просто активируем ──
async function handleApprove(shortId){
  const app = await dbGet('sapp:'+shortId).catch(()=>null);
  if(!app) return {ok:false, error:'not_found', shortId};
  if(app.status==='approved'){
    const existing = await dbGet('seller:'+app.login).catch(()=>null);
    return {ok:true, already:true, login:app.login, pass: existing?existing.password:app.pass};
  }

  // Аккаунт уже создан в момент 'apply' (см. ниже), просто меняем статус на active
  const seller = await dbGet('seller:'+app.login).catch(()=>null);
  if(seller){
    seller.status='active';
    await dbSet('seller:'+app.login, seller, 60*60*24*365);
  }
  app.status='approved';
  await dbSet('sapp:'+shortId, app, 60*60*24*30);

  // Уведомляем продавца — логин/пароль уже были созданы автоматически
  if(app.tgId && TOKEN){
    await tg('sendMessage',{
      chat_id: app.tgId, parse_mode:'HTML',
      text:
        `🎉 <b>Вам одобрили вступление!</b>\n\n`+
        `Добро пожаловать в Venets!\n\n`+
        `🔐 <b>Ваш временный логин и пароль:</b>\n\n`+
        `Логин: <code>${app.login}</code>\n`+
        `Пароль: <code>${seller?seller.password:app.pass}</code>\n\n`+
        `Войдите в кабинет продавца и начните работу. Рекомендуем сменить пароль в Настройках.`,
      reply_markup:{inline_keyboard:[[
        {text:'🏪 Открыть кабинет продавца', web_app:{url:WURL}}
      ]]}
    });
  }
  return {ok:true, login:app.login, pass: seller?seller.password:app.pass};
}

async function handleReject(shortId){
  const app = await dbGet('sapp:'+shortId).catch(()=>null);
  if(!app) return {ok:false};
  if(app.tgId && TOKEN){
    await tg('sendMessage',{
      chat_id:app.tgId, parse_mode:'HTML',
      text:`😔 <b>Заявка отклонена</b>\n\nК сожалению, на данный момент мы не можем принять вашу заявку. Вы можете обратиться в поддержку или подать заявку повторно позже.`
    });
  }
  app.status='rejected';
  await dbSet('sapp:'+shortId, app, 60*60*24*30);
  // Аккаунт остаётся неактивным (status:'pending'), вход запрещён до одобрения
  return {ok:true};
}

module.exports = async function(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end('{}');

  const { action, form, login, password, tgId, userName, shortId, appId,
          newLogin, newPassword, newShopName } = req.body || {};
  const sid = shortId || appId;

  // ── Подача заявки + АВТОСОЗДАНИЕ АККАУНТА ────────────────
  if(action==='apply' && form){
    const sid = makeShortId();
    const sellerLogin = mkLogin(form.shopName);
    const sellerPass  = mkPass();

    const app = { shortId:sid, ...form, tgId, userName, status:'pending',
      login:sellerLogin, pass:sellerPass, createdAt:Date.now() };
    await dbSet('sapp:'+sid, app, 60*60*24*30);

    // Аккаунт создаётся СРАЗУ на основе введённых данных, но неактивен до одобрения
    const sellerAcc = {
      login:sellerLogin, password:sellerPass,
      shopName:form.shopName, inn:form.inn, phone:form.phone, address:form.address,
      flowers:form.flowers||[], segment:form.segment, comment:form.comment||'',
      lat: form.lat?Number(form.lat):null, lon: form.lon?Number(form.lon):null,
      staticPaymentLink: form.staticPaymentLink||'',
      tgId, userName, status:'pending', // pending = не может войти, ждёт одобрения
      appId:sid, createdAt:Date.now()
    };
    await dbSet('seller:'+sellerLogin, sellerAcc, 60*60*24*365);
    await addToSellerIndex(sellerLogin);

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

      await tg('sendMessage',{
        chat_id:ADMIN, parse_mode:'HTML', text:txt,
        reply_markup:{inline_keyboard:[[
          {text:'✅ Принять', callback_data: 'sa_'+sid},
          {text:'❌ Отклонить', callback_data: 'sr_'+sid}
        ]]}
      });
    }
    return res.status(200).end(JSON.stringify({ok:true, shortId:sid}));
  }

  // ── Проверка статуса заявки (polling из WebApp) ──────────
  if(action==='check_app' && sid){
    const app = await dbGet('sapp:'+sid).catch(()=>null);
    if(!app) return res.status(200).end(JSON.stringify({ok:true, status:'pending'}));
    const seller = await dbGet('seller:'+app.login).catch(()=>null);
    return res.status(200).end(JSON.stringify({
      ok:true,
      status: app.status||'pending',
      login:  app.login||null,
      pass:   seller?seller.password:(app.pass||null)
    }));
  }

  // ── Одобрение / отклонение ───────────────────────────────
  if(action==='approve' && sid){
    return res.status(200).end(JSON.stringify(await handleApprove(sid)));
  }
  if(action==='reject' && sid){
    return res.status(200).end(JSON.stringify(await handleReject(sid)));
  }

  // ── Вход (требует status:'active' или 'approved') ────────
  if(action==='login' && login && password){
    const seller = await dbGet('seller:'+login).catch(()=>null);
    if(!seller || seller.password!==password){
      return res.status(200).end(JSON.stringify({ok:false, error:'wrong'}));
    }
    if(seller.status==='pending'){
      return res.status(200).end(JSON.stringify({ok:false, error:'not_approved'}));
    }
    if(seller.status==='blocked'){
      return res.status(200).end(JSON.stringify({ok:false, error:'blocked'}));
    }
    return res.status(200).end(JSON.stringify({
      ok:true,
      seller:{login, shopName:seller.shopName, segment:seller.segment, inn:seller.inn,
        phone:seller.phone, address:seller.address, flowers:seller.flowers,
        lat:seller.lat, lon:seller.lon, staticPaymentLink:seller.staticPaymentLink}
    }));
  }

  // ── Публичные данные продавца (для расчёта доставки клиентом) ──
  if(action==='get_public' && login){
    const seller = await dbGet('seller:'+login).catch(()=>null);
    if(!seller) return res.status(200).end(JSON.stringify({ok:false}));
    return res.status(200).end(JSON.stringify({
      ok:true,
      seller:{
        shopName:seller.shopName, lat:seller.lat, lon:seller.lon,
        staticPaymentLink:seller.staticPaymentLink||''
      }
    }));
  }

  // ── Список всех продавцов (для админки) ──────────────────
  if(action==='list_sellers'){
    const idx = await dbGet('sellers:index').catch(()=>null) || [];
    const sellers = [];
    for(const lg of idx){
      const s = await dbGet('seller:'+lg).catch(()=>null);
      if(s) sellers.push(s);
    }
    return res.status(200).end(JSON.stringify({ok:true, sellers}));
  }

  // ── Админ: изменить логин/пароль продавца ────────────────
  if(action==='admin_update_seller' && login){
    const seller = await dbGet('seller:'+login).catch(()=>null);
    if(!seller) return res.status(200).end(JSON.stringify({ok:false}));
    if(newPassword) seller.password=newPassword;
    if(newLogin && newLogin!==login){
      // Переносим под новым ключом
      seller.login=newLogin;
      await dbSet('seller:'+newLogin, seller, 60*60*24*365);
      await addToSellerIndex(newLogin);
      // Старый можно оставить помеченным как перемещённый (не критично)
    } else {
      await dbSet('seller:'+login, seller, 60*60*24*365);
    }
    return res.status(200).end(JSON.stringify({ok:true}));
  }

  // ── Админ: заблокировать продавца ────────────────────────
  if(action==='admin_block_seller' && login){
    const seller = await dbGet('seller:'+login).catch(()=>null);
    if(!seller) return res.status(200).end(JSON.stringify({ok:false}));
    seller.status='blocked';
    await dbSet('seller:'+login, seller, 60*60*24*365);
    return res.status(200).end(JSON.stringify({ok:true}));
  }

  // ── Селлер: обновить собственные настройки (название, логин, пароль) ──
  if(action==='update_settings' && login){
    const seller = await dbGet('seller:'+login).catch(()=>null);
    if(!seller) return res.status(200).end(JSON.stringify({ok:false,error:'not_found'}));
    if(newShopName) seller.shopName=newShopName;
    if(newPassword) seller.password=newPassword;
    if(req.body.newLat!==undefined) seller.lat = req.body.newLat?Number(req.body.newLat):null;
    if(req.body.newLon!==undefined) seller.lon = req.body.newLon?Number(req.body.newLon):null;
    if(req.body.newPaymentLink!==undefined) seller.staticPaymentLink = req.body.newPaymentLink;
    let finalLogin=login;
    if(newLogin && newLogin!==login){
      const exists = await dbGet('seller:'+newLogin).catch(()=>null);
      if(exists) return res.status(200).end(JSON.stringify({ok:false,error:'login_taken'}));
      seller.login=newLogin;
      await dbSet('seller:'+newLogin, seller, 60*60*24*365);
      await addToSellerIndex(newLogin);
      finalLogin=newLogin;
    } else {
      await dbSet('seller:'+login, seller, 60*60*24*365);
    }
    return res.status(200).end(JSON.stringify({ok:true, seller:{
      login:finalLogin, shopName:seller.shopName, segment:seller.segment,
      lat:seller.lat, lon:seller.lon, staticPaymentLink:seller.staticPaymentLink
    }}));
  }

  return res.status(200).end(JSON.stringify({ok:false, error:'unknown_action'}));
};

module.exports.handleApprove = handleApprove;
module.exports.handleReject  = handleReject;
