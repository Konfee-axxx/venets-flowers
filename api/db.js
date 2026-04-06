/**
 * db.js — простая абстракция над Vercel KV (Redis)
 * 
 * Подключение:
 * 1. В Vercel Dashboard → Storage → Create KV Database
 * 2. Connect to project → переменные автоматически добавятся
 * 
 * Переменные окружения (добавляются автоматически при создании KV):
 *   KV_URL, KV_REST_API_URL, KV_REST_API_TOKEN, KV_REST_API_READ_ONLY_TOKEN
 * 
 * Если KV не подключён — fallback на in-memory (для разработки)
 */

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// In-memory fallback если KV не подключён
if (!global._kvFallback) global._kvFallback = {};
const MEM = global._kvFallback;

async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) {
    return MEM[key] !== undefined ? MEM[key] : null;
  }
  try {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const d = await r.json();
    return d.result !== null && d.result !== undefined ? d.result : null;
  } catch(e) {
    return MEM[key] !== undefined ? MEM[key] : null;
  }
}

async function kvSet(key, value, ttlSeconds) {
  const strVal = typeof value === 'string' ? value : JSON.stringify(value);
  if (!KV_URL || !KV_TOKEN) {
    MEM[key] = strVal;
    return true;
  }
  try {
    const url = ttlSeconds
      ? `${KV_URL}/set/${encodeURIComponent(key)}?ex=${ttlSeconds}`
      : `${KV_URL}/set/${encodeURIComponent(key)}`;
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: strVal })
    });
    MEM[key] = strVal; // дублируем в память для скорости
    return true;
  } catch(e) {
    MEM[key] = strVal;
    return false;
  }
}

async function kvDel(key) {
  delete MEM[key];
  if (!KV_URL || !KV_TOKEN) return;
  try {
    await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
  } catch(e) {}
}

// Получить объект (JSON)
async function dbGet(key) {
  const val = await kvGet(key);
  if (val === null) return null;
  try { return typeof val === 'string' ? JSON.parse(val) : val; }
  catch(e) { return val; }
}

// Сохранить объект
async function dbSet(key, obj, ttl) {
  return kvSet(key, obj, ttl);
}

// Получить все ключи с префиксом (из памяти — для listing)
function dbScan(prefix) {
  return Object.keys(MEM).filter(k => k.startsWith(prefix));
}

module.exports = { dbGet, dbSet, dbDel: kvDel, dbScan };
