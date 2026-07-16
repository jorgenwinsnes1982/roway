// GET /.netlify/functions/get-scores
// Returns the top-20 global leaderboard (sorted desc by score) plus a fresh
// one-time nonce the client must echo back when submitting.
//
// The nonce is now STATELESS: `<issuedAtMs>.<hmac(ts)>` — self-authenticating
// and self-expiring, so this endpoint no longer writes anything. The old
// design stored a nonce blob on EVERY read (boot, every leaderboard tab
// switch, twice per finish), which load-testing exposed as pure write
// amplification plus an unboundedly growing `nonces` store (used and
// never-used nonces alike lingered forever). Single-use enforcement happens
// in submit-score at consume time (atomic onlyIfNew claim), which only
// stores nonces that were actually spent — a store bounded by real submits.
// Netlify v2 function — the ESM default-export form gets the Blobs sandbox
// auto-injected under `netlify dev` (classic exports.handler does not).
import { getStore } from '@netlify/blobs';
import { createHmac } from 'node:crypto';

const SECRET = process.env.SCORE_SECRET || 'dev-insecure-secret-change-me';

// MUST stay identical to mintNonce()/nonce verification in submit-score.js
function mintNonce(now) {
  const ts = String(now);
  const mac = createHmac('sha256', SECRET).update(`nonce|${ts}`).digest('hex').slice(0, 32);
  return `${ts}.${mac}`;
}

export default async (req) => {
  try {
    // ?day=YYYY-MM-DD → the daily-challenge board for that day; else all-time.
    const day = sanitizeDay(new URL(req.url).searchParams.get('day'));
    const key = day ? `day:${day}` : 'list';

    const board = getStore('leaderboard');
    const list = (await board.get(key, { type: 'json' })) || [];
    list.sort((a, b) => b.score - a.score);

    return json(200, { scores: list.slice(0, 20), nonce: mintNonce(Date.now()), day: day || null });
  } catch (e) {
    // store unavailable (e.g. Blobs not provisioned) — let the client fall back
    return json(200, { scores: [], nonce: null, error: 'store-unavailable' });
  }
};

// only accept a clean ISO date; anything else → all-time board
function sanitizeDay(d) {
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
