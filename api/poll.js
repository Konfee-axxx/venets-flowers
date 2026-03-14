// WebApp вызывает этот endpoint каждые 3 секунды чтобы проверить статус заказа
const wh = require('./webhook');
const store = wh.store;

module.exports = async function(req, res){
  res.setHeader('Content-Type','application/json');
  res.setHeader('Access-Control-Allow-Origin','*');

  const {orderId, chatId, action, orderData, chatData, msgData} = req.body||{};

  // Регистрируем новый заказ и шлём уведомление админу
  if(action==='new_order' && orderData){
    store.orders[orderData.id] = {...orderData, ts:Date.now()};
    try{ await wh.notifyAdminNewOrder(orderData); }catch(e){}
    return res.status(200).end(JSON.stringify({ok:true}));
  }

  // Пользователь нажал "Я оплатил" — шлём уведомление админу
  if(action==='paid' && orderId){
    const ord = store.orders[orderId];
    if(ord){ try{ await wh.notifyAdminPaid(ord); }catch(e){} }
    return res.status(200).end(JSON.stringify({ok:true}));
  }

  // Новый чат
  if(action==='new_chat' && chatData){
    store.chats[chatData.id]=chatData;
    try{ await wh.notifyAdminChat(chatData.id, chatData.topic, chatData.user||{}); }catch(e){}
    return res.status(200).end(JSON.stringify({ok:true}));
  }

  // Новое сообщение от пользователя
  if(action==='chat_msg' && chatId){
    const ch=store.chats[chatId];
    try{ await wh.notifyAdminChatMsg(chatId, ch?ch.topic:'?'); }catch(e){}
    return res.status(200).end(JSON.stringify({ok:true}));
  }

  // Администратор ответил — уведомить юзера
  if(action==='admin_reply' && chatId && msgData){
    const ch=store.chats[chatId];
    if(ch && ch.userTgId){
      try{ await wh.notifyUserReply(ch.userTgId, chatId); }catch(e){}
    }
    return res.status(200).end(JSON.stringify({ok:true}));
  }

  // WebApp проверяет статус заказа (polling)
  if(action==='check' && orderId){
    const ord=store.orders[orderId];
    if(!ord) return res.status(200).end(JSON.stringify({ok:true, status:'unknown'}));
    return res.status(200).end(JSON.stringify({
      ok:true,
      payReady: ord.payReady||false,
      payBank: ord.payBank||null,
      payName: ord.payName||null,
      payPhone: ord.payPhone||null,
      confirmed: ord.confirmed||false,
      cancelled: ord.cancelled||false,
    }));
  }

  return res.status(200).end(JSON.stringify({ok:true}));
};
