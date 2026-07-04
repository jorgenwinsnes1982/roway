import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createWater, sampleWater } from './water.js';
import { buildShip, poseStroke, cyclePose } from './ship.js';
import { createSky, createFjord, createClouds, createCourse, updateCourse, createSeagulls, createFogBanks, COURSE_LENGTH, CHANNEL_HALF } from './world.js';
import { initAudio, splash, ding, thud, whistle, crowd, kick, hat, bass, whoosh, donk, roVoice, fireworkBoom, setMuted, isMuted } from './audio.js';
import { createLogoFX } from './logo.js';
import { createShieldFX } from './shield.js';

// ================= Renderer / Scene =================
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG_COLOR = 0x8fa9cf; // dusky blue — matches the blue-hour sky
scene.fog = new THREE.Fog(FOG_COLOR, 320, 1150);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.5, 5200);

// ---- post-processing: bloom makes the sun, water glitter and lanterns glow ----
const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    samples: 4,
    type: THREE.HalfFloatType,
  })
);
composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.45,  // strength
  0.55,  // radius
  0.9    // threshold — only truly bright things bloom
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// lights
const sunDir = new THREE.Vector3(0.35, 0.32, -0.88).normalize();
const sun = new THREE.DirectionalLight(0xffe0b8, 2.2);
sun.position.copy(sunDir).multiplyScalar(300);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x9db8dd, 0x16304f, 0.75));

// world
const sky = createSky();
scene.add(sky);
const water = createWater({ sunDir, fogColor: FOG_COLOR, fogNear: 320, fogFar: 1150 });
scene.add(water.mesh);
scene.add(createFjord());
scene.add(createClouds());
scene.add(createFogBanks());
const seagulls = createSeagulls();
scene.add(seagulls.group);
const course = createCourse(scene);

// ship
const shipData = buildShip('norway');
const ship = shipData.ship;
scene.add(ship);
// warm lantern light over the deck
const deckLight = new THREE.PointLight(0xff9540, 14, 26, 2);
deckLight.position.set(0, 4, 0);
ship.add(deckLight);

// rival ship — Sweden
const rivalData = buildShip('sweden');
const rival = rivalData.ship;
scene.add(rival);
const R = {
  x: 14, z: 0, speed: 0, heading: 0, strokePhase: 0.5, finishTime: null, pace: 13.4,
  aimOff: 8, wobble: 0, bomT: 0,
};
// rival follows the gate line (same sine the gates were laid out with)
function rivalPathX(z) {
  const t = (-z - 140) / (COURSE_LENGTH - 300) * 9;
  const clamped = Math.max(0, Math.min(9, t));
  return Math.sin(clamped * 1.7) * (CHANNEL_HALF - 30);
}

// "BOM!" callout sprite that pops over the rival when it misses a gate
const bomSprite = (() => {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(216, 26, 63, 0.92)';
  g.beginPath();
  g.roundRect(14, 24, 228, 80, 20);
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.font = '900 52px "Avenir Next", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.fillText('BOM!', 128, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(12, 6, 1);
  sp.visible = false;
  scene.add(sp);
  return sp;
})();

// ================= Particles: oar splashes + wake =================
const MAX_P = 420;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(MAX_P * 3);
const pAlpha = new Float32Array(MAX_P);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1));
const pMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: {},
  vertexShader: `
    attribute float aAlpha;
    varying float vA;
    void main() {
      vA = aAlpha;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = 130.0 * aAlpha / -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    varying float vA;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      float a = smoothstep(0.5, 0.1, d) * vA * 0.85;
      gl_FragColor = vec4(0.92, 0.97, 1.0, a);
    }`,
});
const particles = new THREE.Points(pGeo, pMat);
particles.frustumCulled = false;
scene.add(particles);
const pool = [];
for (let i = 0; i < MAX_P; i++) pool.push({ i, life: 0, vx: 0, vy: 0, vz: 0 });
let poolIdx = 0;
function spawnParticle(x, y, z, vx, vy, vz, life = 1) {
  const p = pool[poolIdx];
  poolIdx = (poolIdx + 1) % MAX_P;
  p.life = life;
  p.maxLife = life;
  p.vx = vx; p.vy = vy; p.vz = vz;
  pPos[p.i * 3] = x; pPos[p.i * 3 + 1] = y; pPos[p.i * 3 + 2] = z;
}
function updateParticles(dt) {
  for (const p of pool) {
    if (p.life <= 0) { pAlpha[p.i] = 0; continue; }
    p.life -= dt;
    p.vy -= 9.8 * dt * 0.55;
    pPos[p.i * 3] += p.vx * dt;
    pPos[p.i * 3 + 1] += p.vy * dt;
    pPos[p.i * 3 + 2] += p.vz * dt;
    pAlpha[p.i] = Math.max(0, p.life / p.maxLife);
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.aAlpha.needsUpdate = true;
}

// ================= Fireworks (finish celebration) =================
const FW_MAX = 1000;
const fwGeo = new THREE.BufferGeometry();
const fwPos = new Float32Array(FW_MAX * 3);
const fwCol = new Float32Array(FW_MAX * 3);
const fwAlpha = new Float32Array(FW_MAX);
fwGeo.setAttribute('position', new THREE.BufferAttribute(fwPos, 3));
fwGeo.setAttribute('aColor', new THREE.BufferAttribute(fwCol, 3));
fwGeo.setAttribute('aAlpha', new THREE.BufferAttribute(fwAlpha, 1));
const fwMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: `
    attribute float aAlpha;
    attribute vec3 aColor;
    varying float vA;
    varying vec3 vC;
    void main() {
      vA = aAlpha; vC = aColor;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = 1050.0 * aAlpha / -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    varying float vA;
    varying vec3 vC;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      gl_FragColor = vec4(vC * 1.6, smoothstep(0.5, 0.08, d) * vA);
    }`,
});
const fwPoints = new THREE.Points(fwGeo, fwMat);
fwPoints.frustumCulled = false;
scene.add(fwPoints);
const fwPool = [];
for (let i = 0; i < FW_MAX; i++) fwPool.push({ i, life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0 });
let fwIdx = 0;
const FW_COLORS = [0xff3355, 0xffffff, 0x3a6fff, 0xffd25e, 0x59ff90];
const _fwC = new THREE.Color();

function spawnFireworkBurst(x, y, z, colorHex, count = 70) {
  _fwC.setHex(colorHex);
  for (let n = 0; n < count; n++) {
    const p = fwPool[fwIdx];
    fwIdx = (fwIdx + 1) % FW_MAX;
    // spherical shell burst
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const sp = 9 + Math.random() * 8;
    p.vx = Math.sin(ph) * Math.cos(th) * sp;
    p.vy = Math.cos(ph) * sp;
    p.vz = Math.sin(ph) * Math.sin(th) * sp;
    p.life = p.maxLife = 1.1 + Math.random() * 0.7;
    fwPos[p.i * 3] = x; fwPos[p.i * 3 + 1] = y; fwPos[p.i * 3 + 2] = z;
    fwCol[p.i * 3] = _fwC.r; fwCol[p.i * 3 + 1] = _fwC.g; fwCol[p.i * 3 + 2] = _fwC.b;
  }
  fwGeo.attributes.aColor.needsUpdate = true;
  fireworkBoom(0.22 + Math.random() * 0.14);
}

function updateFireworks(dt) {
  let any = false;
  for (const p of fwPool) {
    if (p.life <= 0) { fwAlpha[p.i] = 0; continue; }
    any = true;
    p.life -= dt;
    p.vy -= 5.5 * dt;       // gravity
    p.vx *= 1 - dt * 0.6;   // air drag
    p.vy *= 1 - dt * 0.25;
    p.vz *= 1 - dt * 0.6;
    fwPos[p.i * 3] += p.vx * dt;
    fwPos[p.i * 3 + 1] += p.vy * dt;
    fwPos[p.i * 3 + 2] += p.vz * dt;
    const k = Math.max(0, p.life / p.maxLife);
    // twinkle as they fall
    fwAlpha[p.i] = k * (0.65 + 0.35 * Math.sin(p.life * 34 + p.i));
  }
  if (any || fwWasAlive) {
    fwGeo.attributes.position.needsUpdate = true;
    fwGeo.attributes.aAlpha.needsUpdate = true;
  }
  fwWasAlive = any;
}
let fwWasAlive = false;
let fwTimer = 0;

function clearFireworks() {
  for (const p of fwPool) p.life = 0;
  fwWasAlive = true; // force one buffer flush
}

// ================= Ghost boat: replay of your best run =================
const GHOST_KEY = 'vikingferd_ghost';
const GH = { shipData: null, ship: null, data: null, idx: 0, phase: 0, lead: null };

