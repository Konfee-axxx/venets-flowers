/**
 * catalog.js — API для синхронизации каталога через Vercel KV
 * Администратор меняет -> KV -> все пользователи получают
 */
const { dbGet, dbSet } = require('./db');

const FLOWERS_KEY = 'catalog:flowers';
const GIFTS_KEY   = 'catalog:gifts';

module.exports = async function(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end('{}');

  const { action, flowers, gifts } = req.body || {};

  // GET каталог
  if (!action || action === 'get') {
    const f = await dbGet(FLOWERS_KEY);
    const g = await dbGet(GIFTS_KEY);
    return res.status(200).end(JSON.stringify({ ok: true, flowers: f || null, gifts: g || null }));
  }

  // SET каталог (только от администратора)
  if (action === 'set') {
    if (flowers) await dbSet(FLOWERS_KEY, flowers, 60 * 60 * 24 * 30); // 30 дней
    if (gifts)   await dbSet(GIFTS_KEY,   gifts,   60 * 60 * 24 * 30);
    return res.status(200).end(JSON.stringify({ ok: true }));
  }

  return res.status(200).end(JSON.stringify({ ok: false }));
};
