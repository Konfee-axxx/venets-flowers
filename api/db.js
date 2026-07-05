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
    const d = await r.json();
    return (d.result !== null && d.result !== undefined) ? d.result : null;
  } catch(e) { return null; }
}

async function kvSet(key, value, ttlSeconds) {
  if (!KV_URL || !KV_TOKEN) return false;
  const strVal = typeof value === 'string' ? value : JSON.stringify(value);
  try {
    const url = ttlSeconds
      ? `${KV_URL}/set/${encodeURIComponent(key)}?ex=${ttlSeconds}`
      : `${KV_URL}/set/${encodeURIComponent(key)}`;
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: strVal })
    });
    MEM[key] = strVal;
    return true;
  } catch(e) { return false; }
}

async function kvDel(key) {
  if (!KV_URL || !KV_TOKEN) return;
  try {
    await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
  } catch(e) {}
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
    // Получаем список файлов и ищем нужный
    const path = blobPath(key);
    // Пробуем через прямой URL если он закэширован
    if (BLOB_CACHE[key]) {
      try {
        const r = await fetch(BLOB_CACHE[key]);
        if (r.ok) {
          const text = await r.text();
          return text;
        }
      } catch(e) {}
    }
    // Листаем blob store
    const r = await fetch(`${BLOB_BASE}?prefix=${encodeURIComponent('db/' + key.replace(/[^a-zA-Z0-9_:\-]/g,'_'))}&limit=1`, {
      headers: { Authorization: `Bearer ${BLOB_TOKEN}` }
    });
    const d = await r.json();
    if (d.blobs && d.blobs.length > 0) {
      const url = d.blobs[0].url;
      BLOB_CACHE[key] = url;
      const fr = await fetch(url);
      if (fr.ok) return await fr.text();
    }
    return null;
  } catch(e) { return null; }
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
    const d = await r.json();
    if (d.url) BLOB_CACHE[key] = d.url;
    MEM[key] = strVal;
    return true;
  } catch(e) {
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
async function dbDiag() {
  return {
    kv: !!(KV_URL && KV_TOKEN),
    blob: !!BLOB_TOKEN,
    memory_keys: Object.keys(MEM).length,
    storage: KV_URL ? 'Vercel KV' : (BLOB_TOKEN ? 'Vercel Blob' : 'In-Memory (данные теряются!)')
  };
}

module.exports = { dbGet, dbSet, dbDel, dbScan, dbDiag };
