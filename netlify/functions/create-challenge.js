// POST /.netlify/functions/create-challenge
//
// Uploads one run (position track + time) so a friend can row against it as
// a ghost, asynchronously, via a short shareable link (?c=<id>). This is a
// SEPARATE, UNSIGNED system from the leaderboard — challenge times never
// touch the score-signature chain (SCORE_SECRET) and are never written to
// the leaderboard store automatically. Same threat-model posture as
// submit-score.js: this raises the bar (plausibility bounds + rate limit),
// it does not cryptographically prove the run happened.
// Netlify v2 function (ESM default export) — required so Blobs is auto-injected
// under `netlify dev`.
import { getStore } from '@netlify/blobs';
import { rateLimitAllow } from './lib/blobcas.js';
import { randomBytes } from 'node:crypto';

const RATE_MAX = 5;                    // creations per IP...
const RATE_WINDOW_MS = 60 * 1000;      // ...per minute
const COURSE_BALLS = 26;               // world.js createCourse: 26 footballs
const FINISH_Z = -1500;                // world.js: finishZ = -COURSE_LENGTH
const SAMPLE_RATE_HZ = 10;             // main.js: G.ghostSampleT resets to 0.1s
const MAX_SAMPLES = 3000;              // ~5 min run at 10 Hz
const MAX_PAYLOAD_BYTES = 150 * 1024;
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export default async (req, context) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });

  let raw;
  try { raw = await req.text(); } catch { return json(400, { error: 'bad-json' }); }
  if (raw.length > MAX_PAYLOAD_BYTES) return json(400, { error: 'too-large' });

  let data;
  try { data = JSON.parse(raw); } catch { return json(400, { error: 'bad-json' }); }

  const rate = getStore('rate');
  const now = Date.now();

  // --- rate limit per IP (own bucket — separate from submit-score's budget;
  // atomic counter, see lib/blobcas.js) ---
  const ip = context?.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown';
  if (!(await rateLimitAllow(rate, `rate:challenge:${ip}`, now, RATE_WINDOW_MS, RATE_MAX))) {
    return json(429, { error: 'rate-limit' });
  }

  // --- alias ---
  const alias = String(data.alias ?? '').trim().slice(0, 14).replace(/[<>&"']/g, '');
  if (!alias) return json(400, { error: 'bad-alias' });

  // --- plausibility bounds (same range as submit-score.js) ---
  const time = Number(data.time);
  const balls = Number(data.balls);
  const perfect = Number(data.perfect);
  const implausible =
    !Number.isFinite(time) || time < 45 || time > 1800 ||
    !Number.isInteger(balls) || balls < 0 || balls > COURSE_BALLS ||
    !Number.isInteger(perfect) || perfect < 0 || perfect > Math.floor(time);
  if (implausible) return json(400, { error: 'implausible' });

  // --- track shape + consistency ---
  const track = data.track;
  if (!Array.isArray(track) || track.length < 2 || track.length > MAX_SAMPLES) {
    return json(400, { error: 'bad-track' });
  }
  for (const s of track) {
    if (!Array.isArray(s) || s.length !== 4 || !s.every(Number.isFinite)) {
      return json(400, { error: 'bad-track' });
    }
  }
  // sample count should roughly match time at the known recording rate (±20%)
  const expectedSamples = time * SAMPLE_RATE_HZ;
  if (Math.abs(track.length - expectedSamples) > expectedSamples * 0.2) {
    return json(400, { error: 'track-time-mismatch' });
  }
  // the track must actually reach the finish line — no half-run uploads
  const lastZ = track[track.length - 1][2];
  if (lastZ > FINISH_Z) return json(400, { error: 'track-incomplete' });

  const id = randomId(8);
  const entry = { id, alias, time: +time.toFixed(2), balls, perfect, track, at: now };
  const challenges = getStore('challenges');
  await challenges.setJSON(id, entry);

  return json(200, { id });
};

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