function buildGhostShip() {
  if (GH.ship) return;
  GH.shipData = buildShip('norway');
  GH.ship = GH.shipData.ship;
  // hologram look: one shared translucent material for every part
  const ghostMat = new THREE.MeshBasicMaterial({
    color: 0x9fd8ff, transparent: true, opacity: 0.26, depthWrite: false,
  });
  GH.ship.traverse((o) => {
    if (o.isSprite) { o.visible = false; return; } // no HAALAND plate on the ghost
    if (o.isMesh) o.material = ghostMat;
  });
  // subtle label so you know who you're chasing
  const c = document.createElement('canvas');
  c.width = 256; c.height = 56;
  const g = c.getContext('2d');
  g.font = '800 30px "Avenir Next", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(159, 216, 255, 0.85)';
  g.fillText('DITT BESTE', 128, 30);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.8, depthWrite: false }));
  label.scale.set(5.4, 1.2, 1);
  label.position.set(0, 11, 0);
  GH.ship.add(label);
  scene.add(GH.ship);
}

// called from startRace: pick up whatever best-run recording exists right now
function loadGhostForRace() {
  try { GH.data = JSON.parse(localStorage.getItem(GHOST_KEY)) || null; }
  catch { GH.data = null; }
  if (GH.data && Array.isArray(GH.data) && GH.data.length > 1) {
    buildGhostShip();
    GH.ship.visible = true;
  } else if (GH.ship) {
    GH.ship.visible = false;
  }
  GH.idx = 0;
  GH.phase = 0;
  GH.lead = null;
}

// ================= Cinematic intro (5 s before the splash reveals) =================
const INTRO = { active: true, t: 0 };
// three cuts: low past the dragon head → sweep across both ships → rise into menu cam
const INTRO_SHOTS = [
  { dur: 1.9, from: [-16, 2.2, -30], to: [-20, 3.4, -2], lookFrom: [0, 4, -14], lookTo: [0, 3, 3], fovFrom: 54, fovTo: 50 },
  { dur: 1.6, from: [27, 2.8, 8], to: [21, 6.0, -15], lookFrom: [6, 3, 0], lookTo: [7, 4, -7], fovFrom: 52, fovTo: 48 },
  { dur: 1.7, from: [0, 6.0, 42], to: [0, 15.5, 27], lookFrom: [0, 5, 0], lookTo: [0, 1.2, -34], fovFrom: 48, fovTo: 58 },
];
const _iv1 = new THREE.Vector3();
const _iv2 = new THREE.Vector3();

function runIntroCamera(dt) {
  INTRO.t += dt;
  let t = INTRO.t;
  let shot = null;
  for (const s of INTRO_SHOTS) {
    if (t <= s.dur) { shot = s; break; }
    t -= s.dur;
  }
  if (!shot) { endIntro(); return; }
  const k = t / shot.dur;
  const e = k * k * (3 - 2 * k); // ease in-out within each cut
  _iv1.fromArray(shot.from).lerp(_iv2.fromArray(shot.to), e);
  camera.position.copy(_iv1);
  _iv1.fromArray(shot.lookFrom).lerp(_iv2.fromArray(shot.lookTo), e);
  camera.lookAt(_iv1);
  camera.fov = shot.fovFrom + (shot.fovTo - shot.fovFrom) * e;
  camera.updateProjectionMatrix();
}

function endIntro() {
  if (!INTRO.active) return;
  INTRO.active = false;
  camPos.set(0, 15.5, 27); // hand over seamlessly to the menu chase camera
  document.getElementById('cinebars').classList.remove('on');
  hud.startScreen.classList.remove('hidden');
  // choreographed entrance: the shield lands first, the wordmark follows
  shieldFX.reveal();
  setTimeout(() => logoFX.reveal(), 220);
}

// any key or tap skips the intro (and swallows the event so it doesn't hit menus)
function maybeSkipIntro(e) {
  if (!INTRO.active) return;
  e.stopImmediatePropagation(); // the skip-press must not reach the menu handlers
  e.stopPropagation();
  endIntro();
}
window.addEventListener('keydown', maybeSkipIntro, { capture: true });
window.addEventListener('pointerdown', maybeSkipIntro, { capture: true });

// ================= Game state =================
const G = {
  mode: 'menu', // menu | countdown | racing | finished
  speed: 0,
  heading: 0, // radians, 0 = straight down -z
  steer: 0,   // smoothed steering input
  paused: false, // restart-confirm dialog freezes the world
  x: 0,
  z: 0,
  time: 0,
  balls: 0,
  perfect: 0,
  strokes: 0,
  boost: 0,          // boost timer
  stunned: 0,        // hit timer
  combo: 0,          // consecutive perfect strokes
  bar: 0,            // music bar counter
  prevMeterT: 0,
  hitStop: 0,        // slow-mo timer after crash
  fovPunch: 0,       // camera kick on perfect strokes
  ghostRec: [],      // this run's recording: [t, x, z, heading] samples
  ghostSampleT: 0,   // countdown to the next ghost sample
  strokePhase: 0,    // idle rowing cycle (menu/finished)
  lastStrokeAt: -9,
  charging: false,   // holding the oars — power building
  charge: 0,         // 0..CHARGE_OVER while holding
  driveT: 0,         // drive animation timer after release
  reach: -0.12,      // oar sweep: -1 catch (bow) .. +1 finish (stern)
  dip: 0,            // 0 blades high .. 1 buried
  driveFrom: -1,     // reach captured at the moment of release
  countdownT: 0,
  finishT: 0,
};
const STROKE_CYCLE = 1.35; // rival's rowing cycle

// ---- Haaland's tempo drum: donk, donk … RO! ----
const TEMPO_MAX = 8;
const T = {
  phase: 0,       // 0..1 through the drum cycle; RO! fires at wrap
  period: 2.35,   // seconds per cycle — shrinks as tempo builds
  level: 0,       // 0..TEMPO_MAX — raises the speed cap
  lastRoAt: -9,   // game-time of the last RO! shout
  hitL: 0, hitR: 0, // drum-arm strike timers
  maxAnnounced: false,
};
const CHARGE_TIME = 0.95;  // seconds of holding to reach full power
const CHARGE_PERFECT_LO = 0.78, CHARGE_PERFECT_HI = 1.08; // release window (with grace past full)
const CHARGE_GOOD_LO = 0.55;
const CHARGE_OVER = 1.18;  // held too long → oars slip, auto-release
const BEST_KEY = 'vikingferd_best';

