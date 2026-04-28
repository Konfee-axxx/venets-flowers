if (!global._phoneCodes) global._phoneCodes = {};
const CODES = global._phoneCodes;

module.exports = async function(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end('{}');

  const { phone, code } = req.body || {};
  if (!phone || !code) return res.status(200).end(JSON.stringify({ ok: false }));

  const stored = CODES[phone];
  if (!stored) return res.status(200).end(JSON.stringify({ ok: false, error: 'no_code' }));
  if (Date.now() > stored.expires) {
    delete CODES[phone];
    return res.status(200).end(JSON.stringify({ ok: false, error: 'expired' }));
  }
  if (stored.code !== String(code)) {
    return res.status(200).end(JSON.stringify({ ok: false, error: 'wrong_code' }));
  }

  delete CODES[phone];
  return res.status(200).end(JSON.stringify({ ok: true }));
};

