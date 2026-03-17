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

// Уведомление администратору о новом заказе
async function notifyAdminNewOrder(order){
  const items=Object.entries(order.items||{})
    .map(([id,qty])=>'· '+id+' × '+qty).join('\n');
  const txt=
    '🌸 <b>Новый заказ №'+order.id+'</b>\n\n'+
    '👤 <b>'+( order.userName||'—')+'</b>\n'+
    '📞 '+(order.userPhone||'—')+'\n'+
    '💰 Сумма: <b>'+((order.total||0).toLocaleString('ru'))+' ₽</b>\n'+
    '🛒 Состав:\n'+items+'\n'+
    '📍 '+(order.address||'—')+'\n\n'+
    '⚠️ <i>Откройте WebApp → Панель → Заказы</i>';
  await api('sendMessage',{chat_id:ADMIN,text:txt,parse_mode:'HTML',
    reply_markup:{inline_keyboard:[[{text:'🌸 Открыть WebApp',web_app:{url:WURL+'/admin'}}]]}
  });
}

// Уведомление об оплате
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

module.exports=async function(req,res){
  res.setHeader('Content-Type','application/json');
  if(req.method==='GET') return res.status(200).end(JSON.stringify({ok:true,info:'webhook alive'}));
  if(req.method!=='POST') return res.status(200).end(JSON.stringify({ok:true}));

  try{
    const upd=req.body;
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