// ================= Input =================
const keys = {};
let steerTouch = 0;
window.addEventListener('keydown', (e) => {
  // typing a name on the leaderboard must never drive the game
  if (e.target && e.target.tagName === 'INPUT') return;
  if (e.repeat) return;
  keys[e.code] = true;
  if (e.code === 'Space') {
    e.preventDefault();
    if (G.mode === 'racing' || G.mode === 'countdown') beginCharge();
    else if (G.mode === 'menu') {
      // splash → how-to; from the how-to modal Space launches the race
      if (!hud.howtoScreen.classList.contains('hidden')) startRace();
      else showHowto();
    }
    else if (G.mode === 'finished' && G.finishT > 1.2 && G.resultStage === 2) startRace();
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Space') releaseStroke();
});

// pointer (mouse / bare touch): hold = charge, release = row, horizontal drag = steer.
// Buttons and inputs handle themselves — and only the pointer that STARTED a charge
// may release it, so a steering finger lifting never cuts your stroke short.
let touchStartX = null;
let chargePtr = null;
window.addEventListener('pointerdown', (e) => {
  if (e.target && e.target.closest && e.target.closest('button, input')) return;
  touchStartX = e.clientX;
  if ((G.mode === 'racing' || G.mode === 'countdown') && !G.charging) {
    beginCharge();
    if (G.charging) chargePtr = e.pointerId;
  }
});
window.addEventListener('pointermove', (e) => {
  if (touchStartX === null) return;
  steerTouch = THREE.MathUtils.clamp((e.clientX - touchStartX) / 120, -1, 1);
});
function pointerEnd(e) {
  touchStartX = null;
  steerTouch = 0;
  if (chargePtr !== null && e.pointerId === chargePtr) {
    chargePtr = null;
    releaseStroke();
  }
}
window.addEventListener('pointerup', pointerEnd);
window.addEventListener('pointercancel', pointerEnd);
window.addEventListener('blur', () => { chargePtr = null; releaseStroke(); }); // don't strand a held stroke

// ================= HUD =================
const $ = (id) => document.getElementById(id);
const hud = {
  topbar: $('topbar'), time: $('hudTime'), speed: $('hudSpeed'), dist: $('hudDist'), balls: $('hudBalls'),
  pos: $('hudPos'), posPill: $('posPill'),
  meterWrap: $('strokeMeterWrap'), fill: $('strokeFill'), zone: $('strokeZone'),
  zoneGood: $('strokeZoneGood'), meter: $('strokeMeter'),
  feedback: $('feedback'), vignette: $('vignette'), countdown: $('countdown'),
  boostGlow: $('boostGlow'), hitFlash: $('hitFlash'),
  roCue: $('roCue'), tempoDots: $('tempoDots'),
  startScreen: $('startScreen'), resultScreen: $('resultScreen'),
  resTime: $('resTime'), resBest: $('resBest'), resBalls: $('resBalls'), resPerfect: $('resPerfect'),
  resultTitle: $('resultTitle'), resultSub: $('resultSub'), medal: $('medal'),
  resScore: $('resScore'), scoreBreakdown: $('scoreBreakdown'),
  saveRow: $('saveRow'), aliasInput: $('aliasInput'), saveScoreBtn: $('saveScoreBtn'), savedMsg: $('savedMsg'),
  leaderboard: $('leaderboard'), lbStart: $('lbStart'), lbStartWrap: $('lbStartWrap'),
  placeBanner: $('placeBanner'), skipSaveBtn: $('skipSaveBtn'), lbResultWrap: $('lbResultWrap'), retryBtn: $('retryBtn'),
  howtoScreen: $('howtoScreen'), lbScreen: $('lbScreen'), touchControls: $('touchControls'),
  restartBtn: $('restartBtn'), confirmScreen: $('confirmScreen'),
};
// gold release-zone at the top of the charge bar; "good" band just before it
hud.zone.style.left = CHARGE_PERFECT_LO * 100 + '%';
hud.zone.style.width = (1 - CHARGE_PERFECT_LO) * 100 + '%';
hud.zoneGood.style.left = CHARGE_GOOD_LO * 100 + '%';
hud.zoneGood.style.width = (CHARGE_PERFECT_LO - CHARGE_GOOD_LO) * 100 + '%';

// build the 8 tempo dots
for (let i = 0; i < TEMPO_MAX; i++) hud.tempoDots.appendChild(document.createElement('i'));

// WebGL splash logo + shield (fall back to HTML title / static img on failure)
const logoFX = createLogoFX();
const shieldFX = createShieldFX();

// ---- menu flow: splash → how-to modal → race; leaderboard behind its own button ----
function showHowto() {
  hud.startScreen.classList.add('hidden');
  hud.lbScreen.classList.add('hidden');
  hud.howtoScreen.classList.remove('hidden');
}
$('startBtn').addEventListener('click', showHowto);
$('goBtn').addEventListener('click', startRace);
$('lbBtn').addEventListener('click', () => {
  renderLeaderboards();
  hud.startScreen.classList.add('hidden');
  hud.lbScreen.classList.remove('hidden');
});
$('lbCloseBtn').addEventListener('click', () => {
  hud.lbScreen.classList.add('hidden');
  hud.startScreen.classList.remove('hidden');
});
$('retryBtn').addEventListener('click', startRace);

// ---- mobile touch controls: hold-buttons for steering and rowing ----
let touchSteerBtn = 0;
function bindHoldButton(el, onDown, onUp) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
    onDown();
  });
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
bindHoldButton($('btnL'), () => { touchSteerBtn = -1; }, () => { touchSteerBtn = 0; });
bindHoldButton($('btnR'), () => { touchSteerBtn = 1; }, () => { touchSteerBtn = 0; });
bindHoldButton($('rowBtn'), () => {
  if (G.mode === 'racing' || G.mode === 'countdown') beginCharge();
}, releaseStroke);

// ================= Leaderboard (global + local fallback) =================
const LB_KEY = 'vikingferd_leaderboard';      // local backup list
const ALIAS_KEY = 'vikingferd_alias';
const GLOBAL_CACHE_KEY = 'vikingferd_global_cache'; // last good global list (offline)
// Shared secret for the submission signature. It ships in the client bundle,
// so it only raises the bar (see submit-score.js threat model). Vite exposes
// only VITE_-prefixed vars to the client.
const SCORE_SECRET = import.meta.env.VITE_SCORE_SECRET || 'dev-insecure-secret-change-me';

let currentNonce = null;          // one-time token from the last get-scores call
let boardCache = loadCachedGlobal();
if (!boardCache.length) boardCache = loadLocal(); // best-known list for sync reads

// Score formula — built from the run parameters shown in the HUD:
//   time (faster = more), footballs, perfect strokes, gates, derby win
// MUST stay identical to computeScore() in netlify/functions/submit-score.js
function computeScore(run) {
  const timePts = Math.round(250000 / Math.max(30, run.time));
  const ballPts = run.balls * 200;
  const perfectPts = run.perfect * 25;
  const gatePts = run.gates * 100;
  const winPts = run.win ? 2000 : 0;
  return { timePts, ballPts, perfectPts, gatePts, winPts, total: timePts + ballPts + perfectPts + gatePts + winPts };
}

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LB_KEY)) || []; }
  catch { return []; }
}
function loadCachedGlobal() {
  try { return JSON.parse(localStorage.getItem(GLOBAL_CACHE_KEY)) || []; }
  catch { return []; }
}
function saveLocal(entry) {
  const list = loadLocal();
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  localStorage.setItem(LB_KEY, JSON.stringify(list.slice(0, 10)));
}

// MUST stay identical to canonicalMsg() in netlify/functions/submit-score.js
function canonicalMsg(d) {
  return [
    String(d.name ?? ''),
    Number(d.time).toFixed(3),
    String(d.balls | 0),
    String(d.perfect | 0),
    String(d.gates | 0),
    d.win ? '1' : '0',
  ].join('|');
}
async function signRun(run) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(SCORE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(canonicalMsg(run)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// fetch the global list + a fresh nonce; caches on success, null on any failure
async function fetchGlobal() {
  try {
    const res = await fetch('/.netlify/functions/get-scores', { cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    if (j.nonce) currentNonce = j.nonce;
    if (Array.isArray(j.scores)) {
      localStorage.setItem(GLOBAL_CACHE_KEY, JSON.stringify(j.scores));
      return j.scores;
    }
    return null;
  } catch { return null; }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function paintBoard(list, highlightId = null) {
  const row = (e) =>
    `<li${e.id === highlightId ? ' class="me"' : ''}><span class="lbName">${escapeHtml(e.name)}</span>` +
    `<span class="lbTime">${fmtTime(e.time)}${e.win ? ' 🇳🇴' : ''}</span>` +
    `<span class="lbScore">${e.score.toLocaleString('nb-NO')}</span></li>`;
  const html = list.length
    ? list.map(row).join('')
    : '<li class="empty">Ingen har rodd ennå — bli den første!</li>';
  hud.leaderboard.innerHTML = html;
  hud.lbStart.innerHTML = list.length ? list.slice(0, 5).map(row).join('') : html;
}
function paintLoading() {
  const l = '<li class="empty">Laster topplista…</li>';
  hud.leaderboard.innerHTML = l;
  hud.lbStart.innerHTML = l;
}

// async: show a brief loading state, fetch the global list, fall back to the
// cached global list (then local) on any failure. Never throws.
async function renderLeaderboards(highlightId = null) {
  paintLoading();
  const g = await fetchGlobal();
  if (g) { boardCache = g; paintBoard(g, highlightId); }
  else paintBoard(boardCache.length ? boardCache : loadLocal(), highlightId);
}

async function saveScore() {
  if (!G.lastRun || G.lastRunSaved) return;
  G.lastRunSaved = true; // guard against double-submit before any await
  const name = hud.aliasInput.value.trim().slice(0, 14) || 'Ukjent viking';
  const run = {
    name,
    time: G.lastRun.time,
    balls: G.lastRun.balls,
    perfect: G.lastRun.perfect,
    gates: G.lastRun.gates,
    win: G.lastRun.win,
  };
  // local backup ALWAYS happens first — the result screen never blocks on the network
  const localEntry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name, score: computeScore(G.lastRun).total, time: run.time, win: run.win,
  };
  saveLocal(localEntry);
  localStorage.setItem(ALIAS_KEY, name);
  hud.saveRow.style.display = 'none';
  hud.savedMsg.classList.add('show');
  hud.savedMsg.textContent = 'Lagrer…';
  revealLeaderboardStage();

  // try the global list
  let serverScores = null, serverId = null;
  try {
    if (!currentNonce) await fetchGlobal();
    if (currentNonce) {
      const sig = await signRun(run);
      const res = await fetch('/.netlify/functions/submit-score', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...run, nonce: currentNonce, sig }),
      });
      currentNonce = null; // single use, whatever the outcome
      if (res.ok) { const j = await res.json(); serverScores = j.scores; serverId = j.id; }
    }
  } catch { /* fall through to local */ }

  if (serverScores) {
    boardCache = serverScores;
    localStorage.setItem(GLOBAL_CACHE_KEY, JSON.stringify(serverScores));
    hud.savedMsg.textContent = serverScores.some((e) => e.id === serverId)
      ? '✅ Lagret på den globale topplista!'
      : '💾 Lagret — men utenfor topp 100 globalt denne gangen!';
    paintBoard(serverScores, serverId);
  } else {
    hud.savedMsg.textContent = '💾 Lagret lokalt — fikk ikke kontakt med den globale topplista';
    // show the LOCAL list so the player sees the entry they just saved, highlighted
    paintBoard(loadLocal(), localEntry.id);
  }
}

// stage 2: the leaderboard and retry appear once the name is in (or skipped)
function revealLeaderboardStage() {
  G.resultStage = 2;
  hud.skipSaveBtn.style.display = 'none';
  hud.lbResultWrap.style.display = '';
  hud.retryBtn.style.display = '';
}

hud.saveScoreBtn.addEventListener('click', () => { saveScore(); hud.saveScoreBtn.blur(); });
hud.skipSaveBtn.addEventListener('click', () => {
  hud.saveRow.style.display = 'none';
  renderLeaderboards();
  revealLeaderboardStage();
  hud.skipSaveBtn.blur();
});
hud.aliasInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { saveScore(); hud.aliasInput.blur(); }
});
hud.aliasInput.value = localStorage.getItem(ALIAS_KEY) || '';
renderLeaderboards();

