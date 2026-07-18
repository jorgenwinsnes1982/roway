// POST /api/voyage/token
//
// Called once a REISEN voyage stage finishes with a NEW personal-best time
// for that stage. Issues a server-signed receipt for that single stage/time
// pair.
import { createHmac, randomUUID } from 'node:crypto';
import { rateLimitAllow, putJson } from './lib/kv.js';

const SECRET = process.env.SCORE_SECRET || 'dev-insecure-secret-change-me';
const RATE_MAX = 5;
const RATE_WINDOW_MS = 60 * 1000;
const STAGE_COUNT = 5;
const MIN_STAGE_MS = 40_000;
const MAX_STAGE_MS = 900_000;

function getClientIp(req) {
  return req.headers.get('CF-Connecting-IP')
    || req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown';
}

function canonicalMsg(d) {
  return [String(d.voyageId), String(d.stage | 0), String(d.timeMs | 0), String(d.nonce)].join('|');
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export default async function issueStageToken(req, env) {
  if (req.method !== 'POST') return json(405, { error: 'method' });

  let data;
  try { data = await req.json(); } catch { return json(400, { error: 'bad-json' }); }

  const now = Date.now();

  const ip = getClientIp(req);
  if (!(await rateLimitAllow(env.rate, `rate:${ip}`, now, RATE_WINDOW_MS, RATE_MAX))) {
    return json(429, { error: 'rate-limit' });
  }

  const voyageId = String(data.voyageId ?? '');
  const stage = Number(data.stage);
  const timeMs = Number(data.timeMs);
  const implausible =
    !voyageId || voyageId.length > 100 ||
    !Number.isInteger(stage) || stage < 0 || stage >= STAGE_COUNT ||
    !Number.isInteger(timeMs) || timeMs < MIN_STAGE_MS || timeMs > MAX_STAGE_MS;
  if (implausible) return json(400, { error: 'implausible' });

  const nonce = randomUUID();
  await putJson(env.nonces, nonce, { at: now, used: false });
  const sig = createHmac('sha256', SECRET).update(canonicalMsg({ voyageId, stage, timeMs, nonce })).digest('hex');

  return json(200, { voyageId, stage, timeMs, nonce, sig });
}
