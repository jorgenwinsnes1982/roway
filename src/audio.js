// Procedural WebAudio: splashes, dings, thuds, crowd — no asset files.
// Deliberate exception: public/sounds/drum.mp3 (Haaland's war drum, real
// recording) — see donk() below. Everything else here stays synthesised.
let ctx = null;
let master = null;      // SFX bus — all synthesised sounds + samples route here
let musicGain = null;   // separate bus for the looping background music track
let ambience = null;
let sfxMuted = false;   // sound effects off?
let musicMuted = false; // background music off? (the player's own Settings toggle)
let musicDucked = false; // background music silenced for the current screen (gameplay)?
const MUSIC_VOL = 0.32; // background music sits well under the SFX
const SFX_VOL = 0.5;    // SFX bus level when unmuted
const FADE_SEC = 2;     // toggles glide over 2s instead of cutting instantly
let musicBuffer = null, musicLoadStarted = false, musicSource = null;
let musicLoadFailed = false; // fetch/decode error — see isMusicLoadSettled()
// looping seagull ambience (public/sounds/sea_seagull.mp3) — audible on the
// menu/pre-race screens and (quieter) the result screens, silent through
// countdown+racing. Own gain node so its level is independent of both the
// SFX one-shots (still routes through `master`, so the Sound-effects toggle
// mutes it too) and the music bus.
let seagullBuffer = null, seagullLoadStarted = false, seagullSource = null, seagullGain = null;
const SEAGULL_VOL_MENU = 0.8;   // splash, how-to, stage card — "before the countdown"
const SEAGULL_VOL_RESULT = 0.6; // result screens — toned down per request
const SEAGULL_VOL_OFF = 0;      // countdown + racing
let introFadeGain = null;  // per-loop-cycle fade: silent through the instrumental head, ramps in for the vocal
let musicStartCtxTime = 0; // ctx.currentTime "zero" for the track's own position — see tryStartMusic()
const MUSIC_FADE_IN_START = 10; // seconds into the track — playback starts here, skipping the pure instrumental head
const MUSIC_FADE_IN_END = 14;   // seconds into the track — the vocal enters; full volume by here
let drumBuffer = null; // decoded sample — null until loaded, or forever if load/decode fails
let drumLoadStarted = false; // fetch is kicked off once, not once per initAudio() call
let roBuffer = null;   // decoded "RO!" shout recording — null until loaded / on failure
let roLoadStarted = false;
let roSource = null;   // the currently-playing RO so a new shout can cut off the old one
// button hover "sparkle" sfx — 3 variants, picked at random each hover (never
// the same one twice in a row if the next hover lands within 3s — see
// hoverSparkle() below). Slots fill in as each file decodes (independently,
// so a slow/failed one doesn't hold the others back); hoverSparkle() only
// ever picks among the slots that are actually loaded.
const HOVER_FILES = ['/sounds/hover1.mp3', '/sounds/hover2.mp3', '/sounds/hover3.mp3'];
let hoverBuffers = [null, null, null];
let hoverLoadStarted = false;
let lastHoverIdx = -1, lastHoverAt = -Infinity;
const HOVER_REPEAT_GUARD_MS = 3000;
const RO_SKIP = 0.05;  // seconds skipped at the head of the RO recording (dead air before the shout); higher = shout fires earlier
let splashBuffer = null, splashLoadStarted = false; // real oar-splash sample (public/sounds/ro_splash.mp3) — decode once
let hornBuffer = null, hornLoadStarted = false; // distant ship's horn (public/sounds/horn.mp3) — decode once

function ensureCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();              // SFX bus
    master.gain.value = sfxMuted ? 0 : SFX_VOL;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();           // music bus (independent toggle)
    musicGain.gain.value = (musicMuted || musicDucked) ? 0 : MUSIC_VOL;
    musicGain.connect(ctx.destination);
    seagullGain = ctx.createGain();         // seagull ambience — routes through master, so
    seagullGain.gain.value = SEAGULL_VOL_MENU; // sfxMuted already zeroes `master` itself
    seagullGain.connect(master);            // G.mode starts on the menu, hence the initial level
    // the moment a real gesture actually unlocks audio (state flips to
    // 'running') is the right moment to start looping tracks — see
    // tryStartMusic()/trySeagullLoop()
    ctx.addEventListener('statechange', () => {
      if (ctx.state === 'running') { tryStartMusic(); trySeagullLoop(); }
    });
  }
  // 'interrupted' is iOS-specific (phone call, Siri, app switch, lock) and
  // does NOT auto-resume — treat it exactly like 'suspended'.
  if (ctx.state === 'suspended' || ctx.state === 'interrupted') ctx.resume().catch(() => {});
  return ctx;
}