// ---- restart button: pause + confirm before throwing the race away ----
hud.restartBtn.addEventListener('click', () => {
  hud.restartBtn.blur();
  if (G.mode !== 'racing' && G.mode !== 'countdown') return;
  G.paused = true;
  releaseStroke(); // don't strand a held stroke under the dialog
  hud.confirmScreen.classList.remove('hidden');
});
$('confirmYes').addEventListener('click', (e) => {
  e.target.blur();
  hud.confirmScreen.classList.add('hidden');
  G.paused = false;
  G.mode = 'menu'; // let startRace pass its in-race guard — this restart is intentional
  startRace();
});
$('confirmNo').addEventListener('click', (e) => {
  e.target.blur();
  hud.confirmScreen.classList.add('hidden');
  G.paused = false;
});

// ---- mute toggle (persisted) ----
const MUTE_KEY = 'vikingferd_muted';
const muteBtn = $('muteBtn');
function applyMute(m) {
  setMuted(m);
  muteBtn.textContent = m ? '🔇' : '🔊';
  muteBtn.classList.toggle('muted', m);
  localStorage.setItem(MUTE_KEY, m ? '1' : '0');
}
applyMute(localStorage.getItem(MUTE_KEY) === '1');
muteBtn.addEventListener('click', () => {
  applyMute(!isMuted());
  muteBtn.blur(); // never leave a button focused — Space must only row
});

function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function updateTempoDots() {
  const dots = hud.tempoDots.querySelectorAll('i');
  dots.forEach((d, i) => d.classList.toggle('on', i < T.level));
  hud.tempoDots.classList.toggle('maxed', T.level >= TEMPO_MAX);
}

function updateComboBadge() {
  const el = $('comboBadge');
  if (G.combo >= 2) {
    el.textContent = `🔥 x${G.combo}`;
    el.classList.add('show');
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  } else {
    el.classList.remove('show');
  }
}

let fbLockUntil = 0;
function showFeedback(text, color, priority = false) {
  // priority callouts (race drama) hold the stage; stroke labels can't overwrite them
  if (!priority && waterT < fbLockUntil) return;
  if (priority) fbLockUntil = waterT + 1.2;
  hud.feedback.textContent = text;
  hud.feedback.style.color = color;
  hud.feedback.classList.remove('pop');
  void hud.feedback.offsetWidth; // restart animation
  hud.feedback.classList.add('pop');
}

// ================= Race control =================
function startRace() {
  // guard: a focused start/retry button turns every Space-release into a
  // synthetic click — never let that restart a race in progress
  if (G.mode === 'countdown' || G.mode === 'racing') return;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  // a race can never start "under" the cinematic intro — kill it silently
  if (INTRO.active) {
    INTRO.active = false;
    document.getElementById('cinebars').classList.remove('on');
  }
  initAudio();
  G.mode = 'countdown';
  G.speed = 0; G.heading = 0; G.x = 0; G.z = 0;
  G.time = 0; G.balls = 0; G.perfect = 0; G.strokes = 0;
  G.boost = 0; G.stunned = 0; G.countdownT = 3.6; G.lastCd = 4;
  G.lastStrokeAt = -9; G.strokePhase = 0;
  G.charging = false; G.charge = 0; G.driveT = 0;
  G.reach = -0.12; G.dip = 0; G.driveFrom = -1;
  G.combo = 0; G.bar = 0; G.hitStop = 0; G.fovPunch = 0;
  G.cbHalf = false; G.cbSprint = false; G.lastLead = true;
  fbLockUntil = 0;
  updateComboBadge();
  hud.boostGlow.style.opacity = 0;
  document.querySelectorAll('.confetti').forEach((el) => el.remove());
  for (const c of course.collectibles) { c.taken = false; c.mesh.visible = true; }
  for (const o of course.obstacles) o.hit = false;
  for (const g of course.gates) { g.passed = false; g.missed = false; g.rivalDone = false; g.rivalAim = undefined; }
  // rival reset
  R.x = 14; R.z = 0; R.speed = 0; R.heading = 0; R.finishTime = null;
  R.aimOff = 8; R.wobble = 0; R.bomT = 0;
  bomSprite.visible = false;
  G.steer = 0;
  // tempo drum reset
  T.phase = 0; T.period = 1.95; T.level = 0; T.lastRoAt = -9; T.lastHitAt = 0;
  T.hitL = 0; T.hitR = 0; T.maxAnnounced = false;
  updateTempoDots();
  G.resultStage = 0;
  G.lastBumpAt = -9;
  G.ghostRec = [];
  G.ghostSampleT = 0;
  loadGhostForRace(); // also resets GH.idx / phase / lead
  clearFireworks();
  R.pace = 12.0 + Math.random() * 0.6; // beatable with steady rhythm + turbo footballs
  hud.startScreen.classList.add('hidden');
  hud.resultScreen.classList.add('hidden');
  hud.howtoScreen.classList.add('hidden');
  hud.lbScreen.classList.add('hidden');
  hud.topbar.style.display = 'flex';
  hud.meterWrap.style.display = 'block';
  hud.touchControls.classList.add('active');
  logoFX.stop(); // the menu FX loops never run during the race itself
  shieldFX.stop();
  G.paused = false;
  hud.confirmScreen.classList.add('hidden');
  hud.restartBtn.style.display = 'flex';
  // reset HUD readouts immediately (they only tick during racing)
  hud.time.textContent = fmtTime(0);
  hud.speed.innerHTML = `0 <small>km/t</small>`;
  hud.dist.innerHTML = `${-course.finishZ} <small>m igjen</small>`;
  hud.balls.textContent = '0';
  // snap chase camera behind the start line
  camPos.set(0, 15.5, 27);
}

