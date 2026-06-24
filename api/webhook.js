const TOKEN = process.env.BOT_TOKEN;
const WURL  = (process.env.WEBAPP_URL||'').replace(/\/+$/,'');
const ADMIN = '1146926337';
const TG    = 'https://api.telegram.org/bot'+TOKEN;
const { dbGet, dbSet } = require('./db');

if(!global._vStore) global._vStore={};
const store=global._vStore;

async function api(method,body){
  try{
    const r=await fetch(TG+'/'+method,{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    return r.json();
  }catch(e){console.error('TG err:',e.message);return {ok:false};}
}

// ── Уведомления ──────────────────────────────────────────────────────────────
async function notifyAdminNewOrder(order){
  const items=Object.entries(order.items||{}).map(([id,qty])=>'· '+id+' × '+qty).join('\n');
  await api('sendMessage',{chat_id:ADMIN,parse_mode:'HTML',
    text:'🌸 <b>Новый заказ №'+order.id+'</b>\n\n'+
         '👤 <b>'+(order.userName||'—')+'</b>\n'+
         '📞 '+(order.userPhone||'—')+'\n'+
         '💰 <b>'+((order.total||0).toLocaleString('ru'))+' ₽</b>\n'+
         '🛒 Состав:\n'+items+'\n'+
         '📍 '+(order.address||'—'),
    reply_markup:{inline_keyboard:[
      [{text:'⚙️ Открыть AdminWebApp',web_app:{url:WURL+'?admin=1'}}],
      [{text:'🌸 Открыть магазин',web_app:{url:WURL}}]
    ]}
  });
}
async function notifyAdminPaid(orderId){
  await api('sendMessage',{chat_id:ADMIN,parse_mode:'HTML',
    text:'💰 <b>Заказ №'+orderId+' оплачен!</b>',
    reply_markup:{inline_keyboard:[[{text:'✅ Подтвердить',web_app:{url:WURL+'?admin=1'}}]]}
  });
}
async function notifyAdminChat(chatId,topic,user){
  await api('sendMessage',{chat_id:ADMIN,parse_mode:'HTML',
    text:'💬 <b>Новый чат №'+chatId+'</b>\nТема: '+topic+'\n👤 '+(user.name||'—')});
}
async function notifyAdminChatMsg(chatId,topic){
  await api('sendMessage',{chat_id:ADMIN,
    text:'💬 Новое сообщение: чат №'+chatId+' ('+topic+')'});
}
async function notifyUserReply(userTgId,chatId){
  if(!userTgId)return;
  try{
    await api('sendMessage',{chat_id:userTgId,
      text:'💬 Новый ответ в обращении №'+chatId,
      reply_markup:{inline_keyboard:[[{text:'🌸 Открыть',web_app:{url:WURL}}]]}});
  }catch(e){}
}

// ── Одобрение/отклонение — принимает данные прямо из callback_data ──────────
// Не зависит от KV/памяти: всё нужное закодировано в payload кнопки.
// Формат callback_data: "sa_LOGIN|PASS|TGID|SID" или "sa_SID" (fallback)
async function approveSellerApp(login, pass, sellerTgId, sid){
  // 1. Активируем аккаунт в KV (если KV подключён — отлично, если нет — пишем в память)
  try{
    const seller = await dbGet('seller:'+login).catch(()=>null) || {};
    seller.status = 'active';
    seller.login  = seller.login || login;
    seller.password = seller.password || pass;
    await dbSet('seller:'+login, seller, 60*60*24*365);
  }catch(e){ console.error('[approve] seller update err:',e.message); }

  // 2. Обновляем запись заявки (если есть)
  if(sid){
    try{
      const app = await dbGet('sapp:'+sid).catch(()=>null);
      if(app){ app.status='approved'; await dbSet('sapp:'+sid, app, 60*60*24*30); }
    }catch(e){}
  }

  // 3. Уведомляем продавца — всегда работает, даже без KV
  const tgId = sellerTgId || (sid ? (await dbGet('sapp:'+sid).catch(()=>null))?.tgId : null);
  if(tgId && TOKEN){
    await api('sendMessage',{
      chat_id:tgId, parse_mode:'HTML',
      text:
        `🎉 <b>Вам одобрили вступление в Venets!</b>\n\n`+
        `🔐 <b>Ваши данные для входа:</b>\n\n`+
        `Логин: <code>${login}</code>\n`+
        `Пароль: <code>${pass}</code>\n\n`+
        `Войдите в кабинет и смените пароль в Настройках.`,
      reply_markup:{inline_keyboard:[[
        {text:'🏪 Открыть кабинет продавца',web_app:{url:WURL}}
      ]]}
    });
  }
  return {ok:true, login, pass};
}

async function rejectSellerApp(login, sellerTgId, sid){
  // Обновляем статус если знаем sid
  if(sid){
    try{
      const app = await dbGet('sapp:'+sid).catch(()=>null);
      if(app){ app.status='rejected'; await dbSet('sapp:'+sid, app, 60*60*24*30); }
    }catch(e){}
  }
  if(login){
    try{
      const seller = await dbGet('seller:'+login).catch(()=>null);
      if(seller){ seller.status='rejected'; await dbSet('seller:'+login, seller, 60*60*24*365); }
    }catch(e){}
  }
  const tgId = sellerTgId || (sid ? (await dbGet('sapp:'+sid).catch(()=>null))?.tgId : null);
  if(tgId && TOKEN){
    await api('sendMessage',{chat_id:tgId, parse_mode:'HTML',
      text:`😔 <b>Заявка отклонена</b>\n\nК сожалению, на данный момент мы не можем принять вашу заявку. Обратитесь в поддержку или подайте заявку позже.`
    });
  }
  return {ok:true};
}

// ── Callback query handler ────────────────────────────────────────────────────
async function handleCallback(cbq){
  const data  = cbq.data||'';
  const msgId = cbq.message?.message_id;
  const chatId= cbq.message?.chat?.id;

  // СРАЗУ отвечаем Telegram — иначе кнопка зависает
  api('answerCallbackQuery',{callback_query_id:cbq.id}).catch(()=>{});

  if(data.startsWith('sa_')||data.startsWith('sr_')){
    const approve = data.startsWith('sa_');
    const payload = data.slice(3); // убираем "sa_" или "sr_"

    // Убираем кнопки (fire-and-forget)
    api('editMessageReplyMarkup',{
      chat_id:chatId,message_id:msgId,reply_markup:{inline_keyboard:[]}
    }).catch(()=>{});

    // Парсим payload: LOGIN|PASS|TGID|SID или просто SID
    const parts = payload.split('|');
    const hasFullPayload = parts.length >= 2;
    const login   = hasFullPayload ? parts[0] : null;
    const pass    = hasFullPayload ? parts[1] : null;
    const tgId    = hasFullPayload ? (parts[2]||null) : null;
    const sid     = hasFullPayload ? (parts[3]||null) : payload;

    console.log('[webhook] callback:', approve?'approve':'reject',
      'login:', login, 'sid:', sid, 'hasFullPayload:', hasFullPayload);

    try{
      if(approve){
        if(!login){
          // Fallback: нет данных в payload — пробуем найти в KV
          const app = await dbGet('sapp:'+sid).catch(()=>null);
          if(!app){
            await api('sendMessage',{chat_id:chatId,parse_mode:'HTML',
              text:'⚠️ Заявка не найдена (sid: <code>'+sid+'</code>).\n\nКV не подключён или данные устарели. Подключите Vercel KV в Dashboard → Storage.'});
            return;
          }
          const result = await approveSellerApp(app.login, app.pass||app.password, app.tgId, sid);
          await api('sendMessage',{chat_id:chatId, parse_mode:'HTML',
            text:`✅ <b>Одобрено!</b>\n\nЛогин: <code>${result.login}</code>\nПароль: <code>${result.pass}</code>`});
        } else {
          const result = await approveSellerApp(login, pass, tgId, sid);
          await api('sendMessage',{chat_id:chatId, parse_mode:'HTML',
            text:`✅ <b>Одобрено!</b>\n\nЛогин: <code>${result.login}</code>\nПароль: <code>${result.pass}</code>\n\nПродавец получил уведомление в Telegram.`});
        }
      } else {
        let sellerTgId = tgId;
        if(!sellerTgId && sid){
          const app = await dbGet('sapp:'+sid).catch(()=>null);
          sellerTgId = app?.tgId || null;
        }
        await rejectSellerApp(login, sellerTgId, sid);
        await api('sendMessage',{chat_id:chatId, parse_mode:'HTML',
          text:'❌ <b>Заявка отклонена.</b>\nПродавец получил уведомление.'});
      }
    }catch(e){
      console.error('[webhook] callback err:',e.message);
      await api('sendMessage',{chat_id:chatId,
        text:'⚠️ Ошибка: '+e.message});
    }
    return;
  }
}

// ── Основной handler ──────────────────────────────────────────────────────────
module.exports = async function(req,res){
  res.setHeader('Content-Type','application/json');
  if(req.method==='GET') return res.status(200).end(JSON.stringify({ok:true,info:'webhook alive'}));
  if(req.method!=='POST') return res.status(200).end(JSON.stringify({ok:true}));

  try{
    const upd=req.body;
    if(upd?.callback_query){
      await handleCallback(upd.callback_query);
      return res.status(200).end(JSON.stringify({ok:true}));
    }
    if(upd?.message){
      const chatId=upd.message.chat.id;
      const text=upd.message.text||'';
      if(text.startsWith('/start')||text==='/help'){
        await api('sendMessage',{chat_id:chatId,parse_mode:'HTML',
          text:'🌸 <b>Venets Flowers</b>\n\nДоставка цветов и подарков по Москве!',
          reply_markup:{inline_keyboard:[[{text:'🌸 Открыть магазин',web_app:{url:WURL}}]]}
        });
      } else {
        await api('sendMessage',{chat_id:chatId,
          text:'🌸 Откройте магазин:',
          reply_markup:{inline_keyboard:[[{text:'🌸 Открыть',web_app:{url:WURL}}]]}
        });
      }
    }
  }catch(e){console.error('webhook err:',e.message);}

  return res.status(200).end(JSON.stringify({ok:true}));
};

module.exports.store=store;
module.exports.notifyAdminNewOrder=notifyAdminNewOrder;
module.exports.notifyAdminPaid=notifyAdminPaid;
module.exports.notifyAdminChat=notifyAdminChat;
module.exports.notifyAdminChatMsg=notifyAdminChatMsg;
module.exports.notifyUserReply=notifyUserReply;
