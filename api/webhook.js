const TOKEN = process.env.BOT_TOKEN;
const WURL  = (process.env.WEBAPP_URL||'').replace(/\/+$/,'');
const ADMIN = '1146926337';
const TG    = 'https://api.telegram.org/bot'+TOKEN;
const { dbGet, dbSet } = require('./db');

if(!global._vStore) global._vStore={orders:{},chats:{},pending:{}};
const store=global._vStore;

async function api(method,body){
  try{
    const r=await fetch(TG+'/'+method,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
    });
    return r.json();
  }catch(e){console.error('TG API error:',e.message);return {ok:false};}
}

// ── Уведомления ─────────────────────────────────────────────────────────────
async function notifyAdminNewOrder(order){
  const items=Object.entries(order.items||{}).map(([id,qty])=>'· '+id+' × '+qty).join('\n');
  await api('sendMessage',{chat_id:ADMIN,parse_mode:'HTML',
    text:'🌸 <b>Новый заказ №'+order.id+'</b>\n\n👤 <b>'+(order.userName||'—')+'</b>\n📞 '+(order.userPhone||'—')+'\n💰 Сумма: <b>'+((order.total||0).toLocaleString('ru'))+' ₽</b>\n🛒 Состав:\n'+items+'\n📍 '+(order.address||'—'),
    reply_markup:{inline_keyboard:[
      [{text:'⚙️ Открыть AdminWebApp',web_app:{url:WURL+'?admin=1'}}],
      [{text:'🌸 Открыть магазин',web_app:{url:WURL}}]
    ]}
  });
}
async function notifyAdminPaid(orderId){
  await api('sendMessage',{chat_id:ADMIN,parse_mode:'HTML',
    text:'💰 <b>Заказ №'+orderId+' оплачен!</b>',
    reply_markup:{inline_keyboard:[[{text:'✅ Подтвердить в WebApp',web_app:{url:WURL}}]]}
  });
}
async function notifyAdminChat(chatId,topic,user){
  await api('sendMessage',{chat_id:ADMIN,parse_mode:'HTML',
    text:'💬 <b>Новый чат №'+chatId+'</b>\nТема: '+topic+'\n👤 '+(user.name||'—')+'\n📞 '+(user.phone||'—')});
}
async function notifyAdminChatMsg(chatId,topic){
  await api('sendMessage',{chat_id:ADMIN,text:'💬 Новое сообщение: чат №'+chatId+' ('+topic+')'});
}
async function notifyUserReply(userTgId,chatId){
  if(!userTgId)return;
  try{
    await api('sendMessage',{chat_id:userTgId,
      text:'💬 Новый ответ в обращении №'+chatId+'\nОткройте магазин:',
      reply_markup:{inline_keyboard:[[{text:'🌸 Открыть',web_app:{url:WURL}}]]}
    });
  }catch(e){}
}

// ── Одобрение/отклонение заявки продавца — прямо из webhook через dbGet/dbSet ──
// Это надёжнее HTTP self-call, т.к. работает в том же инстансе с тем же KV
async function approveSellerApp(shortId){
  const app = await dbGet('sapp:'+shortId).catch(()=>null);
  if(!app) return {ok:false, error:'not_found'};
  if(app.status==='approved') return {ok:true, login:app.login, pass:app.pass};

  // Активируем аккаунт (он уже создан при apply с status:'pending')
  const seller = await dbGet('seller:'+app.login).catch(()=>null);
  if(seller){ seller.status='active'; await dbSet('seller:'+app.login, seller, 60*60*24*365); }
  app.status='approved';
  await dbSet('sapp:'+shortId, app, 60*60*24*30);

  // TG-уведомление продавцу
  if(app.tgId && TOKEN){
    await api('sendMessage',{
      chat_id:app.tgId, parse_mode:'HTML',
      text:
        `🎉 <b>Вам одобрили вступление в Venets!</b>\n\n`+
        `🏪 <b>${app.shopName}</b>\n\n`+
        `🔐 <b>Ваш логин и временный пароль:</b>\n\n`+
        `Логин: <code>${app.login}</code>\n`+
        `Пароль: <code>${seller?seller.password:app.pass}</code>\n\n`+
        `Войдите в кабинет продавца и смените пароль в Настройках.`,
      reply_markup:{inline_keyboard:[[{text:'🏪 Открыть кабинет продавца',web_app:{url:WURL}}]]}
    });
  }
  return {ok:true, login:app.login, pass: seller?seller.password:app.pass};
}

