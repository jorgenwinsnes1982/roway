// ================= Atlanterhavsferden: persistent voyage meta-progression =================
// Every completed race (see finishRace() in main.js) adds metres to a
// long-running trip: Norway -> USA (fetch the trophy) -> Norway (bring it
// home). The race itself never changes; this is a meta-layer on top, stored
// separately from every existing vikingferd_*/roway_* key.
import { COURSE_LENGTH } from './world.js';

// Tunable voyage constants — design decisions live here, tweak freely:
export const BALL_BONUS_M = 50;     // flat bonus metres per football

// Fase 3c: stage variants for VOYAGE mode only. Deterministic — same stage =
// same course for every player (fixed seeds, never random; fairness premise
// for any future voyage leaderboard). Stage 1 == the classic course values
// on purpose: the journey starts on familiar ground. The ball curve is mild
// (26→34): more "tailwind" feel as the voyage progresses, never a wall of ice
// (Regel 7 — variation is flavour, not punishment).
// lengths rise monotonically stage to stage — the journey gets longer and
// harder as it goes. waveScale: the sea state per stage (fed to
// setWaveScale() in water.js — GPU and CPU stay in sync through ONE value);
// stage 5 is the trophy homecoming: dramatic, but gentler than stage 4.
//
// untilM: ONE clean completion of a stage (its own `length`, no ball bonus)
// must cross into the next — this is a one-sitting, one-race-per-stage
// journey, not a many-session grind. So untilM is the CUMULATIVE sum of
// stage lengths so far (1500, 1500+1600, ...), never an arbitrary round
// number. (Previously these sat at 15000/30000/45000/60000 — a leftover
// from an earlier "long voyage over many sessions" design the player never
// actually wanted; each stage silently required ~10 repeat rows to cross.)
// Progressive lengths: every stage longer than the last, and the homecoming
// (stage 5) EXACTLY 2x the length of stage 4 — the epic final pull. balls/
// ice/gates scale with length so density stays comparable per metre.
// mood: the stage's visual profile (sky gradient, fog, water palette, sun,
// mountain tint) — applied with a ~1s crossfade at race start; KAPPRO always
// runs stage 1's dawn look (the game's original "blå time" base).
export const VOYAGE_STAGES = [
  {
    id: 1, name: 'OUT OF THE FJORD',
    untilM: 1500, length: 1500, balls: 26, ice: 22, gates: 9, seed: 101, landmark: 'lighthouse', waveScale: 1.0,
    mood: { skyTop: 0x0e2454, skyMid: 0x4a6fa8, skyBot: 0xff9e52, fog: 0x8fa9cf, fogNear: 320, fogFar: 1150, deep: 0x03151e, shallow: 0x14584e, waterSky: 0x7fa3d0, warm: 0xff9e52, sun: 0xffe0b8, sunI: 2.2, mtn: 0xffffff },
  },
  {
    id: 2, name: 'THE NORWEGIAN SEA',
    untilM: 3200, length: 1700, balls: 30, ice: 25, gates: 9, seed: 202, landmark: 'whale', waveScale: 1.07,
    mood: { skyTop: 0x1b3a6e, skyMid: 0x6f9fd8, skyBot: 0xcfe8ff, fog: 0x9fb8d8, fogNear: 340, fogFar: 1250, deep: 0x06253a, shallow: 0x1a6a70, waterSky: 0x9fc2e8, warm: 0xffd9a0, sun: 0xfff2dd, sunI: 2.4, mtn: 0xf2f6ff },
  },
  {
    id: 3, name: 'THE ICELAND PASSAGE',
    untilM: 5100, length: 1900, balls: 33, ice: 31, gates: 10, seed: 303, landmark: 'volcano', waveScale: 1.14,
    mood: { skyTop: 0x24304a, skyMid: 0x5a7290, skyBot: 0xd8e4ee, fog: 0xb4c4d6, fogNear: 260, fogFar: 950, deep: 0x0a2030, shallow: 0x2a7a8a, waterSky: 0xbccfe0, warm: 0xe8f0ff, sun: 0xd8e8ff, sunI: 1.9, mtn: 0xdfe8f2 },
  },
  {
    id: 4, name: 'THE AMERICAN COAST',
    untilM: 7200, length: 2100, balls: 37, ice: 26, gates: 10, seed: 404, landmark: 'liberty', waveScale: 1.22,
    mood: { skyTop: 0x2a2450, skyMid: 0x8a6fa8, skyBot: 0xffb670, fog: 0xbfa4ae, fogNear: 320, fogFar: 1150, deep: 0x14202e, shallow: 0x3a6a5a, waterSky: 0xd8b8c8, warm: 0xffb060, sun: 0xffc890, sunI: 2.5, mtn: 0xffe8d0 },
  },
  {
    id: 5, name: 'THE VOYAGE HOME',
    untilM: Infinity, length: 4200, balls: 74, ice: 54, gates: 16, seed: 505, landmark: 'homefjord', waveScale: 1.12,
    mood: { skyTop: 0x0a1838, skyMid: 0x3a5688, skyBot: 0xff7e62, fog: 0x7e96c0, fogNear: 300, fogFar: 1100, deep: 0x02101a, shallow: 0x0f4a44, waterSky: 0x6f93c0, warm: 0xff8a5e, sun: 0xffd0a0, sunI: 1.8, mtn: 0xd0d8ec },
  },
];

