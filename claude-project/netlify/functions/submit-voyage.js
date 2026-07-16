// POST /.netlify/functions/submit-voyage
//
// Accepts one or more signed stage tokens (from issue-stage-token) and
// upserts them into a per-player (per-voyageId) record of best times, one
// slot per stage id 0..4. The public REISEN leaderboard ranks by the sum of
// all 5 slots, lowest total wins — but only once all 5 are known.
//
// DELIBERATE DEVIATION from a literal "always exactly 5 tokens, one atomic
// submission" design: REISEN has no discrete start/finish "attempt" (see
// src/voyage.js) — a stage's best time is permanent state, improved over
// however many sessions it takes, exactly like the voyage's total distance.
// So this endpoint is called every time ANY single stage improves, with
// just that ONE new token (never previously-submitted ones — see below on
// why resending an already-accepted token is impossible by construction).
// The server is what carries the running per-stage record across calls.
//
// Mirrors submit-score.js's rate-limit/Blobs/HMAC/nonce/error-format
// conventions, including reusing the SAME `nonces` and `rate` stores.
import { getStore } from '@netlify/blobs';
import { createHmac, randomUUID } from 'node:crypto';
import { casUpdate, rateLimitAllow } from './lib/blobcas.js';

const SECRET = process.env.SCORE_SECRET || 'dev-insecure-secret-change-me';
const NONCE_TTL_MS = 10 * 60 * 1000;   // same TTL as submit-score
const RATE_MAX = 5;
const RATE_WINDOW_MS = 60 * 1000;
const STAGE_COUNT = 5;
const MIN_STAGE_MS = 40_000;  // MUST stay identical to issue-stage-token.js
const MAX_STAGE_MS = 900_000; // MUST stay identical to issue-stage-token.js

