/**
 * catalog.js — API для синхронизации каталога через Vercel KV
 * Администратор меняет -> KV -> все пользователи получают
 */
const { dbGet, dbSet } = require('./db');

const FLOWERS_KEY = 'catalog:flowers';
const GIFTS_KEY   = 'catalog:gifts';
const CAROUSEL_KEY= 'catalog:carousel';

module.exports = async function(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end('{}');

  const { action, flowers, gifts, carousel } = req.body || {};

  if (!action || action === 'get') {
    const f = await dbGet(FLOWERS_KEY);
    const g = await dbGet(GIFTS_KEY);
    const c = await dbGet(CAROUSEL_KEY);
    return res.status(200).end(JSON.stringify({ ok: true, flowers: f || null, gifts: g || null, carousel: c || null }));
  }

  if (action === 'set') {
    if (flowers) await dbSet(FLOWERS_KEY, flowers, 60 * 60 * 24 * 30);
    if (gifts)   await dbSet(GIFTS_KEY,   gifts,   60 * 60 * 24 * 30);
    if (carousel)await dbSet(CAROUSEL_KEY,carousel,60 * 60 * 24 * 30);
    return res.status(200).end(JSON.stringify({ ok: true }));
  }

  return res.status(200).end(JSON.stringify({ ok: false }));
};
