// ================= Fase 4a: Oppdrag + R-O-W-A-Y-bokstavjakt =================
// Two extra reasons for "one more run" beyond the leaderboard. Both pay out
// in voyage metres (src/voyage.js) — they never touch the leaderboard/score.

// Tunable rewards — design decisions live here:
export const MISSION_REWARD_M = 500;   // voyage metres per completed mission
export const ROWAY_REWARD_M   = 2500;  // completing the full letter set

const MISSIONS_KEY = 'roway.missions.v1';
const ACTIVE_SLOTS = 3;

// `kind`:
//   'cumulative' — get(stats) is added to progress every race, never resets
//   'run'        — check(stats) must be true in a SINGLE race to complete
//   'streak'     — check(stats) increments progress on success, RESETS TO 0
//                  on failure (Regel 7: this is the mission's definition,
//                  not a penalty — no other mission kind ever loses progress)
export const MISSIONS = [
  { id: 'balls100', text: 'Collect 100 footballs total', kind: 'cumulative', get: (s) => s.balls, target: 100 },
  { id: 'dist50k', text: 'Row 50,000 m total', kind: 'cumulative', get: (s) => s.distance, target: 50000 },
  { id: 'races10', text: 'Complete 10 races', kind: 'cumulative', get: () => 1, target: 10 },
  { id: 'perfect25', text: '25 perfect strokes total', kind: 'cumulative', get: (s) => s.perfect, target: 25 },
  { id: 'gates50', text: 'Row through 50 gates total', kind: 'cumulative', get: (s) => s.gates, target: 50 },
  { id: 'perfect15run', text: '15 perfect strokes in one race', kind: 'run', check: (s) => s.perfect >= 15 },
  { id: 'allGates', text: 'All 9 gates in one race', kind: 'run', check: (s) => s.gates >= 9 },
  { id: 'noIceWin', text: 'Win without hitting a single ice floe', kind: 'run', check: (s) => s.win && !s.hitIce },
  { id: 'maxSpeed', text: 'Reach MAX SPEED', kind: 'run', check: (s) => s.reachedMax },
  { id: 'balls20run', text: 'Collect 20 footballs in one race', kind: 'run', check: (s) => s.balls >= 20 },
  { id: 'winStreak3', text: 'Win 3 races in a row', kind: 'streak', check: (s) => s.win, target: 3 },
];

function defaultMissionsState() {
  return { active: MISSIONS.slice(0, ACTIVE_SLOTS).map((m) => m.id), progress: {}, completed: [] };
}

export function loadMissions() {
  try {
    const v = JSON.parse(localStorage.getItem(MISSIONS_KEY));
    if (v && Array.isArray(v.active) && v.progress && Array.isArray(v.completed)) return v;
  } catch { /* corrupt/missing — fall through to a fresh mission board */ }
  return defaultMissionsState();
}

function saveMissions(v) {
  try { localStorage.setItem(MISSIONS_KEY, JSON.stringify(v)); }
  catch { /* storage full — this run's mission progress just won't persist */ }
}

function missionById(id) {
  return MISSIONS.find((m) => m.id === id) || null;
}

// call once per completed race (finishRace() only — never on a restart/abort)
export function recordRun(stats) {
  const state = loadMissions();
  const completedNow = [];

  for (const id of state.active.slice()) {
    const m = missionById(id);
    if (!m) continue;
    const target = m.target ?? 1;
    if (m.kind === 'cumulative') {
      state.progress[id] = (state.progress[id] || 0) + m.get(stats);
    } else if (m.kind === 'run') {
      if (m.check(stats)) state.progress[id] = target;
    } else if (m.kind === 'streak') {
      state.progress[id] = m.check(stats) ? (state.progress[id] || 0) + 1 : 0;
    }
    if ((state.progress[id] || 0) >= target) {
      completedNow.push(m);
      state.completed.push(id);
      state.active = state.active.filter((a) => a !== id);
      const next = MISSIONS.find((x) => !state.completed.includes(x.id) && !state.active.includes(x.id));
      if (next) state.active.push(next.id);
    }
  }

  // every mission done — recycle rather than leaving the board permanently
  // empty, so there's always "one more run" to chase (design choice: a
  // completionist player shouldn't run out of reasons to keep rowing)
  if (state.completed.length >= MISSIONS.length && state.active.length === 0) {
    state.completed = [];
    state.progress = {};
    state.active = MISSIONS.slice(0, ACTIVE_SLOTS).map((m) => m.id);
  }

  saveMissions(state);
  return { completed: completedNow };
}

export function activeMissionsWithProgress() {
  const state = loadMissions();
  return state.active.map((id) => {
    const m = missionById(id);
    return { ...m, progress: state.progress[id] || 0, target: m.target ?? 1 };
  });
}

// ================= Bokstavjakten: R-O-W-A-Y =================
const LETTERS_KEY = 'roway.letters.v1';
export const ROWAY_LETTERS = ['R', 'O', 'W', 'A', 'Y'];

function defaultLettersState() {
  return { have: [], rounds: 0 };
}

export function loadLetters() {
  try {
    const v = JSON.parse(localStorage.getItem(LETTERS_KEY));
    if (v && Array.isArray(v.have)) {
      return { have: v.have.filter((c) => ROWAY_LETTERS.includes(c)), rounds: v.rounds | 0 };
    }
  } catch { /* corrupt/missing — fall through to a fresh hunt */ }
  return defaultLettersState();
}

function saveLetters(v) {
  try { localStorage.setItem(LETTERS_KEY, JSON.stringify(v)); }
  catch { /* storage full — this pickup just won't persist */ }
}

// deterministic R->O->W->A->Y order keeps progress legible; null once you
// already have every letter (shouldn't normally happen — collectLetter()
// resets `have` the moment the set completes)
export function nextLetter(have) {
  return ROWAY_LETTERS.find((c) => !have.includes(c)) || null;
}

export function letterProgressText(have) {
  return ROWAY_LETTERS.map((c) => (have.includes(c) ? c : '_')).join(' ');
}

// call once per completed race, only if a letter was actually picked up
// (Regel 1: the pickup itself is per-race state — see G.letterTaken in
// main.js — this is the single place it's committed to storage)
export function collectLetter(char) {
  const v = loadLetters();
  if (!v.have.includes(char)) v.have.push(char);
  const complete = v.have.length >= ROWAY_LETTERS.length;
  if (complete) { v.have = []; v.rounds++; }
  saveLetters(v);
  return { complete, have: v.have, rounds: v.rounds };
}