// Belt-and-braces resume for screen transitions (called from real button
// gestures, so iOS honours the resume): make sure the context exists and is
// running, the looping tracks are started (both are no-ops when already
// live), and the music bus sits at the level the current mute/duck flags
// say it should. Fixes "silent main menu" after iOS interrupted the audio
// session mid-race (call/Siri/app switch/lock) — nothing in the old flow
// ever resumed an 'interrupted' context unless a new SFX happened to fire.
export function resumeAudio() {
  ensureCtx();
  tryStartMusic();
  trySeagullLoop();
  applyMusicGain();
}

// When the page comes back to the foreground, iOS often leaves the context
// non-running. A programmatic resume outside a gesture may be refused —
// harmless (catch below); the statechange listener in ensureCtx() restarts
// the loops the moment it does succeed.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ctx && ctx.state !== 'running') {
    ctx.resume().catch(() => {});
  }
});

// Starts the track for real once BOTH are true: it's decoded, and the
// context is actually 'running' (i.e. a genuine gesture has unlocked audio —
// calling .start() while still suspended is silently a no-op until then).
// Playback begins at MUSIC_FADE_IN_START, skipping the pure-instrumental
// head entirely — the player never waits through it, silent or not; the
// track is just already "at" the fade-in the moment it's audible.
function tryStartMusic() {
  if (!musicBuffer || musicSource || !ctx || ctx.state !== 'running') return;
  introFadeGain = ctx.createGain();
  introFadeGain.gain.value = 0; // tickMusicFade() sets the correct value on its very next frame
  introFadeGain.connect(musicGain);
  musicSource = ctx.createBufferSource();
  musicSource.buffer = musicBuffer;
  musicSource.loop = true;
  musicSource.connect(introFadeGain);
  musicSource.start(0, MUSIC_FADE_IN_START);
  musicStartCtxTime = ctx.currentTime - MUSIC_FADE_IN_START; // so ctx.currentTime - musicStartCtxTime reads MUSIC_FADE_IN_START right now
  requestAnimationFrame(tickMusicFade);
}

// Same "decoded AND context running" gate as tryStartMusic(), for the
// seagull loop — started once and never stopped; audibility is purely
// seagullGain riding whatever level setSeagullScene() last set (so a scene
// change during the initial suspended/silent window is never lost).
function trySeagullLoop() {
  if (!seagullBuffer || seagullSource || !ctx || ctx.state !== 'running') return;
  seagullSource = ctx.createBufferSource();
  seagullSource.buffer = seagullBuffer;
  seagullSource.loop = true;
  seagullSource.connect(seagullGain);
  seagullSource.start();
}

// glide a GainParam to `target` over `sec`, re-anchoring from wherever it
// currently sits so rapid re-toggles stay smooth (no click, no jump)
function fadeGain(param, target, sec = FADE_SEC) {
  if (!ctx) return;
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(target, now + sec);
}

// SFX_MUTE_SEC (not FADE_SEC's 2s): the master bus carries one-shot hits
// (drum, kick, ding, ...), not a continuous track, so "off" needs to read as
// OFF right away — every per-sound function also early-returns on sfxMuted
// itself (defense in depth for anything fired mid-ramp), but the bus level
// still has to actually reach 0 fast, or a sound that started just before
// the toggle keeps ringing out at full volume for the next two seconds. Kept
// non-zero (not an instant jump) purely to avoid an audible click/pop.
const SFX_MUTE_SEC = 0.05;
export function setSfxMuted(m) {
  sfxMuted = m;
  if (master) fadeGain(master.gain, m ? 0 : SFX_VOL, SFX_MUTE_SEC);
}
export function isSfxMuted() { return sfxMuted; }

