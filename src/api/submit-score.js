// POST /api/scores
//
// THREAT MODEL — read this before trusting the numbers.
// This RAISES THE BAR against cheating; it is NOT tamper-proof. The final
// score is recomputed server-side from CLIENT-REPORTED run numbers, so a
// determined attacker who POSTs *plausible* values with a valid signature
// still gets through — the shared secret ships inside the client bundle, so
// the signature only stops naive console POSTing, not a motivated forger.
//
// CONCURRENCY: replaced Netlify Blobs' etag CAS with simple KV read-modify-
// write retries. Cloudflare KV is eventually consistent; for ROWAY's scale this
// is acceptable.
import { createHmac, randomUUID } from 'node:crypto';
import { casUpdate, rateLimitAllow, getJson, putJson } from './lib/kv.js';

const SECRET = process.env.SCORE_SECRET || 'dev-insecure-secret-change-me';
const NONCE_TTL_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
const RATE_WINDOW_MS = 60 * 1000;
const MAX_PAYLOAD_BYTES = 8_192;
const COURSE_BALLS = 26;
const COURSE_GATES = 9;
const GATE_MISS_PENALTY_S = 3.0;

function getClientIp(req) {
  return req.headers.get('CF-Connecting-IP')
    || req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown';
}

export default async function submitScore(req, env) {
  if (req.method !== 'POST') return json(405, { error: 'method' });

  let data;
  try {
    const raw = await req.text();
    if (raw.length > MAX_PAYLOAD_BYTES) return json(413, { error: 'too-large' });
    data = JSON.parse(raw);
  } catch { return json(400, { error: 'bad-json' }); }

  const now = Date.now();

  const ip = getClientIp(req);
  if (!(await rateLimitAllow(env.rate, `rate:${ip}`, now, RATE_WINDOW_MS, RATE_MAX))) {
    return json(429, { error: 'rate-limit' });
  }

  const { nonce, sig } = data;
  if (!nonce) return json(403, { error: 'nonce-missing' });

  const nm = /^(\d{10,16})\.([0-9a-f]{32})$/.exec(String(nonce));
  if (nm) {
    const mac = createHmac('sha256', SECRET).update(`nonce|${nm[1]}`).digest('hex').slice(0, 32);
    if (!timingSafeEqualHex(nm[2], mac)) return json(403, { error: 'nonce-invalid' });
    if (now - Number(nm[1]) > NONCE_TTL_MS) return json(403, { error: 'nonce-expired' });
    const seen = await getJson(env.nonces, String(nonce));
    if (seen) return json(403, { error: 'nonce-used' });
  } else {
    const nrec = await getJson(env.nonces, String(nonce));
    if (!nrec) return json(403, { error: 'nonce-invalid' });
    if (nrec.used) return json(403, { error: 'nonce-used' });
    if (now - nrec.at > NONCE_TTL_MS) { await env.nonces.delete(String(nonce)); return json(403, { error: 'nonce-expired' }); }
  }

  const expected = createHmac('sha256', SECRET).update(canonicalMsg(data)).digest('hex');
  if (!sig || !timingSafeEqualHex(String(sig), expected)) return json(403, { error: 'bad-sig' });

  const time = Number(data.time);
  const balls = Number(data.balls);
  const perfect = Number(data.perfect);
  const gates = Number(data.gates);
  const win = !!data.win;
  const missedGatesProvided = data.missedGates !== undefined && data.missedGates !== null;
  const missedGates = Number(data.missedGates);
  const implausible =
    !Number.isFinite(time) || time < 45 || time > 1800 ||
    !Number.isInteger(balls) || balls < 0 || balls > COURSE_BALLS ||
    !Number.isInteger(gates) || gates < 0 || gates > COURSE_GATES ||
    !Number.isInteger(perfect) || perfect < 0 || perfect > Math.floor(time) ||
    !missedGatesProvided || !Number.isInteger(missedGates) || missedGates < 0 ||
    gates + missedGates > COURSE_GATES;
  if (implausible) return json(400, { error: 'implausible' });

  await putJson(env.nonces, String(nonce), { used: true, at: now });

  // opportunistic GC
  if (Math.random() < 0.05) {
    try {
      const { keys } = await env.nonces.list();
      const cutoff = now - NONCE_TTL_MS * 2;
      let deleted = 0;
      for (const k of keys) {
        if (deleted >= 200) break;
        const ts = Number(k.name.split('.')[0]);
        if (Number.isFinite(ts) && ts > 0 && ts < cutoff) { await env.nonces.delete(k.name); deleted++; }
      }
    } catch { /* best-effort */ }
  }

  const penaltyS = missedGates * GATE_MISS_PENALTY_S;
  const finalTime = time + penaltyS;
  const score = computeScore({ time: finalTime, balls, perfect, gates, win });

  const name = String(data.name ?? '').trim().slice(0, 16).replace(/[<>&"']/g, '') || 'Unknown viking';
  const entry = { id: randomUUID(), name, score, time: +finalTime.toFixed(2), win, at: now };

  let rankAll = 0;
  let top20 = [];
  await casUpdate(env.leaderboard, 'list', (cur) => {
    const list = Array.isArray(cur) ? cur.filter((e) => e.id !== entry.id) : [];
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    rankAll = list.findIndex((e) => e.id === entry.id) + 1;
    const trimmed = list.slice(0, 100);
    top20 = trimmed.slice(0, 20);
    return trimmed;
  });

  const day = resolveDay(data.day, now);
  let dayScores = [];
  let rankDay = null;
  if (day) {
    await casUpdate(env.leaderboard, `day:${day}`, (cur) => {
      const dlist = Array.isArray(cur) ? cur.filter((e) => e.id !== entry.id) : [];
      dlist.push(entry);
      dlist.sort((a, b) => b.score - a.score);
      rankDay = dlist.findIndex((e) => e.id === entry.id) + 1;
      const dtrim = dlist.slice(0, 100);
      dayScores = dtrim.slice(0, 20);
      return dtrim;
    });
  }

  return json(200, { ok: true, id: entry.id, entry, scores: top20, rankAll, dayScores, rankDay, day });
}

function resolveDay(d, now) {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const s = new Date(now);
  const serverUTC = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  const [y, m, day] = d.split('-').map(Number);
  const clientUTC = Date.UTC(y, m - 1, day);
  return Math.abs(serverUTC - clientUTC) <= 86400000 ? d : null;
}

function computeScore({ time, balls, perfect, gates, win }) {
  return Math.round(250000 / Math.max(30, time))
    + balls * 200 + perfect * 25 + gates * 100 + (win ? 2000 : 0);
}

function canonicalMsg(d) {
  return [
    String(d.name ?? ''),
    Number(d.time).toFixed(3),
    String(d.balls | 0),
    String(d.perfect | 0),
    String(d.gates | 0),
    d.win ? '1' : '0',
    String(d.missedGates | 0),
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
