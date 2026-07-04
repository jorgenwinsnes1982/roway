// POST /.netlify/functions/submit-score
//
// THREAT MODEL — read this before trusting the numbers.
// This RAISES THE BAR against cheating; it is NOT tamper-proof. The final
// score is recomputed server-side from CLIENT-REPORTED run numbers, so a
// determined attacker who POSTs *plausible* values with a valid signature
// still gets through — the shared secret ships inside the client bundle, so
// the signature only stops naive console POSTing, not a motivated forger.
// Genuinely trustworthy scores would require the server to simulate the whole
// race from the input timeline, which we do not do.
// What this DOES stop:
//   • naive console/curl POSTing         -> HMAC signature (VITE_SCORE_SECRET)
//   • replay of a captured valid request -> single-use, short-TTL nonce
//   • impossible runs                    -> plausibility bounds (below)
//   • spam / flooding                    -> per-IP rate limit
// Score is ALWAYS recomputed here; any client-sent score field is ignored.
// Netlify v2 function (ESM default export) — required so Blobs is auto-injected
// under `netlify dev`.
import { getStore } from '@netlify/blobs';
import { createHmac, randomUUID } from 'node:crypto';

const SECRET = process.env.SCORE_SECRET || 'dev-insecure-secret-change-me';
const NONCE_TTL_MS = 10 * 60 * 1000;   // nonce valid for 10 min
const RATE_MAX = 5;                    // submissions per IP...
const RATE_WINDOW_MS = 60 * 1000;      // ...per minute
const COURSE_BALLS = 26;               // world.js createCourse: 26 footballs
const COURSE_GATES = 9;                // world.js createCourse: 9 gates

export default async (req, context) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });

  let data;
  try { data = await req.json(); } catch { return json(400, { error: 'bad-json' }); }

  const board = getStore('leaderboard');
  const nonces = getStore('nonces');
  const rate = getStore('rate');
  const now = Date.now();

  // --- rate limit per IP (counts every attempt, valid or not) ---
  const ip = context?.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown';
  const rl = (await rate.get(`rate:${ip}`, { type: 'json' })) || { count: 0, start: now };
  if (now - rl.start > RATE_WINDOW_MS) { rl.count = 0; rl.start = now; }
  rl.count++;
  await rate.setJSON(`rate:${ip}`, rl);
  if (rl.count > RATE_MAX) return json(429, { error: 'rate-limit' });

  // --- nonce: must exist, not expired, not used (stops replay) ---
  const { nonce, sig } = data;
  if (!nonce) return json(403, { error: 'nonce-missing' });
  const nrec = await nonces.get(nonce, { type: 'json' });
  if (!nrec) return json(403, { error: 'nonce-invalid' });
  if (nrec.used) return json(403, { error: 'nonce-used' });
  if (now - nrec.at > NONCE_TTL_MS) { await nonces.delete(nonce); return json(403, { error: 'nonce-expired' }); }

  // --- signature check (stops naive POSTing) ---
  const expected = createHmac('sha256', SECRET).update(canonicalMsg(data)).digest('hex');
  if (!sig || !timingSafeEqualHex(String(sig), expected)) return json(403, { error: 'bad-sig' });

  // --- plausibility bounds (reject impossible runs) ---
  const time = Number(data.time);
  const balls = Number(data.balls);
  const perfect = Number(data.perfect);
  const gates = Number(data.gates);
  const win = !!data.win;
  const implausible =
    !Number.isFinite(time) || time < 45 || time > 1800 ||       // 1500 m course; ~51 s theoretical floor
    !Number.isInteger(balls) || balls < 0 || balls > COURSE_BALLS ||
    !Number.isInteger(gates) || gates < 0 || gates > COURSE_GATES ||
    !Number.isInteger(perfect) || perfect < 0 || perfect > Math.floor(time); // ~1 stroke/s max
  if (implausible) return json(400, { error: 'implausible' });

  // consume the nonce (single use) only once everything else has passed
  nrec.used = true;
  await nonces.setJSON(nonce, nrec);

  // --- server-side score recompute — identical formula to computeScore() in main.js ---
  const score = computeScore({ time, balls, perfect, gates, win });

  const name = String(data.name ?? '').trim().slice(0, 14).replace(/[<>&"']/g, '') || 'Ukjent viking';
  const entry = { id: randomUUID(), name, score, time: +time.toFixed(2), win, at: now };

  const list = (await board.get('list', { type: 'json' })) || [];
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  const trimmed = list.slice(0, 100);
  await board.setJSON('list', trimmed);

  return json(200, { ok: true, id: entry.id, scores: trimmed.slice(0, 20) });
};

// MUST stay identical to computeScore() in src/main.js
function computeScore({ time, balls, perfect, gates, win }) {
  return Math.round(250000 / Math.max(30, time))
    + balls * 200 + perfect * 25 + gates * 100 + (win ? 2000 : 0);
}

// MUST stay identical to canonicalMsg() in src/main.js (signed payload)
function canonicalMsg(d) {
  return [
    String(d.name ?? ''),
    Number(d.time).toFixed(3),
    String(d.balls | 0),
    String(d.perfect | 0),
    String(d.gates | 0),
    d.win ? '1' : '0',
  ].join('|');
}

function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