// Two independent reasons the music can be silent: the player's own Settings
// toggle (musicMuted) and the current screen (musicDucked — off during the
// race itself, on for menus/intro/results). Either one silences it.
function applyMusicGain() {
  if (musicGain) fadeGain(musicGain.gain, (musicMuted || musicDucked) ? 0 : MUSIC_VOL);
}
export function setMusicMuted(m) {
  musicMuted = m;
  applyMusicGain();
}
export function isMusicMuted() { return musicMuted; }
// whether the theme song fetch+decode is done, one way or the other — either
// musicBuffer is ready, or the attempt failed and there's nothing left to
// wait for. The boot preloader (see stepPreload() in main.js) holds itself
// open on this so the track is already decoded by the time a gesture can
// unlock playback, instead of the fade-in kicking in audibly late.
export function isMusicLoadSettled() { return musicBuffer !== null || musicLoadFailed; }
export function setMusicDucked(d) {
  musicDucked = d;
  applyMusicGain();
}

// Which screen the seagull ambience should read as: 'menu' (splash/how-to/
// stage card, before the countdown — 80%), 'result' (result screens —
// toned down to 60%, per request) or 'race' (countdown + racing — silent).
// Same fadeGain() glide as music ducking, so scene changes are never a click.
export function setSeagullScene(scene) {
  if (!seagullGain) return; // ctx not created yet — trySeagullLoop() starts silent-then-fades once it is
  const target = scene === 'menu' ? SEAGULL_VOL_MENU
    : scene === 'result' ? SEAGULL_VOL_RESULT
    : SEAGULL_VOL_OFF;
  fadeGain(seagullGain.gain, target);
}

// short "sparkle" when the cursor lands on a button — plays one of the 3
// loaded variants at random through the SFX bus (so the Sound-effects toggle
// mutes it); silent until at least one sample decodes, and skips any slot
// still missing. Never repeats the immediately-previous variant when the
// next hover follows within HOVER_REPEAT_GUARD_MS — outside that window a
// repeat is fine (enough time has passed that it doesn't read as looping).
export function hoverSparkle() {
  if (sfxMuted || !ctx) return;
  const loaded = hoverBuffers.map((b, i) => (b ? i : -1)).filter((i) => i >= 0);
  if (!loaded.length) return;
  const now = performance.now();
  const recentRepeat = now - lastHoverAt < HOVER_REPEAT_GUARD_MS;
  const pool = (recentRepeat && loaded.length > 1) ? loaded.filter((i) => i !== lastHoverIdx) : loaded;
  const idx = pool[(Math.random() * pool.length) | 0];
  const src = ctx.createBufferSource();
  src.buffer = hoverBuffers[idx];
  src.playbackRate.value = 0.97 + Math.random() * 0.06; // tiny variation so repeats don't feel mechanical
  const g = ctx.createGain();
  g.gain.value = 1.0; // loud enough to read clearly over the background music
  src.connect(g).connect(master);
  src.start();
  lastHoverIdx = idx;
  lastHoverAt = now;
}

// Rides the music's own playback position every loop (not wall-clock time,
// so it stays in sync even if the tab was backgrounded/throttled): silent
// through MUSIC_FADE_IN_START, linear ramp to full by MUSIC_FADE_IN_END.
function tickMusicFade() {
  if (introFadeGain && musicBuffer) {
    const dur = musicBuffer.duration;
    const elapsed = ((ctx.currentTime - musicStartCtxTime) % dur + dur) % dur;
    let v;
    if (elapsed < MUSIC_FADE_IN_START) v = 0;
    else if (elapsed < MUSIC_FADE_IN_END) v = (elapsed - MUSIC_FADE_IN_START) / (MUSIC_FADE_IN_END - MUSIC_FADE_IN_START);
    else v = 1;
    introFadeGain.gain.value = v;
  }
  requestAnimationFrame(tickMusicFade);
}

