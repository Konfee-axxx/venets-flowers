/**
 * seller-products.js — управление товарами конкретного продавца
 *
 * POST { action:'get', login }                    → { ok, products }
 * POST { action:'set', login, products }          → { ok }
 * POST { action:'update_one', login, product }    → { ok }
 * POST { action:'stop', login, productId, stop }  → { ok }
 */
const { dbGet, dbSet } = require('./db');

function key(login){ return 'seller_products:'+login; }

module.exports = async function(req, res){
  res.setHeader('Content-Type','application/json');
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end('{}');

  const { action, login, products, product, productId, stop } = req.body||{};
  if(!login) return res.status(200).end(JSON.stringify({ok:false,error:'no_login'}));

  if(action==='get'){
    const data = await dbGet(key(login)).catch(()=>null);
    return res.status(200).end(JSON.stringify({ok:true, products: data||[]}));
  }

  if(action==='set' && Array.isArray(products)){
    await dbSet(key(login), products, 60*60*24*365);
    return res.status(200).end(JSON.stringify({ok:true}));
  }

  if(action==='update_one' && product){
    let list = await dbGet(key(login)).catch(()=>[]) || [];
    const idx = list.findIndex(p=>String(p.id)===String(product.id));
    if(idx>=0) list[idx]={...list[idx],...product};
    else list.push(product);
    await dbSet(key(login), list, 60*60*24*365);
    return res.status(200).end(JSON.stringify({ok:true}));
  }

  if(action==='stop' && productId!==undefined){
    let list = await dbGet(key(login)).catch(()=>[]) || [];
    const idx = list.findIndex(p=>String(p.id)===String(productId));
    if(idx>=0){ list[idx].stopped = !!stop; }
    await dbSet(key(login), list, 60*60*24*365);
    return res.status(200).end(JSON.stringify({ok:true}));
  }

  return res.status(200).end(JSON.stringify({ok:false,error:'unknown_action'}));
};