// trophy pickup = the moment stage 4 is cleared and stage 5 begins; "home" =
// stage 5 cleared. Kept as named constants (not just VOYAGE_STAGES[3].untilM
// inline) because voyagemap.js's route-drawing math and MILESTONES both key
// off these directly.
export const VOYAGE_OUT_M = VOYAGE_STAGES[3].untilM;               // 6600 — Norway → USA
export const VOYAGE_HOME_M = VOYAGE_STAGES[4].length;              // 1900 — homeward with the trophy
export const TOTAL_VOYAGE_M = VOYAGE_OUT_M + VOYAGE_HOME_M;        // 8500 — the whole round trip

export function currentStage(totalM) {
  return VOYAGE_STAGES.find((s) => totalM < s.untilM) || VOYAGE_STAGES[VOYAGE_STAGES.length - 1];
}

// name, emoji, cumulative metres from Norway. Only two now (was six) — the
// interim ones (Offshore/Norwegian Sea/Iceland/Greenland Sea) duplicated
// what the per-stage "✓ STAGE N COMPLETE" banner already says once stage
// crossings happen every single race instead of once every ~10.
export const MILESTONES = [
  { name: 'The American coast — the trophy!', emoji: '🇺🇸', m: VOYAGE_OUT_M },
  { name: 'Home — trophy ashore', emoji: '🏆', m: TOTAL_VOYAGE_M },
];

const VOYAGE_KEY = 'roway.voyage.v1';

function defaultVoyage() {
  return { total: 0, trophy: false, home: false };
}

export function loadVoyage() {
  try {
    const v = JSON.parse(localStorage.getItem(VOYAGE_KEY));
    if (v && typeof v.total === 'number' && Number.isFinite(v.total)) {
      return { total: v.total, trophy: !!v.trophy, home: !!v.home };
    }
  } catch { /* corrupt/missing — fall through to a fresh voyage */ }
  return defaultVoyage();
}

function saveVoyage(v) {
  try { localStorage.setItem(VOYAGE_KEY, JSON.stringify(v)); }
  catch { /* storage full — this run's progress just won't persist */ }
}

// shared by creditRun() and creditBonus() — adds `m` metres to `v` (mutated
// in place), clamped to the voyage's total length, and reports any milestone
// crossed by that gain so EITHER path (race distance or a mission/letter
// bonus) celebrates milestones the same way.
function applyMeters(v, m) {
  const before = v.total;
  const after = Math.min(TOTAL_VOYAGE_M, before + m);
  const gained = after - before;
  const crossedMilestones = MILESTONES.filter((ms) => before < ms.m && after >= ms.m);
  v.total = after;
  if (after >= VOYAGE_OUT_M) v.trophy = true;
  if (after >= TOTAL_VOYAGE_M) v.home = true;
  return { gained, crossedMilestones };
}

// Credits ONE completed race to the voyage. Call this from finishRace() only —
// never from a restart/abort path, or the voyage becomes farmable.
// Fase 3c: `distance` = the ACTUAL rowed course length (voyage stages vary,
// 1500–1700 m) — callers pass -course.finishZ, never a hardcoded constant.
export function creditRun({ balls = 0, distance = COURSE_LENGTH } = {}) {
  const v = loadVoyage();
  const { gained, crossedMilestones } = applyMeters(v, distance + balls * BALL_BONUS_M);
  saveVoyage(v);
  return { gained, crossedMilestones, voyage: v };
}

// Fase 4a: mission/letter-hunt rewards — a separate entry point from
// creditRun() since these are awarded on top of (not instead of) the race's
// own distance, and can themselves cross a milestone.
export function creditBonus(m) {
  const v = loadVoyage();
  const { gained, crossedMilestones } = applyMeters(v, m);
  saveVoyage(v);
  return { gained, crossedMilestones, voyage: v };
}

