/**
 * db.js — хранилище данных с тремя уровнями:
 *
 * 1. Vercel KV (Redis) — если заданы KV_REST_API_URL + KV_REST_API_TOKEN
 *    Подключить: Vercel Dashboard → Storage → Create KV → Connect to project
 *
 * 2. Vercel Blob — если задан BLOB_READ_WRITE_TOKEN
 *    Подключить: Vercel Dashboard → Storage → Create Blob Store → Connect to project
 *    Используется как файловый fallback: каждый ключ = JSON-файл в Blob
 *
 * 3. In-memory — только для локальной разработки, данные теряются при перезапуске
 *
 * ВАЖНО: без KV и Blob данные будут теряться при каждом cold start Vercel (~10 мин)
 * Подключите хотя бы одно хранилище в Vercel Dashboard → Storage
 */

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const BLOB_BASE  = 'https://blob.vercel-storage.com';

// In-memory fallback
if (!global._kvFallback) global._kvFallback = {};
const MEM = global._kvFallback;

// ── Уровень 1: Vercel KV ─────────────────────────────────────────────────────
async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    if (!r.ok) {
      console.error('[db] kvGet HTTP error:', r.status, key);
      return null;
    }
    const d = await r.json();
    if (d.error) { console.error('[db] kvGet error:', d.error, key); return null; }
    return (d.result !== null && d.result !== undefined) ? d.result : null;
  } catch(e) { console.error('[db] kvGet exception:', e.message); return null; }
}

