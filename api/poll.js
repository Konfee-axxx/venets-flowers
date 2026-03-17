const wh=require('./webhook');

module.exports=async function(req,res){
  res.setHeader('Content-Type','application/json');
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end('{}');

  const {action,orderId,chatId,orderData,chatData}=req.body||{};

  if(action==='new_order'&&orderData){
    try{await wh.notifyAdminNewOrder(orderData);}catch(e){console.error(e.message);}
    return res.status(200).end(JSON.stringify({ok:true}));
  }
  if(action==='paid'&&orderId){
    try{await wh.notifyAdminPaid(orderId);}catch(e){}
    return res.status(200).end(JSON.stringify({ok:true}));
  }
  if(action==='requisites_sent'&&orderId){
    // Уже обработано на стороне WebApp, просто логируем
    return res.status(200).end(JSON.stringify({ok:true}));
  }
  if(action==='order_confirmed'&&orderId){
    return res.status(200).end(JSON.stringify({ok:true}));
  }
  if(action==='order_cancelled'&&orderId){
    return res.status(200).end(JSON.stringify({ok:true}));
  }
  if(action==='new_chat'&&chatData){
    try{await wh.notifyAdminChat(chatData.id,chatData.topic,chatData.user||{});}catch(e){}
    return res.status(200).end(JSON.stringify({ok:true}));
  }
  if(action==='chat_msg'&&chatId){
    const ch=(wh.store.chats||{})[String(chatId)];
    try{await wh.notifyAdminChatMsg(chatId,ch?ch.topic:'?');}catch(e){}
    return res.status(200).end(JSON.stringify({ok:true}));
  }
  if(action==='admin_reply'&&chatId){
    const body=req.body;
    if(body.userTgId){
      try{await wh.notifyUserReply(body.userTgId,chatId);}catch(e){}
    }
    return res.status(200).end(JSON.stringify({ok:true}));
  }

  return res.status(200).end(JSON.stringify({ok:true}));
};