function finishRace() {
  G.mode = 'finished';
  G.finishT = 0;
  hud.boostGlow.style.opacity = 0;
  whistle();
  setTimeout(crowd, 350);
  const best = parseFloat(localStorage.getItem(BEST_KEY) || 'Infinity');
  const isRecord = G.time < best;
  if (isRecord) {
    localStorage.setItem(BEST_KEY, String(G.time));
    // save this run as the new ghost (final sample seals the finish line)
    G.ghostRec.push([+G.time.toFixed(2), +G.x.toFixed(2), +G.z.toFixed(2), +G.heading.toFixed(3)]);
    try { localStorage.setItem(GHOST_KEY, JSON.stringify(G.ghostRec)); }
    catch { /* storage full — keep the old ghost */ }
  }
  const beatSweden = R.finishTime === null || G.time <= R.finishTime;
  hud.resTime.textContent = fmtTime(G.time);
  hud.resBest.textContent = fmtTime(Math.min(best, G.time));
  hud.resBalls.textContent = String(G.balls);
  hud.resPerfect.textContent = String(G.perfect);
  // score + placement — stage 1 of the result flow:
  // fireworks + "you placed Nth" + name entry; leaderboard and retry come after
  const gatesPassed = course.gates.filter((g) => g.passed).length;
  G.lastRun = { time: G.time, balls: G.balls, perfect: G.perfect, gates: gatesPassed, win: beatSweden };
  G.lastRunSaved = false;
  G.resultStage = 1;
  const sc = computeScore(G.lastRun);
  hud.resScore.textContent = sc.total.toLocaleString('nb-NO');
  hud.scoreBreakdown.textContent =
    `⏱ ${sc.timePts} · ⚽ ${G.balls}×200=${sc.ballPts} · 💪 ${G.perfect}×25=${sc.perfectPts} · 🚩 ${gatesPassed}×100=${sc.gatePts}` +
    (sc.winPts ? ` · 🇳🇴 +${sc.winPts}` : '');
  // placement vs. the best-known board (cached global, else local); refresh in
  // the background so boardCache + a submission nonce are fresh by save time
  fetchGlobal().then((g) => { if (g) boardCache = g; });
  const rank = boardCache.filter((e) => e.score > sc.total).length + 1;
  hud.placeBanner.textContent =
    rank === 1 ? '👑 DU ENDTE PÅ 1. PLASS!'
    : rank <= 10 ? `🏅 DU ENDTE PÅ ${rank}. PLASS!`
    : `${rank}. plass — utenfor topplista, ro igjen!`;
  hud.saveRow.style.display = 'flex';
  hud.skipSaveBtn.style.display = '';
  hud.savedMsg.classList.remove('show');
  hud.lbResultWrap.style.display = 'none';
  hud.retryBtn.style.display = 'none';
  fwTimer = 0.2; // light the fuse

  hud.medal.textContent = beatSweden ? (isRecord ? '🥇' : '🏆') : '🥈';
  hud.resultTitle.textContent = beatSweden ? 'NORGE 1 – 0 SVERIGE' : 'SVERIGE VANT…';
  hud.resultSub.textContent = beatSweden
    ? (isRecord ? 'MÅÅÅL! Ny rekord — vikingene jubler!' : 'MÅÅÅL! Heia Norge!')
    : 'Revansj! Trykk deg til seier neste gang!';
  setTimeout(() => {
    hud.resultScreen.classList.remove('hidden');
    hud.topbar.style.display = 'none';
    hud.meterWrap.style.display = 'none';
    hud.touchControls.classList.remove('active');
    hud.restartBtn.style.display = 'none';
    if (beatSweden) spawnConfetti();
  }, 1400);
}

function spawnConfetti() {
  const emojis = ['⚽', '🇳🇴', '🎉', '⭐', '🏆'];
  for (let i = 0; i < 36; i++) {
    const el = document.createElement('div');
    el.className = 'confetti';
    el.textContent = emojis[i % emojis.length];
    el.style.left = Math.random() * 100 + '%';
    el.style.animationDuration = 2.6 + Math.random() * 2.4 + 's';
    el.style.animationDelay = Math.random() * 1.6 + 's';
    el.style.fontSize = 16 + Math.random() * 18 + 'px';
    hud.resultScreen.appendChild(el);
  }
}

// world-space position of an oar blade tip (for splashes and churn)
const _bladeV = new THREE.Vector3();
function bladeWorld(boat, oar) {
  _bladeV.set(oar.side * 4.2, 0, 0).applyEuler(oar.pivot.rotation);
  _bladeV.add(oar.pivot.position);
  return boat.localToWorld(_bladeV);
}

// ================= Rowing mechanic: hold to pull, release to drive =================
function beginCharge() {
  if (G.charging || G.paused) return;
  // always accept the hold — the charge only starts building once the
  // oars have recovered (see the accumulation gate in update)
  G.charging = true;
  G.charge = 0;
}

function releaseStroke() {
  if (!G.charging) return;
  G.charging = false;
  if (G.mode === 'racing' && !G.paused && G.charge > 0.02) executeStroke(G.charge);
  G.charge = 0;
}

function executeStroke(charge) {
  G.lastStrokeAt = G.time;
  G.strokes++;
  G.driveT = 0.55; // drive animation: oars sweep through the water
  G.driveFrom = G.reach; // sweep starts from wherever the windup got to

  let power, label, color;
  const isMilestone = (c) => c === 3 || c === 5 || c === 8 || (c >= 12 && c % 4 === 0);
  if (charge >= CHARGE_PERFECT_LO && charge <= CHARGE_PERFECT_HI) {
    power = 1;
    G.perfect++;
    G.combo++;
    label = isMilestone(G.combo) ? `🔥 COMBO x${G.combo}! 🔥`
          : G.combo >= 2 ? `PERFEKT x${G.combo}!` : 'PERFEKT!';
    color = isMilestone(G.combo) ? '#ff9d2e' : '#ffd25e';
    hud.meter.classList.remove('perfectFlash');
    void hud.meter.offsetWidth;
    hud.meter.classList.add('perfectFlash');
    // rising pitch with the combo — audible reward ladder
    ding(1 + Math.min(G.combo, 12) * 0.05);
    bass([65.41, 65.41, 98.0, 82.41][G.bar % 4]);
    G.bar++;
    G.fovPunch = 1;
  } else if (charge > CHARGE_PERFECT_HI) {
    power = 0.45;
    G.combo = 0;
    label = 'ÅRENE SKLIR!'; color = '#ff9d9d';
  } else if (charge >= CHARGE_GOOD_LO) {
    power = 0.7;
    G.combo = 0;
    label = 'BRA!'; color = '#9ecdfd';
  } else if (charge >= 0.18) {
    power = 0.35;
    G.combo = 0;
    label = 'FOR TIDLIG!'; color = '#ff9d9d';
  } else {
    power = 0.15;
    G.combo = 0;
    label = 'FOR SVAKT!'; color = '#ff7a7a';
  }
  // in tempo with Haaland's RO!? (generous window either side of the shout)
  // Off-beat strokes cost NOTHING — tempo is a pure bonus, it only fades with
  // time (see the decay in the race loop) or a crash.
  const sinceRo = G.time - T.lastRoAt;
  const untilRo = (1 - T.phase) * T.period;
  const inTempo = sinceRo < 0.45 || untilRo < 0.4;
  if (inTempo && power >= 0.7) {
    T.level = Math.min(TEMPO_MAX, T.level + 1);
    T.lastHitAt = G.time;
    if (T.level === TEMPO_MAX && !T.maxAnnounced) {
      T.maxAnnounced = true;
      showFeedback('🔥 MAX FART! 🔥', '#ff9d2e', true);
      crowd();
    }
    updateTempoDots();
  }

  const boostMult = G.boost > 0 ? 1.35 : 1;
  const comboMult = 1 + Math.min(G.combo, 10) * 0.04; // up to +40% at 10-streak
  G.speed += power * 3.8 * boostMult * comboMult;
  updateComboBadge();
  showFeedback(label, color);
  kick(0.35 + power * 0.25); // the stroke IS the beat
  splash(power);

  // catch splash at EVERY blade tip — eight oars biting the water at once
  for (const oar of shipData.oars) {
    const bp = bladeWorld(ship, oar);
    const wy = sampleWater(bp.x, bp.z, waterT).y;
    const n = 2 + Math.round(power * 3);
    for (let i = 0; i < n; i++) {
      spawnParticle(
        bp.x + (Math.random() - 0.5) * 0.9, wy + 0.12, bp.z + (Math.random() - 0.5) * 0.9,
        (Math.random() - 0.5) * 2.2, 1.6 + Math.random() * 2.4 * power, (Math.random() - 0.5) * 2.2,
        0.4 + Math.random() * 0.35
      );
    }
  }
}

// ================= Main loop =================
let lastFrameT = performance.now();
let waterT = 0;

// Seat a hull on the wave surface: sample bow/stern/port/starboard and align
// the hull to the actual surface plane so water never pokes through the deck.
const BOAT_FREEBOARD = 1.0;
function seatBoatOnWater(boat, x, z, heading, dt, leanPitch = 0, leanRoll = 0) {
  const w = sampleWater(x, z, waterT);
  const fx = Math.sin(heading), fz = -Math.cos(heading);   // forward
  const rx = Math.cos(heading), rz = Math.sin(heading);    // starboard
  const wBow = sampleWater(x + fx * 12, z + fz * 12, waterT);
  const wStern = sampleWater(x - fx * 12, z - fz * 12, waterT);
  const wMidF = sampleWater(x + fx * 6, z + fz * 6, waterT);
  const wMidA = sampleWater(x - fx * 6, z - fz * 6, waterT);
  const wR = sampleWater(x + rx * 4, z + rz * 4, waterT);
  const wL = sampleWater(x - rx * 4, z - rz * 4, waterT);
  // ride on the highest supporting point so a crest can't rise over the deck
  const y = Math.max(w.y, wMidF.y, wMidA.y, (wBow.y + wStern.y) / 2, (wL.y + wR.y) / 2) + BOAT_FREEBOARD;
  boat.position.set(x, y, z);
  boat.rotation.y = -heading;
  const targetPitch = Math.atan2(wBow.y - wStern.y, 24) + leanPitch; // +x rot lifts the bow
  const targetRoll = Math.atan2(wR.y - wL.y, 8) + leanRoll;         // +z rot lifts starboard
  const k = Math.min(1, dt * 5.5);
  boat.rotation.x += (targetPitch - boat.rotation.x) * k;
  boat.rotation.z += (targetRoll - boat.rotation.z) * k;
  return w;
}
const camPos = new THREE.Vector3(0, 12, 26);
const camLook = new THREE.Vector3();
let shakeAmt = 0;