async function kvSet(key, value, ttlSeconds) {
  if (!KV_URL || !KV_TOKEN) return false;
  const strVal = typeof value === 'string' ? value : JSON.stringify(value);
  try {
    // ВАЖНО: REST API Vercel KV / Upstash ожидает значение как СЫРОЕ тело запроса,
    // а не обёрнутым в JSON-объект { value: ... } — иначе в базу пишется мусор.
    const url = ttlSeconds
      ? `${KV_URL}/set/${encodeURIComponent(key)}?EX=${ttlSeconds}`
      : `${KV_URL}/set/${encodeURIComponent(key)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'text/plain' },
      body: strVal
    });
    if (!r.ok) {
      console.error('[db] kvSet HTTP error:', r.status, key);
      return false;
    }
    const d = await r.json().catch(() => null);
    if (!d || d.error || d.result !== 'OK') {
      console.error('[db] kvSet unexpected response:', JSON.stringify(d), key);
      return false;
    }
    MEM[key] = strVal;
    return true;
  } catch(e) { console.error('[db] kvSet exception:', e.message); return false; }
}

async function kvDel(key) {
  if (!KV_URL || !KV_TOKEN) return;
  try {
    const r = await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    if (!r.ok) console.error('[db] kvDel HTTP error:', r.status, key);
  } catch(e) { console.error('[db] kvDel exception:', e.message); }
}

// ── Уровень 2: Vercel Blob (постоянное хранилище файлов) ────────────────────
// Blob хранит данные как файлы — каждый ключ → JSON-файл
// Не такой быстрый как KV, но данные НИКОГДА не теряются

function blobPath(key) {
  // Преобразуем ключ в безопасное имя файла
  return 'db/' + key.replace(/[^a-zA-Z0-9_:\-]/g, '_') + '.json';
}

// Кэш URL blob-файлов (чтобы не листить каждый раз)
if (!global._blobUrlCache) global._blobUrlCache = {};
const BLOB_CACHE = global._blobUrlCache;

async function blobGet(key) {
  if (!BLOB_TOKEN) return null;
  try {
    // Пробуем через прямой URL если он закэширован
    if (BLOB_CACHE[key]) {
      try {
        const r = await fetch(BLOB_CACHE[key]);
        if (r.ok) return await r.text();
      } catch(e) {}
    }
    // Листаем blob store
    const r = await fetch(`${BLOB_BASE}?prefix=${encodeURIComponent('db/' + key.replace(/[^a-zA-Z0-9_:\-]/g,'_'))}&limit=1`, {
      headers: { Authorization: `Bearer ${BLOB_TOKEN}` }
    });
    if (!r.ok) { console.error('[db] blobGet list HTTP error:', r.status, key); return null; }
    const d = await r.json();
    if (d.blobs && d.blobs.length > 0) {
      const url = d.blobs[0].url;
      BLOB_CACHE[key] = url;
      const fr = await fetch(url);
      if (fr.ok) return await fr.text();
      console.error('[db] blobGet fetch-by-url HTTP error:', fr.status, key);
    }
    return null;
  } catch(e) { console.error('[db] blobGet exception:', e.message); return null; }
}

async function blobSet(key, value) {
  if (!BLOB_TOKEN) return false;
  const strVal = typeof value === 'string' ? value : JSON.stringify(value);
  try {
    const filename = blobPath(key);
    const r = await fetch(`${BLOB_BASE}/${filename}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${BLOB_TOKEN}`,
        'Content-Type': 'application/json',
        'x-vercel-blob-cache-control': 'no-cache',
      },
      body: strVal
    });
    if (!r.ok) {
      console.error('[db] blobSet HTTP error:', r.status, key);
      MEM[key] = strVal;
      return false;
    }
    const d = await r.json();
    if (d.url) BLOB_CACHE[key] = d.url;
    MEM[key] = strVal;
    return true;
  } catch(e) {
    console.error('[db] blobSet exception:', e.message);
    MEM[key] = strVal;
    return false;
  }
}

// ── Публичный API ─────────────────────────────────────────────────────────────
async function dbGet(key) {
  // 1. Память (самый быстрый)
  if (MEM[key] !== undefined) {
    try { return typeof MEM[key] === 'string' ? JSON.parse(MEM[key]) : MEM[key]; }
    catch(e) { return MEM[key]; }
  }
  // 2. KV
  let val = await kvGet(key);
  // 3. Blob fallback
  if (val === null) val = await blobGet(key);
  if (val === null) return null;
  // Кэшируем в память
  MEM[key] = typeof val === 'string' ? val : JSON.stringify(val);
  try { return typeof val === 'string' ? JSON.parse(val) : val; }
  catch(e) { return val; }
}

async function dbSet(key, obj, ttl) {
  const strVal = typeof obj === 'string' ? obj : JSON.stringify(obj);
  MEM[key] = strVal; // всегда пишем в память для скорости
  const kvOk = await kvSet(key, strVal, ttl);
  // Если KV не работает — пишем в Blob
  if (!kvOk) await blobSet(key, strVal);
  return true;
}

async function dbDel(key) {
  delete MEM[key];
  delete BLOB_CACHE[key];
  await kvDel(key);
}

function dbScan(prefix) {
  return Object.keys(MEM).filter(k => k.startsWith(prefix));
}

// Диагностика — для /api/status
// Делает реальную проверку записи/чтения (а не просто смотрит на наличие env-переменных,
// которые могут быть заданы, но при этом сама запись/чтение не работать).
async function dbDiag() {
  const diag = {
    kv_configured: !!(KV_URL && KV_TOKEN),
    blob_configured: !!BLOB_TOKEN,
    kv_working: false,
    blob_working: false,
    memory_keys: Object.keys(MEM).length,
  };

  if (diag.kv_configured) {
    const testKey = '__diag_test__' + Date.now();
    const testVal = 'ok_' + Math.random().toString(36).slice(2);
    try {
      const setOk = await kvSet(testKey, testVal, 30);
      const readBack = setOk ? await kvGet(testKey) : null;
      diag.kv_working = setOk && readBack === testVal;
      await kvDel(testKey);
    } catch(e) { diag.kv_working = false; }
  }

  if (diag.blob_configured) {
    const testKey = '__diag_test__' + Date.now();
    const testVal = 'ok_' + Math.random().toString(36).slice(2);
    try {
      const setOk = await blobSet(testKey, testVal);
      const readBack = setOk ? await blobGet(testKey) : null;
      diag.blob_working = setOk && readBack === testVal;
    } catch(e) { diag.blob_working = false; }
  }

  diag.storage = diag.kv_working ? 'Vercel KV (проверено записью)'
    : diag.blob_working ? 'Vercel Blob (проверено записью)'
    : (diag.kv_configured || diag.blob_configured) ? 'Настроено, но запись не проходит — см. логи функции в Vercel'
    : 'In-Memory (данные теряются при перезапуске!)';

  return diag;
}

module.exports = { dbGet, dbSet, dbDel, dbScan, dbDiag };