export default async (req, context) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });

  let data;
  try { data = await req.json(); } catch { return json(400, { error: 'bad-json' }); }

  const board = getStore('voyage-scores'); // own store — never the KAPPRO 'leaderboard' store
  const nonces = getStore('nonces');       // shared with KAPPRO, per spec
  const rate = getStore('rate');           // shared with KAPPRO, per spec
  const now = Date.now();

  // --- rate limit per IP (atomic counter — see lib/blobcas.js) ---
  const ip = context?.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown';
  if (!(await rateLimitAllow(rate, `rate:${ip}`, now, RATE_WINDOW_MS, RATE_MAX))) {
    return json(429, { error: 'rate-limit' });
  }

  // --- top-level shape ---
  const voyageId = String(data.voyageId ?? '');
  const tokens = Array.isArray(data.tokens) ? data.tokens : null;
  if (!voyageId || voyageId.length > 100) return json(400, { error: 'bad-voyage-id' });
  if (!tokens || tokens.length < 1 || tokens.length > STAGE_COUNT) return json(400, { error: 'bad-tokens' });

  // no duplicate stages within one request, and every token must claim the
  // same voyageId as the envelope (stops mixing another player's receipts in)
  const stagesInReq = tokens.map((t) => Number(t.stage));
  if (new Set(stagesInReq).size !== tokens.length) return json(400, { error: 'duplicate-stage' });
  if (tokens.some((t) => String(t.voyageId ?? voyageId) !== voyageId)) return json(403, { error: 'voyage-id-mismatch' });

  // --- stage 5 is one-shot: the FIRST accepted time is final, never re-submittable ---
  // (server stage index 4 = client stage 5, the trophy homecoming.) Checked
  // BEFORE any nonce is consumed so a rejected attempt doesn't burn tokens.
  const FINAL_STAGE = STAGE_COUNT - 1;
  const playerKey = `player:${voyageId}`;
  const existing = (await board.get(playerKey, { type: 'json' })) || { stages: {} };
  if (stagesInReq.includes(FINAL_STAGE) && existing.stages[FINAL_STAGE] !== undefined) {
    return json(409, { error: 'stage-final' });
  }

  // --- per-token validation: bounds, signature, nonce ---
  const nonceRecords = []; // { nonce, rec } — collected so we only write "used" after EVERY check passes
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

    const nrec = await nonces.get(nonce, { type: 'json' });
    if (!nrec) return json(403, { error: 'nonce-invalid' });
    if (nrec.used) return json(403, { error: 'nonce-used' });
    if (now - nrec.at > NONCE_TTL_MS) { await nonces.delete(nonce); return json(403, { error: 'nonce-expired' }); }
    nonceRecords.push({ nonce, rec: nrec, stage, timeMs });
  }

  // everything validated — consume the nonces (single use each). The etag
  // conditional write makes each claim atomic: a concurrent replay of the
  // same captured token loses the race and gets nonce-used.
  for (const { nonce } of nonceRecords) {
    const cur = await nonces.getWithMetadata(nonce, { type: 'json' });
    if (!cur || cur.data.used) return json(403, { error: 'nonce-used' });
    const res = await nonces.setJSON(nonce, { ...cur.data, used: true }, { onlyIfMatch: cur.etag });
    if (res && res.modified === false) return json(403, { error: 'nonce-used' });
  }

  // --- upsert this player's per-stage record via CAS (two devices sharing a
  // voyageId used to be able to erase each other's stage times — last writer
  // won the whole record). The mutate re-merges against FRESH data on every
  // retry, and re-asserts the stage-5 one-shot rule under the race.
  // 16-char cap matches the client-side name rule (was 14 — silent mismatch).
  const alias = String(data.alias ?? '').trim().slice(0, 16).replace(/[<>&"']/g, '') || 'Unknown viking';
  let player;
  const landedPlayer = await casUpdate(board, playerKey, (cur) => {
    player = cur || { id: randomUUID(), stages: {} };
    for (const { stage, timeMs } of nonceRecords) {
      const prev = player.stages[stage];
      // FINAL_STAGE is one-shot: first accepted time is final (the pre-check
      // above 409s the obvious case; this holds it under concurrency too).
      if (stage === FINAL_STAGE && prev !== undefined) continue;
      // defensive min() — a token is only ever issued for an improvement
      // client-side, but never trust the client to have actually done that.
      player.stages[stage] = prev === undefined ? timeMs : Math.min(prev, timeMs);
    }
    player.alias = alias;
    player.ts = now;
    return player;
  });
  if (!landedPlayer) return json(503, { error: 'busy' });

  // --- per-stage public boards: [{ id, alias, timeMs }] sorted ascending,
  // capped at 100 per stage — powers the client's "Nth on this stage" and
  // partial "Nth place so far" readouts (a complete-voyage total isn't
  // needed for those, so they work from stage 1 onward).
  let stageBoards = {};
  const landedStages = await casUpdate(board, 'stageBoards', (cur) => {
    stageBoards = cur || {};
    for (const stg of Object.keys(player.stages)) {
      const arr = stageBoards[stg] || [];
      const entry = { id: player.id, alias, timeMs: player.stages[stg] };
      const i = arr.findIndex((e) => e.id === player.id);
      if (i >= 0) arr[i] = entry; else arr.push(entry); // also refreshes alias on every stage
      arr.sort((a, b) => a.timeMs - b.timeMs);
      stageBoards[stg] = arr.slice(0, 100);
    }
    return stageBoards;
  });
  if (!landedStages) return json(503, { error: 'busy' });

  // --- total only exists once all 5 stages are known ---
  const stageKeys = Object.keys(player.stages);
  const complete = stageKeys.length >= STAGE_COUNT;
  let totalMs = null, rank = null, list = [];

  if (complete) {
    totalMs = Object.values(player.stages).reduce((a, b) => a + b, 0);
    // always true by construction (every stage individually >= MIN_STAGE_MS),
    // kept as an explicit assertion per spec rather than trusting the sum
    if (totalMs < STAGE_COUNT * MIN_STAGE_MS) return json(400, { error: 'implausible-total' });

    const landedList = await casUpdate(board, 'list', (cur) => {
      const publicList = Array.isArray(cur) ? cur : [];
      const idx = publicList.findIndex((e) => e.id === player.id);
      const entry = { id: player.id, alias, totalMs: +totalMs.toFixed(0), ts: now };
      if (idx >= 0) publicList[idx] = entry; else publicList.push(entry);
      publicList.sort((a, b) => a.totalMs - b.totalMs); // ascending — lowest total wins
      // rank against the FULL sorted list, before trimming for storage — stays
      // exact past rank 100 instead of collapsing to "not found"
      rank = publicList.findIndex((e) => e.id === player.id) + 1;
      const trimmed = publicList.slice(0, 100);
      list = trimmed; // full stored board — client shows a scrollable list
      return trimmed;
    });
    if (!landedList) { rank = null; list = []; } // player record landed — degrade gracefully
  }

  return json(200, { ok: true, complete, totalMs, stages: player.stages, id: player.id, alias, rank, list, stageBoards });
};

// MUST stay identical to canonicalMsg() in issue-stage-token.js
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