function noiseBuffer(dur = 1) {
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export function initAudio() {
  ensureCtx();
  // fire-and-forget: decode the drum sample once. donk() falls back to the
  // synth hit (donkSynth) for as long as drumBuffer is null — covers both
  // "still loading" and "fetch/decode failed" (offline, missing file) with
  // the same guard, no separate error state to track.
  if (!drumLoadStarted) {
    drumLoadStarted = true;
    fetch('/sounds/drum.mp3')
      .then((r) => r.arrayBuffer())
      .then((buf) => ctx.decodeAudioData(buf))
      .then((decoded) => { drumBuffer = decoded; })
      .catch(() => { /* stays null — donk() keeps using donkSynth() */ });
  }
  // same one-shot decode for the real "RO!" recording — roVoice() falls back
  // to speechSynthesis / a synth bark while roBuffer is null (loading or failed)
  if (!roLoadStarted) {
    roLoadStarted = true;
    fetch('/sounds/Ro-viking.m4a')
      .then((r) => r.arrayBuffer())
      .then((buf) => ctx.decodeAudioData(buf))
      .then((decoded) => { roBuffer = decoded; })
      .catch(() => { /* stays null — roVoice() keeps its fallback */ });
  }
  // oar-splash sample — decode once; oarSplash() is silent while null
  if (!splashLoadStarted) {
    splashLoadStarted = true;
    fetch('/sounds/ro_splash.mp3')
      .then((r) => r.arrayBuffer())
      .then((buf) => ctx.decodeAudioData(buf))
      .then((decoded) => { splashBuffer = decoded; })
      .catch(() => { /* stays null — oarSplash() is a no-op */ });
  }
  // distant ship's horn — decode once; hornSound() is silent while null
  if (!hornLoadStarted) {
    hornLoadStarted = true;
    fetch('/sounds/horn.mp3')
      .then((r) => r.arrayBuffer())
      .then((buf) => ctx.decodeAudioData(buf))
      .then((decoded) => { hornBuffer = decoded; })
      .catch(() => { /* stays null — hornSound() is a no-op */ });
  }
  // button hover sparkle — decode all 3 variants once, independently (a slow
  // or missing file just leaves that one slot null; hoverSparkle() already
  // only picks among loaded slots, so it's never blocked on all three)
  if (!hoverLoadStarted) {
    hoverLoadStarted = true;
    HOVER_FILES.forEach((url, i) => {
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((buf) => ctx.decodeAudioData(buf))
        .then((decoded) => { hoverBuffers[i] = decoded; })
        .catch(() => { /* slot stays null — hoverSparkle() skips it */ });
    });
  }
  // looping menu/screen theme on its own bus — decode once, then loop forever.
  // Silence (mute toggle, or ducked out during the race) is handled purely by
  // musicGain, so we start it once here regardless and never stop the source.
  // A second gain node (introFadeGain) sits BEFORE musicGain in the chain and
  // rides the track's own timeline every loop: silent through the
  // instrumental intro, fading in to land at full volume exactly as the
  // vocal enters — independent of, and multiplied with, the mute/duck gain.
  if (!musicLoadStarted) {
    musicLoadStarted = true;
    fetch('/sounds/roway-theme.mp3')
      .then((r) => r.arrayBuffer())
      .then((buf) => ctx.decodeAudioData(buf))
      .then((decoded) => {
        musicBuffer = decoded;
        tryStartMusic(); // no-op until the context is actually 'running' (real gesture)
      })
      .catch(() => { musicLoadFailed = true; /* no music — game is otherwise unaffected */ });
  }
  // looping seagull ambience — same decode-once/start-once/never-stop
  // approach as the theme above; audibility is purely setSeagullScene()
  // riding seagullGain, never the source's own play/pause state.
  if (!seagullLoadStarted) {
    seagullLoadStarted = true;
    fetch('/sounds/sea_seagull.mp3')
      .then((r) => r.arrayBuffer())
      .then((buf) => ctx.decodeAudioData(buf))
      .then((decoded) => {
        seagullBuffer = decoded;
        trySeagullLoop(); // no-op until the context is actually 'running' (real gesture)
      })
      .catch(() => { /* no seagulls — game is otherwise unaffected */ });
  }
  if (ambience) return;
  // looping wind + sea: filtered noise
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(3);
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  const g = ctx.createGain();
  g.gain.value = 0.12;
  src.connect(lp).connect(g).connect(master);
  src.start();
  // slow swell LFO
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.13;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 0.05;
  lfo.connect(lfoG).connect(g.gain);
  lfo.start();
  ambience = { src, g };
}

// oar blade hitting the water — a real recording (ro_splash.mp3), played
// low so it reads as a soft accent rather than a foley hit. Replaces the old
// procedural bandpass-filtered-noise splash(), which read as a "mechanical"
// tick rather than water (most noticeable during the intro's rapid bot
// cadence, where it repeated many times in a row). Silent until the sample
// decodes, and a no-op if the file is missing — no synth fallback, since a
// missing splash is far less jarring than a missing "RO!" shout would be.
export function oarSplash(vol = 1) {
  if (sfxMuted || !ctx || !splashBuffer || vol <= 0) return;
  const src = ctx.createBufferSource();
  src.buffer = splashBuffer;
  src.playbackRate.value = 0.94 + Math.random() * 0.12; // tiny variation so repeats don't feel mechanical
  const g = ctx.createGain();
  g.gain.value = 0.22 * Math.min(1, vol); // deliberately low — per request
  src.connect(g).connect(master);
  src.start();
}

// distant ship's horn (public/sounds/horn.mp3) — a rare splash-screen flavour
// sound (see scheduleSplashHorn() in main.js) and the "cast off" signal right
// as a race's countdown begins (startRace()). Unlike oarSplash's deliberately
// buried level, a horn is meant to be NOTICED, so it plays close to full SFX
// level rather than ducked down.
export function hornSound(vol = 1) {
  if (sfxMuted || !ctx || !hornBuffer || vol <= 0) return;
  const src = ctx.createBufferSource();
  src.buffer = hornBuffer;
  src.playbackRate.value = 0.97 + Math.random() * 0.06; // tiny variation so repeats don't feel mechanical
  const g = ctx.createGain();
  g.gain.value = Math.min(1, vol);
  src.connect(g).connect(master);
  src.start();
}

// ---- rhythm section: triggered from the game loop, locked to the stroke meter ----
export function kick(gain = 0.42) {
  if (sfxMuted || !ctx) return;
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, t0);
  o.frequency.exponentialRampToValueAtTime(44, t0 + 0.11);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
  o.connect(g).connect(master);
  o.start(t0); o.stop(t0 + 0.2);
}

