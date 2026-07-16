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
//
// CONCURRENCY: every board/rate mutation goes through casUpdate() (etag
// conditional writes + retry) — load-testing the old plain read-modify-write
// measured 62.5% silent entry loss and 24-of-50 requests slipping past the
// rate limit under 50 concurrent submits. See lib/blobcas.js.
// Netlify v2 function (ESM default export) — required so Blobs is auto-injected
// under `netlify dev`.
import { getStore } from '@netlify/blobs';
import { createHmac, randomUUID } from 'node:crypto';
import { casUpdate, rateLimitAllow } from './lib/blobcas.js';

const SECRET = process.env.SCORE_SECRET || 'dev-insecure-secret-change-me';
const NONCE_TTL_MS = 10 * 60 * 1000;   // nonce valid for 10 min
const RATE_MAX = 5;                    // submissions per IP...
const RATE_WINDOW_MS = 60 * 1000;      // ...per minute
const MAX_PAYLOAD_BYTES = 8_192;       // whole valid payload is <1 kB — anything bigger is abuse
const COURSE_BALLS = 26;               // world.js createCourse: 26 footballs
const COURSE_GATES = 9;                // world.js createCourse: 9 gates
// Portstraff: MUST stay identical to GATE_MISS_PENALTY_S in src/main.js. The
// client sends the RAW (unpenalized) time — this is the ONLY place the
// penalty is authoritatively applied; the client can't lie about it.
const GATE_MISS_PENALTY_S = 3.0;

