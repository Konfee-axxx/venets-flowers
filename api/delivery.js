/**
 * delivery.js — расчёт стоимости доставки по дорогам Москвы (OSRM)
 *
 * 1) getRoadDistanceKm(lat1, lon1, lat2, lon2)
 *    — расстояние по дорогам через публичный OSRM demo-сервер,
 *      с резервным fallback на формулу гаверсинусов (по прямой).
 *
 * 2) calcDeliveryCost(distanceKm)
 *    — тариф а-ля Яндекс.Доставка для Москвы:
 *        база (подача): 250 ₽
 *        за км:          35 ₽
 *        моск. коэф.:   1.25
 *      ≤2 км → 250 ₽
 *      >2 км → (250 + (dist-2)*35) * 1.25, округление вверх
 *
 * Используется в order-state.js перед формированием финальной ссылки
 * на оплату — стоимость доставки прибавляется к сумме букета.
 */

const OSRM_BASE = 'https://router.project-osrm.org'; // публичный демо-сервер OSRM (бесплатный, без ключа)

// ── Резервный расчёт "по прямой" — формула гаверсинусов ─────────────
function haversineKm(lat1, lon1, lat2, lon2){
  const R = 6371; // радиус Земли в км
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// ── Основная функция: расстояние по дорогам через OSRM ──────────────
async function getRoadDistanceKm(lat1, lon1, lat2, lon2){
  try{
    // OSRM ожидает координаты в формате lon,lat (долгота первая!)
    const url = `${OSRM_BASE}/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=false`;
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(), 5000); // 5 сек таймаут — не блокируем заказ надолго

    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if(!r.ok) throw new Error('OSRM HTTP '+r.status);
    const data = await r.json();

    if(data.code !== 'Ok' || !data.routes || !data.routes.length){
      throw new Error('OSRM: маршрут не найден');
    }

    const distanceMeters = data.routes[0].distance; // в метрах
    const distanceKm = distanceMeters / 1000;
    return { distanceKm, source: 'osrm' };

  }catch(e){
    // Резервный вариант — расстояние "по прямой" с коэффициентом дорог (~1.3х компенсирует не-прямые маршруты)
    console.warn('[delivery] OSRM недоступен, fallback на haversine:', e.message);
    const straightKm = haversineKm(lat1, lon1, lat2, lon2);
    const roadEstimateKm = straightKm * 1.3; // эмпирический коэффициент для городских дорог
    return { distanceKm: roadEstimateKm, source: 'haversine_fallback' };
  }
}

// ── Формула стоимости доставки (тариф Яндекс.Доставка для Москвы) ───
function calcDeliveryCost(distanceKm){
  const BASE_FARE   = 250;  // базовая стоимость (подача), ₽
  const PER_KM_RATE = 35;   // стоимость за км сверх первых двух, ₽
  const MOSCOW_MULT = 1.25; // коэффициент спроса/пробок для Москвы

  let cost;
  if(distanceKm <= 2){
    cost = BASE_FARE;
  }else{
    cost = (BASE_FARE + (distanceKm - 2) * PER_KM_RATE) * MOSCOW_MULT;
  }

  return Math.ceil(cost); // округление вверх до целых рублей
}

// ── Удобная обёртка: координаты → итоговая стоимость доставки ───────
async function calculateDelivery(sellerLat, sellerLon, clientLat, clientLon){
  const { distanceKm, source } = await getRoadDistanceKm(sellerLat, sellerLon, clientLat, clientLon);
  const cost = calcDeliveryCost(distanceKm);
  return {
    distanceKm: Math.round(distanceKm * 100) / 100, // округляем до 2 знаков для отображения
    cost,
    source // 'osrm' или 'haversine_fallback' — полезно для логов/отладки
  };
}

module.exports = { getRoadDistanceKm, calcDeliveryCost, calculateDelivery, haversineKm };
