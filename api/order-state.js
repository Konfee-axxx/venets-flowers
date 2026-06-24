/**
 * order-state.js — централизованное хранилище состояний заказов через Vercel KV
 * 
 * Теперь polling работает МЕЖДУ УСТРОЙСТВАМИ:
 * Admin WebApp пишет → KV → User WebApp читает
 */

const { dbGet, dbSet } = require('./db');
const { calculateDelivery } = require('./delivery');
const TOKEN = process.env.BOT_TOKEN || '';
const WURL  = (process.env.WEBAPP_URL || '').replace(/\/+$/, '');
const TG    = 'https://api.telegram.org/bot' + TOKEN;

async function tg(method, body) {
  try {
    const r = await fetch(`${TG}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return r.json();
  } catch(e) { return { ok: false }; }
}

module.exports = async function(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end('{}');

  const { action, orderId, data } = req.body || {};
  const key = orderId ? `order:${String(orderId)}` : null;

  // ── РАСЧЁТ ДОСТАВКИ (вызывается отдельно при создании заказа, до отправки реквизитов) ──
  if (action === 'calc_delivery') {
    const { sellerLat, sellerLon, clientLat, clientLon, bouquetTotal } = req.body || {};
    if (sellerLat == null || sellerLon == null || clientLat == null || clientLon == null) {
      return res.status(200).end(JSON.stringify({ ok: false, error: 'missing_coords' }));
    }
    try {
      const delivery = await calculateDelivery(
        Number(sellerLat), Number(sellerLon),
        Number(clientLat), Number(clientLon)
      );
      // Если передан orderId — сразу сохраняем расчёт в KV, чтобы при requisites_sent его подхватить
      if (key) {
        const existing = await dbGet(key) || {};
        const merged = {
          ...existing,
          deliveryDistanceKm: delivery.distanceKm,
          deliveryCost: delivery.cost,
          deliverySource: delivery.source,
          bouquetTotal: Number(bouquetTotal || existing.total || 0),
          finalTotal: Number(bouquetTotal || existing.total || 0) + delivery.cost,
          _ts: Date.now()
        };
        await dbSet(key, merged, 60 * 60 * 24 * 7);
      }
      return res.status(200).end(JSON.stringify({ ok: true, delivery }));
    } catch (e) {
      console.error('[order-state] calc_delivery err:', e.message);
      return res.status(200).end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  // ── SET ─────────────────────────────────────────────────────────
  if (action === 'set_order' && key) {
    const existing = await dbGet(key) || {};
    let merged = { ...existing, ...data, _ts: Date.now() };

    // ── Авторасчёт стоимости доставки (OSRM) перед отправкой реквизитов ──
    // Координаты продавца (sellerLat/sellerLon) и клиента (clientLat/clientLon)
    // должны быть переданы в data (из карточки товара продавца и геолокации WebApp клиента)
    if (data?.payState === 'requisites_sent' &&
        data?.sellerLat != null && data?.sellerLon != null &&
        data?.clientLat != null && data?.clientLon != null) {
      try {
        const delivery = await calculateDelivery(
          Number(data.sellerLat), Number(data.sellerLon),
          Number(data.clientLat), Number(data.clientLon)
        );
        merged.deliveryDistanceKm = delivery.distanceKm;
        merged.deliveryCost = delivery.cost;
        merged.deliverySource = delivery.source; // 'osrm' или 'haversine_fallback'

        // Итоговая сумма = стоимость букета + стоимость доставки
        const bouquetTotal = Number(existing.total || data.bouquetTotal || 0);
        merged.bouquetTotal = bouquetTotal;
        merged.finalTotal = bouquetTotal + delivery.cost;
      } catch(e) {
        console.error('[order-state] delivery calc err:', e.message);
      }
    }

    await dbSet(key, merged, 60 * 60 * 24 * 7); // TTL 7 дней

    // Если отправляются реквизиты — уведомляем пользователя
    if (data?.payState === 'requisites_sent' && data?.userTgId) {
      const bank = data.payBank || 'Банк';
      const name = data.payName || '—';
      const phone = data.payPhone || '—';
      const bid = data.payBankId || 'sber';
      let param = '';
      try {
        param = Buffer.from(JSON.stringify({
          t:'req', oid: String(orderId), bank, name, phone, bankId: bid
        })).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'').slice(0,64);
      } catch(e) {}

      // Текст сообщения — добавляем разбивку стоимости, если доставка была рассчитана
      let costBreakdown = '';
      if (merged.deliveryCost != null) {
        costBreakdown =
          `\n📦 Букет: ${merged.bouquetTotal} ₽\n` +
          `🚗 Доставка (${merged.deliveryDistanceKm} км): ${merged.deliveryCost} ₽\n` +
          `💵 <b>Итого: ${merged.finalTotal} ₽</b>\n`;
      }

      await tg('sendMessage', {
        chat_id: data.userTgId,
        parse_mode: 'HTML',
        text: `💳 <b>Реквизиты по заказу №${orderId} готовы!</b>\n${costBreakdown}\n🏦 ${bank}\n👤 ${name}\n📞 <code>${phone}</code>\n\nНажмите кнопку ниже:`,
        reply_markup: { inline_keyboard: [[{
          text: '💳 Перейти к оплате',
          web_app: { url: WURL + (param ? '?req=' + param : '') }
        }]]}
      });
    }
    return res.status(200).end(JSON.stringify({ ok: true, state: merged }));
  }

  // ── GET ─────────────────────────────────────────────────────────
  if (action === 'get_order' && key) {
    const state = await dbGet(key);
    return res.status(200).end(JSON.stringify({
      ok: true,
      state: state || { payState: 'waiting_requisites' }
    }));
  }

  return res.status(200).end(JSON.stringify({ ok: true }));
};
