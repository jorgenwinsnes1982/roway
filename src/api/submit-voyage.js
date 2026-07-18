// POST /api/voyage/submit
//
// Accepts one or more signed stage tokens and upserts them into a per-player
// record of best times.
import { createHmac, randomUUID } from 'node:crypto';
import { casUpdate, rateLimitAllow, getJson, putJson } from './lib/kv.js';

const SECRET = process.env.SCORE_SECRET || 'dev-insecure-secret-change-me';
const NONCE_TTL_MS = 10 * 60 * 1000;
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

export default async function submitVoyage(req, env) {
  if (req.method !== 'POST') return json(405, { error: 'method' });

  let data;
  try { data = await req.json(); } catch { return json(400, { error: 'bad-json' }); }

  const now = Date.now();

  const ip = getClientIp(req);
  if (!(await rateLimitAllow(env.rate, `rate:${ip}`, now, RATE_WINDOW_MS, RATE_MAX))) {
    return json(429, { error: 'rate-limit' });
  }

  const voyageId = String(data.voyageId ?? '');
  const tokens = Array.isArray(data.tokens) ? data.tokens : null;
  if (!voyageId || voyageId.length > 100) return json(400, { error: 'bad-voyage-id' });
  if (!tokens || tokens.length < 1 || tokens.length > STAGE_COUNT) return json(400, { error: 'bad-tokens' });

  const stagesInReq = tokens.map((t) => Number(t.stage));
  if (new Set(stagesInReq).size !== tokens.length) return json(400, { error: 'duplicate-stage' });
  if (tokens.some((t) => String(t.voyageId ?? voyageId) !== voyageId)) return json(403, { error: 'voyage-id-mismatch' });

  const FINAL_STAGE = STAGE_COUNT - 1;
  const playerKey = `player:${voyageId}`;
  const existing = (await getJson(env.voyageScores, playerKey)) || { stages: {} };
  if (stagesInReq.includes(FINAL_STAGE) && existing.stages[FINAL_STAGE] !== undefined) {
    return json(409, { error: 'stage-final' });
  }

  const nonceRecords = [];
  for (const t of tokens) {
    const stage = Number(t.stage);
    const timeMs = Number(t.timeMs);
    const nonce = String(t.nonce ?? '');
    if (!Number.isInteger(stage) || stage < 0 || stage >= STAGE_COUNT) return json(400, { error: 'bad-stage' });
    if (!Number.isInteger(timeMs) || timeMs < MIN_STAGE_MS || timeMs > MAX_STAGE_MS) return json(400, { error: 'implausible' });
    if (!nonce) return json(403, { error: 'nonce-missing' });

    const expected = createHmac('sha256', SECRET)
      .update(canonicalMsg({ voyageId, stage, timeMs, nonce })).digest('hex');
    if (!t.sig || !timingSafeEqualHex(String(t.sig), expected)) return json(403, { error: 'bad-sig' });

    const nrec = await getJson(env.nonces, nonce);
    if (!nrec) return json(403, { error: 'nonce-invalid' });
    if (nrec.used) return json(403, { error: 'nonce-used' });
    if (now - nrec.at > NONCE_TTL_MS) { await env.nonces.delete(nonce); return json(403, { error: 'nonce-expired' }); }
    nonceRecords.push({ nonce, rec: nrec, stage, timeMs });
  }

  for (const { nonce } of nonceRecords) {
    const cur = await getJson(env.nonces, nonce);
    if (!cur || cur.used) return json(403, { error: 'nonce-used' });
    await putJson(env.nonces, nonce, { ...cur, used: true });
  }

  const alias = String(data.alias ?? '').trim().slice(0, 16).replace(/[<>&"']/g, '') || 'Unknown viking';
  let player;
  await casUpdate(env.voyageScores, playerKey, (cur) => {
    player = cur || { id: randomUUID(), stages: {} };
    for (const { stage, timeMs } of nonceRecords) {
      const prev = player.stages[stage];
      if (stage === FINAL_STAGE && prev !== undefined) continue;
      player.stages[stage] = prev === undefined ? timeMs : Math.min(prev, timeMs);
    }
    player.alias = alias;
    player.ts = now;
    return player;
  });

  let stageBoards = {};
  await casUpdate(env.voyageScores, 'stageBoards', (cur) => {
    stageBoards = cur || {};
    for (const stg of Object.keys(player.stages)) {
      const arr = stageBoards[stg] || [];
      const entry = { id: player.id, alias, timeMs: player.stages[stg] };
      const i = arr.findIndex((e) => e.id === player.id);
      if (i >= 0) arr[i] = entry; else arr.push(entry);
      arr.sort((a, b) => a.timeMs - b.timeMs);
      stageBoards[stg] = arr.slice(0, 100);
    }
    return stageBoards;
  });

  const stageKeys = Object.keys(player.stages);
  const complete = stageKeys.length >= STAGE_COUNT;
  let totalMs = null, rank = null, list = [];

  if (complete) {
    totalMs = Object.values(player.stages).reduce((a, b) => a + b, 0);
    if (totalMs < STAGE_COUNT * MIN_STAGE_MS) return json(400, { error: 'implausible-total' });

    await casUpdate(env.voyageScores, 'list', (cur) => {
      const publicList = Array.isArray(cur) ? cur : [];
      const idx = publicList.findIndex((e) => e.id === player.id);
      const entry = { id: player.id, alias, totalMs: +totalMs.toFixed(0), ts: now };
      if (idx >= 0) publicList[idx] = entry; else publicList.push(entry);
      publicList.sort((a, b) => a.totalMs - b.totalMs);
      rank = publicList.findIndex((e) => e.id === player.id) + 1;
      const trimmed = publicList.slice(0, 100);
      list = trimmed;
      return trimmed;
    });
  }

  return json(200, { ok: true, complete, totalMs, stages: player.stages, id: player.id, alias, rank, list, stageBoards });
}