function update(dt) {
  // hitstop: brief slow-motion after a crash for impact weight
  if (G.hitStop > 0) {
    G.hitStop -= dt;
    dt *= 0.3;
  }
  waterT += dt;

  // ---- charge meter: fills while holding, release in the gold zone ----
  if (G.mode === 'racing' || G.mode === 'countdown') {
    if (G.charging && G.mode === 'racing' && G.stunned <= 0 && G.time - G.lastStrokeAt >= 0.3) {
      const prev = G.charge;
      G.charge += dt / CHARGE_TIME;
      // anticipation ticks as the power builds
      if ((prev < 0.35 && G.charge >= 0.35) || (prev < 0.7 && G.charge >= 0.7)) hat(0.14);
      if (prev < CHARGE_PERFECT_LO && G.charge >= CHARGE_PERFECT_LO) hat(0.22); // "now!"
      if (G.charge > CHARGE_OVER) {
        // held too long — the oars slip
        G.charging = false;
        executeStroke(G.charge);
        G.charge = 0;
      }
    }
    const fill = Math.min(G.charge, 1);
    hud.fill.style.width = (fill * 100).toFixed(1) + '%';
    hud.fill.classList.toggle('in-zone', G.charge >= CHARGE_PERFECT_LO && G.charge <= CHARGE_PERFECT_HI);
    hud.fill.classList.toggle('over', G.charge > CHARGE_PERFECT_HI);
  }

  // ---- countdown ----
  if (G.mode === 'countdown') {
    G.countdownT -= dt;
    const n = Math.ceil(G.countdownT);
    if (n !== G.lastCd && n > 0) {
      G.lastCd = n;
      hud.countdown.textContent = String(n);
      hud.countdown.classList.remove('tick');
      void hud.countdown.offsetWidth;
      hud.countdown.classList.add('tick');
      ding();
    }
    if (G.countdownT <= 0) {
      G.mode = 'racing';
      hud.countdown.textContent = 'RO!';
      hud.countdown.classList.remove('tick');
      void hud.countdown.offsetWidth;
      hud.countdown.classList.add('tick');
      whistle();
      crowd(); // the fjord roars as the race begins
    }
  }

  // ---- racing physics ----
  if (G.mode === 'racing') {
    G.time += dt;

    // steering — smoothed input and gentle turn rate so the ship carves, not snaps
    let steerInput = steerTouch + touchSteerBtn;
    if (keys['ArrowLeft'] || keys['KeyA']) steerInput -= 1;
    if (keys['ArrowRight'] || keys['KeyD']) steerInput += 1;
    steerInput = THREE.MathUtils.clamp(steerInput, -1, 1);
    G.steer += (steerInput - G.steer) * Math.min(1, dt * 5);
    const steerRate = 0.55 * (0.4 + Math.min(1, G.speed / 10) * 0.6);
    G.heading += G.steer * steerRate * dt;
    G.heading = THREE.MathUtils.clamp(G.heading, -0.7, 0.7);
    // heading self-centering slightly
    G.heading *= 1 - dt * 0.3;

    // ---- Haaland's drum cycle: donk (0.55), donk (0.78), RO! at the wrap ----
    {
      const prevPhase = T.phase;
      T.period = 1.95 - T.level * 0.06; // near natural stroke pace; faster as tempo builds
      T.phase += dt / T.period;
      if (prevPhase < 0.55 && T.phase >= 0.55) { donk(); T.hitL = 0.22; }
      if (prevPhase < 0.78 && T.phase >= 0.78) { donk(0.62); T.hitR = 0.22; }
      if (T.phase >= 1) {
        T.phase -= 1;
        T.lastRoAt = G.time;
        roVoice();
        hud.roCue.classList.remove('pop');
        void hud.roCue.offsetWidth;
        hud.roCue.classList.add('pop');
      }
    }

    // tempo fades slowly when you drift off the beat (never punished per stroke)
    if (T.level > 0 && G.time - (T.lastHitAt ?? 0) > 4) {
      T.level--;
      T.lastHitAt = G.time;
      if (T.level < TEMPO_MAX) T.maxAnnounced = false;
      updateTempoDots();
    }

    // drag & speed — full base speed as always; Haaland's tempo raises the CAP further
    if (G.stunned > 0) G.stunned -= dt;
    if (G.boost > 0) G.boost -= dt;
    const dragLoss = G.speed * (0.09 + G.speed * 0.0045) + 0.2;
    G.speed = Math.max(0, G.speed - dragLoss * dt);
    const maxSpeed = 20 + T.level * 0.75 + (G.boost > 0 ? 3.5 : 0);
    G.speed = Math.min(G.speed, maxSpeed);

    // move
    G.x += Math.sin(G.heading) * G.speed * dt;
    G.z -= Math.cos(G.heading) * G.speed * dt;

    // ghost recording (~10 Hz, rounded — a full run stays well under 50 KB)
    G.ghostSampleT -= dt;
    if (G.ghostSampleT <= 0) {
      G.ghostSampleT = 0.1;
      G.ghostRec.push([+G.time.toFixed(2), +G.x.toFixed(2), +G.z.toFixed(2), +G.heading.toFixed(3)]);
    }
    // channel bounds — soft wall
    if (Math.abs(G.x) > CHANNEL_HALF) {
      G.x = THREE.MathUtils.clamp(G.x, -CHANNEL_HALF, CHANNEL_HALF);
      G.speed *= 1 - dt * 2;
      G.heading *= 1 - dt * 4;
    }

    // ---- collisions ----
    for (const c of course.collectibles) {
      if (c.taken || Math.abs(c.z - G.z) > 8) continue;
      const dx = c.x - G.x, dz = c.z - G.z;
      if (dx * dx + dz * dz < c.r * c.r + 14) {
        c.taken = true;
        c.mesh.visible = false;
        G.balls++;
        G.boost = 3.2;
        G.speed += 2.4;
        showFeedback('⚽ TURBO!', '#ffd25e');
        whoosh();
        ding(1.3);
      }
    }
    for (const o of course.obstacles) {
      if (o.hit || Math.abs(o.z - G.z) > 8) continue;
      const dx = o.x - G.x, dz = o.z - G.z;
      if (dx * dx + dz * dz < o.r * o.r + 8) {
        o.hit = true;
        G.speed *= 0.35;
        G.stunned = 0.8;
        G.boost = 0;
        G.combo = 0;
        G.charging = false; G.charge = 0; // the impact knocks the oars loose
        T.level = Math.max(0, T.level - 3); // the crash breaks the crew's tempo
        T.maxAnnounced = false;
        updateTempoDots();
        updateComboBadge();
        shakeAmt = 1;
        G.hitStop = 0.22; // brief slow-mo for impact weight
        hud.hitFlash.classList.remove('on');
        void hud.hitFlash.offsetWidth;
        hud.hitFlash.classList.add('on');
        showFeedback('KRÆSJ!', '#ff7a7a');
        thud();
      }
    }
    for (const g of course.gates) {
      if (g.passed || g.missed || G.z > g.z) continue;
      // ship crossed the gate line
      if (G.z <= g.z) {
        if (Math.abs(G.x - g.x) < g.w / 2) {
          g.passed = true;
          G.speed += 1.6;
          showFeedback('PORT! +FART', '#7dff9e');
          ding();
        } else {
          g.missed = true;
        }
      }
    }

    // ---- rival AI ----
    {
      // accelerate to pace, with rubber-banding that keeps the duel alive
      const gap = G.z - R.z; // positive => rival ahead
      let want = R.pace;
      if (gap > 50) want *= Math.max(0.82, 1 - (gap - 50) * 0.002);  // rival ahead: ease off
      else if (gap < -50) want *= Math.min(1.12, 1 + (-gap - 50) * 0.002); // rival behind: dig in
      R.speed += (want - R.speed) * dt * 0.22; // human-like slow ramp from the start line

      // pick a line through (or occasionally OUTSIDE) the next gate
      const nextRG = course.gates.find((gt) => !gt.rivalDone && gt.z < R.z);
      if (nextRG) {
        if (nextRG.rivalAim === undefined) {
          nextRG.rivalAim = Math.random() < 0.28
            ? (Math.random() < 0.5 ? -1 : 1) * (nextRG.w / 2 + 4.5) // blunder: sails outside the pole
            : (Math.random() * 10 - 5);                             // clean line through the gap
        }
        R.aimOff += (nextRG.rivalAim - R.aimOff) * dt * 0.7;
      }
      let wantX = rivalPathX(R.z) + R.aimOff;
      // the rival helmsman gives the player sea room — steers clear when close
      const latGap = R.x - G.x;
      if (Math.abs(R.z - G.z) < 45 && Math.abs(latGap) < 12) {
        wantX += (latGap >= 0 ? 1 : -1) * (12 - Math.abs(latGap)) * 0.9;
      }
      R.heading += THREE.MathUtils.clamp((wantX - R.x) * 0.02 - R.heading, -1, 1) * dt * 2.2;
      R.heading = THREE.MathUtils.clamp(R.heading, -0.6, 0.6);
      R.x += Math.sin(R.heading) * R.speed * dt + (wantX - R.x) * dt * 0.4;
      R.z -= Math.cos(R.heading) * R.speed * dt;

      // did the rival cross a gate line — inside or outside?
      for (const gt of course.gates) {
        if (gt.rivalDone || R.z > gt.z) continue;
        gt.rivalDone = true;
        if (Math.abs(R.x - gt.x) > gt.w / 2) {
          // missed! wobble of shame, splash, penalty and a BOM! over the ship
          R.wobble = 1;
          R.bomT = 1.8;
          R.speed *= 0.85;
          showFeedback('SVERIGE BOMMET PORTEN! 🙈', '#7dff9e', true);
          ding(0.55);
          const rw2 = sampleWater(R.x, R.z, waterT).y;
          for (let i = 0; i < 14; i++) {
            spawnParticle(
              R.x + (Math.random() - 0.5) * 5, rw2 + 0.2, R.z + (Math.random() - 0.5) * 6,
              (Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4,
              0.5 + Math.random() * 0.4
            );
          }
        }
      }
      if (R.finishTime === null && R.z <= course.finishZ) R.finishTime = G.time;
    }

    // ---- ship-vs-ship collision: hulls can never overlap ----
    {
      const dx = G.x - R.x;
      const dz = G.z - R.z;
      const HULL_W = 5.0;  // side-by-side clearance (hulls only, oars may brush)
      const HULL_L = 26;   // bow/stern overlap reach
      if (Math.abs(dx) < HULL_W && Math.abs(dz) < HULL_L) {
        const dir = dx >= 0 ? 1 : -1;
        const overlap = HULL_W - Math.abs(dx);
        // separate the hulls — the lighter player takes most of the shove
        G.x += dir * overlap * 0.65;
        R.x -= dir * overlap * 0.35;
        // bump event (cooldown so grinding hulls doesn't spam)
        if (G.time - (G.lastBumpAt ?? -9) > 2.2) {
          G.lastBumpAt = G.time;
          G.heading += dir * 0.2;       // knocked off course!
          G.speed *= 0.88;
          R.speed *= 0.93;
          shakeAmt = Math.max(shakeAmt, 0.7);
          showFeedback('SAMMENSTØT! ⚔️', '#ffd25e');
          thud();
          const mx = (G.x + R.x) / 2, mz = (G.z + R.z) / 2;
          const wy = sampleWater(mx, mz, waterT).y;
          for (let i = 0; i < 12; i++) {
            spawnParticle(
              mx + (Math.random() - 0.5) * 3, wy + 0.2, mz + (Math.random() - 0.5) * 8,
              (Math.random() - 0.5) * 4, 2 + Math.random() * 2.5, (Math.random() - 0.5) * 3,
              0.45 + Math.random() * 0.3
            );
          }
        }
      }
    }

    // ---- race drama callouts ----
    if (!G.cbHalf && G.z < course.finishZ / 2) {
      G.cbHalf = true;
      showFeedback('HALVVEIS! 🇳🇴', '#7dff9e', true);
      ding(0.8);
    }
    if (!G.cbSprint && G.z < course.finishZ + 220) {
      G.cbSprint = true;
      showFeedback('SISTE SPURT! 🏁', '#ffd25e', true);
      crowd();
    }
    const leadNow = G.z <= R.z;
    if (G.time > 6 && G.lastLead !== leadNow) {
      G.lastLead = leadNow;
      if (leadNow) {
        showFeedback('DU LEDER! 🇳🇴', '#7dff9e', true);
        ding(1.5);
      } else {
        showFeedback('SVERIGE TAR LEDELSEN!', '#ff9d9d', true);
        ding(0.6);
      }
    }

    // finish
    if (G.z <= course.finishZ) finishRace();

    // HUD
    hud.time.textContent = fmtTime(G.time);
    hud.speed.innerHTML = `${Math.round(G.speed * 3.6 / 1.4)} <small>km/t</small>`;
    hud.dist.innerHTML = `${Math.max(0, Math.round(-course.finishZ + G.z) )} <small>m igjen</small>`;
    hud.balls.textContent = String(G.balls);
    const leading = G.z <= R.z;
    hud.pos.textContent = leading ? '1.' : '2.';
    hud.posPill.style.borderColor = leading ? 'rgba(125,255,158,.6)' : 'rgba(255,122,122,.6)';
    hud.vignette.style.opacity = Math.min(1, G.speed / 24 + (G.boost > 0 ? 0.35 : 0));
    hud.boostGlow.style.opacity = G.boost > 0 ? Math.min(1, G.boost / 1.2) : 0;
  }

  if (G.mode === 'finished') {
    G.finishT += dt;
    // glide to a stop past the goal
    G.speed = Math.max(0, G.speed - dt * 4);
    G.z -= Math.cos(G.heading) * G.speed * dt;

    // fireworks show over the fjord — denser when Norway won
    fwTimer -= dt;
    if (fwTimer <= 0) {
      const won = G.lastRun && G.lastRun.win;
      fwTimer = won ? 0.3 + Math.random() * 0.4 : 0.8 + Math.random() * 0.6;
      // low in the sky band the pitched-down chase camera actually sees
      spawnFireworkBurst(
        G.x + (Math.random() - 0.5) * 160,
        9 + Math.random() * 15,
        G.z - 70 - Math.random() * 110,
        FW_COLORS[(Math.random() * FW_COLORS.length) | 0],
        won ? 60 + (Math.random() * 30 | 0) : 40
      );
    }
  }
  updateFireworks(dt);

  // ---- player rowing animation: a real stroke cycle driven by hold/release ----
  if (G.mode === 'racing' || G.mode === 'countdown') {
    let dipTarget = 0;
    if (G.driveT > 0) {
      // THE DRIVE: catch → blades buried → sweep astern → clean extraction
      G.driveT -= dt;
      const k = 1 - Math.max(0, G.driveT) / 0.55;
      const kk = k * k * (3 - 2 * k); // accelerate through the middle of the stroke
      G.reach = G.driveFrom + (1 - G.driveFrom) * kk;
      dipTarget = Math.max(0, Math.min(1, k / 0.12) * Math.min(1, (1 - k) / 0.1));
    } else if (G.charging) {
      // winding up: crew swings forward, blades feathered above the water
      const want = -Math.pow(Math.min(G.charge, 1), 0.8);
      G.reach += (want - G.reach) * Math.min(1, dt * 8);
    } else {
      // rest between strokes: blades hover just clear of the surface
      G.reach += (-0.12 - G.reach) * Math.min(1, dt * 3);
    }
    G.dip += (dipTarget - G.dip) * Math.min(1, dt * 18);
    poseStroke(shipData, G.reach, G.dip, waterT);

    // Haaland hammers the drum
    if (shipData.haaland) {
      const H = shipData.haaland;
      T.hitL = Math.max(0, T.hitL - dt);
      T.hitR = Math.max(0, T.hitR - dt);
      const swing = (hit) => -1.05 + Math.sin((1 - hit / 0.22) * Math.PI) * (hit > 0 ? 1.15 : 0);
      H.arms[0].rotation.x = swing(T.hitL);
      H.arms[1].rotation.x = swing(T.hitR);
      // bounce with each strike
      H.group.position.y = 0.15 + (T.hitL + T.hitR) * 0.35;
    }

    // water churn dragged up while the blades are buried
    if (G.dip > 0.5 && G.mode === 'racing' && Math.random() < dt * 42) {
      const oar = shipData.oars[(Math.random() * shipData.oars.length) | 0];
      const bp = bladeWorld(ship, oar);
      const wy = sampleWater(bp.x, bp.z, waterT).y;
      spawnParticle(
        bp.x, wy + 0.05, bp.z,
        (Math.random() - 0.5) * 1.5, 1 + Math.random() * 1.4, 1.5 + Math.random() * 2,
        0.35 + Math.random() * 0.2
      );
    }
  } else {
    // idle rowing loop on menu/result screens
    G.strokePhase = (G.strokePhase + dt * 0.35 / STROKE_CYCLE) % 1;
    const p = cyclePose(G.strokePhase);
    poseStroke(shipData, p.reach, p.dip, waterT);
  }

  // ---- rival on water + rowing ----
  {
    if (G.mode === 'finished' && R.finishTime === null) {
      // rival keeps rowing while the player celebrates
      R.z -= R.speed * dt;
      if (R.z <= course.finishZ) R.finishTime = G.time;
    }
    R.strokePhase = (R.strokePhase + dt * (0.55 + Math.min(1.2, R.speed / 14)) / STROKE_CYCLE) % 1;
    const rp = cyclePose(R.strokePhase);
    poseStroke(rivalData, rp.reach, rp.dip, waterT + 3);
    seatBoatOnWater(rival, R.x, R.z, R.heading, dt, 0, 0);
    // wobble of shame after missing a gate
    if (R.wobble > 0) {
      rival.rotation.z += Math.sin(waterT * 22) * 0.13 * R.wobble;
      rival.rotation.y += Math.sin(waterT * 17) * 0.05 * R.wobble;
      R.wobble = Math.max(0, R.wobble - dt * 0.7);
    }
    // BOM! sprite floats up over the rival and fades
    if (R.bomT > 0) {
      R.bomT -= dt;
      bomSprite.visible = true;
      bomSprite.position.set(R.x, rival.position.y + 11 + (1.8 - R.bomT) * 2.2, R.z);
      bomSprite.material.opacity = Math.min(1, R.bomT * 1.4);
      const pop = 1 + Math.max(0, R.bomT - 1.5) * 2.5;
      bomSprite.scale.set(12 * pop, 6 * pop, 1);
    } else {
      bomSprite.visible = false;
    }
  }

  // ---- ghost replay: your best run rows the course beside you ----
  if (GH.ship && GH.ship.visible && GH.data) {
    const rec = GH.data;
    const t = (G.mode === 'racing' || G.mode === 'finished') ? G.time : 0;
    while (GH.idx < rec.length - 2 && rec[GH.idx + 1][0] <= t) GH.idx++;
    const a = rec[GH.idx];
    const b = rec[Math.min(GH.idx + 1, rec.length - 1)];
    const span = Math.max(0.0001, b[0] - a[0]);
    const k = THREE.MathUtils.clamp((t - a[0]) / span, 0, 1);
    const gx = a[1] + (b[1] - a[1]) * k;
    const gz = a[2] + (b[2] - a[2]) * k;
    const ghd = a[3] + (b[3] - a[3]) * k;
    GH.phase = (GH.phase + dt * 0.85 / STROKE_CYCLE) % 1;
    const gp = cyclePose(GH.phase);
    poseStroke(GH.shipData, gp.reach, gp.dip, waterT + 7);
    seatBoatOnWater(GH.ship, gx, gz, ghd, dt, 0, 0);

    // lowkey lead-change callouts vs your own best (8 m hysteresis, no drama)
    if (G.mode === 'racing' && G.time > 5) {
      const diff = gz - G.z; // positive => ghost is behind you
      if (GH.lead === null) GH.lead = diff > 0 ? 'player' : 'ghost';
      else if (GH.lead === 'ghost' && diff > 8) {
        GH.lead = 'player';
        showFeedback('FORBI DITT BESTE! 👻', '#9fd8ff');
      } else if (GH.lead === 'player' && diff < -8) {
        GH.lead = 'ghost';
        showFeedback('DITT BESTE DRAR IFRA 👻', '#9fd8ff');
      }
    }
  }

  // ---- ship on water ----
  const w = seatBoatOnWater(
    ship, G.x, G.z, G.heading, dt,
    -Math.min(0.1, G.speed * 0.004), // slight bow-down lean at speed
    G.heading * 0.14                 // lean into turns
  );

  // wake particles while moving
  if (G.speed > 3 && Math.random() < dt * G.speed * 1.6) {
    const wy = sampleWater(G.x, G.z + 8, waterT).y;
    spawnParticle(
      G.x + (Math.random() - 0.5) * 3, wy + 0.1, G.z + 8 + Math.random() * 3,
      (Math.random() - 0.5) * 1.5, 0.8 + Math.random(), 1 + Math.random() * 2,
      0.7
    );
  }
  // golden churn trail while turbo is active
  if (G.boost > 0 && G.speed > 4) {
    for (let i = 0; i < 2; i++) {
      const wy = sampleWater(G.x, G.z + 10, waterT).y;
      spawnParticle(
        G.x + (Math.random() - 0.5) * 2.2, wy + 0.2, G.z + 9 + Math.random() * 5,
        (Math.random() - 0.5) * 3, 1.6 + Math.random() * 2.2, 2 + Math.random() * 3,
        0.55 + Math.random() * 0.35
      );
    }
  }
  // bow spray at speed
  if (G.speed > 9 && Math.random() < dt * (G.speed - 8) * 2.2) {
    const bs = Math.sin(G.heading), bc = Math.cos(G.heading);
    const bx = G.x - bs * -15, bz = G.z - bc * 15; // bow is 15 ahead (-z)
    const wy = sampleWater(bx, bz, waterT).y;
    for (const side of [-1, 1]) {
      spawnParticle(
        bx + side * (1 + Math.random()), wy + 0.3, bz + Math.random() * 2,
        side * (1.5 + Math.random() * 2), 2.2 + Math.random() * 2, 0.5,
        0.45 + Math.random() * 0.3
      );
    }
  }
  updateParticles(dt);

  // world updates
  water.update(waterT, G.z);
  updateCourse(course, waterT, G.z);
  sky.position.set(G.x, 0, G.z);
  seagulls.update(waterT, G.x, G.z);

  // ---- camera ----
  if (INTRO.active) {
    runIntroCamera(dt);
    return;
  }
  shakeAmt = Math.max(0, shakeAmt - dt * 2.2);
  G.fovPunch = Math.max(0, G.fovPunch - dt * 4);
  const speedK = Math.min(1, G.speed / 22);
  const wantFov = 58 + speedK * 12 + G.fovPunch * 2.5;
  camera.fov += (wantFov - camera.fov) * dt * 6;
  camera.updateProjectionMatrix();

  const behind = 27 - speedK * 4;
  const height = 15.5 + speedK * 2;
  const tx = G.x + Math.sin(G.heading) * -behind * 0.25;
  const tz = G.z + behind;
  camPos.x += (tx - camPos.x) * dt * 3.2;
  camPos.y += (height + w.y * 0.4 - camPos.y) * dt * 3.2;
  camPos.z += (tz - camPos.z) * dt * 3.2;
  camera.position.copy(camPos);
  if (shakeAmt > 0) {
    camera.position.x += (Math.random() - 0.5) * shakeAmt * 0.9;
    camera.position.y += (Math.random() - 0.5) * shakeAmt * 0.7;
  }
  camLook.set(G.x, w.y + 1.2, G.z - 34);
  camera.lookAt(camLook);
}

function frame(maxDt = 0.05) {
  const now = performance.now();
  const dt = Math.min((now - lastFrameT) / 1000, maxDt);
  lastFrameT = now;
  if (!G.paused) update(dt); // paused: world freezes but keeps rendering
  composer.render();
}
renderer.setAnimationLoop(() => frame());
// Fallback: if rAF stalls (embedded/backgrounded preview panels), keep the game
// stepping via a timer so it never freezes mid-countdown or mid-race.
// Larger dt cap here so throttled timers still make reasonable progress;
// 0.1 s steps stay well below collision radii even at top speed.
setInterval(() => {
  if (performance.now() - lastFrameT > 200) frame(0.1);
}, 100);

// debug/test handle — DEV BUILDS ONLY. In production an open game-state handle
// would let anyone rewrite time/balls/etc. and submit a plausible (but fake)
// score, so Vite strips this whole block from `npm run build`. The bot-test
// pattern in PROSJEKT-OVERSIKT.md still works under `npm run dev`.
if (import.meta.env.DEV) {
  window.__game = { G, R, T, GH, INTRO, logoFX, shieldFX, course, renderer, ship, rival, spawnFireworkBurst, get waterT() { return waterT; } };
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloomPass.setSize(window.innerWidth, window.innerHeight);
});
