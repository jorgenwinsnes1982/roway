// GET /.netlify/functions/get-scores
// Returns the top-20 global leaderboard (sorted desc by score) plus a fresh
// one-time nonce the client must echo back when submitting. The nonce is stored
// with a timestamp in the `nonces` store; submit-score rejects it if it is
// missing, already used, or older than NONCE_TTL_MS (Blobs has no native TTL,
// so expiry is enforced on read). Empty list if the store has nothing yet.
// Netlify v2 function — the ESM default-export form gets the Blobs sandbox
// auto-injected under `netlify dev` (classic exports.handler does not).
import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';

export default async () => {
  try {
    const board = getStore('leaderboard');
    const nonces = getStore('nonces');

    const list = (await board.get('list', { type: 'json' })) || [];
    list.sort((a, b) => b.score - a.score);

    const nonce = randomUUID();
    await nonces.setJSON(nonce, { at: Date.now(), used: false });

    return json(200, { scores: list.slice(0, 20), nonce });
  } catch (e) {
    // store unavailable (e.g. Blobs not provisioned) — let the client fall back
    return json(200, { scores: [], nonce: null, error: 'store-unavailable' });
  }
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