async function rejectSellerApp(shortId){
  const app = await dbGet('sapp:'+shortId).catch(()=>null);
  if(!app) return {ok:false};
  app.status='rejected';
  await dbSet('sapp:'+shortId, app, 60*60*24*30);
  if(app.tgId && TOKEN){
    await api('sendMessage',{chat_id:app.tgId, parse_mode:'HTML',
      text:`😔 <b>Заявка на вступление отклонена</b>\n\nК сожалению, мы не можем принять вашу заявку в данный момент. Обратитесь в поддержку или подайте заявку повторно позже.`
    });
  }
  return {ok:true};
}

// ── Обработчик callback_query ─────────────────────────────────────────────
async function handleCallback(cbq){
  const data  = cbq.data||'';
  const msgId = cbq.message?.message_id;
  const chatId= cbq.message?.chat?.id;

  // 1. СРАЗУ отвечаем Telegram — иначе кнопка зависает ("часики")
  api('answerCallbackQuery',{callback_query_id:cbq.id,text:'Обрабатываем...'}).catch(()=>{});

  if(data.startsWith('sa_')||data.startsWith('sr_')){
    const approve = data.startsWith('sa_');
    const shortId = data.slice(3);

    // Убираем кнопки сразу (fire-and-forget)
    api('editMessageReplyMarkup',{chat_id:chatId,message_id:msgId,reply_markup:{inline_keyboard:[]}}).catch(()=>{});

    try{
      const result = approve ? await approveSellerApp(shortId) : await rejectSellerApp(shortId);
      if(approve){
        if(result.ok){
          await api('sendMessage',{chat_id:chatId, parse_mode:'HTML',
            text:
              `✅ <b>Заявка одобрена!</b>\n\n`+
              `Логин: <code>${result.login}</code>\n`+
              `Пароль: <code>${result.pass}</code>\n\n`+
              `Продавец получил уведомление в Telegram.`
          });
        }else{
          await api('sendMessage',{chat_id:chatId, parse_mode:'HTML',
            text:`⚠️ Ошибка: ${result.error||'unknown'} (shortId: ${shortId})\n\nПопробуйте обработать заявку через панель /api/status`
          });
        }
      }else{
        await api('sendMessage',{chat_id:chatId, parse_mode:'HTML',
          text:`❌ <b>Заявка отклонена.</b> Продавец получил уведомление.`
        });
      }
    }catch(e){
      console.error('[webhook] seller callback err:',e.message);
      await api('sendMessage',{chat_id:chatId,text:'⚠️ Ошибка обработки: '+e.message});
    }
    return;
  }
}

// ── Основной обработчик ───────────────────────────────────────────────────
module.exports=async function(req,res){
  res.setHeader('Content-Type','application/json');
  if(req.method==='GET') return res.status(200).end(JSON.stringify({ok:true,info:'webhook alive'}));
  if(req.method!=='POST') return res.status(200).end(JSON.stringify({ok:true}));

  try{
    const upd=req.body;

    if(upd&&upd.callback_query){
      await handleCallback(upd.callback_query);
      return res.status(200).end(JSON.stringify({ok:true}));
    }

    if(upd&&upd.message){
      const chatId=upd.message.chat.id;
      const text=upd.message.text||'';
      if(text.startsWith('/start')||text==='/help'){
        await api('sendMessage',{chat_id:chatId,parse_mode:'HTML',
          text:'🌸 <b>Venets Flowers</b>\n\nДоставка цветов и подарков по Москве!',
          reply_markup:{inline_keyboard:[[{text:'🌸 Открыть магазин',web_app:{url:WURL}}]]}
        });
      }else{
        await api('sendMessage',{chat_id:chatId,text:'🌸 Откройте магазин:',
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