export function hat(gain = 0.09) {
  if (sfxMuted || !ctx) return;
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.05);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.04);
  src.connect(hp).connect(g).connect(master);
  src.start();
}

export function bass(freq = 65.4, gain = 0.16) {
  if (sfxMuted || !ctx) return;
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = freq;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(500, t0);
  lp.frequency.exponentialRampToValueAtTime(140, t0 + 0.28);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.32);
  o.connect(lp).connect(g).connect(master);
  o.start(t0); o.stop(t0 + 0.36);
}

export function ding(pitch = 1) {
  if (sfxMuted || !ctx) return;
  const t0 = ctx.currentTime;
  for (const [f, d] of [[880 * pitch, 0], [1318.5 * pitch, 0.07]]) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(0.22, t0 + d + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.5);
    o.connect(g).connect(master);
    o.start(t0 + d);
    o.stop(t0 + d + 0.6);
  }
}

export function thud() {
  if (sfxMuted || !ctx) return;
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(120, t0);
  o.frequency.exponentialRampToValueAtTime(38, t0 + 0.25);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.5, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + 0.35);
  // crack noise
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.15);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1400;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.18, t0);
  ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
  src.connect(hp).connect(ng).connect(master);
  src.start();
}

// Haaland's war drum: deep "donk" — plays the real drum.mp3 sample once
// decoded (see initAudio()), falls back to the procedural donkSynth() hit
// for as long as it isn't (still loading, or failed to load/decode —
// offline, missing file). The gain parameter and call signature are
// unchanged either way, so callers never need to know which path fired.
export function donk(gain = 0.55, pitchMult = 1) {
  if (sfxMuted || !ctx) return;
  if (!drumBuffer) { donkSynth(gain, pitchMult); return; }
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = drumBuffer;
  src.playbackRate.value = (0.97 + Math.random() * 0.06) * pitchMult; // avoid two hits sounding machine-identical
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(master);
  src.start(t0);
  // the sample has a real hit followed by ~7.6 s of near-silent tail baked
  // in (measured via ffprobe/silencedetect) — trim it so the node doesn't
  // sit around doing nothing for that long, especially with donk() firing
  // every ~1-2 s during a race
  src.stop(t0 + 2.5);
}

