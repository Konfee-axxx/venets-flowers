const TOKEN   = process.env.BOT_TOKEN;
const WURL    = (process.env.WEBAPP_URL||'').replace(/\/+$/,'');
const ADMIN   = '1146926337';
const TG      = 'https://api.telegram.org/bot'+TOKEN;

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

async function notifyAdminNewOrder(order){
  const items=Object.entries(order.items||{})
    .map(([id,qty])=>'· '+id+' × '+qty).join('\n');
  const txt=
    '🌸 <b>Новый заказ №'+order.id+'</b>\n\n'+
    '👤 <b>'+(order.userName||'—')+'</b>\n'+
    '📞 '+(order.userPhone||'—')+'\n'+
    '💰 Сумма: <b>'+((order.total||0).toLocaleString('ru'))+' ₽</b>\n'+
    '🛒 Состав:\n'+items+'\n'+
    '📍 '+(order.address||'—')+'\n\n'+
    '⚠️ <i>Откройте WebApp → Панель → Заказы</i>';
  await api('sendMessage',{chat_id:ADMIN,text:txt,parse_mode:'HTML',
    reply_markup:{inline_keyboard:[
      [{text:'⚙️ Открыть админку',web_app:{url:WURL+'?admin=1'}}],
      [{text:'🌸 Открыть магазин',web_app:{url:WURL}}]
    ]}
  });
}

async function notifyAdminPaid(orderId){
  await api('sendMessage',{chat_id:ADMIN,parse_mode:'HTML',
    text:'💰 <b>Заказ №'+orderId+' оплачен!</b>\n\nПроверьте получение средств в WebApp.',
    reply_markup:{inline_keyboard:[[{text:'✅ Подтвердить в WebApp',web_app:{url:WURL}}]]}
  });
}

async function notifyAdminChat(chatId,topic,user){
  await api('sendMessage',{chat_id:ADMIN,parse_mode:'HTML',
    text:'💬 <b>Новый чат №'+chatId+'</b>\nТема: '+topic+'\n👤 '+(user.name||'—')+'\n📞 '+(user.phone||'—')
  });
}

async function notifyAdminChatMsg(chatId,topic){
  await api('sendMessage',{chat_id:ADMIN,
    text:'💬 Новое сообщение: чат №'+chatId+' ('+topic+')'});
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

async function handleCallback(cbq){
  const data  = cbq.data || '';
  const msgId = cbq.message?.message_id;
  const chatId= cbq.message?.chat?.id;

  if(data.startsWith('seller_approve_')||data.startsWith('seller_reject_')){
    const approve = data.startsWith('seller_approve_');
    const appId   = data.replace(/^seller_(approve|reject)_/,'');

    // Убираем кнопки сразу чтобы не нажали дважды
    await api('editMessageReplyMarkup',{
      chat_id:chatId, message_id:msgId,
      reply_markup:{inline_keyboard:[]}
    });
    await api('answerCallbackQuery',{callback_query_id:cbq.id});

    try{
      const seller = require('./seller');
      if(approve){
        const res = await seller.handleApprove(appId);
        await api('sendMessage',{chat_id:chatId,parse_mode:'HTML',
          text: res.ok
            ? `✅ <b>Заявка одобрена!</b>\n\nЛогин: <code>${res.login}</code>\nПароль: <code>${res.pass}</code>\n\nПродавец получил уведомление в Telegram.`
            : '⚠️ Ошибка при одобрении заявки: '+( res.error||'unknown')
        });
      }else{
        await seller.handleReject(appId);
        await api('sendMessage',{chat_id:chatId,parse_mode:'HTML',
          text:'❌ <b>Заявка отклонена.</b>\n\nПродавец получил уведомление в Telegram.'
        });
      }
    }catch(e){
      console.error('seller callback err:',e.message);
      await api('sendMessage',{chat_id:chatId,text:'⚠️ Ошибка: '+e.message});
    }
    return;
  }

  await api('answerCallbackQuery',{callback_query_id:cbq.id});
}

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