export default async (req, context) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });

  // size cap BEFORE parsing — create-challenge already had one; this endpoint
  // buffered arbitrarily large bodies into memory (found in load-test review)
  let data;
  try {
    const raw = await req.text();
    if (raw.length > MAX_PAYLOAD_BYTES) return json(413, { error: 'too-large' });
    data = JSON.parse(raw);
  } catch { return json(400, { error: 'bad-json' }); }

  const board = getStore('leaderboard');
  const nonces = getStore('nonces');
  const rate = getStore('rate');
  const now = Date.now();

  // --- rate limit per IP (counts every attempt, valid or not) ---
  const ip = context?.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown';
  if (!(await rateLimitAllow(rate, `rate:${ip}`, now, RATE_WINDOW_MS, RATE_MAX))) {
    return json(429, { error: 'rate-limit' });
  }

  // --- nonce: stateless `<ts>.<hmac>` from get-scores — verify mac + age.
  // Single-use is enforced at consume time below (atomic onlyIfNew claim).
  const { nonce, sig } = data;
  if (!nonce) return json(403, { error: 'nonce-missing' });
  const nm = /^(\d{10,16})\.([0-9a-f]{32})$/.exec(String(nonce));
  let legacyNonce = false;
  if (nm) {
    const mac = createHmac('sha256', SECRET).update(`nonce|${nm[1]}`).digest('hex').slice(0, 32);
    if (!timingSafeEqualHex(nm[2], mac)) return json(403, { error: 'nonce-invalid' });
    if (now - Number(nm[1]) > NONCE_TTL_MS) return json(403, { error: 'nonce-expired' });
    const seen = await nonces.get(String(nonce), { type: 'json' });
    if (seen) return json(403, { error: 'nonce-used' });
  } else {
    // legacy STORED nonce (issued by the previous get-scores build) — keep
    // honoring these through the deploy rollover so an in-flight result
    // screen can still save. Removable once no pre-rollover clients remain.
    legacyNonce = true;
    const nrec = await nonces.get(String(nonce), { type: 'json' });
    if (!nrec) return json(403, { error: 'nonce-invalid' });
    if (nrec.used) return json(403, { error: 'nonce-used' });
    if (now - nrec.at > NONCE_TTL_MS) { await nonces.delete(String(nonce)); return json(403, { error: 'nonce-expired' }); }
  }

  // --- signature check (stops naive POSTing) ---
  const expected = createHmac('sha256', SECRET).update(canonicalMsg(data)).digest('hex');
  if (!sig || !timingSafeEqualHex(String(sig), expected)) return json(403, { error: 'bad-sig' });

  // --- plausibility bounds (reject impossible runs) ---
  const time = Number(data.time); // RAW time, penalty not yet applied — see below
  const balls = Number(data.balls);
  const perfect = Number(data.perfect);
  const gates = Number(data.gates);
  const win = !!data.win;
  // Portstraff: missedGates must be present and sane — the client can't lie
  // about it (it's part of the signed payload), but a well-formed-but-wrong
  // value (e.g. more misses than gates exist) is still rejected here.
  const missedGatesProvided = data.missedGates !== undefined && data.missedGates !== null;
  const missedGates = Number(data.missedGates);
  const implausible =
    !Number.isFinite(time) || time < 45 || time > 1800 ||       // 1500 m course; ~51 s theoretical floor
    !Number.isInteger(balls) || balls < 0 || balls > COURSE_BALLS ||
    !Number.isInteger(gates) || gates < 0 || gates > COURSE_GATES ||
    !Number.isInteger(perfect) || perfect < 0 || perfect > Math.floor(time) || // ~1 stroke/s max
    !missedGatesProvided || !Number.isInteger(missedGates) || missedGates < 0 ||
    gates + missedGates > COURSE_GATES;
  if (implausible) return json(400, { error: 'implausible' });

  // consume the nonce (single use) only once everything else has passed.
  // onlyIfNew makes the claim ATOMIC: two concurrent replays of the same
  // capture race to create the key and exactly one wins.
  const claim = await nonces.setJSON(String(nonce), { used: true, at: now }, legacyNonce ? {} : { onlyIfNew: true });
  if (!legacyNonce && claim && claim.modified === false) return json(403, { error: 'nonce-used' });

  // opportunistic GC: spent stateless nonces carry their issue time in the
  // key, so anything past 2×TTL can never validate again — delete a batch
  // now and then so the store stays bounded (it only grows by real submits).
  if (Math.random() < 0.05) {
    try {
      const { blobs } = await nonces.list();
      const cutoff = now - NONCE_TTL_MS * 2;
      let deleted = 0;
      for (const b of blobs) {
        if (deleted >= 200) break;
        const ts = Number(b.key.split('.')[0]);
        if (Number.isFinite(ts) && ts > 0 && ts < cutoff) { await nonces.delete(b.key); deleted++; }
      }
    } catch { /* GC is best-effort — never fail a submit over it */ }
  }

  // Portstraff: the server owns the penalty math — `time` recomputed here is
  // what actually lands in computeScore() and on the leaderboard, regardless
  // of anything the client believes about its own penalty.
  const penaltyS = missedGates * GATE_MISS_PENALTY_S;
  const finalTime = time + penaltyS;

  // --- server-side score recompute — identical formula to computeScore() in main.js ---
  const score = computeScore({ time: finalTime, balls, perfect, gates, win });

  // 16-char cap matches the client's NAME_RE {3,16} — the server used to cut
  // at 14, silently truncating names the client had validated as legal.
  const name = String(data.name ?? '').trim().slice(0, 16).replace(/[<>&"']/g, '') || 'Unknown viking';
  const entry = { id: randomUUID(), name, score, time: +finalTime.toFixed(2), win, at: now };

  // all-time board — rank computed against the FULL sorted list (not the
  // top-100 slice that's actually stored) so it stays exact past rank 100,
  // instead of collapsing to a meaningless "not found" beyond the cap.
  // casUpdate re-runs the mutate on conflict, so rank/top-20 always come from
  // the attempt that actually landed.
  let rankAll = 0;
  let top20 = [];
  const landedAll = await casUpdate(board, 'list', (cur) => {
    const list = Array.isArray(cur) ? cur.filter((e) => e.id !== entry.id) : [];
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    rankAll = list.findIndex((e) => e.id === entry.id) + 1;
    const trimmed = list.slice(0, 100);
    top20 = trimmed.slice(0, 20);
    return trimmed;
  });
  // the client already saved locally before calling — an honest 503 beats a
  // false "saved" that the next writer would silently erase (the old bug)
  if (!landedAll) return json(503, { error: 'busy' });

  // daily-challenge board: same entry into today's bucket (key `day:<day>`).
  const day = resolveDay(data.day, now);
  let dayScores = [];
  let rankDay = null;
  if (day) {
    const landedDay = await casUpdate(board, `day:${day}`, (cur) => {
      const dlist = Array.isArray(cur) ? cur.filter((e) => e.id !== entry.id) : [];
      dlist.push(entry);
      dlist.sort((a, b) => b.score - a.score);
      rankDay = dlist.findIndex((e) => e.id === entry.id) + 1;
      const dtrim = dlist.slice(0, 100);
      dayScores = dtrim.slice(0, 20);
      return dtrim;
    });
    if (!landedDay) { rankDay = null; dayScores = []; } // all-time landed — degrade gracefully
  }

  // `entry` is returned too — so the client can render "your row" without
  // re-deriving the server's own score/penalty math a second time.
  return json(200, { ok: true, id: entry.id, entry, scores: top20, rankAll, dayScores, rankDay, day });
};

// accept the client-reported day only if well-formed AND within ±1 day of the
// server's date (timezone tolerance); otherwise skip the daily board.
function resolveDay(d, now) {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const s = new Date(now);
  const serverUTC = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  const [y, m, day] = d.split('-').map(Number);
  const clientUTC = Date.UTC(y, m - 1, day);
  return Math.abs(serverUTC - clientUTC) <= 86400000 ? d : null;
}

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
    String(d.missedGates | 0), // Portstraff
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
