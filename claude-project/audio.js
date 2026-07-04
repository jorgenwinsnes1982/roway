// Procedural WebAudio: splashes, dings, thuds, crowd — no asset files.
let ctx = null;
let master = null;
let ambience = null;
let muted = false;

function ensureCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.5;
}

export function isMuted() {
  return muted;
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

export function splash(power = 1) {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.4);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(900 + power * 500, ctx.currentTime);
  bp.frequency.exponentialRampToValueAtTime(250, ctx.currentTime + 0.3);
  bp.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.35 * (0.5 + power * 0.5), ctx.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
  src.connect(bp).connect(g).connect(master);
  src.start();
  src.stop(ctx.currentTime + 0.45);
}

// ---- rhythm section: triggered from the game loop, locked to the stroke meter ----
export function kick(gain = 0.42) {
  if (!ctx) return;
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
  if (!ctx) return;
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
  if (!ctx) return;
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
  if (!ctx) return;
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
  if (!ctx) return;
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

// Haaland's war drum: deep "donk"
export function donk(gain = 0.55) {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(165, t0);
  o.frequency.exponentialRampToValueAtTime(72, t0 + 0.16);
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

// The coxswain's shout: "RO!" — real voice if the browser has one, synth bark otherwise
export function roVoice() {
  if (muted) return;
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
  if (!ctx) return;
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
  if (!ctx) return;
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
  if (!ctx) return;
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
  if (!ctx) return;
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
