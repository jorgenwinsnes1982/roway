// GET /api/scores
// Returns the top-20 global leaderboard (sorted desc by score) plus a fresh
// one-time nonce the client must echo back when submitting.
import { createHmac } from 'node:crypto';
import { getJson } from './lib/kv.js';

const SECRET = process.env.SCORE_SECRET || 'dev-insecure-secret-change-me';

function mintNonce(now) {
  const ts = String(now);
  const mac = createHmac('sha256', SECRET).update(`nonce|${ts}`).digest('hex').slice(0, 32);
  return `${ts}.${mac}`;
}

function sanitizeDay(d) {
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export default async function getScores(req, env) {
  try {
    const day = sanitizeDay(new URL(req.url).searchParams.get('day'));
    const key = day ? `day:${day}` : 'list';

    const list = (await getJson(env.leaderboard, key)) || [];
    list.sort((a, b) => b.score - a.score);

    return json(200, { scores: list.slice(0, 20), nonce: mintNonce(Date.now()), day: day || null });
  } catch (e) {
    return json(200, { scores: [], nonce: null, error: 'store-unavailable' });
  }
}
