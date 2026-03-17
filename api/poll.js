const wh = require('./webhook');
const store = wh.store;

module.exports = async function(req, res){
  res.setHeader('Content-Type','application/json');
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end('{}');

  const body = req.body||{};
  const {action, orderId, chatId, orderData, chatData, msgData} = body;

  // Новый заказ → сохранить + уведомить админа
  if(action==='new_order' && orderData){
    const key = String(orderData.id);
    store.orders[key] = {...orderData, ts:Date.now()};
    try{ await wh.notifyAdminNewOrder(orderData); }catch(e){ console.error('notify err',e.message); }
    return res.status(200).end(JSON.stringify({ok:true}));
  }

  // Пользователь нажал "Я оплатил"
  if(action==='paid' && orderId){
    const ord = store.orders[String(orderId)];
    if(ord){ try{ await wh.notifyAdminPaid(ord); }catch(e){} }
    return res.status(200).end(JSON.stringify({ok:true}));
  }

  // Новый чат поддержки
  if(action==='new_chat' && chatData){
    store.chats = store.chats||{};
    store.chats[String(chatData.id)] = chatData;
    try{ await wh.notifyAdminChat(chatData.id, chatData.topic, chatData.user||{}); }catch(e){}
    return res.status(200).end(JSON.stringify({ok:true}));
  }

  // Новое сообщение от пользователя
  if(action==='chat_msg' && chatId){
    const ch=(store.chats||{})[String(chatId)];
    try{ await wh.notifyAdminChatMsg(chatId, ch?ch.topic:'?'); }catch(e){}
    return res.status(200).end(JSON.stringify({ok:true}));
  }

  // Ответ администратора → уведомить пользователя
  if(action==='admin_reply' && chatId){
    const ch=(store.chats||{})[String(chatId)];
    if(ch && ch.userTgId){
      try{ await wh.notifyUserReply(ch.userTgId, chatId); }catch(e){}
    }
    return res.status(200).end(JSON.stringify({ok:true}));
  }

  // Polling статуса заказа
  if(action==='check' && orderId){
    const key = String(orderId);
    const ord = store.orders[key];
    if(!ord){
      return res.status(200).end(JSON.stringify({
        ok:true, status:'unknown',
        payReady:false, confirmed:false, cancelled:false
      }));
    }
    return res.status(200).end(JSON.stringify({
      ok:true,
      payReady:  !!ord.payReady,
      payBank:   ord.payBank  || null,
      payName:   ord.payName  || null,
      payPhone:  ord.payPhone || null,
      confirmed: !!ord.confirmed,
      cancelled: !!ord.cancelled,
    }));
  }

  return res.status(200).end(JSON.stringify({ok:true}));
};
