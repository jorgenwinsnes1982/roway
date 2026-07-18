// POST /api/challenge
//
// Uploads one run (position track + time) so a friend can row against it as
// a ghost, asynchronously, via a short shareable link (?c=<id>).
import { rateLimitAllow } from './lib/kv.js';
import { randomBytes } from 'node:crypto';

const RATE_MAX = 5;
const RATE_WINDOW_MS = 60 * 1000;
const COURSE_BALLS = 26;
const FINISH_Z = -1500;
const SAMPLE_RATE_HZ = 10;
const MAX_SAMPLES = 3000;
const MAX_PAYLOAD_BYTES = 150 * 1024;
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function getClientIp(req) {
  return req.headers.get('CF-Connecting-IP')
    || req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown';
}

export default async function createChallenge(req, env) {
  if (req.method !== 'POST') return json(405, { error: 'method' });

  let raw;
  try { raw = await req.text(); } catch { return json(400, { error: 'bad-json' }); }
  if (raw.length > MAX_PAYLOAD_BYTES) return json(400, { error: 'too-large' });

  let data;
  try { data = JSON.parse(raw); } catch { return json(400, { error: 'bad-json' }); }

  const now = Date.now();

  const ip = getClientIp(req);
  if (!(await rateLimitAllow(env.rate, `rate:challenge:${ip}`, now, RATE_WINDOW_MS, RATE_MAX))) {
    return json(429, { error: 'rate-limit' });
  }

  const alias = String(data.alias ?? '').trim().slice(0, 14).replace(/[<>&"']/g, '');
  if (!alias) return json(400, { error: 'bad-alias' });

  const time = Number(data.time);
  const balls = Number(data.balls);
  const perfect = Number(data.perfect);
  const implausible =
    !Number.isFinite(time) || time < 45 || time > 1800 ||
    !Number.isInteger(balls) || balls < 0 || balls > COURSE_BALLS ||
    !Number.isInteger(perfect) || perfect < 0 || perfect > Math.floor(time);
  if (implausible) return json(400, { error: 'implausible' });

  const track = data.track;
  if (!Array.isArray(track) || track.length < 2 || track.length > MAX_SAMPLES) {
    return json(400, { error: 'bad-track' });
  }
  for (const s of track) {
    if (!Array.isArray(s) || s.length !== 4 || !s.every(Number.isFinite)) {
      return json(400, { error: 'bad-track' });
    }
  }

  const expectedSamples = time * SAMPLE_RATE_HZ;
  if (Math.abs(track.length - expectedSamples) > expectedSamples * 0.2) {
    return json(400, { error: 'track-time-mismatch' });
  }

  const lastZ = track[track.length - 1][2];
  if (lastZ > FINISH_Z) return json(400, { error: 'track-incomplete' });

  const id = randomId(8);
  const entry = { id, alias, time: +time.toFixed(2), balls, perfect, track, at: now };
  await env.challenges.put(id, JSON.stringify(entry));

  return json(200, { id });
}

function randomId(len) {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