// the original procedural hit — kept as the fallback, not deleted
function donkSynth(gain = 0.55, pitchMult = 1) {
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(165 * pitchMult, t0);
  o.frequency.exponentialRampToValueAtTime(72 * pitchMult, t0 + 0.16);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
  o.connect(g).connect(master);
  o.start(t0); o.stop(t0 + 0.26);
  // skin slap
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.06);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 900;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.12, t0);
  ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
  src.connect(bp).connect(ng).connect(master);
  src.start();
}

// The coxswain's shout: "RO!" — real recording (Ro-viking.m4a) if it has
// decoded, otherwise speechSynthesis, otherwise a synth bark.
export function roVoice() {
  if (sfxMuted) return; // the shout is a sound effect
  // preferred: the real recorded shout, played through master (mute-aware)
  if (roBuffer && ctx) {
    if (roSource) { try { roSource.stop(); } catch { /* already ended */ } }
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = roBuffer;
    const g = ctx.createGain();
    g.gain.value = 0.9;
    src.connect(g).connect(master);
    src.onended = () => { if (roSource === src) roSource = null; };
    roSource = src;
    // Ro-viking.m4a has ~0.128 s of dead air before the actual shout, which
    // made the "RO!" land a touch late. Start playback partway in to skip most
    // of that lead-in so the shout fires promptly. Tune RO_SKIP up = earlier.
    src.start(t0, RO_SKIP);
    return;
  }
  let spoke = false;
  try {
    if (window.speechSynthesis) {
      speechSynthesis.cancel(); // never queue up ROs
      const u = new SpeechSynthesisUtterance('RO!');
      u.lang = 'nb-NO';
      u.rate = 1.15;
      u.pitch = 0.65;
      u.volume = 0.9;
      speechSynthesis.speak(u);
      spoke = true;
    }
  } catch { /* fall through to synth bark */ }
  if (!spoke && ctx) {
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t0);
    o.frequency.exponentialRampToValueAtTime(95, t0 + 0.3);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2.5;
    f.frequency.setValueAtTime(650, t0);
    f.frequency.exponentialRampToValueAtTime(380, t0 + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t0);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.34);
    o.connect(f).connect(g).connect(master);
    o.start(t0); o.stop(t0 + 0.4);
  }
}

export function whoosh() {
  if (sfxMuted || !ctx) return;
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.7);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(300, t0);
  bp.frequency.exponentialRampToValueAtTime(2600, t0 + 0.35);
  bp.frequency.exponentialRampToValueAtTime(900, t0 + 0.65);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.001, t0);
  g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.18);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.68);
  src.connect(bp).connect(g).connect(master);
  src.start();
}

export function whistle() {
  if (sfxMuted || !ctx) return;
  const t0 = ctx.currentTime;
  // referee whistle: two quick trills
  for (const d of [0, 0.18]) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 2200;
    const trill = ctx.createOscillator();
    trill.frequency.value = 40;
    const tg = ctx.createGain();
    tg.gain.value = 300;
    trill.connect(tg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + d + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.15);
    o.connect(g).connect(master);
    o.start(t0 + d); o.stop(t0 + d + 0.2);
    trill.start(t0 + d); trill.stop(t0 + d + 0.2);
  }
}

// firework detonation: deep thump + airy crack
export function fireworkBoom(gain = 0.3) {
  if (sfxMuted || !ctx) return;
  const t0 = ctx.currentTime + Math.random() * 0.05;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(70, t0);
  o.frequency.exponentialRampToValueAtTime(28, t0 + 0.4);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
  o.connect(g).connect(master);
  o.start(t0); o.stop(t0 + 0.55);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.4);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(2600, t0);
  lp.frequency.exponentialRampToValueAtTime(300, t0 + 0.35);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(gain * 0.8, t0);
  ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
  src.connect(lp).connect(ng).connect(master);
  src.start(t0);
}

export function crowd() {
  if (sfxMuted || !ctx) return;
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(3);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 800;
  bp.Q.value = 0.4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.001, t0);
  g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.4);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 2.8);
  src.connect(bp).connect(g).connect(master);
  src.start();
  // stadium horn
  for (const [f, d] of [[233, 0.1], [311, 0.1], [233, 0.9], [311, 0.9]]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0 + d);
    og.gain.exponentialRampToValueAtTime(0.07, t0 + d + 0.05);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.6);
    o.connect(og).connect(master);
    o.start(t0 + d);
    o.stop(t0 + d + 0.7);
  }
}
