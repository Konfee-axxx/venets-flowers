const TOKEN = process.env.BOT_TOKEN;
const WURL  = (process.env.WEBAPP_URL||'').replace(/\/+$/,'');
const ADMIN_ID = '1146926337';
const TG = 'https://api.telegram.org/bot'+TOKEN;

if(!global._vStore) global._vStore={orders:{},chats:{},pending:{}};
const store=global._vStore;

async function api(method,body){
  const r=await fetch(TG+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return r.json();
}

async function notifyAdminNewOrder(order){
  const items=Object.entries(order.items||{}).map(([id,qty])=>id+' × '+qty).join(', ');
  await api('sendMessage',{chat_id:ADMIN_ID,parse_mode:'HTML',
    text:'🌸 <b>Новый заказ №'+order.id+'</b>\n\n👤 '+(order.userName||'—')+'\n📞 '+(order.userPhone||'—')+'\n💰 <b>'+((order.total||0).toLocaleString('ru'))+' ₽</b>\n🛒 '+items+'\n📍 '+(order.address||'—'),
    reply_markup:{inline_keyboard:[[{text:'💳 Ввести реквизиты',callback_data:'req_'+order.id},{text:'❌ Отменить',callback_data:'cancel_'+order.id}]]}
  });
}

async function notifyAdminPaid(order){
  await api('sendMessage',{chat_id:ADMIN_ID,parse_mode:'HTML',
    text:'💰 <b>Заказ №'+order.id+' оплачен!</b>\n\nПроверьте получение денег.',
    reply_markup:{inline_keyboard:[[{text:'✅ Деньги получены',callback_data:'confirm_'+order.id},{text:'❌ Отменить',callback_data:'cancel_'+order.id}]]}
  });
}

async function notifyAdminChat(chatId,topic,user){
  await api('sendMessage',{chat_id:ADMIN_ID,parse_mode:'HTML',
    text:'💬 <b>Новый чат №'+chatId+'</b>\nТема: '+topic+'\n👤 '+(user.name||'—')+'\n📞 '+(user.phone||'—')
  });
}
async function notifyAdminChatMsg(chatId,topic){
  await api('sendMessage',{chat_id:ADMIN_ID,text:'💬 Новое сообщение в чате №'+chatId+' ('+topic+')'});
}
async function notifyUserReply(userTgId,chatId){
  if(!userTgId)return;
  try{await api('sendMessage',{chat_id:userTgId,text:'💬 Новый ответ на ваше обращение №'+chatId+'\n\nОткройте магазин.',reply_markup:{inline_keyboard:[[{text:'🌸 Открыть',web_app:{url:WURL}}]]}});}catch(e){}
}

module.exports=async function(req,res){
  res.setHeader('Content-Type','application/json');
  if(req.method!=='POST')return res.status(200).end(JSON.stringify({ok:true}));
  try{
    const upd=req.body;
    if(upd.message){
      const chatId=upd.message.chat.id;
      const text=upd.message.text||'';
      const isAdmin=String(chatId)===ADMIN_ID;
      if(text.startsWith('/start')){
        await api('sendMessage',{chat_id:chatId,text:'🌸 <b>Venets Flowers</b>\n\nОткройте магазин:',parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'🌸 Открыть магазин',web_app:{url:WURL}}]]}});
        return res.status(200).end(JSON.stringify({ok:true}));
      }
      if(isAdmin&&store.pending[chatId]&&store.pending[chatId].type==='req'){
        const ordId=store.pending[chatId].orderId;
        delete store.pending[chatId];
        const parts=text.split(',').map(s=>s.trim());
        if(parts.length>=3){
          const ord=store.orders[ordId];
          if(ord){ord.payBank=parts[0];ord.payName=parts[1];ord.payPhone=parts[2];ord.payReady=true;}
          await api('sendMessage',{chat_id:chatId,text:'✅ Реквизиты отправлены по заказу №'+ordId});
        }else{
          await api('sendMessage',{chat_id:chatId,text:'⚠️ Формат: Банк, Имя, Телефон\nПример: Сбербанк, Иван Иванов, +79001234567'});
        }
        return res.status(200).end(JSON.stringify({ok:true}));
      }
      await api('sendMessage',{chat_id:chatId,text:'🌸 Откройте магазин!',reply_markup:{inline_keyboard:[[{text:'🌸 Открыть магазин',web_app:{url:WURL}}]]}});
    }
    if(upd.callback_query){
      const cb=upd.callback_query;const chatId=cb.message.chat.id;const data=cb.data;
      await api('answerCallbackQuery',{callback_query_id:cb.id});
      if(data.startsWith('req_')){
        store.pending[chatId]={type:'req',orderId:data.slice(4)};
        await api('sendMessage',{chat_id:chatId,parse_mode:'HTML',text:'💳 Введите через запятую:\n<b>Банк, Имя получателя, Номер телефона</b>\n\nПример: Сбербанк, Иван Иванов, +79001234567'});
      }else if(data.startsWith('cancel_')){
        const ord=store.orders[data.slice(7)];if(ord)ord.cancelled=true;
        await api('sendMessage',{chat_id:chatId,text:'❌ Заказ №'+data.slice(7)+' отменён.'});
      }else if(data.startsWith('confirm_')){
        const ord=store.orders[data.slice(8)];if(ord)ord.confirmed=true;
        await api('sendMessage',{chat_id:chatId,text:'✅ Заказ №'+data.slice(8)+' подтверждён!'});
      }
    }
  }catch(e){console.error(e.message);}
  return res.status(200).end(JSON.stringify({ok:true}));
};
module.exports.store=store;
module.exports.notifyAdminNewOrder=notifyAdminNewOrder;
module.exports.notifyAdminPaid=notifyAdminPaid;
module.exports.notifyAdminChat=notifyAdminChat;
module.exports.notifyAdminChatMsg=notifyAdminChatMsg;
module.exports.notifyUserReply=notifyUserReply;