// ================= Voyage server leaderboard (combined-time, per-stage) =================
// The REISEN server leaderboard ranks players by the sum of their best time on
// each of the 5 stages. There is no discrete "start/finish a voyage attempt" —
// `voyage.total` above is a permanent, ever-growing lifetime distance, and
// VOYAGE_STAGES is picked automatically from it — so a stage's best time is
// its own small piece of permanent state, improved incrementally over however
// many sessions it takes, exactly like `voyage.total` itself.
const VOYAGE_ID_KEY = 'roway.voyage.id.v1';
const STAGE_BEST_KEY = 'roway.voyage.stageBest.v1';

// a stable per-browser identity that ties a player's stage tokens together
// server-side — generated once, then permanent (like BEST_KEY/GHOST_KEY),
// NOT a per-attempt session id (there is no "attempt" in this design).
export function getOrCreateVoyageId() {
  try {
    let id = localStorage.getItem(VOYAGE_ID_KEY);
    if (id) return id;
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(VOYAGE_ID_KEY, id);
    return id;
  } catch {
    // storage unavailable — fall back to a session-only id (won't persist,
    // so this player's stage tokens just won't link up across reloads)
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

// { [stageId]: { timeMs, score, submitted } } — keyed by VOYAGE_STAGES id
// (1..5). `score`: the points computeScore() awarded the run that set this
// best time (drives the "voyage total" readout on the result screen).
// `submitted`: this stage's current best has already been accepted by
// submit-voyage — its token's nonce is spent, so it must never be resent.
export function loadStageBests() {
  try {
    const v = JSON.parse(localStorage.getItem(STAGE_BEST_KEY));
    if (v && typeof v === 'object') return v;
  } catch { /* corrupt/missing — fall through to empty */ }
  return {};
}

function saveStageBests(v) {
  try { localStorage.setItem(STAGE_BEST_KEY, JSON.stringify(v)); }
  catch { /* storage full — this stage's best just won't persist */ }
}

// returns true if `timeMs` is a new personal best for this stage (i.e. a
// fresh signed token should be requested for it)
export function isStageBest(stageId, timeMs) {
  const best = loadStageBests()[stageId];
  return !best || timeMs < best.timeMs;
}

// commits a new best time for a stage, marked NOT submitted yet — call this
// right after issue-stage-token succeeds, before submit-voyage is attempted.
// Preserves the `final` flag (stage 5's one-shot lock, see markStageFinal).
// `score` is the run's computeScore() total — kept alongside the time so the
// result screen can show points per stage and the voyage total.
export function recordStageBest(stageId, timeMs, score = undefined) {
  const bests = loadStageBests();
  bests[stageId] = { ...bests[stageId], timeMs, submitted: false };
  if (score !== undefined) bests[stageId].score = score;
  saveStageBests(bests);
}

// sum of the points banked across every stage best recorded so far — the
// "total hittil på ferden" number on the voyage result screen
export function voyageScoreTotal() {
  const bests = loadStageBests();
  return Object.values(bests).reduce((sum, b) => sum + (b.score || 0), 0);
}

// Stage 5 (the trophy homecoming) is rowed ONCE — the first completed run is
// final, never "best of several". Set in finishRace() the moment stage 5
// completes; every replay/re-submit path checks isStageFinal() first.
export function markStageFinal(stageId) {
  const bests = loadStageBests();
  bests[stageId] = { ...(bests[stageId] || { timeMs: 0, submitted: false }), final: true };
  saveStageBests(bests);
}

export function isStageFinal(stageId) {
  return !!loadStageBests()[stageId]?.final;
}

// call after submit-voyage successfully accepts this stage's token — its
// nonce is now spent, so it's excluded from every future submission unless
// a NEW best (and therefore a new token) supersedes it
export function markStageSubmitted(stageId) {
  const bests = loadStageBests();
  if (bests[stageId]) bests[stageId].submitted = true;
  saveStageBests(bests);
}

// player-requested "row it again" once the voyage is complete — starts a
// brand new journey from Stage 1. Their PREVIOUS completed voyage stays on
// the server leaderboard forever under the old voyageId; this only resets
// local progress-tracking state and mints a fresh voyageId so the new
// attempt gets its own identity (never blocked by the old one's stage-5
// 409 lock, since that lock is keyed per-voyageId server-side).
export function resetVoyage() {
  saveVoyage(defaultVoyage());
  saveStageBests({});
  try {
    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(VOYAGE_ID_KEY, id);
  } catch { /* storage unavailable — nothing to reset, getOrCreateVoyageId() already falls back per-call */ }
}
