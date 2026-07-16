// POST /.netlify/functions/issue-stage-token
//
// Called once a REISEN voyage stage finishes with a NEW personal-best time
// for that stage. Issues a server-signed receipt for that single stage/time
// pair — the SERVER signs here (unlike submit-score, where the client signs
// with the shared secret); the client never sees SCORE_SECRET for this flow,
// only the opaque {nonce, sig} it must relay back unmodified to
// submit-voyage. This is deliberately a receipt, not a submission: the nonce
// is NOT marked used here — see submit-voyage.js.
//
// Mirrors submit-score.js's rate-limit/Blobs/HMAC/error-format conventions.
// Netlify v2 function (ESM default export) — required so Blobs is auto-injected.
import { getStore } from '@netlify/blobs';
import { createHmac, randomUUID } from 'node:crypto';
import { rateLimitAllow } from './lib/blobcas.js';

const SECRET = process.env.SCORE_SECRET || 'dev-insecure-secret-change-me';
const RATE_MAX = 5;                    // submissions per IP...
const RATE_WINDOW_MS = 60 * 1000;      // ...per minute — same as submit-score
const STAGE_COUNT = 5;                 // VOYAGE_STAGES.length in src/voyage.js
// Voyage stages are 1500-1700 m (src/voyage.js VOYAGE_STAGES), same physics/
// max-speed as the 1500 m KAPPRO course, whose own theoretical floor is ~51 s
// (see `time < 45` in submit-score.js). 40 s is a uniform, slightly
// conservative floor across all 5 stage lengths — NOT per-stage-exact, but
// grounded in that existing calibration rather than a blind guess.
const MIN_STAGE_MS = 40_000;
const MAX_STAGE_MS = 900_000; // 15 min — sized for the 4200 m stage-5 homecoming at honest low pace

export default async (req, context) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });

  let data;
  try { data = await req.json(); } catch { return json(400, { error: 'bad-json' }); }

  const rate = getStore('rate');
  const nonces = getStore('nonces'); // shared with KAPPRO's nonce store, per spec
  const now = Date.now();

  // --- rate limit per IP (atomic counter — see lib/blobcas.js) ---
  const ip = context?.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown';
  if (!(await rateLimitAllow(rate, `rate:${ip}`, now, RATE_WINDOW_MS, RATE_MAX))) {
    return json(429, { error: 'rate-limit' });
  }

  // --- validate input ---
  const voyageId = String(data.voyageId ?? '');
  const stage = Number(data.stage);
  const timeMs = Number(data.timeMs);
  const implausible =
    !voyageId || voyageId.length > 100 ||
    !Number.isInteger(stage) || stage < 0 || stage >= STAGE_COUNT ||
    !Number.isInteger(timeMs) || timeMs < MIN_STAGE_MS || timeMs > MAX_STAGE_MS;
  if (implausible) return json(400, { error: 'implausible' });

  // --- issue a fresh one-time nonce + server-computed signature ---
  const nonce = randomUUID();
  await nonces.setJSON(nonce, { at: now, used: false });
  const sig = createHmac('sha256', SECRET).update(canonicalMsg({ voyageId, stage, timeMs, nonce })).digest('hex');

  return json(200, { voyageId, stage, timeMs, nonce, sig });
};

// MUST stay identical to the check in submit-voyage.js
function canonicalMsg(d) {
  return [String(d.voyageId), String(d.stage | 0), String(d.timeMs | 0), String(d.nonce)].join('|');
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
