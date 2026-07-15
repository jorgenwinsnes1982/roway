import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createWater, sampleWater, setWaveScale } from './water.js';
import { buildShip, poseStroke, cyclePose } from './ship.js';
import { createSky, createFjord, createClouds, createCourse, disposeCourse, updateCourse, createSeagulls, createFogBanks, createIntroLandmarks, COURSE_LENGTH, CHANNEL_HALF } from './world.js';
import { initAudio, oarSplash, ding, thud, whistle, crowd, kick, hat, bass, whoosh, donk, roVoice, fireworkBoom, setSfxMuted, isSfxMuted, setMusicMuted, isMusicMuted, setMusicDucked, setSeagullScene, hoverSparkle, hornSound, isMusicLoadSettled } from './audio.js';
import { createLogoFX, createHowtoFX, createVoyageDoneFX } from './logo.js';
import { createShieldFX } from './shield.js';
import {
  loadVoyage, creditRun, creditBonus, VOYAGE_OUT_M, TOTAL_VOYAGE_M, VOYAGE_STAGES, currentStage,
  getOrCreateVoyageId, loadStageBests, isStageBest, recordStageBest, markStageSubmitted,
  markStageFinal, isStageFinal, resetVoyage, voyageScoreTotal,
} from './voyage.js';
import { recordRun, loadMissions, activeMissionsWithProgress, loadLetters, nextLetter, letterProgressText, collectLetter, MISSION_REWARD_M, ROWAY_REWARD_M } from './missions.js';
import { voyageStatusText, LANDMARK_INFO } from './voyagemap.js';
import { mountVoyageMap } from './map/voyageMap.js';
import { enhanceRuneButtons } from './runeButtons.js';

// ---- DevTools console credit ----
// Small, isolated, and side-effect-free besides the one console.log call —
// see the top-of-file HTML comment (View Source) for the same credit and
// index.html's <head> for the same production/infra facts as structured
// metadata. The globalThis guard keeps this to exactly one print per page
// session no matter how many times this module body runs (HMR, a stray
// re-import, etc.) — it must never fire from the render loop, a race
// start/restart, or a menu/result transition, only once at boot.
function showWinsenCredits() {
  if (globalThis.__ROWAY_CREDITS_SHOWN__) return;
  globalThis.__ROWAY_CREDITS_SHOWN__ = true;
  try {
    const chip = 'background:#101010;';
    const art = `${chip} color:#e8f116; font-family:monospace; font-weight:bold; line-height:1.3;`;
    const title = `${chip} color:#f4f1eb; font-weight:bold; font-size:13px;`;
    const label = `${chip} color:#999999;`;
    const name = `${chip} color:#e8f116; font-weight:bold; font-size:13px;`;
    const role = `${chip} color:#f4f1eb;`;
    const info = `${chip} color:#999999;`;
    const link = `${chip} color:#e8f116; font-weight:bold;`;
    console.log(
      [
        '%c   ┌────────┐',
        '   │        │',
        '   │   ✓    │',
        '   │        │',
        '   └────────┘',
        '    W I N S E N',
        '',
        '%cROWAY — Row the Trophy Home',
        '',
        '%cDesigned and developed by:',
        '%cJørgen Winsnes',
        '',
        '%cDesign Director — Brand, Product & Experience',
        'Winsen AS',
        '',
        '%cConcept, game design, art direction, UX, production',
        'and AI orchestration.',
        '',
        'AI and creative production:',
        'ChatGPT, OpenAI Codex, Claude Code, Cursor, Meshy,',
        'Figma, Figma MCP, Kling 3.0 and custom AI agents',
        'created and directed by Jørgen Winsnes.',
        '',
        'Music:',
        'Composed via AI direction — generated with MiniMax',
        'Music (music-2.5) and Kling AI via the Pika platform',
        '(pika.art).',
        'Audio analysis: Google Gemini.',
        'Composer and lyrics: Jørgen Winsnes.',
        '',
        'Game technology:',
        'Three.js, WebGL, JavaScript and Vite.',
        '',
        'Versioned with GitHub. Built and deployed with Netlify.',
        '',
        'Serverless leaderboard and signed score verification powered by',
        'Netlify Functions.',
        '',
        '%cwww.winsen.no',
        'jorgen@winsen.no',
      ].join('\n'),
      art, title, label, name, role, info, link,
    );
  } catch {
    // a cosmetic console signature must never break the page
  }
}
showWinsenCredits();

// Figma "Game Buttons — RO! / TILBAKE" skin, applied game-wide — must run before
// any code below queries/wires up buttons by id, since it re-parents each
// button under a decorative wrapper (the button itself keeps its id/classes).
enhanceRuneButtons();

// ---- dev tools online-unlock ----
// `import.meta.env.DEV` is Vite's own dev/prod flag and gets the whole
// DEV-ONLY block below stripped from `npm run build` by dead-code
// elimination. This adds a second, runtime path: a one-time secret in the
// URL flips a localStorage flag, so the same tools can be turned on in the
// deployed build (e.g. for QA on a phone, where there's no console) without
// a rebuild — and the settings-modal "Dev tools" row (only rendered once
// this is already on) turns it back off. Pure obfuscation, not a security
// boundary: the code ships inside the bundle, same as submit-score.js's own
// documented threat model, which already assumes a determined client can
// forge plausible-but-fake runs.
const DEV_FLAG_KEY = 'roway.devtools';
{
  const devParam = new URLSearchParams(location.search).get('dev');
  if (devParam === 'roway2026') localStorage.setItem(DEV_FLAG_KEY, '1');
  else if (devParam === 'off') localStorage.removeItem(DEV_FLAG_KEY);
}
const DEV_TOOLS = import.meta.env.DEV || localStorage.getItem(DEV_FLAG_KEY) === '1';

// Kick off audio asset loading (fetch + decode, incl. the ~3MB theme song)
// immediately at boot instead of waiting for the player's first gesture —
// decoding doesn't need a user gesture, only playback (ctx.resume(), still
// gated behind kickAudio() below) does. On a fast desktop/localhost this is
// unnoticeable either way, but on a slower mobile connection the fetch+decode
// alone can take long enough that starting it only on first tap left the
// track still loading well into the race, audible only once the player
// reached the result screen. Starting it here gives it the whole boot/menu
// window as a head start. initAudio() is idempotent (safe to call again from
// kickAudio()/startRace()).
initAudio();

// ================= Renderer / Scene =================
const app = document.getElementById('app');
// antialias:false is deliberate, not an oversight: the scene is ONLY ever
// drawn through the EffectComposer below, whose render target is created with
// samples:4 (MSAA) — that is what antialiases every scene edge. The main
// scene is never drawn to the default framebuffer directly (grep confirms the
// only renderer.render(scene,...) calls live in logo.js/shield.js, which own
// SEPARATE renderers/canvases). So enabling antialias here would allocate a
// multisampled DEFAULT framebuffer that only ever receives OutputPass's
// fullscreen-triangle blit — a blit has no internal edges to smooth, so that
// buffer's MSAA is pure wasted VRAM + resolve bandwidth, most costly exactly
// on the fill-rate-bound mobile GPUs we care about. Turning it off changes
// nothing visible (composer MSAA still does the AA) and frees that buffer.
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
// Device-pixel-ratio cap. Phones/tablets report DPR 2–3; rendering the whole
// pipeline (the fill-rate-heavy water shader + the half-float MSAA composer
// target + bloom) at that ratio is the dominant per-frame GPU cost AND the
// biggest one-time GPU allocation on mobile — a prime suspect for the slow
// first-frame stall on iOS Safari (the 3D world appears several seconds late
// behind the already-interactive UI). Capping mobile to 1.5 shrinks every
// render target ~44% vs 2.0 (faster to allocate, far less VRAM/bandwidth)
// while staying crisp on a Retina phone. Desktop is unchanged (min(DPR, 2)).
// Detection uses coarse-pointer / touch only — NOT viewport width — so a
// narrow desktop window with a mouse is never downscaled. Reused for the
// composer + bloom below so all three render targets share the same ratio.
const IS_MOBILE_GPU = window.matchMedia('(pointer: coarse)').matches
  || navigator.maxTouchPoints > 0
  || 'ontouchstart' in window;
const PIXEL_RATIO = Math.min(window.devicePixelRatio, IS_MOBILE_GPU ? 1.5 : 2);
renderer.setPixelRatio(PIXEL_RATIO);
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
composer.setPixelRatio(PIXEL_RATIO);
composer.addPass(new RenderPass(scene, camera));
// Bloom runs at half the CSS resolution: bloom is a wide blur, so its down/
// upsample mip chain is imperceptible at half res (verified by before/after
// screenshots in menu, race and voyage) while the fullscreen fill cost drops
// ~4x on fill-rate-bound (mobile) GPUs.
const BLOOM_RES_SCALE = 0.5;
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth * BLOOM_RES_SCALE, window.innerHeight * BLOOM_RES_SCALE),
  0.45,  // strength
  0.55,  // radius
  0.9    // threshold — only truly bright things bloom
);
composer.addPass(bloomPass);
// ---- cinematic finishing pass: vignette + film grain + speed-linked
// chromatic aberration, all in ONE ShaderPass so it's a single extra
// full-screen fill regardless of scene complexity — zero draw-call cost,
// a fixed per-pixel cost independent of how many boats/props are on screen,
// which is exactly the kind of "looks premium" upgrade that's safe on mobile.
// Runs before OutputPass so it works in the same linear working space as
// bloom's output; OutputPass still does the final sRGB conversion.
const finishPass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0 }, // 0..1, driven by G.speed each frame
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAberration;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec2 ctr = vUv - 0.5;
      // speed-based chromatic aberration: sample R/G/B at slightly offset UVs
      // radiating from screen centre — subtle at rest, more pronounced at
      // speed, reinforcing the sense of speed rather than being pure decor.
      float ca = uAberration * 0.0035;
      vec2 dir = normalize(ctr + 1e-5);
      vec3 col = vec3(
        texture2D(tDiffuse, vUv - dir * ca).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv + dir * ca).b
      );
      // vignette: soft darkening toward the corners for cinematic framing
      float vig = 1.0 - dot(ctr, ctr) * 0.55;
      col *= clamp(vig, 0.72, 1.0);
      // film grain: cheap per-pixel noise, animated so it doesn't read as a
      // static dirty-lens smudge
      float grain = (hash(vUv * 800.0 + uTime) - 0.5) * 0.025;
      col += grain;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
composer.addPass(finishPass);
composer.addPass(new OutputPass());

// lights
const sunDir = new THREE.Vector3(0.35, 0.32, -0.88).normalize();
const sun = new THREE.DirectionalLight(0xffe0b8, 2.2);
sun.position.copy(sunDir).multiplyScalar(300);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x9db8dd, 0x16304f, 0.75));
// cool-toned fill light from roughly the camera's own side (above, behind the
// boats) — the sun is mostly AHEAD of the boats (matching the forward-facing
// chase cam, so it already acts as a natural backlight/rim on what the camera
// sees), which left the surfaces actually facing the camera — rowers' backs,
// the stern-side of the hull — lit only by the flat ambient hemisphere. This
// adds dimension there without any new geometry/draw calls: lighting is a
// uniform, its cost is already paid by the existing two lights, a third is a
// negligible per-fragment addition.
const fillDir = new THREE.Vector3(-0.15, 0.5, 1).normalize();
const fillLight = new THREE.DirectionalLight(0x9fc8ff, 0.5);
fillLight.position.copy(fillDir).multiplyScalar(300);
scene.add(fillLight);

// world
const sky = createSky();
scene.add(sky);
const water = createWater({ sunDir, fogColor: FOG_COLOR, fogNear: 320, fogFar: 1150 });
scene.add(water.mesh);
const fjord = createFjord(); // kept — stage moods tint its materials live
scene.add(fjord);
scene.add(createClouds());
scene.add(createFogBanks());
const seagulls = createSeagulls();
scene.add(seagulls.group);
// boot-intro-only conceptual set dressing (herbern + frihets/liberty) —
// hidden the instant the intro ends, see endIntro() below
const introLandmarks = createIntroLandmarks(scene);

// ================= Stage moods: per-etappe lys/farge-profil =================
// Every voyage stage carries a `mood` palette (see VOYAGE_STAGES in
// voyage.js): sky gradient, fog colour/range, water tones, sun colour/
// intensity and a mountain tint. setStageMood() starts a ~1s crossfade
// toward it; the actual lerp runs in update() so it's frame-rate safe.
// KAPPRO always fades back to BASE_MOOD (stage 1's dawn = the game's
// original hardcoded "blå time" values, so the daily race looks untouched).
const BASE_MOOD = VOYAGE_STAGES[0].mood;
const _moodColorKeys = ['skyTop', 'skyMid', 'skyBot', 'fog', 'deep', 'shallow', 'waterSky', 'warm', 'sun', 'mtn'];
function _resolveMood(m) {
  const r = { fogNear: m.fogNear, fogFar: m.fogFar, sunI: m.sunI };
  for (const k of _moodColorKeys) r[k] = new THREE.Color(m[k]);
  return r;
}
const MOOD = {
  cur: _resolveMood(BASE_MOOD), // live values, written to the scene every blend frame
  from: null, to: null, t: 1,   // t=1 → blend finished
};
function setStageMood(mood) {
  const target = _resolveMood(mood);
  // already there (common case: restart same stage / repeated kapp runs)
  if (MOOD.t >= 1 && _moodColorKeys.every((k) => MOOD.cur[k].equals(target[k]))
    && MOOD.cur.sunI === target.sunI && MOOD.cur.fogFar === target.fogFar) return;
  // snapshot the LIVE values as the blend's start point (mid-blend restarts
  // continue smoothly from wherever the previous fade got to)
  MOOD.from = { fogNear: MOOD.cur.fogNear, fogFar: MOOD.cur.fogFar, sunI: MOOD.cur.sunI };
  for (const k of _moodColorKeys) MOOD.from[k] = MOOD.cur[k].clone();
  MOOD.to = target;
  MOOD.t = 0;
}
// write MOOD.cur into every consumer — sky uniforms, scene fog, water tone,
// sun light and the fjord's material tints
function applyMoodToScene() {
  const c = MOOD.cur;
  sky.userData.skyUniforms.top.copy(c.skyTop);
  sky.userData.skyUniforms.mid.copy(c.skyMid);
  sky.userData.skyUniforms.bot.copy(c.skyBot);
  scene.fog.color.copy(c.fog);
  scene.fog.near = c.fogNear;
  scene.fog.far = c.fogFar;
  water.tone.deep.copy(c.deep);
  water.tone.shallow.copy(c.shallow);
  water.tone.sky.copy(c.waterSky);
  water.tone.warm.copy(c.warm);
  water.tone.fog.copy(c.fog);
  sun.color.copy(c.sun);
  sun.intensity = c.sunI;
  for (const m of fjord.userData.mats) m.color.copy(c.mtn);
}
function tickMood(dt) {
  if (MOOD.t >= 1) return;
  MOOD.t = Math.min(1, MOOD.t + dt); // 1s crossfade
  const k = MOOD.t * MOOD.t * (3 - 2 * MOOD.t);
  for (const key of _moodColorKeys) MOOD.cur[key].lerpColors(MOOD.from[key], MOOD.to[key], k);
  MOOD.cur.fogNear = MOOD.from.fogNear + (MOOD.to.fogNear - MOOD.from.fogNear) * k;
  MOOD.cur.fogFar = MOOD.from.fogFar + (MOOD.to.fogFar - MOOD.from.fogFar) * k;
  MOOD.cur.sunI = MOOD.from.sunI + (MOOD.to.sunI - MOOD.from.sunI) * k;
  applyMoodToScene();
}

// self-terminating bloom pulse (landmark reveals, turbo pickups) — decays in
// update(), same "never leave a flash stuck on" principle as perfectFlash
const BLOOM_BASE = 0.45; // = the UnrealBloomPass strength set at boot
let bloomPulse = 0;

// ---- daily challenge: everyone rows the same course on a given calendar day ----
const _today = new Date();
const DAILY_SEED = _today.getFullYear() * 10000 + (_today.getMonth() + 1) * 100 + _today.getDate();
const DAILY_LABEL = `${String(_today.getDate()).padStart(2, '0')}.${String(_today.getMonth() + 1).padStart(2, '0')}.${_today.getFullYear()}`;
const DAILY_KEY = `${_today.getFullYear()}-${String(_today.getMonth() + 1).padStart(2, '0')}-${String(_today.getDate()).padStart(2, '0')}`;
// Fase 3c: `let` — voyage stages rebuild the course; kapp always rebuilds back
// to THIS daily layout. builtStageId: null = the daily/KAPPRO course is built.
let course = createCourse(scene, DAILY_SEED);
let builtStageId = null;
// Fase 3e: one-shot override for "Ro etappe N igjen" — voyage.total has
// already moved past stage N by the time that button is clicked (this run's
// distance was credited at the finish line), so ensureCourseForMode() can't
// derive "the stage the run started on" from the live total anymore. Set this
// right before startRace(true) to force that specific stage; it consumes
// itself on the next call.
let forceStageId = null;

// swap the course to match the mode/stage about to be raced. No-op when the
// right course is already built (the common case — repeated runs, restarts).
function ensureCourseForMode() {
  if (G.gameMode === 'voyage') {
    const stage = forceStageId != null
      ? (VOYAGE_STAGES.find((s) => s.id === forceStageId) || currentStage(voyage.total))
      : currentStage(voyage.total);
    forceStageId = null;
    // sea state per stage — set even when the course is already built (the
    // scale may have been reset by an intervening KAPPRO run). ONE call
    // drives GPU shader and CPU sampleWater identically (Regel 6).
    setWaveScale(stage.waveScale ?? 1.0);
    setStageMood(stage.mood); // ~1s crossfade into this leg's light (no-op if already there)
    if (builtStageId === stage.id) return stage;
    disposeCourse(scene, course);
    course = createCourse(scene, stage.seed, stage);
    builtStageId = stage.id;
    // same shader pre-warm as the boot-time one below (renderer.compile),
    // but for THIS stage's fresh materials — without it, the first frame
    // that actually needs them (i.e. once the player starts rowing) stalls
    // compiling lazily instead, which on a slow mobile GPU can read as "the
    // graphics haven't loaded yet" for a few seconds into the race. Doing it
    // here means any stall lands during the countdown that follows, not once
    // the player is already moving.
    renderer.compile(scene, camera);
    return stage;
  }
  setWaveScale(1.0); // KAPPRO always races the classic sea — leaderboard premise
  setStageMood(BASE_MOOD); // ...and the classic dawn light (identical to the original values)
  if (builtStageId !== null) {
    disposeCourse(scene, course);
    course = createCourse(scene, DAILY_SEED); // bit-identical daily layout — leaderboard premise
    builtStageId = null;
    renderer.compile(scene, camera); // same pre-warm as the voyage branch above
  }
  return null;
}
{ const el = document.getElementById('dailyDate'); if (el) el.textContent = DAILY_LABEL; }

// ship
// Fase 3: the voyage is persistent across sessions — load it once up front so
// a returning player whose ship already reached the USA sees the trophy on
// deck immediately, with no rebuild needed.
let voyage = loadVoyage();
// the boot cinematic (INTRO, below) always shows the trophy aboard regardless
// of real story progress — it's a hero shot, not a literal save-state readout
// — endIntro() puts trophyMesh.visible back to the true voyage.trophy value
// once the cinematic hands off to the real menu/gameplay.
const shipData = buildShip('norway', { trophy: true });
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

// ---- soft contact shadow under each hull ----
// Without this the boats read as floating just above the water — a real
// shadow map for two moving hulls would mean enabling renderer.shadowMap
// (costly, and works against the draw-call cuts just made for mobile), so
// instead: one canvas-gradient blob per boat, positioned/rotated each frame
// from the SAME x/z/heading/waterY the hull itself uses. Lives at scene level
// (not a child of the hull) and its geometry is pre-rotated flat once, so only
// rotation.y ever changes — mirrors how boat.rotation.y = -heading works in
// seatBoatOnWater(), no per-frame Euler-order ambiguity.
const hullShadowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(4,10,20,0.55)');
  grad.addColorStop(0.65, 'rgba(4,10,20,0.28)');
  grad.addColorStop(1, 'rgba(4,10,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
function createHullShadow() {
  const geo = new THREE.PlaneGeometry(12, 36);
  geo.rotateX(-Math.PI / 2); // bake flat once — only rotation.y changes per frame
  const mat = new THREE.MeshBasicMaterial({ map: hullShadowTex, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  return mesh;
}
function updateHullShadow(mesh, x, z, heading, waterY) {
  mesh.position.set(x, waterY + 0.06, z); // just proud of the water surface — no z-fighting
  mesh.rotation.y = -heading;
}
const shipShadow = createHullShadow();
const rivalShadow = createHullShadow();

const R = {
  x: 14, z: 0, speed: 0, heading: 0, strokePhase: 0.5, finishTime: null, pace: 13.4,
  aimOff: 8, wobble: 0, bomT: 0,
};
// rival follows the gate line — interpolated straight from the course's own
// gates array (real x/z, the single source of truth world.js already built),
// not a re-derived sine formula. An earlier version recomputed
// `Math.sin(t * 1.7) * (CHANNEL_HALF - 30)` here, missing the per-course
// `gatePhase` random offset that world.js's real gate placement includes —
// the rival's "weave" ended up on a completely uncorrelated wave from the
// actual gates (Regel 8 territory: two copies of the same formula silently
// diverged). Interpolating the real gates avoids the whole bug class.
// At the start the two boats sit on OPPOSITE sides of gate 1's opening — the
// player just left of centre, the rival just right — each lined up with its own
// half of the gap, so rowing straight ahead splits the gate and the hulls never
// cross. See startRace() for the spawn and the rival start-line blend below.
const GATE1_LANE = 6; // lateral offset from gate 1's centre for each boat
function rivalPathX(z) {
  const gates = course.gates;
  if (!gates || !gates.length) return 0;
  if (z >= gates[0].z) return gates[0].x; // before the first gate — hold its line
  for (let i = 0; i < gates.length - 1; i++) {
    if (z <= gates[i].z && z >= gates[i + 1].z) {
      const t = (gates[i].z - z) / (gates[i].z - gates[i + 1].z);
      return gates[i].x + (gates[i + 1].x - gates[i].x) * t;
    }
  }
  return gates[gates.length - 1].x; // past the last gate — hold its line to the finish
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
  g.font = '900 52px Cinzel, system-ui, serif';
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

function spawnFireworkBurst(x, y, z, colorHex, count = 70, withSound = true) {
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
  if (withSound) fireworkBoom(0.22 + Math.random() * 0.14);
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
const GH = { shipData: null, ship: null, data: null, idx: 0, phase: 0, lead: null, lastTrack: null };

// hologram-style translucent ship + floating name label — shared by the local
// best-time ghost (GH, blue) and a challenge opponent (C, gold; Fase 2)
function buildTintedGhostShip(colorHex, labelCss, labelText) {
  const shipData = buildShip('norway');
  const ship = shipData.ship;
  const ghostMat = new THREE.MeshBasicMaterial({
    color: colorHex, transparent: true, opacity: 0.26, depthWrite: false,
  });
  ship.traverse((o) => {
    if (o.isSprite) { o.visible = false; return; } // no HAALAND plate on the ghost
    if (o.isMesh) o.material = ghostMat;
  });
  const c = document.createElement('canvas');
  c.width = 256; c.height = 56;
  const g = c.getContext('2d');
  g.font = '800 30px Cinzel, system-ui, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = labelCss;
  g.fillText(labelText.toUpperCase().slice(0, 14), 128, 30);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.8, depthWrite: false }));
  label.scale.set(5.4, 1.2, 1);
  label.position.set(0, 11, 0);
  ship.add(label);
  scene.add(ship);
  return shipData;
}

function buildGhostShip() {
  if (GH.ship) return;
  GH.shipData = buildTintedGhostShip(0x9fd8ff, 'rgba(159, 216, 255, 0.85)', 'DITT BESTE');
  GH.ship = GH.shipData.ship;
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

// ================= Challenge (Fase 2): async duel via shareable link =================
// separate, unsigned system — challenge times never touch the leaderboard's
// signature chain and are never auto-submitted to the leaderboard.
const C = { active: false, alias: '', time: 0, track: null, idx: 0, phase: 0, shipData: null, ship: null };

function buildChallengeShip(alias) {
  if (C.ship) return;
  C.shipData = buildTintedGhostShip(0xffd25e, 'rgba(255, 210, 94, 0.9)', alias || 'UTFORDRER');
  C.ship = C.shipData.ship;
}

// shared interpolated-ghost stepper — advances `state.idx`/`state.phase` along
// `rec` ([t,x,z,heading] samples) up to timeline `t` and seats `state.ship` on
// the water. Used by BOTH the local best-time ghost (GH) and the challenge
// opponent (C) — do not fork this logic, only the tint/label differ.
function stepGhost(state, rec, t, dt) {
  while (state.idx < rec.length - 2 && rec[state.idx + 1][0] <= t) state.idx++;
  const a = rec[state.idx];
  const b = rec[Math.min(state.idx + 1, rec.length - 1)];
  const span = Math.max(0.0001, b[0] - a[0]);
  const k = THREE.MathUtils.clamp((t - a[0]) / span, 0, 1);
  const gx = a[1] + (b[1] - a[1]) * k;
  const gz = a[2] + (b[2] - a[2]) * k;
  const ghd = a[3] + (b[3] - a[3]) * k;
  state.phase = (state.phase + dt * 0.85 / STROKE_CYCLE) % 1;
  const gp = cyclePose(state.phase);
  poseStroke(state.shipData, gp.reach, gp.dip, waterT + 7);
  seatBoatOnWater(state.ship, gx, gz, ghd, dt, 0, 0);
  return { x: gx, z: gz };
}

// ================= Fase 4a: R-O-W-A-Y letter hunt =================
// One gold letter per race (whichever letter you're missing next), spawned
// fresh each startRace() — mirrors the football collectibles' pickup logic
// (distance filter, radius check, taken flag, hide mesh) but lives outside
// world.js's seeded createCourse() since which letter appears depends on
// mutable local progress, not the deterministic daily course.
const LETTER = { mesh: null, char: null, x: 0, z: 0, r: 3.4, taken: false };

function buildLetterSprite(char) {
  const c = document.createElement('canvas');
  c.width = 160; c.height = 160;
  const g = c.getContext('2d');
  // soft halo baked into the texture — sprites aren't lit, so "glow" has to
  // come from the pixels themselves (bright enough to trip the bloom pass,
  // same trick as the dragon-head eyes / lanterns)
  const glow = g.createRadialGradient(80, 80, 10, 80, 80, 80);
  glow.addColorStop(0, 'rgba(255, 210, 94, .9)');
  glow.addColorStop(1, 'rgba(255, 210, 94, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 160, 160);
  g.font = '900 116px Cinzel, system-ui, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff6d9';
  g.fillText(char, 80, 86);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(6, 6, 1);
  return sprite;
}

// middle 60% of the course, inside the channel, clear of gates/obstacles/
// footballs (simple clearance-radius check, a few random attempts)
function pickLetterSpot() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const len = -course.finishZ; // Fase 3c: actual course length, stage-aware
    const z = -len * 0.2 - Math.random() * (len * 0.6);
    const x = (Math.random() - 0.5) * 2 * (CHANNEL_HALF - 12);
    const clear = [...course.collectibles, ...course.obstacles, ...course.gates].every((o) => {
      const dx = o.x - x, dz = o.z - z;
      return dx * dx + dz * dz > 10 * 10;
    });
    if (clear) return { x, z };
  }
  return { x: 0, z: course.finishZ * 0.5 }; // unlucky 30 tries — still a valid, if untested, spot
}

// called from startRace(): pick this race's letter (if any left to find) and
// give it a fresh position — per-race state, reset every time (Regel 1)
function spawnLetterForRace() {
  const letters = loadLetters();
  const char = nextLetter(letters.have);
  G.letterTaken = false;
  if (!char) { // full set already sitting uncommitted is impossible, but be defensive
    if (LETTER.mesh) LETTER.mesh.visible = false;
    LETTER.taken = true;
    return;
  }
  const spot = pickLetterSpot();
  LETTER.char = char;
  LETTER.x = spot.x;
  LETTER.z = spot.z;
  LETTER.taken = false;
  if (!LETTER.mesh || LETTER.mesh.userData.char !== char) {
    if (LETTER.mesh) scene.remove(LETTER.mesh);
    LETTER.mesh = buildLetterSprite(char);
    LETTER.mesh.userData.char = char;
    scene.add(LETTER.mesh);
  }
  LETTER.mesh.position.set(spot.x, 2.4, spot.z);
  LETTER.mesh.visible = true;
}

// ================= Cinematic intro: the two crews sprint the last stretch =====
// ==== toward the start line, trading the lead, while the camera cuts through
// four trailer-style shots. Both ships START ahead of the start line (positive
// z — open water, no course objects there) and the analytic distance profile
// lands them EXACTLY on their menu spots (G 0/0, R 14/0) as the last shot
// settles into the menu chase camera — a seamless handover, no teleport.
const INTRO = { active: true, t: 0, cadence: 0.35 };
const INTRO_V = 17;          // sprint speed (m/s) — race-typical, drives spray/wake/lean for free
const INTRO_SPRINT_T = 7.5;  // full-speed battle (shots 1-4)
const INTRO_DECEL_T = 2.0;   // glide to a stop (shot 5 — crane up into the menu cam)
const INTRO_TOTAL = INTRO_SPRINT_T + INTRO_DECEL_T;
// distance covered by the profile below: V*T1 + V*T2/2 — start exactly that far out
const INTRO_START_Z = INTRO_V * (INTRO_SPRINT_T + INTRO_DECEL_T / 2);
// (the fleet is parked at the intro start line right after G is declared below
// — the boot preloader hides the scene while it sits static there, and the
// overlay lifts onto ships already mid-sprint)

// Drives ship positions/cadence each frame while the intro plays (called from
// update() before the on-water seating, so seatBoatOnWater/wake/bow-spray all
// see the sprint). Everything is computed analytically from INTRO.t — zero
// integration drift, so the boats land exactly on their menu spots at the end.
function updateIntroAction(dt) {
  const t = Math.min(INTRO.t, INTRO_TOTAL);
  const kB = THREE.MathUtils.clamp((t - INTRO_SPRINT_T) / INTRO_DECEL_T, 0, 1); // 0 sprint → 1 stopped
  const wob = 1 - kB * kB * (3 - 2 * kB); // weave/battle amplitude fades out with the decel
  // analytic distance: constant V, then linear ramp to 0 (area = V*T2/2)
  const t2 = Math.max(0, t - INTRO_SPRINT_T);
  const dist = INTRO_V * Math.min(t, INTRO_SPRINT_T) + INTRO_V * t2 - (INTRO_V * t2 * t2) / (2 * INTRO_DECEL_T);
  G.speed = INTRO_V * (1 - kB);
  G.z = INTRO_START_Z - dist;
  // gentle, disciplined lines: a slow ±1.2 m drift per boat, lanes ~11 m
  // apart at the closest — the duel is in the LEAD trading below, never in
  // hulls crossing (an earlier ±3.8 m carve read as the boats crashing)
  G.x = THREE.MathUtils.lerp(-5 + Math.sin(t * 0.45) * 1.2, 0, kB);
  G.heading = 0.032 * Math.cos(t * 0.45) * wob; // yaw matches the drift's direction
  // the rival battles on the clock, not the racing line: surges ahead, falls back
  const lead = Math.sin(t * 0.5 + 0.9) * 10; // positive = rival in front (smaller z)
  R.speed = G.speed;
  R.z = G.z + (4 - lead) * wob;
  R.x = THREE.MathUtils.lerp(9 + Math.sin(t * 0.5 + 2.0) * 1.8, 14, kB);
  R.heading = 0.053 * Math.cos(t * 0.5 + 2.0) * wob;
  // hard racing cadence while sprinting, easing back to the idle loop's 0.35
  INTRO.cadence = THREE.MathUtils.lerp(1.8, 0.35, kB);
  // (rival wake/bow-spray/blade-splash all live in the always-running rival
  // block in update() — driven by R.speed, so setting it above is enough)
}

// Five cuts, all anchored to the MOVING ships (P = player, M = midpoint of the
// two hulls) so every shot tracks the sprint. Three of them sit well back from
// the fleet (establishing / wide orbit / distant bow line) with one close-up
// in between — the mix reads as a trailer, not a barrage of close calls:
//  1 wide establishing: 35-40 m off the beam, both hulls in profile vs the fjord
//  2 hull-skim: low alongside the player's hull, the ship surges past the lens
//  3 wide drone orbit: a high, slow 150° sweep around the stern of the duel
//  4 bow line: ahead of the fleet at a respectful distance as it bears down
//  5 crane up: rises over the player's stern into the exact menu chase framing
const INTRO_SHOTS = [
  { dur: 1.9, kind: 'track', posA: 'M', posFrom: [-42, 9, -14], posTo: [-32, 7.5, 0], lookA: 'M', lookFrom: [0, 2.5, 0], lookTo: [0, 2.5, 2], fovFrom: 42, fovTo: 46, jitter: 0.04 },
  { dur: 1.5, kind: 'track', posA: 'P', posFrom: [-10, 1.7, -22], posTo: [-7, 2.6, 13], lookA: 'P', lookFrom: [0, 3, -12], lookTo: [1, 3.2, 4], fovFrom: 60, fovTo: 53, jitter: 0.10 },
  { dur: 2.3, kind: 'orbit', a0: -1.7, a1: 0.9, r0: 42, r1: 26, h0: 7, h1: 13, fovFrom: 44, fovTo: 46, jitter: 0.04 },
  { dur: 1.8, kind: 'track', posA: 'M', posFrom: [-18, 2.4, -64], posTo: [14, 3.6, -18], lookA: 'M', lookFrom: [0, 2.4, 0], lookTo: [0, 2.6, 4], fovFrom: 44, fovTo: 54, jitter: 0.10 },
  { dur: 2.0, kind: 'crane', posFrom: [-14, 6, -10], posTo: [0, 15.5, 27], fovFrom: 50, fovTo: 58, jitter: 0.03 },
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
  const mx = (G.x + R.x) / 2, mz = (G.z + R.z) / 2; // midpoint of the duel
  const ax = (a) => (a === 'M' ? mx : G.x);
  const az = (a) => (a === 'M' ? mz : G.z);
  if (shot.kind === 'orbit') {
    const a = shot.a0 + (shot.a1 - shot.a0) * e;
    const r = shot.r0 + (shot.r1 - shot.r0) * e;
    const h = shot.h0 + (shot.h1 - shot.h0) * e;
    camera.position.set(mx + Math.sin(a) * r, h, mz + Math.cos(a) * r);
    _iv1.set(mx, 2.6, mz);
  } else if (shot.kind === 'crane') {
    camera.position.set(
      G.x + shot.posFrom[0] + (shot.posTo[0] - shot.posFrom[0]) * e,
      shot.posFrom[1] + (shot.posTo[1] - shot.posFrom[1]) * e,
      G.z + shot.posFrom[2] + (shot.posTo[2] - shot.posFrom[2]) * e
    );
    // look swings from the duel's midpoint to the menu camera's own target
    _iv1.set(mx, 2.6, mz).lerp(_iv2.set(G.x, 1.2, G.z - 34), e);
  } else {
    camera.position.set(
      ax(shot.posA) + shot.posFrom[0] + (shot.posTo[0] - shot.posFrom[0]) * e,
      shot.posFrom[1] + (shot.posTo[1] - shot.posFrom[1]) * e,
      az(shot.posA) + shot.posFrom[2] + (shot.posTo[2] - shot.posFrom[2]) * e
    );
    _iv1.set(
      ax(shot.lookA) + shot.lookFrom[0] + (shot.lookTo[0] - shot.lookFrom[0]) * e,
      shot.lookFrom[1] + (shot.lookTo[1] - shot.lookFrom[1]) * e,
      az(shot.lookA) + shot.lookFrom[2] + (shot.lookTo[2] - shot.lookFrom[2]) * e
    );
  }
  // subtle handheld wobble — sells speed without motion sickness
  camera.position.x += Math.sin(INTRO.t * 11) * shot.jitter;
  camera.position.y += Math.sin(INTRO.t * 8.7 + 2) * shot.jitter * 0.7;
  camera.lookAt(_iv1);
  camera.fov = shot.fovFrom + (shot.fovTo - shot.fovFrom) * e;
  camera.updateProjectionMatrix();
}

// the boot-intro-only conceptual set dressing (herbern + frihets/liberty,
// see createIntroLandmarks in world.js) — called from every path that ends
// the intro (played out in full, skipped by a tap, or bypassed entirely by
// a challenge deep-link) so it never lingers into the menu/race.
function hideIntroLandmarks() { introLandmarks.visible = false; }

// "Presented by Winsen" intro sting (public/winsen_intro.svg) — shown once,
// right as the boot cinematic starts (the preloader has just hidden — see
// its trigger in stepPreload()), held a couple seconds, then dissolved via
// the .show/.hide CSS transitions in index.html. Skipped entirely when the
// intro itself never plays — the INTRO.active guard covers the
// challenge-deep-link boot path (initChallengeFromURL), which can already
// have ended the intro before this ever fires.
const WINSEN_CARD_HOLD_MS = 2200;
function showWinsenIntroCard() {
  if (!INTRO.active) return;
  hud.winsenIntroCard.classList.add('show');
  setTimeout(() => { if (INTRO.active) hideWinsenIntroCard(); }, WINSEN_CARD_HOLD_MS);
}
// called from every path that can end/skip the intro early (alongside the
// existing hideIntroLandmarks() calls below) so the card never lingers into
// the menu or a race started out from under the cinematic.
function hideWinsenIntroCard() {
  hud.winsenIntroCard.classList.remove('show');
  hud.winsenIntroCard.classList.add('hide');
}

function endIntro() {
  if (!INTRO.active) return;
  INTRO.active = false;
  hideIntroLandmarks();
  hideWinsenIntroCard();
  // land the fleet on its exact menu spots — the choreography ends here
  // anyway when it plays out in full, so this only "jumps" on a skip-tap
  // (where the hard cut to the menu camera hides it completely)
  G.speed = 0; G.heading = 0; G.x = 0; G.z = 0;
  R.speed = 0; R.heading = 0; R.x = 14; R.z = 0;
  INTRO.cadence = 0.35;
  camPos.set(0, 15.5, 27); // hand over seamlessly to the menu chase camera
  // the cinematic's always-visible trophy (see shipData construction above)
  // now yields to the real story state
  shipData.trophyMesh.visible = voyage.trophy;
  document.getElementById('cinebars').classList.remove('on');
  document.getElementById('controlsBtn').style.display = ''; // hidden during the intro — see index.html
  hud.startScreen.classList.remove('hidden');
  // choreographed entrance: the shield lands first, the wordmark follows
  shieldFX.reveal();
  setTimeout(() => logoFX.reveal(), 220);
}

// ---- Stage 5 pre-race cinematic: a short pan around the ship showing the
// trophy aboard, right before "THE VOYAGE HOME" begins — triggered once from
// startRace() (see the raceStage.id === FINAL_STAGE_ID check near its end).
// Boats are already parked at their real start-line spot by the time this
// runs, so every shot is anchored on G.x/G.z directly (no sprint math needed,
// unlike the boot INTRO above) and the final crane lands EXACTLY on the
// standard race-start chase pose (G.x, 15.5, G.z+27, looking G.z-34 ahead) —
// see the per-frame chase-cam block further down — so the handoff into the
// real countdown has no visible snap.
const TROPHY_PAN = { active: false, t: 0 };
// Camera stays at y>=5 for all of this — the hull's own shield rail tops
// out around y~1 (see addShields in ship.js: y=0.42, radius 0.62), and at
// the tight FOVs a trophy reveal wants, anything sub-2-unit-high reads as
// grazing the shields (verified live: a lower/closer first draft put a
// shield disc filling half the frame). Comfortably above that band instead.
const TROPHY_PAN_SHOTS = [
  // side-on reveal, sweeping in over the rail — the trophy fills the frame
  // without the shield rail intruding
  { dur: 1.6, kind: 'track', posFrom: [-14, 5.0, -2], posTo: [-11, 6.0, -10], lookFrom: [0, 1.3, -6.5], lookTo: [0, 1.8, -6.5], fovFrom: 46, fovTo: 42, jitter: 0.02 },
  // sweep around the bow to the other flank — the trophy reads from both sides
  { dur: 2.4, kind: 'orbit', a0: -1.95, a1: 0.6, r0: 13, r1: 14, h0: 6.0, h1: 7.0, fovFrom: 42, fovTo: 50 },
  // crane back and up into the exact race-start chase pose — posFrom here is
  // the orbit shot's own end pose (a1=0.6, r1=14, h1=7.0) written out so
  // this shot picks up with zero discontinuity from where the orbit left off
  { dur: 1.8, kind: 'crane', posFrom: [7.9, 7.0, 11.55], posTo: [0, 15.5, 27], fovFrom: 50, fovTo: 58, jitter: 0.03 },
];
const _tpv1 = new THREE.Vector3();
const _tpv2 = new THREE.Vector3();

function runTrophyPanCamera(dt) {
  TROPHY_PAN.t += dt;
  let t = TROPHY_PAN.t;
  let shot = null;
  for (const s of TROPHY_PAN_SHOTS) {
    if (t <= s.dur) { shot = s; break; }
    t -= s.dur;
  }
  if (!shot) { endTrophyPan(); return; }
  const k = t / shot.dur;
  const e = k * k * (3 - 2 * k); // ease in-out within each cut
  if (shot.kind === 'orbit') {
    const a = shot.a0 + (shot.a1 - shot.a0) * e;
    const r = shot.r0 + (shot.r1 - shot.r0) * e;
    const h = shot.h0 + (shot.h1 - shot.h0) * e;
    camera.position.set(G.x + Math.sin(a) * r, h, G.z + Math.cos(a) * r);
    _tpv1.set(G.x, 1.6, G.z - 6.5); // the trophy's own deck position (ship.js: z -6.5)
  } else if (shot.kind === 'crane') {
    camera.position.set(
      G.x + shot.posFrom[0] + (shot.posTo[0] - shot.posFrom[0]) * e,
      shot.posFrom[1] + (shot.posTo[1] - shot.posFrom[1]) * e,
      G.z + shot.posFrom[2] + (shot.posTo[2] - shot.posFrom[2]) * e
    );
    // look swings from the trophy to the standard race-start look-ahead point
    _tpv1.set(G.x, 1.6, G.z - 6.5).lerp(_tpv2.set(G.x, 1.2, G.z - 34), e);
  } else {
    camera.position.set(
      G.x + shot.posFrom[0] + (shot.posTo[0] - shot.posFrom[0]) * e,
      shot.posFrom[1] + (shot.posTo[1] - shot.posFrom[1]) * e,
      G.z + shot.posFrom[2] + (shot.posTo[2] - shot.posFrom[2]) * e
    );
    _tpv1.set(
      G.x + shot.lookFrom[0] + (shot.lookTo[0] - shot.lookFrom[0]) * e,
      shot.lookFrom[1] + (shot.lookTo[1] - shot.lookFrom[1]) * e,
      G.z + shot.lookFrom[2] + (shot.lookTo[2] - shot.lookFrom[2]) * e
    );
  }
  camera.position.x += Math.sin(TROPHY_PAN.t * 9) * (shot.jitter || 0);
  camera.position.y += Math.sin(TROPHY_PAN.t * 7 + 1) * (shot.jitter || 0) * 0.6;
  camera.lookAt(_tpv1);
  camera.fov = shot.fovFrom + (shot.fovTo - shot.fovFrom) * e;
  camera.updateProjectionMatrix();
}

function endTrophyPan() {
  if (!TROPHY_PAN.active) return;
  TROPHY_PAN.active = false;
  // land exactly on the standard race-start chase pose (see the per-frame
  // chase-cam block) so the real countdown picks up with no visible snap
  camPos.set(G.x, 15.5, G.z + 27);
  camera.position.copy(camPos);
  camLook.set(G.x, 1.2, G.z - 34);
  camera.lookAt(camLook);
  camera.fov = 58;
  camera.updateProjectionMatrix();
}

// any key or tap skips the intro (and swallows the event so it doesn't hit menus)
function maybeSkipIntro(e) {
  if (!INTRO.active) return;
  e.stopImmediatePropagation(); // the skip-press must not reach the menu handlers
  e.stopPropagation();
  // this may be the player's very first interaction with the page — it must
  // also kick audio init, or a skip-tap swallows the event before the
  // separate kickAudio listener below ever sees it, leaving the theme silent
  // until a SECOND tap. (Browsers require a real gesture before any sound
  // can play at all, so the earliest it can start is right here.)
  kickAudio();
  endIntro();
}
window.addEventListener('keydown', maybeSkipIntro, { capture: true });
window.addEventListener('pointerdown', maybeSkipIntro, { capture: true });

// ================= Game state =================
const G = {
  mode: 'menu', // menu | countdown | racing | finished
  // Fase 3b: which mode this run is being played in — set by whichever start
  // button was clicked, persists across quick-restarts of that same run
  // (never reset in startRace()), only changes when a start button is
  // clicked again from the menu.
  gameMode: 'kapp', // 'kapp' (daily race + leaderboard) | 'voyage' (the journey)
  // Fase 3e: which voyage stage this run started on, and whether it crossed
  // into a new one by the finish — both reset in startRace() (Regel 1),
  // computed fresh in finishRace().
  stageAtRunStart: 0,
  stageChangedThisRun: false,
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
  hitStop: 0,        // slow-mo timer after crash
  fovPunch: 0,       // camera kick on perfect strokes
  ghostRec: [],      // this run's recording: [t, x, z, heading] samples
  ghostSampleT: 0,   // countdown to the next ghost sample
  strokePhase: 0,    // idle rowing cycle (menu/finished)
  lastStrokeAt: -9,
  charging: false,   // holding the oars — power building
  charge: 0,         // 0..CHARGE_OVER while holding
  // release snapshot (feel-fix): -1 = no snapshot active. 0..METER_HOLD_S =
  // frozen at meterFrozenFill; METER_HOLD_S..METER_HOLD_S+METER_DRAIN_S =
  // lerping frozenFill -> 0. Lets the player actually see where they let go
  // relative to the zone, instead of an instant snap to empty.
  meterReleaseT: -1,
  meterFrozenFill: 0,
  meterFrozenClass: '', // 'in-zone' | 'over' | '' — colour at the moment of release
  driveT: 0,         // drive animation timer after release
  reach: -0.12,      // oar sweep: -1 catch (bow) .. +1 finish (stern)
  dip: 0,            // 0 blades high .. 1 buried
  driveFrom: -1,     // reach captured at the moment of release
  countdownT: 0,
  finishT: 0,
};
// park the fleet at the cinematic-intro start line (see the INTRO block above
// — the boot preloader hides the scene while the ships sit static out here)
G.z = INTRO_START_Z; G.x = -5;
R.z = INTRO_START_Z + 4; R.x = 7;
const STROKE_CYCLE = 1.35; // rival's rowing cycle

// ---- Haaland's tempo drum: donk, donk … RO! ----
const TEMPO_MAX = 8; // scale unit for the crash energy penalty (see T.energy -= 3/TEMPO_MAX)
const RO_LEAD_S = 0.12; // speechSynthesis startup latency compensation
// ---- Crew energy: each stroke feeds the drum ----
// Strong strokes push energy up, energy leaks over time, and the drum
// period follows. The drum CHASES the rower — pure feedback, never a
// requirement (rule 7: rhythm is a bonus, drum speed caps nothing).
const DRUM_PERIOD_SLOW = 1.80; // idle crew — slightly brisker than the old base
const DRUM_PERIOD_FAST = 1.15; // full energy — hard floor
const ENERGY_PER_POWER = 0.16; // a PERFECT (power 1) adds this much
const ENERGY_DECAY = 0.06;     // per second — ~15 s from full to idle
const T = {
  phase: 0,       // 0..1 through the drum cycle; RO! fires at wrap
  period: 2.35,   // seconds per cycle — shrinks as tempo builds
  lastRoAt: -9,   // game-time of the last RO! shout
  hitL: 0, hitR: 0, // drum-arm strike timers
  maxAnnounced: false,
  roVoiceFired: false, // guards the lead-compensated roVoice() call within one cycle
  energy: 0,      // 0..1 crew energy — drives the drum period, see updateDrum()
  speedEase: 0,   // eased G.speed — drives the pendulum's fill rate, see chargeScale
};
const CHARGE_TIME = 0.95;  // seconds of holding to reach full power
const CHARGE_SCALE_FLOOR = 0.55;
const SPEED_FOR_MAX_CHARGE = 26; // matches the base (non-boost) speed cap — see maxSpeed in update()
const CHARGE_PERFECT_LO = 0.78, CHARGE_PERFECT_HI = 1.08; // release window (with grace past full)
const CHARGE_GOOD_LO = 0.55;
const CHARGE_OVER = 1.18;  // held too long → oars slip, auto-release
// Meter feel-fix: the blade fills 0..CHARGE_VIS_MAX (not 0..1) so the tip
// keeps moving all the way to the end of the real perfect window instead of
// freezing at charge=1 for the last ~0.22s of a max-length hold.
// Maps to CHARGE_PERFECT_HI (NOT CHARGE_OVER): the green window must END at
// the very tip of the blade, so "fill the bar to full = release now" — the
// universal charge-meter instinct. Extending it to CHARGE_OVER (1.18) once
// put the green zone at only 66-92% of the bar with a red tip on top, so
// filling to full overshot into the OVER/slip zone — the red flashed up
// "for no reason" the moment the bar looked full. The tiny 95 ms the blade
// now sits full-and-red during a genuine over-hold reads correctly as
// "too much!", which is exactly what it is.
const CHARGE_VIS_MAX = CHARGE_PERFECT_HI;
const METER_HOLD_S = 0.18;  // release snapshot: frozen at the release width...
const METER_DRAIN_S = 0.12; // ...then lerps to empty over this long
const BEST_KEY = 'vikingferd_best';
// Portstraff: missed gates cost time in KAPPRO — REISEN never applies this
// (see finishRace() and the gate-check loop below). MUST stay identical to
// GATE_MISS_PENALTY_S in netlify/functions/submit-score.js.
// KAPPRO gates are now hard checkpoints (see the gate-check loop): a miss
// rewinds the boat instead of letting the player sail past, so by the finish
// every kapp gate ends up g.passed=true and missedGates is always 0 — this
// flat penalty and the server-side recompute stay wired up as a dead-letter
// safety net, not the active penalty path anymore.
const GATE_MISS_PENALTY_S = 3.0;
// How far back (in +z, i.e. toward the start) a missed gate rewinds the boat.
// Sits well inside GATE_CLEAR_FRONT (46 m, world.js) — the approach lane is
// already guaranteed free of ice floes out to that distance, so a 30 m
// rewind can never drop the boat on top of an obstacle. Leaves ~1.5-2 s of
// clear water at typical race speed, enough to correct even a full-width
// miss (heading is clamped to ±0.7 rad) without turning it into a long detour.
const GATE_REWIND_M = 30;

// ================= Input =================
// Touch-mode detection: pure @media (pointer: coarse) misses real phones
// behind desktop-reporting webviews/emulators, which silently stripped the
// whole touch UI (ROW/steer buttons, touch hint texts) and left
// keyboard-only "SPACE" hints on mobile. Treat coarse pointer OR any touch
// points OR a phone-narrow viewport as touch mode, mirror it onto
// html.touch for CSS, and keep it live (a resize can cross the boundary).
let IS_TOUCH = false;
function updateTouchMode() {
  IS_TOUCH = window.matchMedia('(pointer: coarse)').matches
    || navigator.maxTouchPoints > 0
    || 'ontouchstart' in window
    || window.innerWidth <= 640;
  document.documentElement.classList.toggle('touch', IS_TOUCH);
}
updateTouchMode();
window.addEventListener('resize', updateTouchMode);

const keys = {};
let steerTouch = 0;
window.addEventListener('keydown', (e) => {
  // typing a name on the leaderboard must never drive the game
  if (e.target && e.target.tagName === 'INPUT') return;
  if (e.repeat) return;
  if (SHIP_VIEWER.active) { if (e.code === 'Escape') closeShipViewer(); return; }
  if (e.code === 'KeyR' && G.mode === 'finished' && G.finishT > 0.8) {
    // quick restart from ANY result stage — deliberately skips score saving.
    // Fase 3e: in voyage mode this always repeats the stage just played
    // (same as repeatStageBtn), never the stage bridge — R is a shortcut,
    // not a "continue the journey" action.
    // C3: the finished one-shot stage 5 can't be re-rowed — route out
    // instead of silently ignoring the press (Lærdom 19).
    if (G.gameMode === 'voyage' && G.stageAtRunStart === FINAL_STAGE_ID && isStageFinal(FINAL_STAGE_ID)) {
      continueFromResult(); // → returnToMenu via its stage-5 guard
      return;
    }
    if (G.gameMode === 'voyage') forceStageId = G.stageAtRunStart;
    startRace(true);
  }
  keys[e.code] = true;
  if (e.code === 'Space') {
    e.preventDefault();
    if (G.mode === 'racing' || G.mode === 'countdown') beginCharge();
    else if (G.mode === 'menu') {
      // splash → how-to; from the how-to modal Space launches the race
      if (!hud.howtoScreen.classList.contains('hidden')) startRace(false);
      else showHowto();
    }
    else if (G.mode === 'finished' && G.finishT > 1.2 && G.resultStage === 2) {
      // Fase 3e: Space on the stage interlude is always a forward action
      // ("RO NESTE ETAPPE!"/"RO VIDERE!"), never a "go back" — same button
      // the interlude's own click handler uses.
      if (!hud.stageInterludeScreen.classList.contains('hidden')) advanceStageInterlude();
      else continueFromResult();
    }
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Space') releaseStroke();
});

// DEV-ONLY: isolated ship model viewer (psw gallery) — see openShipViewer()/
// closeShipViewer() below. Orbit state lives here (module scope, not gated
// behind import.meta.env.DEV) so the ordinary input handlers just below can
// branch into it with a plain flag check — only the window.__game exposure
// that actually opens it is dev-gated.
const SHIP_VIEWER = { active: false, angle: 0.5, height: 8, dist: 22, dragging: false, lastX: 0 };

// pointer (mouse / bare touch): hold = charge, release = row, horizontal drag = steer.
// Buttons and inputs handle themselves — and only the pointer that STARTED a charge
// may release it, so a steering finger lifting never cuts your stroke short.
let touchStartX = null;
let chargePtr = null;
window.addEventListener('pointerdown', (e) => {
  if (e.target && e.target.closest && e.target.closest('button, input')) return;
  if (SHIP_VIEWER.active) { SHIP_VIEWER.dragging = true; SHIP_VIEWER.lastX = e.clientX; return; }
  touchStartX = e.clientX;
  if ((G.mode === 'racing' || G.mode === 'countdown') && !G.charging) {
    beginCharge();
    if (G.charging) chargePtr = e.pointerId;
  }
});
window.addEventListener('pointermove', (e) => {
  if (SHIP_VIEWER.active) {
    if (SHIP_VIEWER.dragging) { SHIP_VIEWER.angle -= (e.clientX - SHIP_VIEWER.lastX) * 0.01; SHIP_VIEWER.lastX = e.clientX; }
    return;
  }
  if (touchStartX === null) return;
  steerTouch = THREE.MathUtils.clamp((e.clientX - touchStartX) / 120, -1, 1);
});
function pointerEnd(e) {
  if (SHIP_VIEWER.active) { SHIP_VIEWER.dragging = false; return; }
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
  preloaderScreen: $('preloaderScreen'), preloadPct: $('preloadPct'),
  winsenIntroCard: $('winsenIntroCard'),
  topbar: $('topbar'), time: $('hudTime'), speed: $('hudSpeed'), balls: $('hudBallsCount'),
  meterWrap: $('strokeMeterWrap'), fill: $('oarFill'), zone: $('oarZoneBand'),
  meter: $('strokeMeter'), pendulum: $('pendulumCanvas'),
  feedback: $('feedback'), vignette: $('vignette'), countdown: $('countdown'),
  boostGlow: $('boostGlow'), hitFlash: $('hitFlash'),
  roCue: $('roCue'),
  startScreen: $('startScreen'), resultScreen: $('resultScreen'),
  resTime: $('resTime'),
  resultTitle: $('resultTitle'),
  resScore: $('resScore'), resRank: $('resRank'), resBalls: $('resBalls'), newBestBadge: $('newBestBadge'),
  resultMenuBtn: $('resultMenuBtn'),
  saveRow: $('saveRow'), aliasInput: $('aliasInput'), saveScoreBtn: $('saveScoreBtn'), savedMsg: $('savedMsg'),
  lbNameHeadline: $('lbNameHeadline'), lbNameSubtext: $('lbNameSubtext'), lbNameError: $('lbNameError'),
  leaderboard: $('leaderboard'), lbStart: $('lbStart'),
  placeBanner: $('placeBanner'), skipSaveBtn: $('skipSaveBtn'), lbResultWrap: $('lbResultWrap'), retryBtn: $('retryBtn'),
  resultTicker: $('resultTicker'),
  lbResultTitle: $('lbResultTitle'), viewFullLbBtn: $('viewFullLbBtn'),
  howtoScreen: $('howtoScreen'), lbScreen: $('lbScreen'), touchControls: $('touchControls'),
  shipViewerScreen: $('shipViewerScreen'),
  restartBtn: $('restartBtn'), confirmScreen: $('confirmScreen'),
  controlsBtn: $('controlsBtn'), howtoCloseBtn: $('howtoCloseBtn'),
  // Fase 2: challenge links
  challengeBtn: $('challengeBtn'), challengeMsg: $('challengeMsg'),
  challengeLinkScreen: $('challengeLinkScreen'), challengeLinkClose: $('challengeLinkClose'),
  challengeLinkInput: $('challengeLinkInput'), challengeLinkCopyBtn: $('challengeLinkCopyBtn'),
  challengeLinkDesc: $('challengeLinkDesc'),
  duelCard: $('duelCard'), duelResult: $('duelResult'),
  challengeScreen: $('challengeScreen'), challengeTitle: $('challengeTitle'), challengeTimeText: $('challengeTimeText'),
  challengeGoBtn: $('challengeGoBtn'), challengeNoBtn: $('challengeNoBtn'),
  // Fase 3: Atlanterhavsferden
  voyageBtn: $('voyageBtn'), voyageScreen: $('voyageScreen'), voyageMapWrap: $('voyageMapWrap'),
  voyageScreenTitle: $('voyageScreenTitle'),
  voyageStageCardWrap: $('voyageStageCardWrap'), voyageStageCardImg: $('voyageStageCardImg'),
  voyageStageBadgeImg: $('voyageStageBadgeImg'), voyageStageVideo: $('voyageStageVideo'),
  voyageDoneWrap: $('voyageDoneWrap'), voyageDoneImg: $('voyageDoneImg'), voyageDoneHeaderImg: $('voyageDoneHeaderImg'),
  voyageDoneStats: $('voyageDoneStats'), voyageDoneStatPlace: $('voyageDoneStatPlace'),
  voyageDoneStatTime: $('voyageDoneStatTime'), voyageDoneStatScore: $('voyageDoneStatScore'),
  voyageBackBtn: $('voyageBackBtn'),
  voyageMilestones: $('voyageMilestones'),
  voyageStartRaceBtn: $('voyageStartRaceBtn'), startNewVoyageBtn: $('startNewVoyageBtn'),
  voyageDoneLbBtn: $('voyageDoneLbBtn'), voyageDoneMenuBtn: $('voyageDoneMenuBtn'),
  // voyage server leaderboard (combined-time, per-stage tokens)
  voyageRankBanner: $('voyageRankBanner'), voyageLbWrap: $('voyageLbWrap'), voyageLeaderboard: $('voyageLeaderboard'),
  // Fase 3e: which stage this result just completed/is on, and the two
  // voyage-mode result buttons
  stageContext: $('stageContext'), stageNameBanner: $('stageNameBanner'),
  repeatStageBtn: $('repeatStageBtn'), nextStageBtn: $('nextStageBtn'),
  // Fase 3e: etappe-mellomsteg (stage bridge screen, voyage mode only)
  stageInterludeScreen: $('stageInterludeScreen'), interludeCard: $('interludeCard'),
  interludeDoneIcon: $('interludeDoneIcon'), interludeDoneText: $('interludeDoneText'),
  interludeTrophyBanner: $('interludeTrophyBanner'),
  interludeMapWrap: $('interludeMapWrap'), interludeMapImg: $('interludeMapImg'),
  interludeStageBadgeImg: $('interludeStageBadgeImg'), interludeMapVideo: $('interludeMapVideo'),
  interludeNextLabel: $('interludeNextLabel'), interludeNextLandmark: $('interludeNextLandmark'),
  interludeGoBtn: $('interludeGoBtn'), interludeMenuBtn: $('interludeMenuBtn'),
  // Fase 4a: oppdrag + bokstavjakt
  missionsBtn: $('missionsBtn'), missionsScreen: $('missionsScreen'),
  missionsList: $('missionsList'), letterStatus: $('letterStatus'), missionsBackBtn: $('missionsBackBtn'),
};
// distant ship's horn (public/sounds/horn.mp3) — a rare bit of splash-screen
// flavour, not a loop: a self-rescheduling timer fires every ~18-40s and only
// actually plays if the splash screen is the thing currently on screen (a
// visibility CHECK, not a gate on the timer itself, so the chain stays alive
// and correctly timed even while the player is elsewhere — e.g. mid-race —
// and just resumes honking next time they're back at the splash).
function scheduleSplashHorn() {
  const delay = 18000 + Math.random() * 22000;
  setTimeout(() => {
    if (!hud.startScreen.classList.contains('hidden')) hornSound();
    scheduleSplashHorn();
  }, delay);
}
scheduleSplashHorn();

// map charge fractions onto the designed oar's x-range (Union.svg viewBox 0..2460)
const OAR_X0 = 2.5, OAR_X1 = 2457, OAR_W = OAR_X1 - OAR_X0;
// green release disc — decorative glow, NOT the precise boundary (that's the
// .oarMid dashed markers, positioned directly from CHARGE_PERFECT_LO/HI
// below). Recentred on the honest 0..CHARGE_VIS_MAX visual mapping so it
// still roughly tracks the real window; radius stays as designed (cy/r are
// static in markup) — the circle is larger than the blade so the oar clip
// crops its top & bottom.
const zoneLoVis = CHARGE_PERFECT_LO / CHARGE_VIS_MAX, zoneHiVis = CHARGE_PERFECT_HI / CHARGE_VIS_MAX;
// hud.zone (#oarZoneBand) only exists in the demo meter now — the live meter is
// the procedural pendulum canvas. Guard so a missing element can't crash boot.
if (hud.zone) hud.zone.setAttribute('cx', OAR_X0 + ((zoneLoVis + zoneHiVis) / 2) * OAR_W);

// ================= Pendulum-curve rowing control (procedural canvas) =================
// A visual reskin of the SAME G.charge value: a bob rides a shallow arc.
//   charge 0            → bob at the right END (top of the side you're on)
//   charge rising       → bob slides down toward CENTRE, lightning fills behind it
//   PERFECT window      → green zone at the arc's centre
//   charge > CHARGE_OVER→ bob passes the green, lightning dies, "ÅRENE SKLIR"
// Charge TIMING is untouched (still fixed dt/CHARGE_TIME) — tempo (T.energy)
// only speeds up the visual pulse + the donk + the boat's speed cap, never the
// skill window (see the maxSpeed change in update()).
// Rune power-bar art (public/buttons/rowbar.png) — replaces the old procedural
// band/ticks/gradient track (see drawPendulum). MAXA below is fitted to this
// image's own measured curvature so pendPoint() places the bob/lightning
// exactly on the glowing groove — see ROWBAR_IMG_* calibration below.
const rowbarImg = new Image();
let rowbarLoaded = false;
rowbarImg.onload = () => { rowbarLoaded = true; };
rowbarImg.src = '/buttons/rowbar.png';
// Pixel coords (in the source PNG) of the left/right cap's track midpoint —
// measured by sampling the image's alpha channel. Used to scale+place the
// image so its caps land exactly on pendPoint(-MAXA)/pendPoint(MAXA).
const ROWBAR_IMG_CAP_L = { x: 58, y: 220 };
const ROWBAR_IMG_CAP_R = { x: 2445, y: 225 };
// Pixel coords of where the gold cap art ENDS and the glowing blue track
// actually begins (measured the same way) — the bob/lightning should start
// here, not at the cap tip, so the "energy" visibly starts where the blue
// glow starts. Both sides land at ~88% of the way from centre to cap, so
// BOB_MAXA below is MAXA scaled by that same fraction (via sin, since
// pendPoint places things by sin(angle), not raw pixel distance).
const ROWBAR_IMG_BLUE_L = { x: 201, y: 287 };
const ROWBAR_IMG_BLUE_R = { x: 2302, y: 288 };

const PEND = {
  ctx: hud.pendulum ? hud.pendulum.getContext('2d') : null,
  W: 700, H: 200, dpr: 1,
  MAXA: 0.408,            // half-swing angle — matches rowbar.png's real arc curvature (used to place the image itself)
  CENTER_CHARGE: (CHARGE_PERFECT_LO + CHARGE_PERFECT_HI) / 2, // charge that puts the bob dead-centre
  cx: 350, cy: 0, R: 700, baseY: 160,
  trail: [],             // recent bob positions {x,y,a} for the motion trail
  splash: [],            // screen-space droplets on a clean release {x,y,vx,vy,life,max,ring}
  flash: 0,              // perfect-release white bloom timer
  side: 1,               // +1 = this stroke starts from the RIGHT end, -1 = LEFT; flips every stroke
  displayA: 0.357,       // the actually-drawn bob angle (smoothed on idle so it swings to the next side)
};
// Bob/lightning start angle — where rowbar.png's blue glow actually begins,
// short of the full geometric MAXA (which only places the image via the gold
// cap tips). Same circle (pendPoint), just a smaller angle.
const BOB_MAXA = Math.asin(Math.sin(PEND.MAXA) * (ROWBAR_IMG_BLUE_L.x - 1254) / (ROWBAR_IMG_CAP_L.x - 1254));
// charge → arc angle (0 rad = centre bottom, ±BOB_MAXA = the current start
// end — where the blue glow starts, not the outer geometric MAXA).
// The sign follows PEND.side so the bob alternates which end it pulls from.
// All pendulum helpers take an optional target `P` (defaults to the live game
// PEND) so the how-to screen can render a pixel-identical demo bar into a second
// canvas (PEND_DEMO) without touching the in-race one.
function pendAngle(charge, P = PEND) {
  return THREE.MathUtils.clamp(P.side * BOB_MAXA * (1 - charge / P.CENTER_CHARGE), -BOB_MAXA, BOB_MAXA);
}
function pendPoint(a, P = PEND) { return { x: P.cx + P.R * Math.sin(a), y: P.cy + P.R * Math.cos(a) }; }
function initPendulumInto(cv, P) {
  if (!cv) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const rect = cv.getBoundingClientRect();
  P.W = Math.max(360, Math.round(rect.width || 700));
  P.H = Math.max(120, Math.round(rect.height || 200));
  P.dpr = dpr;
  cv.width = P.W * dpr; cv.height = P.H * dpr;
  P.ctx = cv.getContext('2d');
  P.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // arc geometry: a wide shallow smile, centre of the circle far above the canvas
  P.baseY = P.H * 0.72; // leave headroom below the bob + above for PERFEKT label
  const chord = P.W * 0.86;
  P.R = (chord / 2) / Math.sin(P.MAXA);
  P.cx = P.W / 2;
  P.cy = P.baseY - P.R;
}
function initPendulum() { initPendulumInto(hud.pendulum, PEND); }
// electric bolt from angle a0 to a1 along the arc, jittered perpendicular to it
function pendBolt(ctx, a0, a1, amp, segs, P = PEND) {
  ctx.beginPath();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const a = a0 + (a1 - a0) * t;
    const p = pendPoint(a, P);
    // perpendicular offset (toward circle centre is -normal); taper at both ends
    const j = (i === 0 || i === segs) ? 0 : (Math.random() - 0.5) * 2 * amp * Math.sin(t * Math.PI);
    const nx = Math.sin(a), ny = Math.cos(a); // outward normal
    if (i === 0) ctx.moveTo(p.x + nx * j, p.y + ny * j);
    else ctx.lineTo(p.x + nx * j, p.y + ny * j);
  }
  ctx.stroke();
}
function drawPendulum(s, P = PEND) {
  const ctx = P.ctx;
  if (!ctx) return;
  const { W, H, MAXA } = P;
  ctx.clearRect(0, 0, W, H);
  const A = MAXA;                // full geometric half-angle — places the image via the gold cap tips
  const startA = P.side * BOB_MAXA; // this stroke's start end — where the blue glow begins, not the cap tip
  const bobA = P.displayA;       // smoothed draw angle (charge-driven while held, swings to the next side on release)
  const pulse = 0.5 + 0.5 * Math.sin((s.phase ?? 0) * Math.PI * 2); // donk-synced

  // 1) the rune power-bar art (rowbar.png) replaces the old procedural band/
  // ticks/gradient track — it already bakes in the blue→orange→green zone
  // colours and the gold end-caps. Scaled+placed so its own two cap points
  // land exactly on pendPoint(-A)/pendPoint(A), keeping it pixel-aligned with
  // the bob/lightning drawn below (both ride the same pendPoint() circle).
  if (rowbarLoaded) {
    const capL = pendPoint(-A, P), capR = pendPoint(A, P);
    const k = (capR.x - capL.x) / (ROWBAR_IMG_CAP_R.x - ROWBAR_IMG_CAP_L.x);
    const dx = capL.x - ROWBAR_IMG_CAP_L.x * k;
    const dy = capL.y - ROWBAR_IMG_CAP_L.y * k;
    ctx.drawImage(rowbarImg, dx, dy, rowbarImg.naturalWidth * k, rowbarImg.naturalHeight * k);
  } else {
    // asset still loading — thin placeholder band so the meter isn't blank
    ctx.lineCap = 'round';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(120,150,205,.25)';
    arcPath(ctx, -A, A, P); ctx.stroke();
  }
  // centre marker: release cue + down-triangle above the (already-green)
  // centre — no "SPACE" on touch devices, where there is no space bar
  const cP = pendPoint(0, P);
  ctx.fillStyle = 'rgba(150,240,165,.9)';
  ctx.beginPath();
  ctx.moveTo(cP.x - 7, cP.y - 30); ctx.lineTo(cP.x + 7, cP.y - 30); ctx.lineTo(cP.x, cP.y - 20); ctx.closePath(); ctx.fill();
  ctx.font = '700 13px Cinzel, system-ui, serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(190,245,200,.95)';
  ctx.fillText(IS_TOUCH ? 'RELEASE HERE' : 'RELEASE SPACE', cP.x, cP.y - 36);

  // 6) lightning while actively charging (energy fills from the start end)
  if (s.accumulating && !s.over) {
    // closeness to green → wilder bolts (normalised against the bob's actual
    // travel range, BOB_MAXA — not the wider geometric A used to place the image)
    const near = 1 - Math.min(1, Math.abs(bobA) / BOB_MAXA);
    const bp = pendPoint(bobA, P);
    ctx.shadowColor = 'rgba(140,200,255,.9)'; ctx.shadowBlur = 8;
    const bolts = 1 + Math.round(near * 2);
    for (let b = 0; b < bolts; b++) {
      ctx.lineWidth = b === 0 ? 2.4 : 1.2;
      ctx.strokeStyle = b === 0 ? 'rgba(220,240,255,.95)' : `rgba(150,205,255,${0.5 + near * 0.4})`;
      pendBolt(ctx, startA, bobA, 4 + near * 9, 14, P);
    }
    ctx.shadowBlur = 0;
    // spark cluster at the bob
    ctx.fillStyle = 'rgba(210,235,255,.9)';
    for (let k = 0; k < Math.round(2 + near * 4); k++) {
      ctx.beginPath();
      ctx.arc(bp.x + (Math.random() - 0.5) * 10, bp.y + (Math.random() - 0.5) * 10, Math.random() * 1.6, 0, 7);
      ctx.fill();
    }
  }

  // 7) motion trail
  for (let i = 0; i < P.trail.length; i++) {
    const tr = P.trail[i];
    const al = (i / P.trail.length) * 0.4;
    ctx.fillStyle = `rgba(130,175,235,${al})`;
    ctx.beginPath(); ctx.arc(tr.x, tr.y, 5 + i * 0.3, 0, 7); ctx.fill();
  }

  // 8) the bob
  const b = pendPoint(bobA, P);
  const grey = s.over;
  // halo
  const halo = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, 26);
  halo.addColorStop(0, grey ? 'rgba(200,200,205,.5)' : `rgba(160,205,255,${0.5 + pulse * 0.2})`);
  halo.addColorStop(1, 'rgba(160,205,255,0)');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(b.x, b.y, 26, 0, 7); ctx.fill();
  // ball + white ring
  ctx.fillStyle = grey ? '#9aa0aa' : '#6f97dd';
  ctx.beginPath(); ctx.arc(b.x, b.y, 11, 0, 7); ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = grey ? 'rgba(255,255,255,.5)' : 'rgba(255,255,255,.9)';
  ctx.beginPath(); ctx.arc(b.x, b.y, 11, 0, 7); ctx.stroke();

  // 9) perfect-release bloom
  if (P.flash > 0) {
    ctx.fillStyle = `rgba(200,255,210,${P.flash * 0.6})`;
    ctx.beginPath(); ctx.arc(cP.x, cP.y, 30 * (1.2 - P.flash), 0, 7); ctx.fill();
  }

  // 10) screen-space splash droplets + expanding rings
  for (const d of P.splash) {
    const a = Math.max(0, d.life / d.max);
    if (d.ring) {
      ctx.lineWidth = 2; ctx.strokeStyle = `rgba(180,215,255,${a * 0.6})`;
      ctx.beginPath(); ctx.arc(d.x, d.y, (1 - a) * 34, 0, 7); ctx.stroke();
    } else {
      ctx.fillStyle = `rgba(200,225,255,${a})`;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 7); ctx.fill();
    }
  }
}
function arcPath(ctx, a0, a1, P = PEND) {
  ctx.beginPath();
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const a = a0 + (a1 - a0) * (i / N);
    const p = pendPoint(a, P);
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
}
// advance trail/splash/flash buffers (called every frame from update())
function stepPendulumFX(dt, charge, accumulating, P = PEND) {
  // bob angle: snap to the charge-driven position while pulling; otherwise
  // ease toward the current start end so it visibly SWINGS across to the
  // next side after a release (the side flips in executeStroke).
  const restA = P.side * BOB_MAXA;
  if (accumulating) {
    P.displayA = pendAngle(charge, P);
  } else {
    P.displayA += (restA - P.displayA) * Math.min(1, dt * 11);
  }
  // trail follows the live bob only while charging
  if (accumulating) {
    const p = pendPoint(P.displayA, P);
    P.trail.push({ x: p.x, y: p.y });
    if (P.trail.length > 8) P.trail.shift();
  } else if (P.trail.length) {
    P.trail.shift();
  }
  if (P.flash > 0) P.flash = Math.max(0, P.flash - dt * 3.3);
  for (let i = P.splash.length - 1; i >= 0; i--) {
    const d = P.splash[i];
    d.life -= dt;
    if (!d.ring) { d.vy += dt * 260; d.x += d.vx * dt; d.y += d.vy * dt; }
    if (d.life <= 0) P.splash.splice(i, 1);
  }
}
// burst of droplets + a ring at the green centre, strength ∝ release precision
function pendSplash(precision, P = PEND) {
  const c = pendPoint(0, P);
  P.flash = 1;
  P.splash.push({ x: c.x, y: c.y, ring: true, life: 0.5, max: 0.5 });
  const n = 8 + Math.round(precision * 10);
  for (let i = 0; i < n; i++) {
    P.splash.push({
      x: c.x, y: c.y, ring: false, r: 1.5 + Math.random() * 2.2,
      vx: (Math.random() - 0.5) * 150, vy: -40 - Math.random() * 130 * (0.5 + precision),
      life: 0.4 + Math.random() * 0.4, max: 0.8,
    });
  }
}
initPendulum();
window.addEventListener('resize', initPendulum);

// ---- tutorial row-bar demo: the REAL pendulum meter, self-looping on the
// how-to screen. Renders through drawPendulum() against a second target so it's
// pixel-identical to the in-race bar. Charges up, releases dead-centre (always
// PERFEKT), swings to the other end, repeats. ----
const PEND_DEMO = {
  ctx: null, W: 700, H: 200, dpr: 1,
  MAXA: PEND.MAXA, CENTER_CHARGE: PEND.CENTER_CHARGE,
  cx: 350, cy: 0, R: 700, baseY: 160,
  trail: [], splash: [], flash: 0, side: 1, displayA: BOB_MAXA,
};
const demoCanvas = document.getElementById('pendulumCanvasDemo');
// live not-pressed/pressed spacebar art next to the "Row:" instruction line —
// see .keyBtn--space in index.html (space_default.png/space_pressed.png
// background-image swap). Kept in sync with the demo bar below it: pressed
// while charging, released the instant the bob crosses the green centre
// (demoPhase flips to 'released').
const howtoSpaceKeyEl = document.getElementById('howtoSpaceKey');
function initPendulumDemo() { if (demoCanvas) initPendulumInto(demoCanvas, PEND_DEMO); }
const DEMO_RELEASE_AT = (CHARGE_PERFECT_LO + CHARGE_PERFECT_HI) / 2; // dead-centre of the green zone, every cycle
let demoRaf = null, demoLast = 0, demoCharge = 0, demoPhase = 'charging', demoT = 0, demoPhaseT = 0;
function demoFrame(t) {
  const dt = Math.min(0.05, (t - demoLast) / 1000);
  demoLast = t;
  demoPhaseT += dt;
  if (demoPhase === 'charging') {
    demoCharge += dt / CHARGE_TIME;
    stepPendulumFX(dt, demoCharge, true, PEND_DEMO);
    if (demoCharge >= DEMO_RELEASE_AT) {
      pendSplash(1, PEND_DEMO);      // dead-centre release = perfect burst
      PEND_DEMO.side *= -1;          // swing to the other end for the next stroke
      demoPhase = 'released'; demoT = 0.85;
      if (howtoSpaceKeyEl) howtoSpaceKeyEl.classList.remove('pressed');
    }
    drawPendulum({ phase: demoPhaseT, accumulating: true, over: false }, PEND_DEMO);
  } else { // 'released' — bob eases across to the new rest end, then recharge
    stepPendulumFX(dt, 0, false, PEND_DEMO);
    drawPendulum({ phase: demoPhaseT, accumulating: false, over: false }, PEND_DEMO);
    demoT -= dt;
    if (demoT <= 0) {
      demoCharge = 0; demoPhase = 'charging';
      if (howtoSpaceKeyEl) howtoSpaceKeyEl.classList.add('pressed');
    }
  }
  demoRaf = requestAnimationFrame(demoFrame);
}
function startOarDemo() {
  if (!demoCanvas || demoRaf) return;
  initPendulumDemo(); // canvas now has a real layout size (howto screen is visible)
  demoCharge = 0; demoPhase = 'charging'; demoLast = performance.now();
  if (howtoSpaceKeyEl) howtoSpaceKeyEl.classList.add('pressed'); // starts mid-charge
  demoRaf = requestAnimationFrame(demoFrame);
}
function stopOarDemo() {
  if (demoRaf) cancelAnimationFrame(demoRaf);
  demoRaf = null;
}
window.addEventListener('resize', () => { if (demoRaf) initPendulumDemo(); });

// ---- boot preloader: the same row-bar art/energy-spark, charging 0%→100%
// once before the cinematic intro/splash reveal (see PRELOAD.active gating
// runIntroCamera() below — the intro camera doesn't move until this is done). ----
const PEND_PRELOAD = {
  ctx: null, W: 700, H: 200, dpr: 1,
  MAXA: PEND.MAXA, CENTER_CHARGE: PEND.CENTER_CHARGE,
  cx: 350, cy: 0, R: 700, baseY: 160,
  trail: [], splash: [], flash: 0, side: 1, displayA: BOB_MAXA,
};
const preloadCanvas = document.getElementById('pendulumCanvasPreload');
function initPendulumPreload() { if (preloadCanvas) initPendulumInto(preloadCanvas, PEND_PRELOAD); }
initPendulumPreload();
window.addEventListener('resize', initPendulumPreload);

// Two energy streams sweep in from both ends (no ball) and meet dead-centre
// at pct=1 — a dedicated draw path rather than drawPendulum() since that one
// always renders a single charge-driven bob.
function drawPreloadBar(pct, P = PEND_PRELOAD) {
  const ctx = P.ctx;
  if (!ctx) return;
  const { W, H, MAXA } = P;
  ctx.clearRect(0, 0, W, H);
  const A = MAXA; // full geometric half-angle — places the image via the gold cap tips

  // 1) the rune power-bar art — same placement math as drawPendulum()
  if (rowbarLoaded) {
    const capL = pendPoint(-A, P), capR = pendPoint(A, P);
    const k = (capR.x - capL.x) / (ROWBAR_IMG_CAP_R.x - ROWBAR_IMG_CAP_L.x);
    const dx = capL.x - ROWBAR_IMG_CAP_L.x * k;
    const dy = capL.y - ROWBAR_IMG_CAP_L.y * k;
    ctx.drawImage(rowbarImg, dx, dy, rowbarImg.naturalWidth * k, rowbarImg.naturalHeight * k);
  } else {
    ctx.lineCap = 'round';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(120,150,205,.25)';
    arcPath(ctx, -A, A, P); ctx.stroke();
  }

  // 2) both streams travel from the blue start (±BOB_MAXA) toward centre —
  // same jittered-bolt look as the in-race charge lightning, just two of them
  const travel = BOB_MAXA * pct;
  const leftTip = -BOB_MAXA + travel;  // -BOB_MAXA → 0
  const rightTip = BOB_MAXA - travel;  //  BOB_MAXA → 0
  const near = pct; // brighter/wilder as the streams close in on each other
  ctx.shadowColor = 'rgba(140,200,255,.9)'; ctx.shadowBlur = 8;
  for (const [a0, a1] of [[-BOB_MAXA, leftTip], [BOB_MAXA, rightTip]]) {
    const bolts = 1 + Math.round(near * 2);
    for (let b = 0; b < bolts; b++) {
      ctx.lineWidth = b === 0 ? 2.4 : 1.2;
      ctx.strokeStyle = b === 0 ? 'rgba(220,240,255,.95)' : `rgba(150,205,255,${0.5 + near * 0.4})`;
      pendBolt(ctx, a0, a1, 4 + near * 9, 14, P);
    }
  }
  ctx.shadowBlur = 0;
  // spark dust at both travelling tips — scattered dots, no solid ball
  ctx.fillStyle = 'rgba(210,235,255,.9)';
  for (const a of [leftTip, rightTip]) {
    const tp = pendPoint(a, P);
    for (let k = 0; k < Math.round(2 + near * 4); k++) {
      ctx.beginPath();
      ctx.arc(tp.x + (Math.random() - 0.5) * 10, tp.y + (Math.random() - 0.5) * 10, Math.random() * 1.6, 0, 7);
      ctx.fill();
    }
  }

  // 3) the 100% particle explosion at centre — same bloom+droplets pendSplash()
  // already drives for a perfect release, just triggered once by stepPreload
  const cP = pendPoint(0, P);
  if (P.flash > 0) {
    ctx.fillStyle = `rgba(200,255,210,${P.flash * 0.6})`;
    ctx.beginPath(); ctx.arc(cP.x, cP.y, 30 * (1.2 - P.flash), 0, 7); ctx.fill();
  }
  for (const d of P.splash) {
    const a = Math.max(0, d.life / d.max);
    if (d.ring) {
      ctx.lineWidth = 2; ctx.strokeStyle = `rgba(180,215,255,${a * 0.6})`;
      ctx.beginPath(); ctx.arc(d.x, d.y, (1 - a) * 34, 0, 7); ctx.stroke();
    } else {
      ctx.fillStyle = `rgba(200,225,255,${a})`;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 7); ctx.fill();
    }
  }
}
// MUSIC_WAIT_CAP: the theme song (~3MB) is fetched+decoded from the moment
// initAudio() first runs (module boot, see below) — this just gives it a
// bounded extra beat to finish past the animation's own hold if it hasn't
// already, so the buffer is ready before the first gesture can unlock
// playback. Capped so a slow/broken connection can't strand the player on
// the preloader forever — past this, the game proceeds and music (if it
// ever arrives) just starts whenever tryStartMusic() next fires.
const PRELOAD = { active: true, t: 0, DURATION: 2.2, EXPLODE_HOLD: 0.7, exploded: false, holdT: 0, musicWaitT: 0, MUSIC_WAIT_CAP: 6 };
function stepPreload(dt) {
  if (!PRELOAD.active) return;
  stepPendulumFX(dt, 0, false, PEND_PRELOAD); // no bob driven here — just ages flash/splash
  if (!PRELOAD.exploded) {
    PRELOAD.t += dt;
    const pct = Math.min(1, PRELOAD.t / PRELOAD.DURATION);
    if (hud.preloadPct) hud.preloadPct.textContent = `${Math.round(pct * 100)}%`;
    drawPreloadBar(pct, PEND_PRELOAD);
    if (pct >= 1) {
      PRELOAD.exploded = true;
      pendSplash(1, PEND_PRELOAD); // streams meet centre → particle explosion, "100% loaded"
    }
  } else {
    PRELOAD.holdT += dt;
    drawPreloadBar(1, PEND_PRELOAD);
    if (PRELOAD.holdT >= PRELOAD.EXPLODE_HOLD) {
      // hold a little longer if the theme song hasn't finished decoding yet
      // (fetching since module boot — see the initAudio() call at the top of
      // the file) — otherwise the first tap/gesture can unlock audio before
      // the buffer exists, and the track only starts once decode eventually
      // finishes, audibly late into the intro/menu. Browsers still require a
      // real gesture before anything can be heard (see kickAudio below,
      // which unlocks/resumes the audio context) — this just makes sure the
      // buffer itself is ready by then, it can't remove the gesture
      // requirement itself.
      if (!isMusicLoadSettled() && PRELOAD.musicWaitT < PRELOAD.MUSIC_WAIT_CAP) {
        PRELOAD.musicWaitT += dt;
        return;
      }
      PRELOAD.active = false;
      if (hud.preloaderScreen) hud.preloaderScreen.classList.add('hidden');
      showWinsenIntroCard();
    }
  }
}

// WebGL splash logo + shield (fall back to HTML title / static img on failure)
const logoFX = createLogoFX();
const shieldFX = createShieldFX();
const howtoFX = createHowtoFX(); // same shine/tilt treatment on the how-to hero art
const voyageDoneFX = createVoyageDoneFX(); // same treatment, full-bleed, on the Voyage Complete trophy photo

// ---- menu flow: splash → how-to modal → race; leaderboard behind its own button ----
// (voyage mode inserts the voyage map before this — see openVoyageScreen below)
function showHowto() {
  hud.startScreen.classList.add('hidden');
  hud.lbScreen.classList.add('hidden');
  hud.voyageScreen.classList.add('hidden');
  hud.stageInterludeScreen.classList.add('hidden'); // Fase 3e: "RO NESTE ETAPPE!" lands here
  // reset in case a previous #controlsBtn open left the modal presentation on
  hud.howtoScreen.classList.remove('howtoModal');
  $('goBtn').style.display = '';
  $('howtoBackBtn').style.display = '';
  hud.howtoCloseBtn.style.display = 'none';
  hud.howtoScreen.classList.remove('hidden');
  startOarDemo();
  howtoFX.reveal();
}
$('startBtn').addEventListener('click', (e) => { e.currentTarget.blur(); G.gameMode = 'kapp'; showHowto(); });
$('startVoyageBtn').addEventListener('click', (e) => {
  e.currentTarget.blur();
  G.gameMode = 'voyage';
  openVoyageScreen(hud.startScreen, true); // see the map before the controls tutorial
});
$('goBtn').addEventListener('click', () => startRace(false));
$('howtoBackBtn').addEventListener('click', (e) => {
  e.target.blur();
  hud.howtoScreen.classList.add('hidden');
  hud.startScreen.classList.remove('hidden');
  stopOarDemo();
  howtoFX.stop();
});

// ---- controls help: reachable any time via #controlsBtn (topbar), not just pre-race.
// Mid-race it pauses (same mechanism as the restart-confirm dialog) and swaps in a
// single "Fortsett å ro!" close button instead of Ro!/Tilbake.
let howtoCameFromMenu = false; // ✕ must restore the start screen it hid (Back used to do this)
let howtoModalOffT = 0; // pending "strip .howtoModal" timer — see howtoCloseBtn below
function openControlsHelp() {
  clearTimeout(howtoModalOffT); // reopening before a previous close's delayed cleanup fired
  const midRace = G.mode === 'racing' || G.mode === 'countdown';
  if (midRace) {
    G.paused = true;
    releaseStroke(); // don't strand a held stroke under the overlay
  }
  howtoCameFromMenu = !hud.startScreen.classList.contains('hidden');
  // modal presentation (gold plate, settings-style title, ✕ close) — the
  // flow buttons (Row!/Back) and the legacy resume CTA never show here.
  // From the splash, the start screen is deliberately left visible (NOT
  // hidden) so the modal overlays on top of the ROWAY logo/art, same as
  // #settingsScreen already does — mid-race it's a no-op since the start
  // screen is already hidden.
  hud.howtoScreen.classList.add('howtoModal');
  $('goBtn').style.display = 'none';
  $('howtoBackBtn').style.display = 'none';
  hud.howtoCloseBtn.style.display = 'none';
  hud.howtoScreen.classList.remove('hidden');
  startOarDemo();
  howtoFX.reveal();
}
hud.controlsBtn.addEventListener('click', (e) => { e.currentTarget.blur(); openControlsHelp(); });
hud.howtoCloseBtn.addEventListener('click', (e) => {
  e.target.blur();
  hud.howtoScreen.classList.add('hidden');
  // .screen's own opacity fade (index.html) runs .5s — stripping .howtoModal
  // synchronously here used to yank the gold-framed panel's background off
  // instantly, leaving a bare rectangular hole showing through the veil
  // for the rest of that fade. Match the same .5s so the panel disappears
  // exactly when the veil finishes, not half a second early.
  clearTimeout(howtoModalOffT);
  howtoModalOffT = setTimeout(() => hud.howtoScreen.classList.remove('howtoModal'), 500);
  stopOarDemo();
  howtoFX.stop();
  G.paused = false;
  if (howtoCameFromMenu) {
    hud.startScreen.classList.remove('hidden');
    howtoCameFromMenu = false;
  }
});
// the modal ✕ (controls-icon presentation) closes exactly like the legacy CTA
$('howtoModalX').addEventListener('click', () => hud.howtoCloseBtn.click());
// leaderboard modal with "I dag" (today's daily board) / "Tidenes" (all-time) tabs
function selectLbTab(day) {
  $('lbTabDay').classList.toggle('active', !!day);
  $('lbTabAll').classList.toggle('active', !day);
  renderLeaderboards(null, day);
}
// top-level mode tabs — Time Attack (KAPPRO, unchanged board) vs Story Mode
// (REISEN combined-time board, see renderStoryModeLeaderboard() below).
function selectLbMode(mode) {
  $('lbModeTimeBtn').classList.toggle('active', mode === 'time');
  $('lbModeStoryBtn').classList.toggle('active', mode === 'story');
  $('lbTimeAttackPane').classList.toggle('hiddenMsg', mode !== 'time');
  $('lbStoryPane').classList.toggle('hiddenMsg', mode !== 'story');
  if (mode === 'story') renderStoryModeLeaderboard();
}
// Which screen to return to on Close — the leaderboard modal can now be
// opened from the splash, the result screen's "View full leaderboard", or
// the voyage-complete screen's own Leaderboard button.
// mode: which top-level tab to land on ('time' for the first two entry
// points, unchanged; 'story' for the voyage-complete button below, since
// that screen's whole context IS the Story Mode leaderboard).
let lbReturnScreenId = 'startScreen';
function openLeaderboardFrom(screenId, mode = 'time') {
  lbReturnScreenId = screenId;
  document.getElementById(screenId).classList.add('hidden');
  hud.lbScreen.classList.remove('hidden');
  selectLbTab(DAILY_KEY); // keep the Today/All-time sub-tab primed regardless of which top-level mode opens
  selectLbMode(mode);
}
$('lbBtn').addEventListener('click', (e) => {
  e.currentTarget.blur(); // Regel 2: a focused button turns Space into a click
  openLeaderboardFrom('startScreen');
});
hud.viewFullLbBtn.addEventListener('click', (e) => {
  e.currentTarget.blur();
  openLeaderboardFrom('resultScreen');
});
hud.voyageDoneLbBtn.addEventListener('click', (e) => {
  e.currentTarget.blur();
  openLeaderboardFrom('voyageScreen', 'story');
});
$('lbModeTimeBtn').addEventListener('click', (e) => { e.currentTarget.blur(); selectLbMode('time'); });
$('lbModeStoryBtn').addEventListener('click', (e) => { e.currentTarget.blur(); selectLbMode('story'); });
$('lbTabDay').addEventListener('click', (e) => { e.target.blur(); selectLbTab(DAILY_KEY); });
$('lbTabAll').addEventListener('click', (e) => { e.target.blur(); selectLbTab(null); });
$('lbCloseBtn').addEventListener('click', (e) => {
  e.currentTarget.blur(); // Regel 2
  hud.lbScreen.classList.add('hidden');
  document.getElementById(lbReturnScreenId).classList.remove('hidden');
});

// DEV-ONLY: isolated ship model viewer — see SHIP_VIEWER state + the
// pointer/keydown branches above, and the orbit-camera override in update().
// Only reachable via the psw gallery (window.__game.openShipViewer, gated
// behind import.meta.env.DEV further down) — never called in production.
let shipViewerReturnScreenId = null;
// ghost boats (GH = personal-best, C = challenge duel) toggle .visible on
// race-state transitions elsewhere, not every frame — so we must remember
// whatever they were showing and restore THAT on close, not force them back
// on unconditionally (e.g. GH stays hidden during voyage mode, C stays
// hidden when no challenge is active).
let shipViewerGhostWasVisible = false;
let shipViewerChallengeWasVisible = false;
function openShipViewer() {
  // must exclude itself — if the viewer were somehow already open (or left in
  // a stuck state from a prior bug), matching #shipViewerScreen here would
  // store it as its OWN "return to" target, so closing would immediately
  // re-open it (add + remove 'hidden' on the same element cancel out).
  const current = document.querySelector('.screen:not(.hidden):not(#shipViewerScreen)');
  shipViewerReturnScreenId = current ? current.id : null;
  if (current) current.classList.add('hidden');
  hud.shipViewerScreen.classList.remove('hidden');
  SHIP_VIEWER.active = true;
  SHIP_VIEWER.angle = 0.5;
  SHIP_VIEWER.dragging = false;
  rival.visible = false;
  course.group.visible = false;
  shipViewerGhostWasVisible = !!(GH.ship && GH.ship.visible);
  if (GH.ship) GH.ship.visible = false;
  shipViewerChallengeWasVisible = !!(C.ship && C.ship.visible);
  if (C.ship) C.ship.visible = false;
}
function closeShipViewer() {
  hud.shipViewerScreen.classList.add('hidden');
  SHIP_VIEWER.active = false;
  SHIP_VIEWER.dragging = false;
  rival.visible = true;
  course.group.visible = true;
  if (GH.ship) GH.ship.visible = shipViewerGhostWasVisible;
  if (C.ship) C.ship.visible = shipViewerChallengeWasVisible;
  // fall back to the splash if nothing was visible when the viewer opened
  // (e.g. opened mid-race, where no .screen is up at all) — never leave the
  // player looking at a blank overlay with no way back in.
  const el = document.getElementById(shipViewerReturnScreenId || 'startScreen');
  if (el) el.classList.remove('hidden');
}
$('shipViewerCloseBtn').addEventListener('click', (e) => { e.currentTarget.blur(); closeShipViewer(); });
// Fase 3e: "continue" (retryBtn/nextStageBtn/Space) — voyage mode only opens
// the stage bridge when a crossing actually happened; otherwise straight into
// the next attempt. Kapproing is untouched either way.
function continueFromResult() {
  // C3: after the one-shot stage 5 the only way forward is out — never a replay
  if (G.gameMode === 'voyage' && G.stageAtRunStart === FINAL_STAGE_ID && isStageFinal(FINAL_STAGE_ID)) {
    returnToMenu();
    return;
  }
  if (G.gameMode === 'voyage' && G.stageChangedThisRun && pendingInterlude) openStageInterlude();
  else startRace(true);
}
$('retryBtn').addEventListener('click', (e) => { e.currentTarget.blur(); continueFromResult(); });
hud.nextStageBtn.addEventListener('click', (e) => { e.currentTarget.blur(); continueFromResult(); });
// "Ro etappe N igjen" — replay the SAME stage this run was just played on,
// even if this run's credit already pushed voyage.total into the next
// stage's range (forceStageId overrides the live-total-based stage pick).
hud.repeatStageBtn.addEventListener('click', (e) => {
  e.currentTarget.blur();
  forceStageId = G.stageAtRunStart;
  startRace(true);
});
// straight to the main menu from the result screen — the run is already
// finished/scored, so (unlike the mid-race restartBtn) no confirm dialog
hud.resultMenuBtn.addEventListener('click', (e) => { e.currentTarget.blur(); returnToMenu(); });
hud.voyageDoneMenuBtn.addEventListener('click', (e) => { e.currentTarget.blur(); returnToMenu(); });

// ---- Fase 3: voyage map (opened from the splash screen or the result screen —
// "Tilbake" returns to whichever one it was opened from) ----
// v2: real asset-package map (public/roway_map_dev_package), mounted once —
// see src/map/voyageMap.js. Wiring note: the real Phase-3 cumulative voyage
// distance is `voyage.total` (src/voyage.js), out of TOTAL_VOYAGE_M (the
// round-trip Norway->USA->Norway total already decided/implemented here) —
// that's what's actually fed into setProgress() below. The module's own
// DEFAULT_TOTAL_METERS placeholder is only ever used before this first call.
const voyageMapApi = mountVoyageMap(hud.voyageMapWrap);

// Stage map v3: one shared looping video background (public/3d map/
// 3dmap_loop.mp4) + a per-stage route overlay (public/3d map/stageN.png,
// same 1080x1920 canvas as the video). The folder name contains a space, so
// the URL uses %20 — Vite serves public/ verbatim, no bundler rewriting.
// The stage->file mapping is a function of the stage id, never five
// hard-coded blocks. Badges (ship + "STAGE N/5") still come from
// public/stage_maps/stageN.png, unchanged.
const MAP_ASSET_BASE = '/3d%20map';
const stageMapOverlaySrc = (id) => `${MAP_ASSET_BASE}/stage${id}.png`;
// Preload every overlay + badge so the interlude/voyage screens never flash
// while the first swap loads. Fade-in on `src` change is setStageImage().
for (let i = 1; i <= 5; i++) {
  const map = new Image(); map.src = stageMapOverlaySrc(i);
  const badge = new Image(); badge.src = `/stage_maps/stage${i}.png`;
}
function setStageImage(imgEl, src) {
  imgEl.classList.remove('loaded');
  imgEl.onload = () => imgEl.classList.add('loaded');
  imgEl.src = src;
}
// The map videos autoplay muted; a browser that still refuses (or a failed
// load) must never leave a black hole — the route overlay PNG always renders
// on top, so the fallback is simply "static map instead of animated one".
// On error we hide the video element outright; on every screen-open we nudge
// play() again (autoplay policies can flip after the first user gesture).
function ensureMapVideoPlaying(videoEl) {
  if (!videoEl || videoEl.style.display === 'none') return;
  const p = videoEl.play();
  if (p && p.catch) p.catch(() => { /* overlay PNG is the fallback */ });
}
for (const v of [hud.voyageStageVideo, hud.interludeMapVideo]) {
  if (v) v.addEventListener('error', () => { v.style.display = 'none'; });
}

let voyageReturnScreen = hud.startScreen;
// forRaceStart: true when opened via "Start Reisen" — shows the real designed
// card (public/stage_maps/N.png + stageN.png badge) for whichever stage is
// about to be raced, with a "START STAGE N" button that continues into the
// controls tutorial. Casual views (splash "Reisen" button, "se reisen" from
// the result screen) aren't about to start any specific stage, so they keep
// the interactive overview map (src/map/voyageMap.js) and only get "Tilbake".
function openVoyageScreen(fromScreen, forRaceStart = false) {
  voyageReturnScreen = fromScreen;
  // startNewVoyageBtn calls this with fromScreen === hud.voyageScreen itself
  // (resetting in place, no reload) — don't hide the screen we're already on.
  if (fromScreen !== hud.voyageScreen) fromScreen.classList.add('hidden');
  // finale FX only ever belong to the voyageDone branch below — clear them
  // unconditionally on every call so a re-entry into a non-done state (e.g.
  // "Start New Voyage" resetting back to the Stage 1 card) never leaves a
  // stray dust layer or a running shine loop behind.
  stopVoyageDust();
  voyageDoneFX.stop();
  // the ghost/duel holograms belong to an in-progress KAPPRO race, not to this
  // map screen — hide them regardless of which content below is shown, so
  // their floating name sprites can't bleed through the overlay
  if (GH.ship) GH.ship.visible = false;
  if (C.ship) C.ship.visible = false;
  hud.voyageMapWrap.classList.toggle('hiddenMsg', forRaceStart);
  hud.voyageStageCardWrap.classList.toggle('hiddenMsg', !forRaceStart);
  // map framed at the top + buttons pinned to the bottom only in the "about
  // to start this stage" case — the casual overview map keeps its normal
  // centred layout
  hud.voyageScreen.classList.toggle('stage-card-mode', forRaceStart);
  // C3: the homecoming is rowed ONCE — once it's final there's no "Row!" left
  // to offer, the voyage itself is done (this is the entry point that used to
  // let a finished stage 5 be started again from the menu — see Lesson 22).
  let voyageDone = false;
  if (forRaceStart) {
    const stage = currentStage(voyage.total);
    voyageDone = stage.id === FINAL_STAGE_ID && isStageFinal(FINAL_STAGE_ID);
    if (voyageDone) {
      // "Voyage complete" is now said once, by the header wordmark image
      // below (public/voyagecomplete.png) — this line is just the remaining
      // body copy, so it never repeats the same words twice on screen.
      hud.voyageScreenTitle.textContent = 'The trophy is home 🏆';
      renderVoyageDoneStatus(); // fire-and-forget — appends a rank line once known
      // the Ullevaal homecoming photo replaces the stage map/video and its
      // "STAGE N/5" badge entirely — the header wordmark takes that top slot
      hud.voyageStageBadgeImg.classList.add('hiddenMsg');
      hud.voyageDoneHeaderImg.classList.remove('hiddenMsg');
      hud.voyageDoneStats.classList.remove('hiddenMsg');
      playVoyageDoneEntrance(); // staggered fade/zoom/pop-in across the photo, wordmark, stats
      spawnVoyageDust(); // ambient sparkle motes, looping until this screen is left
      // NOT here: voyageDoneFX.reveal() needs #voyageDoneWrap's real layout
      // size for its cover-fit math (see fitCover() in logo.js) — at this
      // point it's still .hiddenMsg (display:none), so clientWidth/Height
      // would read 0. Called just below, once the toggle() a few lines down
      // has actually unhidden it.
    } else {
      hud.voyageDoneHeaderImg.classList.add('hiddenMsg');
      hud.voyageDoneStats.classList.add('hiddenMsg');
      // the badge image below already says "STAGE N/5" — drop the redundant
      // "Stage N —" prefix here, just the stage's own name
      hud.voyageScreenTitle.textContent = stage.name;
      setStageImage(hud.voyageStageCardImg, stageMapOverlaySrc(stage.id));
      setStageImage(hud.voyageStageBadgeImg, `/stage_maps/stage${stage.id}.png`);
      hud.voyageStageBadgeImg.classList.remove('hiddenMsg');
      ensureMapVideoPlaying(hud.voyageStageVideo);
      hud.voyageStartRaceBtn.textContent = `Row! — Start Stage ${stage.id}`;
    }
    hud.voyageStageCardWrap.classList.toggle('hiddenMsg', voyageDone);
    hud.voyageDoneWrap.classList.toggle('hiddenMsg', !voyageDone);
    if (voyageDone) voyageDoneFX.reveal(); // shine sweep across the trophy/players photo — now that the wrap has real layout size
  } else {
    hud.voyageScreenTitle.textContent = 'The Atlantic Voyage';
    voyageMapApi.setProgress(voyage.total, TOTAL_VOYAGE_M);
    voyageMapApi.setStatusText(voyageStatusText(voyage));
  }
  // the "done" message reads like splash-screen body copy (introText), not a
  // stage-name headline — smaller, sentence case, two lines (see CSS)
  hud.voyageScreenTitle.classList.toggle('voyageDoneMsg', voyageDone);
  hud.voyageStartRaceBtn.style.display = (forRaceStart && !voyageDone) ? '' : 'none';
  hud.startNewVoyageBtn.style.display = voyageDone ? '' : 'none';
  hud.voyageDoneLbBtn.style.display = voyageDone ? '' : 'none';
  hud.voyageDoneMenuBtn.style.display = voyageDone ? '' : 'none';
  // the finale is an endpoint, not a browsing state — "Back" (which returns
  // to whichever screen opened this one) only makes sense on the map/stage
  // views; here Main menu is the single way out (per request)
  hud.voyageBackBtn.style.display = voyageDone ? 'none' : '';
  // buttons on this screen are ALWAYS one centred column now (per request) —
  // .menuBtns--stack lives in the markup itself, no per-state toggling
  hud.voyageScreen.classList.remove('hidden');
}
// player-requested "let me play again" once the voyage is done (see Lærdom
// 22 follow-up) — the PREVIOUS completed voyage stays on the leaderboard
// forever under the old voyageId; resetVoyage() mints a fresh one so a new
// attempt isn't blocked by the old one's stage-5 409 lock. Resets fully in
// place: no reload, no trip back through the splash/intro — voyage + voyageId
// (both reassignable module-level bindings) are refreshed from the freshly
// written localStorage, then openVoyageScreen paints Stage 1 right here.
hud.startNewVoyageBtn.addEventListener('click', (e) => {
  e.currentTarget.blur();
  resetVoyage();
  voyage = loadVoyage();
  voyageId = getOrCreateVoyageId();
  openVoyageScreen(hud.voyageScreen, true);
});
// best-effort "where do I stand" line under the done message — same
// approximate rank math as renderVoyageRankBanner()'s no-freshResult
// fallback (top-20 list only), just rendered into the voyage screen instead
// of the result screen. Never awaited by its caller — appends once resolved.
async function renderVoyageDoneStatus() {
  const bests = loadStageBests();
  const stageIds = Object.keys(bests);
  if (stageIds.length < VOYAGE_STAGES.length) return;
  const localTotalMs = stageIds.reduce((sum, id) => sum + bests[id].timeMs, 0);
  // time + score are local, known immediately — place needs the server
  // round-trip below, so it starts as a placeholder and fills in once resolved
  hud.voyageDoneStatTime.textContent = fmtTime(localTotalMs / 1000);
  hud.voyageDoneStatScore.textContent = voyageScoreTotal().toLocaleString('en-US');
  hud.voyageDoneStatPlace.textContent = '…';
  // same reasoning as applyVoyageStageRanks()/renderVoyageRankBanner()'s
  // offline default (see main.js) — no server reachable means no evidence
  // anyone's ahead, so default to #1 (friendliest reading, often literally
  // correct for solo/offline play) rather than leaving a permanent dash.
  let placeText = ordinal(1);
  try {
    const res = await fetch('/.netlify/functions/get-voyage', { cache: 'no-store' });
    if (!res.ok) throw new Error('offline');
    const j = await res.json();
    const list = Array.isArray(j.scores) ? j.scores : [];
    const rank = list.filter((e) => e.totalMs < localTotalMs).length + 1;
    placeText = ordinal(rank);
  } catch { /* offline — keep the #1 default set above */ }
  // guard: don't write into stale content if the player already navigated
  // away (or reset the voyage) before this fetch resolved
  if (!hud.voyageScreenTitle.classList.contains('voyageDoneMsg')) return;
  hud.voyageDoneStatPlace.textContent = placeText;
}
hud.voyageBtn.addEventListener('click', (e) => { e.currentTarget.blur(); openVoyageScreen(hud.startScreen); });
hud.voyageStartRaceBtn.addEventListener('click', (e) => {
  e.currentTarget.blur();
  // C3: belt-and-suspenders — the button is hidden once the voyage is done,
  // but never trust display:none alone to stop a click (Regel 19 spirit)
  if (currentStage(voyage.total).id === FINAL_STAGE_ID && isStageFinal(FINAL_STAGE_ID)) return;
  hud.voyageScreen.classList.add('hidden');
  showHowto();
});
hud.voyageBackBtn.addEventListener('click', (e) => {
  e.currentTarget.blur(); // Regel 2
  hud.voyageScreen.classList.add('hidden');
  voyageReturnScreen.classList.remove('hidden');
  // leaving the voyage-complete finale (if that's what was showing) — don't
  // let its dust/shine keep running behind the scenes
  stopVoyageDust();
  voyageDoneFX.stop();
});

// ---- Fase 3e: etappe-mellomsteg (stage bridge) — shown between the voyage
// result screen and the next race, ONLY when this run crossed a stage
// boundary (see continueFromResult() above). G.mode stays 'finished' the
// whole time; nothing here calls startRace() except the explicit
// "START ETAPPE N+1" button (or Space, routed the same way).
// pendingInterlude is (re)populated fresh in finishRace() every result —
// Regel 1: this is per-result state, not per-run state, so it's never reset
// in startRace().
let pendingInterlude = null;

function openStageInterlude() {
  const { stageBefore, stageAfter, trophyJustArrived } = pendingInterlude;
  hud.resultScreen.classList.add('hidden');
  hud.stageInterludeScreen.classList.remove('hidden');
  // the bridge screen's own START button is the only way forward — the
  // result screen's lingering restart control doesn't belong here
  hud.restartBtn.style.display = 'none';

  const doneInfo = LANDMARK_INFO[stageBefore.landmark];
  hud.interludeDoneIcon.textContent = doneInfo.emoji;
  hud.interludeDoneText.textContent = `✓ STAGE ${stageBefore.id} COMPLETE — ${stageBefore.name}`;
  hud.interludeTrophyBanner.classList.toggle('hiddenMsg', !trophyJustArrived);
  if (trophyJustArrived) hud.interludeTrophyBanner.innerHTML = '🏆 THE TROPHY IS YOURS<br>— ROW IT HOME!';

  // stage map v3: the NEXT stage's route overlay over the shared video loop,
  // plus the ship + "STAGE N/5" badge (stage_maps/stageN.png) layered on top
  setStageImage(hud.interludeMapImg, stageMapOverlaySrc(stageAfter.id));
  setStageImage(hud.interludeStageBadgeImg, `/stage_maps/stage${stageAfter.id}.png`);
  ensureMapVideoPlaying(hud.interludeMapVideo);

  const nextInfo = LANDMARK_INFO[stageAfter.landmark];
  hud.interludeNextLabel.textContent = `NEXT: STAGE ${stageAfter.id} — ${stageAfter.name} ${nextInfo.emoji}`;
  hud.interludeNextLandmark.textContent = `You'll pass: ${nextInfo.name} ${nextInfo.emoji}`;
  hud.interludeGoBtn.textContent = `START STAGE ${stageAfter.id}`;

  // the trophy arriving is as big a moment here as it is on the result
  // screen — no auto-skip, so give it its own fanfare when actually seen
  if (trophyJustArrived) {
    for (let i = 0; i < 5; i++) {
      setTimeout(() => spawnFireworkBurst(
        G.x + (Math.random() - 0.5) * 200, 10 + Math.random() * 16, G.z - 60 - Math.random() * 120,
        FW_COLORS[(Math.random() * FW_COLORS.length) | 0], 80,
      ), i * 220);
    }
  }
}

function advanceStageInterlude() {
  hud.stageInterludeScreen.classList.add('hidden');
  pendingInterlude = null;
  startRace(false); // full nedtelling for den nye etappen
}
hud.interludeGoBtn.addEventListener('click', (e) => { e.currentTarget.blur(); advanceStageInterlude(); });
hud.interludeMenuBtn.addEventListener('click', (e) => {
  e.currentTarget.blur();
  pendingInterlude = null;
  hud.stageInterludeScreen.classList.add('hidden');
  returnToMenu();
});

// ---- Fase 4a: missions + letter-hunt status (splash screen only) ----
function renderMissionsScreen() {
  hud.missionsList.innerHTML = activeMissionsWithProgress()
    .map((m) => `<div class="missionRow"><span>${m.text}</span><span class="missionProgress">${m.progress}/${m.target}</span></div>`)
    .join('');
  hud.letterStatus.textContent = letterProgressText(loadLetters().have);
}
hud.missionsBtn.addEventListener('click', (e) => {
  e.currentTarget.blur(); // Regel 2
  hud.startScreen.classList.add('hidden');
  renderMissionsScreen();
  hud.missionsScreen.classList.remove('hidden');
});
hud.missionsBackBtn.addEventListener('click', (e) => {
  e.currentTarget.blur(); // Regel 2
  hud.missionsScreen.classList.add('hidden');
  hud.startScreen.classList.remove('hidden');
});

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
const GLOBAL_CACHE_KEY = 'vikingferd_global_cache'; // last good all-time list (offline)
const DAILY_CACHE_KEY = 'vikingferd_daily_cache';   // last good daily list (offline)
const VOYAGE_CACHE_KEY = 'roway.voyage.boardCache.v1'; // last good Story Mode combined-time list (offline)
// Shared secret for the submission signature. It ships in the client bundle,
// so it only raises the bar (see submit-score.js threat model). Vite exposes
// only VITE_-prefixed vars to the client.
const SCORE_SECRET = import.meta.env.VITE_SCORE_SECRET || 'dev-insecure-secret-change-me';

let currentNonce = null;          // one-time token from the last get-scores call
let boardCache = loadCachedGlobal();
if (!boardCache.length) boardCache = loadLocal(); // best-known list for sync reads

// ---- Kapp-mode leaderboard name entry ----
// 3-16 chars after trim; letters/numbers/spaces/hyphens/apostrophes plus
// whatever accented letters players actually type (æøå, äöü, é…) — \p{L}/\p{N}
// (Unicode letter/number categories) covers all of that without an explicit
// per-language allowlist, and rejects raw HTML/script punctuation (< > & etc.)
// by construction, since those characters simply aren't in the allowed set.
const NAME_RE = /^[\p{L}\p{N}\s'-]{3,16}$/u;
function isValidName(raw) {
  const name = String(raw ?? '').trim();
  return NAME_RE.test(name) ? name : null;
}

// States: enterName | savingScore | scoreSaved | scoreSkipped | saveError |
// idle (nothing shown — the default before finishRace() decides what to do).
// Centralizes what's visible so the name field and the 3 result buttons
// (ROW AGAIN / CHALLENGE A FRIEND / VIEW FULL LEADERBOARD) are never shown
// at the same time — only Row Race uses this; voyage mode's own stage-5
// name prompt (saveVoyageFinal()) manages hud.saveRow/skipSaveBtn directly
// and never calls this.
let resultNameState = 'idle';
// elements that make up the name-entry "step" — faded out as one group
// before the confirmation/buttons ever appear (never a hard cut, never both
// visible together)
const LB_NAME_STEP_ELS = () => [hud.lbNameHeadline, hud.lbNameSubtext, hud.saveRow, hud.lbNameError, hud.skipSaveBtn];
let lbFormVisible = false; // whether the name-entry step is ACTUALLY on screen right now — a
// silent 'savingScore' (opts.silent, e.g. voyage's background submit) never renders the form
// (see applyResultNameState), so the crossfade below must key off this, not just the state
// NAME matching a form-showing state
function setResultNameState(state, opts = {}) {
  resultNameState = state; // logical state updates immediately; the DOM may lag one short fade behind
  const nextShowForm = state === 'enterName' || state === 'saveError' || (state === 'savingScore' && !opts.silent);
  if (lbFormVisible && !nextShowForm) {
    // name-entry step -> confirmation/buttons: fade the step out FIRST, only
    // swap once it's actually gone (never a same-frame form+buttons overlap)
    const els = LB_NAME_STEP_ELS();
    els.forEach((el) => el.classList.add('lbFadeOut'));
    setTimeout(() => {
      els.forEach((el) => el.classList.remove('lbFadeOut'));
      applyResultNameState(state, opts);
    }, 220);
    return;
  }
  applyResultNameState(state, opts);
}
function applyResultNameState(state, opts = {}) {
  // opts.silent: a background save (no visible form) — the form must never
  // flash on screen for that case, only a real saveError does (so a failed
  // silent save is still explained, not just silently stuck). NOTE: the Race
  // flow no longer uses this — every finish shows the claim step, pre-filled
  // with the saved name — but the plumbing stays for background submits.
  const showForm = state === 'enterName' || state === 'saveError' || (state === 'savingScore' && !opts.silent);
  lbFormVisible = showForm; // record what's ACTUALLY visible now, for the next transition's decision
  hud.lbNameHeadline.classList.toggle('hiddenMsg', !showForm);
  hud.lbNameHeadline.textContent = 'You made the leaderboard!';
  hud.lbNameSubtext.classList.toggle('hiddenMsg', !showForm);
  hud.lbNameSubtext.textContent = 'Enter your name so others know who to beat.';
  hud.saveRow.style.display = showForm ? 'flex' : 'none';
  // Row Race no longer offers a "skip" — claiming your place is the only way
  // forward (this button is Row-Race-only state; voyage's own stage-5 name
  // prompt in finishRace() still shows #skipSaveBtn directly, untouched here)
  hud.skipSaveBtn.style.display = 'none';
  // scoreSaved/scoreSkipped both just reveal the result buttons — no
  // "saved as X · Edit" confirmation line (the next race's claim step is
  // already pre-filled/editable, so a same-screen edit path is redundant)
  const revealButtons = state === 'scoreSaved' || state === 'scoreSkipped';
  hud.retryBtn.style.display = revealButtons ? '' : 'none';
  hud.challengeBtn.style.display = revealButtons ? '' : 'none';
  hud.viewFullLbBtn.style.display = revealButtons ? '' : 'none';
  hud.lbResultWrap.style.display = revealButtons ? '' : 'none';
  hud.saveScoreBtn.textContent = state === 'savingScore' ? 'Saving…' : 'Claim your place';
  hud.saveScoreBtn.disabled = state === 'savingScore';
  if (state === 'saveError') hud.lbNameError.textContent = opts.errorText || 'Could not save your score. Try again.';
  else if (state === 'enterName') hud.lbNameError.textContent = '';
  if (revealButtons) {
    G.resultStage = 2; // Space/R can restart right away once these are up
    const grp = hud.retryBtn.parentElement;
    grp.classList.remove('lbFadeIn');
    void grp.offsetWidth;
    grp.classList.add('lbFadeIn');
  }
  // only re-check live validity on the actual enterName transition — doing
  // this for saveError too would immediately clobber the "could not save"
  // message with a validation re-check of an already-known-valid name
  if (state === 'enterName') syncSaveButtonValidity();
}
function syncSaveButtonValidity() {
  if (resultNameState === 'savingScore') return; // don't fight the disabled+"Saving…" state
  const raw = hud.aliasInput.value;
  const trimmed = raw.trim();
  const valid = isValidName(raw);
  if (trimmed.length === 0) hud.lbNameError.textContent = '';
  else if (!valid) {
    hud.lbNameError.textContent = trimmed.length < 3 ? 'Minimum 3 characters'
      : trimmed.length > 16 ? 'Keep it to 16 characters or fewer.'
      : 'Only letters, numbers, spaces and hyphens.';
  } else hud.lbNameError.textContent = '';
  hud.saveScoreBtn.disabled = !valid;
}
hud.aliasInput.addEventListener('input', syncSaveButtonValidity);

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
function loadCachedDaily() {
  try { return JSON.parse(localStorage.getItem(DAILY_CACHE_KEY)) || []; }
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
    String(d.missedGates | 0), // Portstraff — signed so it can't be tampered with in transit
  ].join('|');
}
async function signRun(run) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(SCORE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(canonicalMsg(run)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// fetch a board (day = ISO date for the daily board, null = all-time) + a fresh
// nonce; caches on success, null on any failure.
async function fetchGlobal(day = null) {
  try {
    const url = '/.netlify/functions/get-scores' + (day ? `?day=${encodeURIComponent(day)}` : '');
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    if (j.nonce) currentNonce = j.nonce;
    if (Array.isArray(j.scores)) {
      localStorage.setItem(day ? DAILY_CACHE_KEY : GLOBAL_CACHE_KEY, JSON.stringify(j.scores));
      return j.scores;
    }
    return null;
  } catch { return null; }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// selfRow: { rank, entry } — the player's own row, appended below the visible
// list (visually set apart) when their rank puts them outside it. Never
// duplicated if they're already shown in `list` itself.
//
// Result redesign: the result screen's #leaderboard now shows only the TOP 3
// (see "TOP 3 TODAY" — the full list moved to the standalone Leaderboard
// modal, #lbStart, reached via "View full leaderboard"). Both render from the
// SAME fetched `list` — no second request — just two different depths.
function paintBoard(list, highlightId = null, day = null, selfRow = null) {
  const row = (e) =>
    `<span class="lbName">${escapeHtml(e.name)}</span>` +
    `<span class="lbTime">${fmtTime(e.time)}${e.win ? ' 🇳🇴' : ''}</span>` +
    `<span class="lbScore">${e.score.toLocaleString('en-US')}</span>`;
  const empty = day
    ? '<li class="empty">No one has rowed today\'s course yet — be the first!</li>'
    : '<li class="empty">No one has rowed yet — be the first!</li>';

  // full list — standalone Leaderboard modal
  let fullHtml = list.length
    ? list.map((e) => `<li${e.id === highlightId ? ' class="me"' : ''}>${row(e)}</li>`).join('')
    : empty;
  if (selfRow && !list.some((e) => e.id === highlightId)) {
    fullHtml += `<li class="me lbSelfRow" data-rank="${selfRow.rank}.">${row(selfRow.entry)}</li>`;
  }
  hud.lbStart.innerHTML = fullHtml;

  // top 3 — result screen. Always shows the player's own row (from selfRow,
  // or their real rank within `list`) if they're not already in the top 3, so
  // "where do I stand" is never lost just because the board got shorter.
  const top3 = list.slice(0, 3);
  let top3Html = top3.length
    ? top3.map((e) => `<li${e.id === highlightId ? ' class="me"' : ''}>${row(e)}</li>`).join('')
    : empty;
  const playerInTop3 = top3.some((e) => e.id === highlightId);
  if (!playerInTop3) {
    if (selfRow) {
      top3Html += `<li class="me lbSelfRow" data-rank="${selfRow.rank}.">${row(selfRow.entry)}</li>`;
    } else if (highlightId) {
      const idx = list.findIndex((e) => e.id === highlightId);
      if (idx >= 0) top3Html += `<li class="me lbSelfRow" data-rank="${idx + 1}.">${row(list[idx])}</li>`;
    }
  }
  hud.leaderboard.innerHTML = top3Html;
}
function paintLoading() {
  const l = '<li class="empty">Loading the leaderboard…</li>';
  hud.leaderboard.innerHTML = l;
  hud.lbStart.innerHTML = l;
}

// async: show a brief loading state, fetch the chosen board (day = ISO date for
// the daily board, null = all-time), fall back to the cached/local list on any
// failure. Never throws.
async function renderLeaderboards(highlightId = null, day = null) {
  paintLoading();
  const g = await fetchGlobal(day);
  if (g) {
    if (!day) boardCache = g;
    paintBoard(g, highlightId, day);
  } else {
    const fallback = day ? loadCachedDaily() : (boardCache.length ? boardCache : loadLocal());
    paintBoard(fallback, highlightId, day);
  }
}

// ================= REISEN server leaderboard (combined-time, per-stage) =================
// See src/voyage.js for why this is per-stage-incremental rather than a
// single atomic "submit the whole voyage" call: REISEN has no discrete
// attempt to submit — a stage's best time is permanent state, improved over
// however many sessions it takes, same as voyage.total itself.
// reassigned (not const) so startNewVoyageBtn can pick up the freshly-minted
// id in place, without a page reload — see that handler below.
let voyageId = getOrCreateVoyageId();

async function issueStageToken(stage, timeMs) {
  try {
    const res = await fetch('/.netlify/functions/issue-stage-token', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voyageId, stage, timeMs }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function submitVoyageTokens(tokens) {
  try {
    const alias = localStorage.getItem(ALIAS_KEY) || 'Unknown viking';
    const res = await fetch('/.netlify/functions/submit-voyage', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alias, voyageId, tokens }),
    });
    // parse rejections too — 'stage-final' means the server already holds an
    // accepted stage-5 time (the retry path treats that as "submitted")
    if (!res.ok) { try { return { ok: false, error: (await res.json()).error }; } catch { return null; } }
    return await res.json();
  } catch { return null; }
}

// selfRow: { rank, entry } — same pattern as paintBoard's (see there).
// target: which <ol> to paint into — defaults to the result screen's own
// board (every existing call site), but the leaderboard modal's Story Mode
// tab (renderStoryModeLeaderboard()) passes its own list element instead.
function paintVoyageBoard(list, highlightId = null, selfRow = null, target = hud.voyageLeaderboard) {
  const row = (e) =>
    `<span class="lbName">${escapeHtml(e.alias)}</span><span class="lbTime">${fmtTime(e.totalMs / 1000)}</span>`;
  let html = list.length
    ? list.map((e) => `<li${e.id === highlightId ? ' class="me"' : ''}>${row(e)}</li>`).join('')
    : '<li class="empty">No one has completed all 5 stages yet — be the first!</li>';
  if (selfRow && !list.some((e) => e.id === highlightId)) {
    html += `<li class="me lbSelfRow" data-rank="${selfRow.rank}.">${row(selfRow.entry)}</li>`;
  }
  target.innerHTML = html;
  // the board is the FULL server list (scrollable) — start the view centred
  // on the player's own highlighted row so their placement is instantly
  // visible, with the rest reachable by scrolling. Rect-based math (NOT
  // offsetTop, whose base is the nearest POSITIONED ancestor — the screen,
  // not this un-positioned <ol> — which put the target ~a banner-and-title
  // too far down), and direct scrollTop (not scrollIntoView) so no
  // ancestor/page ever scrolls along.
  const mine = target.querySelector('li.me');
  if (mine) requestAnimationFrame(() => {
    const rowTopInContent = mine.getBoundingClientRect().top - target.getBoundingClientRect().top + target.scrollTop;
    target.scrollTop = Math.max(0, rowTopInContent - target.clientHeight / 2 + mine.offsetHeight / 2);
  });
}

// Story Mode tab of the leaderboard modal — reuses the same REISEN
// combined-time fetch (get-voyage) and row rendering (paintVoyageBoard) the
// result screen's own board already uses, just painted into #lbStoryList.
// Frontend-only: no Netlify function or server logic touched.
//
// Gated on the VIEWING PLAYER's own completion: submit-voyage.js only ever
// adds a player to the public list once all 5 stages are in (see get-voyage.js
// — every entry it returns is already a completed voyage), so an unfinished
// player has no row to highlight and no honest rank to show — an explicit
// prompt reads better than a bare list of strangers.
async function renderStoryModeLeaderboard() {
  const bests = loadStageBests();
  const stageIds = Object.keys(bests);
  if (stageIds.length < VOYAGE_STAGES.length) {
    $('lbStoryList').innerHTML = '<li class="empty">Complete the voyage to join this leaderboard.</li>';
    return;
  }
  $('lbStoryList').innerHTML = '<li class="empty">Loading the leaderboard…</li>';
  const localTotalMs = stageIds.reduce((sum, id) => sum + bests[id].timeMs, 0);
  const myId = getOrCreateVoyageId();
  const paint = (list) => paintVoyageBoard(list, myId, list.some((e) => e.id === myId) ? null : {
    rank: list.filter((e) => e.totalMs < localTotalMs).length + 1,
    entry: { id: myId, alias: localStorage.getItem(ALIAS_KEY) || 'You', totalMs: localTotalMs },
  }, $('lbStoryList'));
  try {
    const res = await fetch('/.netlify/functions/get-voyage', { cache: 'no-store' });
    if (!res.ok) throw new Error('offline');
    const j = await res.json();
    const list = Array.isArray(j.scores) ? j.scores : [];
    try { localStorage.setItem(VOYAGE_CACHE_KEY, JSON.stringify(list)); } catch { /* storage full — just won't cache */ }
    paint(list);
  } catch {
    // offline/unreachable — same "last good list" fallback pattern as
    // Time Attack's GLOBAL_CACHE_KEY/DAILY_CACHE_KEY (loadCachedGlobal etc.)
    let cached = [];
    try { cached = JSON.parse(localStorage.getItem(VOYAGE_CACHE_KEY)) || []; } catch { /* corrupt/missing */ }
    if (cached.length) paint(cached);
    else $('lbStoryList').innerHTML = '<li class="empty">Could not load the leaderboard — try again later.</li>';
  }
}

// Fase 3c stage id (1..5, VOYAGE_STAGES) -> server stage (0..4, per
// issue-stage-token/submit-voyage's contract)
function toServerStage(stageId) { return stageId - 1; }
const FINAL_STAGE_ID = VOYAGE_STAGES[VOYAGE_STAGES.length - 1].id; // 5 — the one-shot homecoming

// submission engine: (re)issue a token for a stage's locally-recorded best
// and push it to the board. Shared by the auto path (stages 1-4), the
// name-gated stage-5 flow (saveVoyageFinal) and the boot-time retry.
// Returns the server result on acceptance, null otherwise.
async function submitStageBest(stageId) {
  const best = loadStageBests()[stageId];
  if (!best || best.submitted) return null;
  const token = await issueStageToken(toServerStage(stageId), best.timeMs);
  if (!token) return null; // offline/rate-limited — stays unsubmitted, retried at next boot
  const result = await submitVoyageTokens([token]);
  if (result && result.ok) { markStageSubmitted(stageId); return result; }
  // the server already holds an accepted final time (a crash between accept
  // and markStageSubmitted) — reconcile the local flag, don't retry forever
  if (result && result.error === 'stage-final') markStageSubmitted(stageId);
  return null;
}

// called from finishRace()'s voyage branch for stages 1-4, fire-and-forget —
// never awaited in the frame loop. Stage 5 never goes through here: its ONE
// submission is name-gated in saveVoyageFinal() (C3/C4).
async function maybeSubmitStageResult(stageId, timeSeconds, score = undefined) {
  if (stageId === FINAL_STAGE_ID) return;
  const timeMs = Math.round(timeSeconds * 1000);
  if (!isStageBest(stageId, timeMs)) return;
  recordStageBest(stageId, timeMs, score); // commit locally first — never lost even if offline
  const result = await submitStageBest(stageId);
  if (result) renderVoyageRankBanner(result);
}

// boot-time retry: anything recorded but never accepted by the server (page
// closed while offline, submit failed, etc.) gets one more attempt per load.
async function retryUnsubmittedStageBests() {
  const bests = loadStageBests();
  for (const id of Object.keys(bests)) {
    if (!bests[id].submitted) await submitStageBest(Number(id));
  }
}

// The stage line's base text (the stage-5 one-shot caveat only now — the
// stage NAME itself lives in #stageNameBanner above the headline instead).
// applyVoyageStageRanks appends "Nth on this stage" to it once the server
// boards arrive, so it must be re-renderable without string-parsing what's
// already in the DOM. Empty string is a legitimate value (stages 1-4 have no
// base caveat) — voyageStageContextReady is the real "has a run just
// finished" guard for applyVoyageStageRanks below.
let voyageStageContextBase = '';
let voyageStageContextReady = false;

// "Nth on this stage" + "Nth place so far" from the server's per-stage
// boards (see submit-voyage/get-voyage — [{id, alias, timeMs}] per stage,
// capped at 100). "So far" = combined time over the stages THIS player has
// recorded, ranked against every player who has all of those same stages.
function applyVoyageStageRanks(stageBoards) {
  if (!stageBoards || G.gameMode !== 'voyage') return;
  const myId = getOrCreateVoyageId();
  const bests = loadStageBests();
  const stageId = G.stageAtRunStart;
  const myBest = bests[stageId];
  const board = stageBoards[toServerStage(stageId)];
  if (myBest && Array.isArray(board) && board.length && voyageStageContextReady) {
    const stageRank = 1 + board.filter((e) => e.id !== myId && e.timeMs < myBest.timeMs).length;
    const rankText = `${ordinal(stageRank)} on this stage`;
    hud.stageContext.textContent = voyageStageContextBase ? `${voyageStageContextBase} · ${rankText}` : rankText;
    hud.stageContext.classList.remove('hiddenMsg');
  }
  const myStageIds = Object.keys(bests);
  if (!myStageIds.length) return;
  const mySum = myStageIds.reduce((s, id) => s + bests[id].timeMs, 0);
  const sums = new Map(); // other player id -> { count, sum } over MY stages
  for (const id of myStageIds) {
    const b = stageBoards[toServerStage(Number(id))];
    // a stage with no board yet means nobody else is known for it — that's
    // not evidence someone's ahead, so skip just this stage's contribution
    // rather than abandoning the whole rank (the old `return` here left
    // #resRank stuck on its "—" placeholder forever whenever ANY one of the
    // player's recorded stages had no server board at all, e.g. offline/dev)
    if (!Array.isArray(b)) continue;
    for (const e of b) {
      if (e.id === myId) continue;
      const rec = sums.get(e.id) || { count: 0, sum: 0 };
      rec.count++; rec.sum += e.timeMs;
      sums.set(e.id, rec);
    }
  }
  let ahead = 0;
  for (const rec of sums.values()) if (rec.count === myStageIds.length && rec.sum < mySum) ahead++;
  // "so far" combined-time rank feeds the card's RANK stat directly — once
  // the voyage is complete, renderVoyageRankBanner() below overwrites this
  // with the authoritative combined-voyage rank.
  hud.resRank.textContent = `#${ahead + 1}`;
}

// shows the per-stage/"so far" placements after every voyage run, and the
// combined-time rank/board once all 5 stages are known — either from the
// response of a submission just made, or (if this run wasn't a new best but
// the player already has all 5 recorded from earlier sessions) from a fresh
// get-voyage fetch compared against the locally-known total.
async function renderVoyageRankBanner(freshResult = null) {
  if (freshResult) applyVoyageStageRanks(freshResult.stageBoards);
  if (freshResult && freshResult.complete) {
    // authoritative combined-voyage rank — lives in the card now; the banner
    // element is reserved for the offline caveat only (see below), so hide it.
    hud.resRank.textContent = `#${freshResult.rank}`;
    hud.voyageRankBanner.classList.add('hiddenMsg');
    hud.voyageLbWrap.classList.remove('hiddenMsg');
    const list = freshResult.list || [];
    const inList = list.some((e) => e.id === freshResult.id);
    paintVoyageBoard(list, freshResult.id, inList ? null : {
      rank: freshResult.rank,
      entry: { id: freshResult.id, alias: freshResult.alias, totalMs: freshResult.totalMs },
    });
    return;
  }
  const bests = loadStageBests();
  const stageIds = Object.keys(bests);
  const complete = stageIds.length >= VOYAGE_STAGES.length;
  if (!complete) {
    hud.voyageRankBanner.classList.add('hiddenMsg');
    hud.voyageLbWrap.classList.add('hiddenMsg');
    // a fresh submit already carried its own boards through the top of this
    // function — otherwise fall through to the fetch purely for placements
    if (freshResult) return;
  }
  const localTotalMs = stageIds.reduce((sum, id) => sum + bests[id].timeMs, 0);
  // offline/unreachable: the combined time is already known locally (and
  // already banked in the card's TIME/points), but the RANK stat needs the
  // server — this small caveat line is the only thing shown until then.
  const offlineBanner = () => {
    // no server reachable at all, so no comparison data of any kind — rather
    // than leave the card's RANK stat stuck on its "—" placeholder (there's
    // nothing on screen more discouraging than a blank dash), default to
    // #1: with zero evidence anyone's ahead, that's both the friendliest
    // reading and often the literally correct one (solo play, offline dev).
    // It's overwritten the moment a real comparison succeeds.
    if (hud.resRank.textContent === '—') hud.resRank.textContent = '#1';
    if (!complete) return;
    // stage-5 claim step keeps a clean single-action layout (per request) —
    // the rank story starts AFTER claiming anyway (saveVoyageFinal re-renders
    // this banner, and the Ullevaal handoff shows the final placement)
    if (hud.saveRow.style.display !== 'none') return;
    hud.voyageRankBanner.classList.remove('hiddenMsg');
    hud.voyageRankBanner.textContent = "🏆 Rank appears once you're back online";
  };
  try {
    const res = await fetch('/.netlify/functions/get-voyage', { cache: 'no-store' });
    if (!res.ok) { offlineBanner(); return; }
    const j = await res.json();
    // per-stage/"so far" placements apply after EVERY voyage run — the
    // combined banner/board below stays gated on a complete voyage
    applyVoyageStageRanks(j.stageBoards);
    if (!complete) return;
    const list = Array.isArray(j.scores) ? j.scores : [];
    const rank = list.filter((e) => e.totalMs < localTotalMs).length + 1;
    hud.resRank.textContent = `#${rank}`;
    hud.voyageRankBanner.classList.add('hiddenMsg');
    hud.voyageLbWrap.classList.remove('hiddenMsg');
    // highlight the player's own row here too (this path runs when the
    // voyage was already complete before this run) — and if their entry
    // hasn't reached the server list yet, append the dashed self-row so
    // their placement is still plainly visible
    const myId = getOrCreateVoyageId();
    paintVoyageBoard(list, myId, list.some((e) => e.id === myId) ? null : {
      rank,
      entry: { id: myId, alias: localStorage.getItem(ALIAS_KEY) || 'You', totalMs: localTotalMs },
    });
  } catch { offlineBanner(); }
}

// C4: stage 5's one-shot submission, gated behind the name prompt — reuses
// the KAPPRO alias field/save button (saveScore() routes here in voyage mode).
async function saveVoyageFinal() {
  if (!G.lastRun || G.lastRunSaved) return;
  G.lastRunSaved = true; // guard against double-submit before any await
  const name = hud.aliasInput.value.trim().slice(0, 14) || 'Unknown viking';
  localStorage.setItem(ALIAS_KEY, name); // submitVoyageTokens reads the alias from here
  hud.saveRow.style.display = 'none';
  hud.skipSaveBtn.style.display = 'none';
  hud.savedMsg.classList.add('show');
  hud.savedMsg.textContent = 'Saving…';
  const result = await submitStageBest(FINAL_STAGE_ID);
  if (result && result.complete) {
    hud.savedMsg.textContent = 'The trophy is home — final time saved!';
    renderVoyageRankBanner(result); // highlights this player's row via result.id
  } else if (result) {
    // accepted, but some earlier stage was never submitted — total pending
    hud.savedMsg.textContent = 'Saved!';
    renderVoyageRankBanner();
  } else {
    hud.savedMsg.textContent = 'Saved locally — submits next time you\'re online';
    renderVoyageRankBanner(); // shows local combined time via the offline fallback
  }
  // C4 follow-up: claiming the name is the last step on the result screen —
  // hand off straight to the Ullevaal homecoming screen (place/time/score)
  // instead of leaving the player to find "Back to menu" themselves. Brief
  // pause so the "saved" message above is actually readable first. Guarded
  // on the result screen still being open — a player who somehow already
  // left (e.g. hit Back to menu during the save round-trip) shouldn't get
  // yanked to a different screen out from under them.
  setTimeout(() => {
    hud.restartBtn.style.display = 'none'; // the finale screen is a menu, not a race context
    if (!hud.resultScreen.classList.contains('hidden')) openVoyageScreen(hud.resultScreen, true);
  }, 1400);
}

async function saveScore({ silent = false } = {}) {
  // voyage mode: the name field belongs to the stage-5 final submission (C4)
  if (G.gameMode === 'voyage') return saveVoyageFinal();
  if (!G.lastRun || G.lastRunSaved) return;
  G.lastRunSaved = true; // guard against double-submit before any await
  const name = isValidName(hud.aliasInput.value) || 'Unknown viking';
  setResultNameState('savingScore', { silent });
  try {
    // Portstraff: the REMOTE payload's `time` is the RAW (unpenalized) race
    // time, not G.lastRun.time — the server independently recomputes and adds
    // the gate penalty from missedGates itself (never trusts the client's
    // math for the value that actually lands on the leaderboard).
    const run = {
      name,
      time: G.lastRun.rawTime,
      missedGates: G.lastRun.missedGates,
      balls: G.lastRun.balls,
      perfect: G.lastRun.perfect,
      gates: G.lastRun.gates,
      win: G.lastRun.win,
    };
    // local backup ALWAYS happens first — the result screen never blocks on the
    // network. This uses G.lastRun.time (WITH the penalty already baked in) —
    // the same value shown everywhere else on this result screen.
    const localEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name, score: computeScore(G.lastRun).total, time: G.lastRun.time, win: run.win,
    };
    saveLocal(localEntry);
    localStorage.setItem(ALIAS_KEY, name);

    // try the global list — the daily-challenge board is what the result screen shows
    let dayScores = null, allScores = null, serverId = null, serverEntry = null, rankDay = null, rankAll = null;
    try {
      if (!currentNonce) await fetchGlobal();
      if (currentNonce) {
        const sig = await signRun(run);
        const res = await fetch('/.netlify/functions/submit-score', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...run, day: DAILY_KEY, nonce: currentNonce, sig }),
        });
        currentNonce = null; // single use, whatever the outcome
        if (res.ok) {
          const j = await res.json();
          dayScores = j.dayScores; allScores = j.scores; serverId = j.id;
          serverEntry = j.entry; rankDay = j.rankDay; rankAll = j.rankAll;
        }
      }
    } catch { /* fall through to local */ }

    if (allScores) {
      boardCache = allScores;
      localStorage.setItem(GLOBAL_CACHE_KEY, JSON.stringify(allScores));
      if (Array.isArray(dayScores)) localStorage.setItem(DAILY_CACHE_KEY, JSON.stringify(dayScores));
      // result screen shows TODAY's board — that's the course you just rowed
      const board = Array.isArray(dayScores) ? dayScores : allScores;
      const rank = Array.isArray(dayScores) ? rankDay : rankAll;
      const inBoard = board.some((e) => e.id === serverId);
      paintBoard(board, serverId, DAILY_KEY, (!inBoard && serverEntry) ? { rank, entry: serverEntry } : null);
      // the card's RANK stat was set right at finish time from a possibly-
      // stale cache (see finishRace()) — now that the save round-trip gives
      // an authoritative rank, overwrite it so the two never contradict.
      if (rankDay != null) hud.resRank.textContent = `#${rankDay}`;
    } else {
      // show the LOCAL list so the player sees the entry they just saved, highlighted
      paintBoard(loadLocal(), localEntry.id);
    }
    setResultNameState('scoreSaved');
  } catch (err) {
    G.lastRunSaved = false; // local save never got a chance to guard against a retry — allow one
    setResultNameState('saveError');
  }
}

// Row Race "Claim your place": voyage mode's own field routes straight to
// saveScore() (which redirects to saveVoyageFinal()) exactly as before — no
// validation gate there, unchanged. Kapp mode validates first (the button is
// already disabled for an invalid name via syncSaveButtonValidity(), this is
// the defensive re-check for a stray Enter-key submit).
function handleClaimClick() {
  if (G.gameMode === 'voyage') { saveScore(); return; }
  const valid = isValidName(hud.aliasInput.value);
  if (!valid) { syncSaveButtonValidity(); return; }
  saveScore();
}
hud.saveScoreBtn.addEventListener('click', () => { handleClaimClick(); hud.saveScoreBtn.blur(); });
hud.skipSaveBtn.addEventListener('click', () => {
  hud.skipSaveBtn.blur();
  if (G.gameMode === 'voyage') {
    // skipping the name prompt doesn't skip the final submission — it just
    // keeps whatever alias is already stored (C4)
    hud.aliasInput.value = localStorage.getItem(ALIAS_KEY) || '';
    saveVoyageFinal();
    return;
  }
  renderLeaderboards(null, DAILY_KEY); // show today's board — the course just rowed
  setResultNameState('scoreSkipped');
});
hud.aliasInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { handleClaimClick(); hud.aliasInput.blur(); }
});
hud.aliasInput.value = localStorage.getItem(ALIAS_KEY) || '';
renderLeaderboards();
retryUnsubmittedStageBests(); // C4: pending voyage submissions (offline finishes) retry once per load

// ================= Challenge links (Fase 2): upload + share =================
// Separate, unsigned system — never touches the leaderboard's signature chain
// and is never auto-submitted to the leaderboard.
async function shareChallenge(msgEl, btnEl) {
  if (btnEl) btnEl.blur(); // Rule 2: never leave the trigger button focused
  const track = GH.lastTrack;
  if (!track || track.length < 2 || !G.lastRun) return; // nothing to share yet
  msgEl.classList.remove('hiddenMsg');
  msgEl.textContent = 'Creating link…';
  let url;
  try {
    const alias = String(hud.aliasInput.value || localStorage.getItem(ALIAS_KEY) || 'Unknown viking').trim().slice(0, 14);
    const res = await fetch('/.netlify/functions/create-challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        v: 1, alias, time: G.lastRun.time, balls: G.lastRun.balls, perfect: G.lastRun.perfect, track,
      }),
    });
    if (!res.ok) throw new Error('bad-status');
    const j = await res.json();
    url = `${location.origin}/?c=${j.id}`;
  } catch {
    msgEl.textContent = 'Could not create the link — try again';
    return;
  }
  msgEl.classList.add('hiddenMsg');
  openChallengeLinkModal(url);
}
// Shown once create-challenge succeeds, instead of firing
// navigator.share()/navigator.clipboard.writeText() straight from here: both
// are gesture-gated APIs, and by this point the triggering click is already
// stale (the awaited fetch above sits in between) — some browsers, notably
// Safari/iOS, silently refuse the call once that gesture has gone stale,
// which read as "the link doesn't work" even though it was created fine.
// The modal's own Copy button below fires its own fresh click, so it isn't
// affected the same way.
function openChallengeLinkModal(url) {
  hud.challengeLinkDesc.textContent = shareCopyText();
  hud.challengeLinkInput.value = url;
  hud.challengeLinkCopyBtn.textContent = 'Copy';
  hud.challengeLinkScreen.classList.remove('hidden');
}
function closeChallengeLinkModal() {
  hud.challengeLinkScreen.classList.add('hidden');
}
hud.challengeLinkClose.addEventListener('click', (e) => { e.currentTarget.blur(); closeChallengeLinkModal(); });
hud.challengeLinkCopyBtn.addEventListener('click', async (e) => {
  e.currentTarget.blur();
  try {
    await navigator.clipboard.writeText(hud.challengeLinkInput.value);
    hud.challengeLinkCopyBtn.textContent = 'Copied!';
  } catch {
    // clipboard permission denied/unavailable — the link is still right
    // there, selected, ready for a manual copy
    hud.challengeLinkInput.select();
  }
});
// share body text: branches on game mode + completion state, but every
// branch still feeds the same URL-creation/clipboard-fallback/error-handling
// flow above unchanged. G.lastRun is guaranteed set here (shareChallenge()
// returns early above if it isn't).
function shareCopyText() {
  if (G.gameMode === 'kapp') {
    return `I completed today’s ROWAY course in ${fmtTime(G.lastRun.time)}. Can you beat me?`;
  }
  if (G.gameMode === 'voyage' && G.stageAtRunStart === FINAL_STAGE_ID && isStageFinal(FINAL_STAGE_ID)) {
    return 'Mission complete. I claimed the World Cup trophy in the USA and rowed it home to Ullevaal.';
  }
  return `I brought the World Cup trophy home in ROWAY. Can you beat my time? (${fmtTime(G.lastRun.time)})`;
}
// Result redesign: the duel outcome no longer has its own rematch button —
// "Challenge a friend" (below) creates/shares the same link for both cases.
hud.challengeBtn.addEventListener('click', () => shareChallenge(hud.challengeMsg, hud.challengeBtn));

// ---- receiving a challenge link (?c=<id>) ----
hud.challengeGoBtn.addEventListener('click', (e) => {
  e.currentTarget.blur(); // Rule 2
  hud.challengeScreen.classList.add('hidden');
  C.active = true;
  G.gameMode = 'kapp'; // Fase 3b: duels race the daily course — always Kapproing
  startRace(false);
});
hud.challengeNoBtn.addEventListener('click', (e) => {
  e.currentTarget.blur(); // Rule 2
  hud.challengeScreen.classList.add('hidden');
  C.active = false; C.alias = ''; C.time = 0; C.track = null;
  hud.startScreen.classList.remove('hidden');
  shieldFX.reveal();
  setTimeout(() => logoFX.reveal(), 220);
});

// declared here, but not CALLED until after `camPos` exists further down the
// file (it's a `const` — calling this any earlier would hit the TDZ)
function initChallengeFromURL() {
  const id = new URLSearchParams(location.search).get('c');
  if (!id) return;
  history.replaceState(null, '', location.pathname); // a refresh must not re-trigger this

  // the friend should land straight on the duel screen, not sit through a 5 s
  // cinematic they didn't ask for — skip it silently
  INTRO.active = false;
  hideIntroLandmarks();
  hideWinsenIntroCard();
  camPos.set(0, 15.5, 27);
  document.getElementById('cinebars').classList.remove('on');
  document.getElementById('controlsBtn').style.display = ''; // hidden during the intro — see index.html

  fetch(`/.netlify/functions/get-challenge?id=${encodeURIComponent(id)}`)
    .then((res) => { if (!res.ok) throw new Error('not-found'); return res.json(); })
    .then((entry) => {
      if (!entry || !Array.isArray(entry.track) || entry.track.length < 2) throw new Error('bad-data');
      C.alias = String(entry.alias || 'Unknown viking').slice(0, 14);
      C.time = Number(entry.time) || 0;
      C.track = entry.track;
      buildChallengeShip(C.alias);
      hud.challengeTitle.textContent = `${C.alias} challenges you!`;
      hud.challengeTimeText.textContent = `Time to beat: ${fmtTime(C.time)}`;
      hud.challengeScreen.classList.remove('hidden');
    })
    .catch(() => {
      // expired link / bad id / network error — no race to offer, just an exit
      hud.challengeGoBtn.style.display = 'none';
      hud.challengeTitle.textContent = 'This challenge no longer exists';
      hud.challengeTimeText.textContent = '';
      hud.challengeScreen.classList.remove('hidden');
    });
}

// ---- restart button: pause + confirm before throwing the race away ----
hud.restartBtn.addEventListener('click', () => {
  hud.restartBtn.blur();
  const midRace = G.mode === 'racing' || G.mode === 'countdown';
  if (!midRace && G.mode !== 'finished') return; // finished: the result screen keeps this button
  if (midRace) {
    G.paused = true;
    releaseStroke(); // don't strand a held stroke under the dialog
  }
  // same dialog both ways — only the body copy differs (nothing pauses or
  // gets thrown away when the race is already finished/scored)
  $('confirmText').textContent = midRace
    ? 'The race will pause. Do you want to abandon it and row from the start line again?'
    : 'Row this race again from the start line?';
  hud.confirmScreen.classList.remove('hidden');
});
$('confirmYes').addEventListener('click', (e) => {
  e.target.blur();
  hud.confirmScreen.classList.add('hidden');
  G.paused = false;
  G.mode = 'menu'; // let startRace pass its in-race guard — this restart is intentional
  startRace();
});
$('confirmMenu').addEventListener('click', (e) => {
  e.target.blur();
  returnToMenu();
});
$('confirmNo').addEventListener('click', (e) => {
  e.target.blur();
  hud.confirmScreen.classList.add('hidden');
  G.paused = false;
});

// ---- settings modal: music / SFX toggles (persisted) ----
const MUSIC_KEY = 'roway.music', SFX_KEY = 'roway.sfx', HIDE_GHOST_KEY = 'roway.hideGhost';
const settingsBtn = $('settingsBtn'), settingsScreen = $('settingsScreen'), settingsClose = $('settingsClose');
const toggleMusic = $('toggleMusic'), toggleSfx = $('toggleSfx');
const hideGhostRow = $('hideGhostRow'), toggleHideGhost = $('toggleHideGhost');
function applyMusic(on) {
  setMusicMuted(!on);
  toggleMusic.classList.toggle('on', on);
  localStorage.setItem(MUSIC_KEY, on ? '1' : '0');
}
function applySfx(on) {
  setSfxMuted(!on);
  toggleSfx.classList.toggle('on', on);
  localStorage.setItem(SFX_KEY, on ? '1' : '0');
}
// default ON unless the player explicitly turned it off before
applyMusic(localStorage.getItem(MUSIC_KEY) !== '0');
applySfx(localStorage.getItem(SFX_KEY) !== '0');

// hide-ghost-ship (Settings): the row itself only shows up when a ghost
// actually exists to hide — a personal-best recording (GHOST_KEY) or an
// active challenge duel (C.active) — checked fresh every time Settings
// opens, not cached, since either can appear/disappear between visits.
let hideGhostPref = localStorage.getItem(HIDE_GHOST_KEY) === '1';
function hasGhostAvailable() {
  let data;
  try { data = JSON.parse(localStorage.getItem(GHOST_KEY)); } catch { data = null; }
  return (Array.isArray(data) && data.length > 1) || C.active;
}
toggleHideGhost.classList.toggle('on', hideGhostPref);
settingsBtn.addEventListener('click', () => {
  settingsBtn.blur();
  if (G.mode === 'racing' || G.mode === 'countdown') { G.paused = true; releaseStroke(); }
  hideGhostRow.style.display = hasGhostAvailable() ? 'flex' : 'none';
  settingsScreen.classList.remove('hidden');
});
function closeSettings() {
  settingsScreen.classList.add('hidden');
  G.paused = false; // resume if we paused a race; harmless on the menu
}
settingsClose.addEventListener('click', (e) => { e.currentTarget.blur(); closeSettings(); });

// ---- About-the-game modal: splash-only entry point, same overlay
// presentation as Settings (z-50 plate over whatever is showing) ----
$('aboutBtn').addEventListener('click', (e) => {
  e.currentTarget.blur();
  $('aboutScreen').classList.remove('hidden');
});
$('aboutCloseBtn').addEventListener('click', (e) => {
  e.currentTarget.blur();
  $('aboutScreen').classList.add('hidden');
});
toggleMusic.addEventListener('click', (e) => { e.currentTarget.blur(); applyMusic(isMusicMuted()); });
toggleSfx.addEventListener('click', (e) => { e.currentTarget.blur(); applySfx(isSfxMuted()); });
// turning ON hides whichever ghost is currently up right away; turning OFF
// just persists the preference — the ghost (if any) reappears on the next
// race start (startRace() reads hideGhostPref there), rather than trying to
// re-derive which of GH/C should currently be visible here too.
toggleHideGhost.addEventListener('click', (e) => {
  e.currentTarget.blur();
  hideGhostPref = !hideGhostPref;
  localStorage.setItem(HIDE_GHOST_KEY, hideGhostPref ? '1' : '0');
  toggleHideGhost.classList.toggle('on', hideGhostPref);
  if (hideGhostPref) {
    if (GH.ship) GH.ship.visible = false;
    if (C.ship) C.ship.visible = false;
  }
});

// dev tools row: only ever shown when DEV_TOOLS is already on (see the
// online-unlock block up top), so its one job is turning it back off —
// unlike music/sfx there's no "off" visual state to support, a click just
// clears the flag and reloads so the DEV-ONLY block further down stops
// running on the next boot.
if (DEV_TOOLS) $('devToolsRow').style.display = 'flex';
$('toggleDevTools').addEventListener('click', (e) => {
  e.currentTarget.blur();
  localStorage.removeItem(DEV_FLAG_KEY);
  // navigate to the bare URL, not just reload() — if the page was opened
  // via ?dev=roway2026 (e.g. a bookmarked/shared link), a plain reload sees
  // that same query string again and immediately re-arms the flag we just
  // cleared, so the toggle would silently do nothing.
  window.location.href = window.location.origin + window.location.pathname;
});

// reset voyage progress from Settings: two-tap confirm (the "armed" state
// reverts after 3s) so a stray tap can't wipe local progress. Same
// resetVoyage() + reload as #startNewVoyageBtn's own reset flow — voyageId
// is cached module-level at boot, so a reload is the only safe way to pick
// a freshly-minted one up cleanly.
const resetVoyageBtn = $('resetVoyageBtn');
let resetArmed = false, resetArmTimer = null;
resetVoyageBtn.addEventListener('click', (e) => {
  e.currentTarget.blur();
  if (!resetArmed) {
    resetArmed = true;
    resetVoyageBtn.textContent = 'Tap to confirm';
    resetVoyageBtn.classList.add('armed');
    resetArmTimer = setTimeout(() => {
      resetArmed = false;
      resetVoyageBtn.textContent = 'Reset';
      resetVoyageBtn.classList.remove('armed');
    }, 3000);
    return;
  }
  clearTimeout(resetArmTimer);
  resetVoyage();
  window.location.reload();
});

// start the audio context (and the looping music) on the first user gesture so
// the menu already has music — initAudio() is idempotent, startRace() calls it too
let audioKicked = false;
function kickAudio() {
  if (audioKicked) return;
  audioKicked = true;
  initAudio();
}
window.addEventListener('pointerdown', kickAudio, { once: true, capture: true });
window.addEventListener('keydown', kickAudio, { once: true, capture: true });

// hover sparkle — fire once each time the mouse crosses INTO a button (not on
// every move within it, and mouse only so taps don't double up with clicks)
let lastHoverBtn = null;
document.addEventListener('pointerover', (e) => {
  if (e.pointerType && e.pointerType !== 'mouse') return;
  if (!e.target.closest) return;
  // any button — resolve raster buttons to their wrapper so hovering the label
  // vs the frame edges counts as the same element (no double-fire)
  const btn = e.target.closest('.raster-btn') || e.target.closest('button, .toggle');
  if (btn) { if (btn !== lastHoverBtn) { hoverSparkle(); lastHoverBtn = btn; } }
  else lastHoverBtn = null;
});
// the coxswain's "Ro!" shout on every button press — same element detection
// as the hover sparkle above (native click, so touch taps get it too, unlike
// the mouse-only hover). Native browser behaviour already skips `disabled`
// buttons (they never dispatch click), so no extra guard is needed here.
document.addEventListener('click', (e) => {
  if (!e.target.closest) return;
  const btn = e.target.closest('.raster-btn') || e.target.closest('button, .toggle');
  if (btn) roVoice();
});

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
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
// durationMs: optional override of the default .8s pop animation — the
// Portstraff miss toast needs to stay up longer (1.5s) so it reads as a
// warning, not a quick flash; same self-terminating animation either way.
function showFeedback(text, color, priority = false, durationMs = null) {
  // priority callouts (race drama) hold the stage; stroke labels can't overwrite them
  if (!priority && waterT < fbLockUntil) return;
  if (priority) fbLockUntil = waterT + (durationMs ? durationMs / 1000 : 1.2);
  hud.feedback.textContent = text;
  hud.feedback.style.color = color;
  hud.feedback.classList.remove('pop');
  void hud.feedback.offsetWidth; // restart animation
  hud.feedback.style.animationDuration = durationMs ? `${durationMs}ms` : '';
  hud.feedback.classList.add('pop');
}

// Norwegian chapter card at voyage stage start — the CSS animation is fully
// self-terminating (fade in → hold through the countdown → fade out), so
// this only ever restarts it (perfectFlash pattern, Regel 9).
function showStageChapter(stage) {
  const el = $('stageChapter');
  $('stageChapterKicker').textContent = `STAGE ${stage.id} OF ${VOYAGE_STAGES.length}`;
  $('stageChapterName').textContent = stage.name;
  el.classList.remove('play');
  void el.offsetWidth;
  el.classList.add('play');
}

// ================= Race control =================
function startRace(quick) {
  // guard: a focused start/retry button turns every Space-release into a
  // synthetic click — never let that restart a race in progress
  if (G.mode === 'countdown' || G.mode === 'racing') return;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  // a race can never start "under" the cinematic intro — kill it silently
  if (INTRO.active) {
    INTRO.active = false;
    hideIntroLandmarks();
    hideWinsenIntroCard();
    document.getElementById('cinebars').classList.remove('on');
    document.getElementById('controlsBtn').style.display = ''; // hidden during the intro — see index.html
  }
  initAudio();
  stopResultTicker(); // never let a rotating ticker survive into the next race
  setMusicDucked(true); // theme plays on menus/results only — silent through the race itself
  setSeagullScene('race'); // seagulls are a pre-race/result ambience — silent through countdown+racing
  hornSound(); // a ship's horn cast-off signal, right as the countdown begins
  G.mode = 'countdown';
  G.speed = 0; G.heading = 0; G.x = 0; G.z = 0;
  G.time = 0; G.balls = 0; G.perfect = 0; G.strokes = 0;
  G.boost = 0; G.stunned = 0;
  // quick restart: grinders skip the long ceremony (first race keeps 3.6 s)
  G.countdownT = quick === true ? 1.6 : 3.6;
  G.lastCd = 4;
  G.lastStrokeAt = -9; G.strokePhase = 0;
  G.charging = false; G.charge = 0; G.driveT = 0;
  G.meterReleaseT = -1; // Regel 1 — a leftover release snapshot must never bleed into the next race
  G.reach = -0.12; G.dip = 0; G.driveFrom = -1;
  G.combo = 0; G.bar = 0; G.hitStop = 0; G.fovPunch = 0;
  G.cbHalf = false; G.cbSprint = false; G.cbLandmark = false; G.lastLead = true;
  bloomPulse = 0; // Regel 1 — a landmark/turbo flash must never bleed into the next race
  fbLockUntil = 0;
  shakeAmt = 0; // Regel 3 — leftover camera-shake from a hit right at the finish must not bleed into the next race
  updateComboBadge();
  hud.boostGlow.style.opacity = 0;
  document.querySelectorAll('.confetti').forEach((el) => el.remove());
  stopVoyageDust(); // never let the Voyage Complete dust loop survive into a new/reset race
  // Fase 3c: build the right course BEFORE the per-race resets below touch it
  const raceStage = ensureCourseForMode();
  if (raceStage) {
    // Norwegian chapter card ("ETAPPE N AV 5 / NAVN") — the mood crossfade
    // from ensureCourseForMode() lands underneath it, and a whoosh + crowd
    // swell + camera punch make each leg open like a chapter, not a menu
    showStageChapter(raceStage);
    whoosh();
    crowd();
    G.fovPunch = 1.4;
    // Fase 3e: derive from the course actually being raced (not a fresh
    // currentStage(voyage.total) lookup) — "Ro etappe N igjen" forces a stage
    // via forceStageId that may already be behind the live voyage.total
    G.stageAtRunStart = raceStage.id;
  } else {
    G.stageAtRunStart = 0; // Kapproing — unused
  }
  G.stageChangedThisRun = false;
  for (const c of course.collectibles) c.taken = false; // instanced visuals follow `taken` in updateCourse
  for (const o of course.obstacles) o.hit = false;
  for (const g of course.gates) { g.passed = false; g.missed = false; g.missFlashUntil = 0; g.rivalDone = false; g.rivalAim = undefined; }
  // Fase 4a: per-race mission flags + this race's letter (Regel 1)
  G.hitIce = false;
  G.reachedMaxThisRace = false;
  G.penaltyS = 0; // Portstraff — recomputed fresh in finishRace() (KAPPRO only)
  spawnLetterForRace();
  // Spawn the two boats on opposite sides of gate 1's opening: player just LEFT
  // of centre, rival just RIGHT, each lined up with its own half so a straight
  // pull splits the gate and the hulls never cross.
  const gate1 = course.gates[0];
  if (gate1) G.x = gate1.x - GATE1_LANE;
  // rival reset
  R.x = gate1 ? gate1.x + GATE1_LANE : 0; R.z = 0; R.speed = 0; R.heading = 0; R.finishTime = null;
  R.aimOff = GATE1_LANE; R.wobble = 0; R.bomT = 0;
  // force gate 1's rival line to the RIGHT half (skip the occasional blunder here)
  if (gate1) gate1.rivalAim = GATE1_LANE;
  bomSprite.visible = false;
  G.steer = 0;
  // auto-aim toward the right side of gate 1 — a new player shouldn't have
  // to steer AND row before their stroke has settled. Latches off for good
  // the moment the player touches the helm, or once gate 1 is resolved.
  G.autoAim = true;
  // tempo drum reset
  T.phase = 0; T.period = DRUM_PERIOD_SLOW; T.lastRoAt = -9; T.speedEase = 0;
  T.hitL = 0; T.hitR = 0; T.maxAnnounced = false; T.roVoiceFired = false; T.energy = 0;
  // pendulum FX buffers (Regel 1 — leftover trail/splash must not bleed in)
  PEND.trail.length = 0; PEND.splash.length = 0; PEND.flash = 0;
  PEND.side = 1; PEND.displayA = BOB_MAXA; // every race starts pulling from the right
  // blade entry/exit watcher (Regel 1) — an intro/menu stroke that ended
  // mid-water must not suppress (or double) the first catch splash of the race
  OARFX.ship.wasIn = false;
  OARFX.rival.wasIn = false;
  // Phase-align the drum so the GRAB donk (phase 0.55) lands exactly at GO:
  // the pre-race metronome counts the crew in, and "grip at GO, release on
  // the first RO!" becomes a guaranteed perfect first stroke (no dead time).
  // Works for both the 3.6s and 1.6s (quick restart) countdowns since it's
  // computed from the actual countdown length, not a fixed constant. Uses
  // the AT-REST period — energy is 0 for the whole countdown (no strokes),
  // so the drum sits exactly at DRUM_PERIOD_SLOW the entire time (T.period
  // is reset to it above too, so there's no easing transient to account for).
  T.phase = ((0.55 - G.countdownT / DRUM_PERIOD_SLOW) % 1 + 1) % 1;
  G.resultStage = 0;
  G.lastBumpAt = -9;
  G.ghostRec = [];
  G.ghostSampleT = 0;
  loadGhostForRace(); // also resets GH.idx / phase / lead
  // Fase 3c: the best-time ghost was recorded on the DAILY course — replaying
  // it on a different-length voyage stage would desync, so hide it there
  if (G.gameMode === 'voyage' && GH.ship) GH.ship.visible = false;
  // Fase 2: C.idx/phase reset every race (Regel 1), but C.active/alias/time/
  // track persist across restarts so a rematch stays against the SAME ghost.
  C.idx = 0;
  C.phase = 0;
  if (C.active) {
    if (C.ship) C.ship.visible = true;
    if (GH.ship) GH.ship.visible = false; // two hologram boats at once reads as clutter — local ghost yields to the duel
  } else if (C.ship) {
    C.ship.visible = false;
  }
  // Settings "Hide ghost ship" — a final override on top of the precedence
  // above, never changes WHICH ghost would be shown, only whether either is.
  if (hideGhostPref) {
    if (GH.ship) GH.ship.visible = false;
    if (C.ship) C.ship.visible = false;
  }
  clearFireworks();
  R.pace = 11.0 + Math.random() * 0.6; // beatable with steady rhythm + turbo footballs
  hud.startScreen.classList.add('hidden');
  hud.resultScreen.classList.add('hidden');
  hud.stageInterludeScreen.classList.add('hidden'); // Fase 3e — Regel 1
  hud.howtoScreen.classList.add('hidden');
  hud.lbScreen.classList.add('hidden');
  hud.challengeScreen.classList.add('hidden');
  hud.voyageScreen.classList.add('hidden');
  hud.missionsScreen.classList.add('hidden');
  stopOarDemo(); // Space can jump straight from the how-to screen into the race, skipping goBtn
  hud.topbar.style.display = 'flex';
  hud.meterWrap.style.display = 'block';
  initPendulum(); // NOW the canvas has a real layout size (the wrapper was display:none at boot)
  hud.touchControls.classList.add('active');
  logoFX.stop(); // the menu FX loops never run during the race itself
  shieldFX.stop();
  howtoFX.stop();
  voyageDoneFX.stop();
  G.paused = false;
  hud.confirmScreen.classList.add('hidden');
  hud.restartBtn.style.display = 'flex';
  // reset HUD readouts immediately (they only tick during racing)
  hud.time.textContent = fmtTime(0);
  hud.speed.innerHTML = `0 <small>km/h</small>`;
  hud.balls.textContent = '0';
  // Stage 5 ("THE VOYAGE HOME"): a short cinematic pan around the ship shows
  // off the trophy on deck before the real countdown starts, instead of the
  // usual hard camera snap — see TROPHY_PAN/runTrophyPanCamera above. Every
  // other race/stage keeps the normal instant snap.
  if (G.gameMode === 'voyage' && raceStage && raceStage.id === FINAL_STAGE_ID) {
    TROPHY_PAN.active = true;
    TROPHY_PAN.t = 0;
  } else {
    // snap chase camera behind the start line
    camPos.set(0, 15.5, 27);
  }
}

// ---- bail out of a race back to the splash screen (from the pause/confirm dialog) ----
function returnToMenu() {
  G.mode = 'menu';
  setMusicDucked(false);
  setSeagullScene('menu');
  G.paused = false;
  G.speed = 0; G.heading = 0; G.x = 0; G.z = 0;
  G.charging = false; G.charge = 0; G.driveT = 0; G.meterReleaseT = -1;
  G.reach = -0.12; G.dip = 0; G.driveFrom = -1;
  G.strokePhase = 0; G.lastStrokeAt = -9;
  G.combo = 0; updateComboBadge();
  hud.boostGlow.style.opacity = 0;
  document.querySelectorAll('.confetti').forEach((el) => el.remove());
  stopVoyageDust(); // never let the Voyage Complete dust loop survive into a new/reset race
  voyageDoneFX.stop(); // ditto its shine sweep — only reachable from Voyage Complete's own Menu button
  clearFireworks();
  R.x = 14; R.z = 0; R.speed = 0; R.heading = 0; R.finishTime = null;
  bomSprite.visible = false;
  // Fase 2: leaving to the main menu fully exits challenge mode (rematches
  // only stay "live" across in-race restarts, per Regel 1)
  C.active = false; C.alias = ''; C.time = 0; C.track = null; C.idx = 0; C.phase = 0;
  if (C.ship) C.ship.visible = false;
  hud.confirmScreen.classList.add('hidden');
  hud.resultScreen.classList.add('hidden');
  hud.voyageScreen.classList.add('hidden'); // was never reachable from here before — Voyage Complete's own Menu button needs it hidden too
  hud.stageInterludeScreen.classList.add('hidden'); // Fase 3e
  hud.topbar.style.display = 'none';
  hud.meterWrap.style.display = 'none';
  hud.touchControls.classList.remove('active');
  hud.restartBtn.style.display = 'none';
  hud.startScreen.classList.remove('hidden');
  logoFX.reveal();
  shieldFX.reveal();
  // snap chase camera behind the start line, same as a fresh intro hand-off
  camPos.set(0, 15.5, 27);
}

// ================= Result redesign: Row Race reward ticker =================
// Placement is the hero now (see finishRace()'s kapp branch) — the old
// always-on "1:24.6 · best 1:22.1 · ⚽ 12 · 18 perfect" line is replaced by a
// single rotating message so it doesn't compete for attention. Every message
// is grounded in the REAL score breakdown (computeScore()'s fields) — no
// invented point values for things the scoring model doesn't actually track.
// isRecord's own moment lives in #newBestBadge now (see finishRace()) — no
// longer a 4th parameter here duplicating it as a ticker message.
function buildTickerMessages(run, gatesPassed, sc) {
  const msgs = [];
  if (run.perfect > 0) msgs.push(`🔥 +${sc.perfectPts.toLocaleString('en-US')} Perfect strokes bonus`);
  if (run.balls > 0) msgs.push(`⚽ +${sc.ballPts.toLocaleString('en-US')} Footballs bonus`);
  if (gatesPassed > 0) msgs.push(`🚩 +${sc.gatePts.toLocaleString('en-US')} Gates bonus`);
  if (run.win) msgs.push('🇳🇴 Beat Sweden\'s ghost!');
  if (G.penaltyS > 0) {
    msgs.push(`⚠️ +${G.penaltyS.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}s gate penalty`);
  }
  msgs.push(`⏱ Finished in ${fmtTime(run.time)}`); // always at least one message
  return msgs;
}
let tickerTimer = null;
function startResultTicker(messages) {
  stopResultTicker();
  let i = 0;
  const show = () => {
    hud.resultTicker.classList.remove('tickerIn');
    void hud.resultTicker.offsetWidth; // restart the fade-in animation
    hud.resultTicker.textContent = messages[i];
    hud.resultTicker.classList.add('tickerIn');
    i = (i + 1) % messages.length;
  };
  show();
  if (messages.length > 1) tickerTimer = setInterval(show, 2600);
}
// Always called before a new race starts (see startRace()) — a stray interval
// surviving across races is the exact "leaked setInterval" bug class this
// project has hit before (see LÆRDOMMER.md).
function stopResultTicker() {
  if (tickerTimer) { clearInterval(tickerTimer); tickerTimer = null; }
}

function finishRace() {
  G.mode = 'finished';
  setMusicDucked(false);
  setSeagullScene('result');
  G.finishT = 0;
  hud.boostGlow.style.opacity = 0;
  whistle();
  setTimeout(crowd, 350);
  // this run's track, sealed at the finish line, regardless of record status —
  // challenge links (Fase 2) upload THIS, independent of the best-time ghost
  // below (which only updates on a record).
  GH.lastTrack = G.ghostRec.concat([[+G.time.toFixed(2), +G.x.toFixed(2), +G.z.toFixed(2), +G.heading.toFixed(3)]]);
  // Portstraff: KAPPRO only — REISEN never applies a penalty. rawTime is kept
  // separate (used only for the signed remote submission, see saveScore());
  // everything else from here on uses G.time WITH the penalty already baked
  // in, exactly like any other race time (records, display, local board).
  const rawTime = G.time;
  const missedGates = G.gameMode === 'kapp' ? course.gates.filter((g) => g.missed && !g.passed).length : 0;
  G.penaltyS = missedGates * GATE_MISS_PENALTY_S;
  G.time += G.penaltyS;
  const best = parseFloat(localStorage.getItem(BEST_KEY) || 'Infinity');
  // Fase 3c: best time + its ghost belong to the daily KAPPRO course — a
  // voyage stage has a different length, so its times never count as records
  const isRecord = G.gameMode === 'kapp' && G.time < best;
  if (isRecord) {
    localStorage.setItem(BEST_KEY, String(G.time));
    // save this run as the new ghost (final sample seals the finish line)
    G.ghostRec.push([+G.time.toFixed(2), +G.x.toFixed(2), +G.z.toFixed(2), +G.heading.toFixed(3)]);
    try { localStorage.setItem(GHOST_KEY, JSON.stringify(G.ghostRec)); }
    catch { /* storage full — keep the old ghost */ }
  }
  const beatSweden = R.finishTime === null || G.time <= R.finishTime;
  hud.resTime.textContent = fmtTime(G.time);
  // score + placement — stage 1 of the result flow:
  // fireworks + "you placed Nth" + name entry; leaderboard and retry come after
  const gatesPassed = course.gates.filter((g) => g.passed).length;
  G.lastRun = {
    time: G.time, rawTime, missedGates,
    balls: G.balls, perfect: G.perfect, gates: gatesPassed, win: beatSweden,
  };
  G.lastRunSaved = false;
  G.resultStage = 1;
  const sc = computeScore(G.lastRun);
  // resScore holds just the number — the "Pts" unit is static markup beside
  // it (#resCardPtsLabel) so the stat card can show it as a smaller
  // baseline-aligned suffix, per the result-card redesign.
  hud.resScore.textContent = sc.total.toLocaleString('en-US');
  hud.resRank.textContent = '—'; // filled in per-mode below (some paths resolve async)
  // every course is laid out so the FULL chain of balls is collectable in one
  // run (see the reachability post-pass in world.js) — showing x/total makes
  // that a visible goal; gold when the player got them all
  const ballsTotal = course.collectibles.length;
  hud.resBalls.textContent = `${G.balls}/${ballsTotal}`;
  hud.resBalls.classList.toggle('allBalls', ballsTotal > 0 && G.balls >= ballsTotal);
  hud.newBestBadge.classList.add('hiddenMsg'); // shown only where a record actually happened

  // Fase 3: Atlanterhavsferden — every COMPLETED VOYAGE race credits the
  // voyage (never on a restart/abort — this is the only call site). Row
  // Race (kapp) is a fully separate score-chasing mode with its own daily
  // leaderboard — it must never silently advance voyage/mission/letter
  // progress in the background, or a Row Race-only player would find their
  // "Bring Home the Trophy" voyage further along than any voyage run they
  // actually played.
  const wasTrophyCarrier = voyage.trophy;
  // Fase 3e: the stage this run was ACTUALLY played on — G.stageAtRunStart
  // (set in startRace() from the course that was really built), not a fresh
  // currentStage(voyage.total) lookup, which would be wrong after "Ro etappe
  // N igjen" forces an earlier stage than the live total suggests.
  const stageBeforeRun = VOYAGE_STAGES.find((s) => s.id === G.stageAtRunStart) || VOYAGE_STAGES[0];
  const allCrossedMilestones = [];
  let completedMissions = [];
  let letterSetComplete = false;
  let voyageGained = 0; // metres this run banked — read by the voyage result ticker below
  if (G.gameMode === 'voyage') {
    const { gained, crossedMilestones, voyage: voyageAfter } = creditRun({ balls: G.balls, distance: -course.finishZ });
    voyage = voyageAfter;
    voyageGained = gained;
    allCrossedMilestones.push(...crossedMilestones);
    // the +m line lives in the reward ticker now (see the voyage branch below)

    // Fase 4a: missions — evaluated fresh every completed voyage race
    const { completed } = recordRun({
      balls: G.balls, perfect: G.perfect, gates: gatesPassed, win: beatSweden,
      hitIce: !!G.hitIce, reachedMax: !!G.reachedMaxThisRace, distance: -course.finishZ,
    });
    completedMissions = completed;
    for (const m of completedMissions) {
      const bonus = creditBonus(MISSION_REWARD_M);
      voyage = bonus.voyage;
      allCrossedMilestones.push(...bonus.crossedMilestones);
    }

    // Fase 4a: letter hunt — commit the pickup ONLY now (Regel 1: before this,
    // a pickup is just G.letterTaken, discarded by a mid-race restart)
    if (G.letterTaken) {
      const result = collectLetter(LETTER.char);
      if (result.complete) {
        letterSetComplete = true;
        const bonus = creditBonus(ROWAY_REWARD_M);
        voyage = bonus.voyage;
        allCrossedMilestones.push(...bonus.crossedMilestones);
      }
    }
    // mission/letter banners no longer shown on the stage result screen —
    // the voyage-distance rewards above still apply silently
  }

  // Fase 3e: final stage/total AFTER every credit this result gives (race
  // distance + missions + letters) — this, not just the race distance alone,
  // is what decides whether the stage interlude shows a crossing or not.
  const stageAfterRun = currentStage(voyage.total);
  const stageChanged = stageAfterRun.id !== stageBeforeRun.id;
  G.stageChangedThisRun = stageChanged;
  const trophyJustArrived = !wasTrophyCarrier && voyage.trophy;

  // stage-complete juice: screen shake + speed streak (chromatic aberration
  // spike that eases itself back down) + a rising three-ding fanfare + a
  // burst of Norwegian-palette fireworks over the finish. Only on a REAL
  // crossing — replaying an old stage just gets the normal finish.
  if (G.gameMode === 'voyage' && stageChanged) {
    shakeAmt = 1.1;
    finishPass.uniforms.uAberration.value = 1.5; // decays toward speedK in the camera block
    setTimeout(() => ding(1.1), 60);
    setTimeout(() => ding(1.35), 260);
    setTimeout(() => ding(1.65), 470);
    for (let i = 0; i < 3; i++) {
      setTimeout(() => spawnFireworkBurst(
        G.x + (Math.random() - 0.5) * 90, 8 + Math.random() * 10, G.z - 40 - Math.random() * 60,
        FW_COLORS[(Math.random() * FW_COLORS.length) | 0], 45, i === 0,
      ), i * 260);
    }
  }

  // the trophy milestone is the narrative turning point — its own bigger
  // message instead of the generic "DU PASSERTE ..." banner
  hud.voyageMilestones.innerHTML = allCrossedMilestones
    .map((ms) => ms.m === VOYAGE_OUT_M
      ? '<div class="milestoneBanner milestoneBannerTrophy">🏆 THE TROPHY IS ABOARD<br>— ROW IT HOME TO THE HOMELAND!</div>'
      : `<div class="milestoneBanner">${ms.emoji} YOU PASSED ${ms.name.toUpperCase()}!</div>`)
    .join('');
  if (allCrossedMilestones.length || completedMissions.length || letterSetComplete) crowd();
  // the trophy milestone gets its own extra burst on top of the usual finish fireworks
  if (trophyJustArrived) {
    for (let i = 0; i < 5; i++) {
      setTimeout(() => spawnFireworkBurst(
        G.x + (Math.random() - 0.5) * 200, 10 + Math.random() * 16, G.z - 60 - Math.random() * 120,
        FW_COLORS[(Math.random() * FW_COLORS.length) | 0], 80,
      ), i * 220);
    }
  }
  // completing the full R-O-W-A-Y set is just as big a moment — its own burst
  if (letterSetComplete) {
    for (let i = 0; i < 6; i++) {
      setTimeout(() => spawnFireworkBurst(
        G.x + (Math.random() - 0.5) * 200, 10 + Math.random() * 16, G.z - 60 - Math.random() * 120,
        FW_COLORS[(Math.random() * FW_COLORS.length) | 0], 80,
      ), i * 200);
    }
  }
  // the trophy just went from "not on deck" to "on deck" (or "carried home") —
  // flip the mesh live, no reload/rebuild needed
  if (shipData.trophyMesh) shipData.trophyMesh.visible = voyage.trophy;
  // Fase 3b: the leaderboard only applies to Kapproing — a Reisen run has no
  // rank and nothing to save, so it skips straight to a "stage 2"-equivalent
  // (retry/challenge ready, no name-entry prompt).
  if (G.gameMode === 'kapp') {
    pendingInterlude = null; // Fase 3e: the stage bridge is voyage-only
    // placement vs. TODAY's board (cached estimate now; saveScore() below
    // refreshes it and overwrites this with the authoritative server rank
    // once the round-trip completes). fetchGlobal() (no args) still runs to
    // warm the all-time board cache other UI reads (e.g. the leaderboard
    // modal's All-time tab) — just no longer to compute a rank for display.
    fetchGlobal(DAILY_KEY);
    fetchGlobal();
    const rank = loadCachedDaily().filter((e) => e.score > sc.total).length + 1;
    // Result-card redesign: the headline just names the moment now — the
    // actual rank number lives in the card's RANK stat instead of the old
    // giant "1ST TODAY" hero text, so it isn't shown twice. KAPPRO has no
    // stage concept, so #stageNameBanner (voyage-only) stays hidden here.
    hud.placeBanner.textContent = 'RACE COMPLETED';
    hud.stageNameBanner.classList.add('hiddenMsg');
    // cached estimate; saveScore() below overwrites this with the
    // authoritative server rank once that round-trip completes.
    hud.resRank.textContent = `#${rank}`;
    hud.newBestBadge.classList.toggle('hiddenMsg', !isRecord);
    startResultTicker(buildTickerMessages(G.lastRun, gatesPassed, sc));
    // savedMsg belongs to voyage's own flow now — just defensively hide any
    // stale text a previous voyage run left showing.
    hud.savedMsg.classList.remove('show');
    // Trimmed further: the match-result chip and mission-completion banner
    // both competed with the placement hero — gone from this view.
    hud.resultTitle.classList.add('hiddenMsg');
    hud.stageContext.classList.add('hiddenMsg');
    voyageStageContextReady = false;
    hud.voyageRankBanner.classList.add('hiddenMsg');
    hud.voyageLbWrap.classList.add('hiddenMsg');
    hud.repeatStageBtn.style.display = 'none';
    hud.nextStageBtn.style.display = 'none';
    hud.challengeMsg.classList.add('hiddenMsg');
    hud.challengeLinkScreen.classList.add('hidden');
    // Row Race: claiming your place is the only path off this screen now —
    // no side-door back to the menu before that (voyage-stage result below
    // keeps it, since a voyage run never gates progress behind a name claim)
    hud.resultMenuBtn.style.display = 'none';
    // Leaderboard name entry: EVERY finish shows the claim step — the field
    // is pre-filled with the name saved last time (editable per race), empty
    // for a first-time finisher. Claiming is always an explicit action; the
    // old silent auto-save for returning players was retired by request.
    // See setResultNameState() for what's visible in each state.
    hud.aliasInput.value = isValidName(localStorage.getItem(ALIAS_KEY)) || '';
    setResultNameState('enterName');
    // don't pop the mobile keyboard on an unrequested screen transition —
    // desktop players get the convenience of landing in the field already
    if (!IS_TOUCH) hud.aliasInput.focus({ preventScroll: true });
  } else {
    // ===== Reisen result, race-mode layout: hero placement + stage points +
    // rotating reward ticker. Main message: "STAGE 1/5 COMPLETED · 21st
    // place so far · 11,212 Pts" — the "so far"/stage placements fill in
    // async from the server's per-stage boards (applyVoyageStageRanks).
    hud.resultTitle.classList.add('hiddenMsg'); // same single-hero focus as Race
    // the stage NAME is its own small pill above the headline now; the
    // headline itself just says "COMPLETED" (no more "STAGE N/5" prefix).
    hud.stageNameBanner.classList.remove('hiddenMsg');
    hud.stageNameBanner.textContent = stageBeforeRun.name;
    hud.placeBanner.textContent = 'COMPLETED';
    hud.saveRow.style.display = 'none';
    hud.skipSaveBtn.style.display = 'none';
    hud.resultMenuBtn.style.display = ''; // Row Race hides this above; a voyage-stage result always keeps it
    hud.lbResultWrap.style.display = 'none';
    hud.viewFullLbBtn.style.display = 'none';
    // "Ro igjen" reads as "repeat this run" — voyage mode replaces retryBtn
    // with two purpose-built buttons instead (Fase 3e).
    hud.retryBtn.style.display = 'none';
    hud.repeatStageBtn.style.display = '';
    hud.repeatStageBtn.textContent = `Row stage ${stageBeforeRun.id} again`;
    hud.nextStageBtn.style.display = '';
    hud.nextStageBtn.textContent = stageChanged ? `Row stage ${stageAfterRun.id}` : 'Row on';
    // record best time + points BEFORE the totals below are read, so this
    // run's banked score is already included (the record call inside
    // maybeSubmitStageResult is synchronous; only the submission awaits)
    if (stageBeforeRun.id === FINAL_STAGE_ID) {
      // C3: the homecoming is rowed ONCE — the first completed run is final.
      const firstCompletion = !isStageFinal(FINAL_STAGE_ID);
      if (firstCompletion) {
        markStageFinal(FINAL_STAGE_ID);
        recordStageBest(FINAL_STAGE_ID, Math.round(G.time * 1000), sc.total); // the ONE final time, pending submit
        // C4: ask for a name before the one-shot submission — same alias
        // field/save button as KAPPRO (saveScore routes to saveVoyageFinal).
        // CLAIMING IS THE ONLY ACTION on this screen (per request): no skip,
        // no menu buttons — the trophy moment deserves a clean single step,
        // and saveVoyageFinal() hands off to the Ullevaal finale by itself.
        hud.saveRow.style.display = 'flex';
        hud.skipSaveBtn.style.display = 'none';
        hud.nextStageBtn.style.display = 'none';
        hud.resultMenuBtn.style.display = 'none';
        hud.savedMsg.classList.remove('show');
      } else {
        // (defensive — stage 5 can't normally be re-rowed once final)
        hud.nextStageBtn.textContent = 'Back to menu'; // continueFromResult routes there when final
      }
      // no replays, no "row on" into another stage-5 run — the journey is done
      hud.repeatStageBtn.style.display = 'none';
      // this is always a first/only completion — a "new best" badge would
      // read oddly for a one-shot event, so it stays hidden here (default).
    } else {
      // NEW BEST TIME badge: check against the OLD stage best BEFORE
      // maybeSubmitStageResult (fire-and-forget below) records this run over it
      hud.newBestBadge.classList.toggle('hiddenMsg', !isStageBest(stageBeforeRun.id, Math.round(G.time * 1000)));
      maybeSubmitStageResult(stageBeforeRun.id, G.time, sc.total);
    }
    // small secondary line under the card: "Nth on this stage", appended by
    // applyVoyageStageRanks once the boards arrive — the stage NAME itself
    // lives in #stageNameBanner above. Every stage starts with an empty base
    // and stays hidden until the per-stage rank actually arrives (no bare
    // placeholder line). The old stage-5 "rowed once — this time is final"
    // caveat is gone (per request): the screen said it implicitly already —
    // no repeat button — and the claim step needs to stay uncluttered.
    voyageStageContextBase = '';
    voyageStageContextReady = true;
    hud.stageContext.textContent = voyageStageContextBase;
    hud.stageContext.classList.toggle('hiddenMsg', !voyageStageContextBase);
    // rotating reward ticker, same engine as Race, with the voyage's own
    // achievements (metres banked + banked total) leading the rotation
    startResultTicker([
      `⛵ +${Math.round(voyageGained).toLocaleString('en-US')} m on the voyage`,
      `⛵ Voyage total ${voyageScoreTotal().toLocaleString('en-US')} Pts`,
      ...buildTickerMessages(G.lastRun, gatesPassed, sc),
    ]);
    // REISEN server leaderboard: G.time here is a clean stage time (no
    // Portstraff penalty in voyage mode) — fire-and-forget, never awaited in
    // the frame loop; fills the placements + (when complete) the combined
    // banner/board once results are known.
    renderVoyageRankBanner();
    // Fase 3c: challenge links replay on the DAILY course — a voyage-stage
    // track has a different length and wouldn't line up, so no sharing here
    hud.challengeBtn.style.display = 'none';
    hud.challengeMsg.classList.add('hiddenMsg');
    hud.challengeLinkScreen.classList.add('hidden');
    G.resultStage = 2; // nothing to save — Space/R can restart right away
    // Fase 3e: nextStageBtn/Space route through the stage bridge only when a
    // crossing happened (see continueFromResult()) — this is the ONLY place
    // pendingInterlude gets (re)populated for a fresh result.
    pendingInterlude = {
      stageBefore: stageBeforeRun, stageAfter: stageAfterRun,
      stageChanged, trophyJustArrived,
    };
  }
  fwTimer = 0.2; // light the fuse

  hud.resultTitle.textContent = beatSweden ? '🇳🇴 NORWAY 1 – 0 SWEDEN 🇸🇪' : '🇸🇪 SWEDEN WON… 🇳🇴';

  // Fase 2: duel outcome — only when this run was against a challenge link.
  // Never auto-submitted to the leaderboard; the name-field save above works
  // exactly as it does outside a duel.
  if (C.active) {
    const won = G.time < C.time;
    hud.duelResult.textContent = won
      ? `You beat ${C.alias}! ${fmtTime(G.time)} vs ${fmtTime(C.time)}`
      : `${C.alias} won — ${fmtTime(C.time)} vs ${fmtTime(G.time)}. Rematch?`;
    hud.duelCard.classList.remove('hiddenMsg');
  } else {
    hud.duelCard.classList.add('hiddenMsg');
  }

  setTimeout(() => {
    // this cleanup is safe regardless of what's showing now — always run it
    hud.topbar.style.display = 'none';
    hud.meterWrap.style.display = 'none';
    hud.touchControls.classList.remove('active');
    // restartBtn deliberately STAYS visible: the result screen keeps the
    // top-right restart control (per request) so "row this race again from
    // the start" is always one tap away, next to the controls button. It
    // hides on returnToMenu() and on the voyage-done handoff below.
    // Fase 3e: Space can advance past this result as early as finishT > 1.2s
    // (see the keydown handler) — slightly before this 1.4s reveal fires. If
    // that already opened the stage interlude (or started a new race), don't
    // clobber it by force-showing the result screen underneath.
    if (G.mode !== 'finished' || !hud.stageInterludeScreen.classList.contains('hidden')) return;
    hud.resultScreen.classList.remove('hidden');
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
    el.addEventListener('animationend', () => el.remove()); // don't linger once it's faded out
    // own fixed+clipped layer, NOT a child of #resultScreen (a .screen, which
    // has overflow-y:auto) — see #confettiLayer's comment in index.html
    $('confettiLayer').appendChild(el);
  }
}

// Voyage Complete finale: staggered fade/zoom/pop-in for the photo, wordmark
// and stats row — see the .voyageDoneAnim keyframes in index.html. Same
// self-terminating-animation idiom as showStageChapter()'s chapterCard
// (Regel 9): remove the class, force a reflow, re-add it, so a replayed
// voyage (Start New Voyage → finish again) always gets a fresh play instead
// of silently no-op'ing because the class was already there from last time.
function playVoyageDoneEntrance() {
  const els = [hud.voyageDoneImg, hud.voyageDoneHeaderImg, hud.voyageDoneStats];
  els.forEach((el) => el.classList.remove('voyageDoneAnim'));
  void hud.voyageDoneWrap.offsetWidth;
  els.forEach((el) => el.classList.add('voyageDoneAnim'));
}

// Voyage Complete finale: ambient sparkle motes drifting gently over the
// trophy photo — unlike spawnConfetti() above (a one-shot falling burst),
// these loop forever (CSS animation-iteration-count:infinite) until
// stopVoyageDust() clears them. Appended into #voyageDoneWrap itself, which
// is already position:absolute + overflow:hidden and full-bleed over this
// one screen — same "own clipped layer" reasoning as #confettiLayer, just
// scoped to this screen instead of the whole viewport, so drift can never
// grow #voyageScreen's own scrollable content area.
function spawnVoyageDust() {
  stopVoyageDust(); // never stack a fresh batch on top of a leftover one
  for (let i = 0; i < 22; i++) {
    const el = document.createElement('div');
    el.className = 'voyageDust';
    el.style.left = Math.random() * 100 + '%';
    el.style.top = 20 + Math.random() * 70 + '%';
    const size = 3 + Math.random() * 5;
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.animationDuration = (6 + Math.random() * 6) + 's';
    el.style.animationDelay = -(Math.random() * 12) + 's'; // negative: already mid-cycle on frame 1, not all born together
    hud.voyageDoneWrap.appendChild(el);
  }
}
function stopVoyageDust() {
  document.querySelectorAll('.voyageDust').forEach((el) => el.remove());
}

// world-space position of an oar blade tip (for splashes and churn) — reads
// the innermost (feather) pivot's matrixWorld so dip AND the blade-feather
// rotation (see poseStroke in ship.js) are both accounted for, not just the
// outer sweep rotation the old single-pivot shortcut used.
const _bladeV = new THREE.Vector3();
function bladeWorld(boat, oar) {
  oar.featherPivot.updateWorldMatrix(true, false);
  _bladeV.set(oar.side * 4.2, 0, 0).applyMatrix4(oar.featherPivot.matrixWorld);
  return _bladeV;
}

// ---- blade entry/exit water FX (Del 2/4) ----
// Watches the ACTUAL dip value that posed each boat this frame — player
// input, menu idle loop, cinematic-intro bot rowing and the rival's AI
// cadence all flow through the same watcher, so splashes fire wherever a
// rowing animation runs, not just on player strokes. Hysteresis (in past
// 0.5, out below 0.35) debounces the surface crossing. Both `wasIn` flags
// are per-run state and reset in startRace() (Regel 1).
const OARFX = {
  ship: { wasIn: false },
  rival: { wasIn: false },
};
// entry: a quick dome/ring of droplets + a brief foam patch hugging the
// surface at every blade; exit: a lighter dripping trail as the blades lift.
// Positions come from bladeWorld() per oar (sweep+dip+feather all included).
// audioVol > 0 plays the real oarSplash() sample scaled by entry power —
// muted automatically with the SFX bus, so the intro respects the toggle.
function stepOarWaterFX(fx, dip, boat, boatData, entryPower, audioVol, skipEntry = false) {
  const inWater = fx.wasIn ? dip > 0.35 : dip > 0.5;
  if (inWater === fx.wasIn) return;
  fx.wasIn = inWater;
  if (inWater) {
    if (skipEntry) return; // racing: executeStroke() already owns the catch splash
    for (const oar of boatData.oars) {
      const bp = bladeWorld(boat, oar);
      const wy = sampleWater(bp.x, bp.z, waterT).y;
      const n = 3 + Math.round(entryPower * 4);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.8; // ring of droplets
        const sp = 1.1 + Math.random() * 1.5;
        spawnParticle(
          bp.x + Math.cos(a) * 0.25, wy + 0.1, bp.z + Math.sin(a) * 0.25,
          Math.cos(a) * sp, 1.4 + Math.random() * 1.5 + entryPower * 1.5, Math.sin(a) * sp,
          0.4 + Math.random() * 0.2
        );
      }
      for (let i = 0; i < 2; i++) { // short-lived foam patch, stays low
        spawnParticle(
          bp.x + (Math.random() - 0.5) * 0.7, wy + 0.05, bp.z + (Math.random() - 0.5) * 0.7,
          (Math.random() - 0.5) * 0.5, 0.25, (Math.random() - 0.5) * 0.5,
          0.45 + Math.random() * 0.15
        );
      }
    }
    if (audioVol > 0) oarSplash(entryPower * audioVol);
  } else {
    for (const oar of boatData.oars) {
      const bp = bladeWorld(boat, oar);
      const wy = sampleWater(bp.x, bp.z, waterT).y;
      for (let i = 0; i < 2; i++) {
        spawnParticle(
          bp.x + (Math.random() - 0.5) * 0.5, wy + 0.25, bp.z + (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.7, 0.9 + Math.random() * 0.8, (Math.random() - 0.5) * 0.7,
          0.35 + Math.random() * 0.15
        );
      }
    }
  }
}

// ================= Rowing mechanic: hold to pull, release to drive =================
// meter feel-fix: capture the release snapshot BEFORE G.charge resets to 0,
// so the fill can hold/drain from the real release width instead of
// snapping straight to empty. Shared by the manual release and the
// held-too-long auto-release (both are "a stroke just resolved, show me
// where").
function captureMeterSnapshot(charge) {
  G.meterFrozenFill = Math.min(charge, CHARGE_VIS_MAX) / CHARGE_VIS_MAX;
  G.meterFrozenClass = charge > CHARGE_PERFECT_HI ? 'over' : (charge >= CHARGE_PERFECT_LO ? 'in-zone' : '');
  G.meterReleaseT = 0;
}

function beginCharge() {
  if (G.charging || G.paused) return;
  // always accept the hold — the charge only starts building once the
  // oars have recovered (see the accumulation gate in update)
  G.charging = true;
  G.charge = 0;
  G.meterReleaseT = -1; // a new stroke takes over the display immediately — cancel any in-progress snapshot
}

function releaseStroke() {
  if (!G.charging) return;
  G.charging = false;
  if (G.mode === 'racing' && !G.paused && G.charge > 0.02) {
    captureMeterSnapshot(G.charge);
    executeStroke(G.charge);
  }
  G.charge = 0;
}

function executeStroke(charge) {
  G.lastStrokeAt = G.time;
  G.strokes++;
  G.driveT = 0.55; // drive animation: oars sweep through the water
  G.driveFrom = G.reach; // sweep starts from wherever the windup got to

  let power, label, color;
  const isMilestone = (c) => c === 3 || c === 5 || c === 8 || (c >= 12 && c % 4 === 0);
  // Release grace: one display frame (~33ms) of slack past CHARGE_PERFECT_HI
  // so a release that's visually dead-on but lands a frame late (rAF jitter,
  // input latency) still reads as PERFECT. Approved as an explicit exception
  // to "never touch the charge constants" — the constants themselves are
  // untouched, only this one comparison gets a hair of forgiveness. The
  // in-zone/over CSS classes below still use the bare CHARGE_PERFECT_HI —
  // the grace is invisible, felt only in the outcome.
  const RELEASE_GRACE = 0.035;
  if (charge >= CHARGE_PERFECT_LO && charge <= CHARGE_PERFECT_HI + RELEASE_GRACE) {
    // power scales with how close the release lands to the window's dead
    // centre (1.0) — full 1.0 only right on the mark, tapering toward the
    // edges of the window instead of a flat max for anywhere "in the zone",
    // so precision actually matters ("closer to the middle, the better").
    //
    // The slope must be exactly 1.0 (not shallower): a stroke's true cycle
    // time is the 0.3s post-stroke cooldown + charge*CHARGE_TIME of holding,
    // so releasing at the window's LOW edge means shorter holds and MORE
    // strokes per second. With any slope < 1, that faster cadence more than
    // paid for the small per-stroke power loss, and riding the low edge
    // out-paced dead-centre releases in speed per second — a rhythm exploit.
    // At slope 1.0 the low side reduces to power = charge, which (against
    // the fixed 0.3s overhead) makes speed-per-second strictly maximal at
    // the centre, both per stroke AND per second.
    power = 1 - Math.abs(charge - 1.0);
    G.perfect++;
    G.combo++;
    // "N% - WORD!" everywhere (per request) — the % IS the real power just
    // earned, so it's an honest number, not decoration. The running streak
    // already has its own always-on readout (#comboBadge, "🔥 xN"), so the
    // per-stroke text doesn't repeat the count — milestones just get the
    // fire treatment (color + bracketing emoji) instead of more words.
    const pct = Math.round(power * 100);
    label = isMilestone(G.combo) ? `🔥 ${pct}% - PERFECT! 🔥` : `${pct}% - PERFECT!`;
    color = isMilestone(G.combo) ? '#ff9d2e' : '#ffd25e';
    hud.meter.classList.remove('perfectFlash');
    void hud.meter.offsetWidth;
    hud.meter.classList.add('perfectFlash');
    // clean release in the green zone → pendulum water splash, strength ∝ how
    // near the release was to charge 1.0 (the dead centre of the window)
    pendSplash(1 - Math.min(1, Math.abs(charge - 1.0) / 0.3));
    // rising pitch with the combo — audible reward ladder
    ding(1 + Math.min(G.combo, 12) * 0.05);
    bass([65.41, 65.41, 98.0, 82.41][G.bar % 4]);
    G.bar++;
    G.fovPunch = 1;
  } else if (charge > CHARGE_PERFECT_HI) {
    // continuous taper past the window instead of one flat value — a release
    // right at the edge is a near-miss (still 0.45), but holding on further
    // costs progressively more, bottoming out at the auto-release point
    // (CHARGE_OVER). Without this, just holding forever and letting the
    // stroke auto-fire was a guaranteed, zero-skill 0.45 — actually WORSE
    // than a deliberate near-miss, but better than a mediocre "BRA!" release,
    // making "never release, just hold" a viable no-timing strategy. Now the
    // worst thing you can do is hold past the window and let it auto-fire.
    const overAmt = Math.min(1, (charge - CHARGE_PERFECT_HI) / (CHARGE_OVER - CHARGE_PERFECT_HI));
    power = 0.45 - overAmt * 0.2;
    G.combo = 0;
    label = `${Math.round(power * 100)}% - LATE!`; color = '#ff9d9d';
  } else if (charge >= CHARGE_GOOD_LO) {
    // ALL sub-green releases share one rule: power proportional to how long
    // you actually held (capped at 0.45), instead of flat per-tier values.
    // Flat tiers were farmable — a blind ~0.5s tap rhythm landed in the flat
    // 0.35 "FOR TIDLIG" band over and over, and because shorter holds mean
    // more strokes per second, that mindless cadence reached ~93% of a
    // perfect rower's speed. Proportional power makes every early release
    // pay per second of hold, so no sub-green rhythm — fast spam, blind
    // tapping, or edge-of-BRA — can beat roughly half of a centred PERFECT's
    // rate. The tier labels stay: they tell the player WHY it was weak.
    power = Math.min(0.45, 0.5 * charge);
    G.combo = 0;
    label = `${Math.round(power * 100)}% - GOOD!`; color = '#9ecdfd';
  } else if (charge >= 0.18) {
    power = Math.min(0.45, 0.5 * charge);
    G.combo = 0;
    label = `${Math.round(power * 100)}% - EARLY!`; color = '#ff9d9d';
  } else {
    power = Math.min(0.45, 0.5 * charge);
    G.combo = 0;
    label = `${Math.round(power * 100)}% - WEAK!`; color = '#ff7a7a';
  }
  // crew energy: the drum answers the stroke — this is what drives the
  // speed cap (maxSpeed in update()).
  T.energy = Math.min(1, T.energy + power * ENERGY_PER_POWER);
  if (T.energy >= 0.999 && !T.maxAnnounced) {
    T.maxAnnounced = true;
    G.reachedMaxThisRace = true; // Fase 4a: unlike T.maxAnnounced this never resets mid-race on a crash
    showFeedback('🔥 MAX SPEED! 🔥', '#ff9d2e', true);
    crowd();
  }

  const boostMult = G.boost > 0 ? 1.35 : 1;
  const comboMult = 1 + Math.min(G.combo, 10) * 0.04; // up to +40% at 10-streak
  G.speed += power * 3.8 * boostMult * comboMult;
  updateComboBadge();
  showFeedback(label, color);
  kick(0.35 + power * 0.25); // the stroke IS the beat
  oarSplash(power);

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
  // pendulum swings back the other way — the next stroke pulls from the far end
  PEND.side = -PEND.side;
}

// ================= Main loop =================
let lastFrameT = performance.now();
let waterT = 0;

// Seat a hull on the wave surface: sample bow/stern/port/starboard and align
// the hull to the actual surface plane so water never pokes through the deck.
const BOAT_FREEBOARD = 1.0;
// Haaland's drum: advance the cycle, fire donks + RO!. Runs during BOTH
// countdown (pre-race metronome) and racing, so the crew never waits.
function updateDrum(dt) {
  const prevPhase = T.phase;
  // Crew energy: each stroke feeds the drum (executeStroke adds energy on
  // every stroke, scaled by its power), energy leaks away over time, and
  // the drum period eases toward whatever the current energy implies — the
  // drum CHASES the rower, it never gates anything (rule 7: rhythm is a
  // bonus, drum speed caps nothing). Runs during countdown too, harmlessly:
  // energy is 0 and stays 0 with no strokes happening.
  T.energy = Math.max(0, T.energy - ENERGY_DECAY * dt);
  if (T.energy < 0.999) T.maxAnnounced = false; // rearm so MAX SPEED can fire again next time
  // eased current boat speed — feeds chargeScale (see the pendulum block in
  // update()) so the bob's fill rate tracks what the player actually sees on
  // the speed HUD, not just crew energy (which saturates well before top speed).
  T.speedEase += (G.speed - T.speedEase) * Math.min(1, dt * 2.0);
  const e = T.energy * (2 - T.energy); // easeOutQuad — first strokes felt immediately
  const targetPeriod = DRUM_PERIOD_SLOW + (DRUM_PERIOD_FAST - DRUM_PERIOD_SLOW) * e;
  T.period += (targetPeriod - T.period) * Math.min(1, dt * 2.0);
  T.phase += dt / T.period;
  // pitch rises with energy — the drum sounds eager, not just faster
  const pitchMult = 1 + T.energy * 0.12;
  if (prevPhase < 0.55 && T.phase >= 0.55) { donk(0.55, pitchMult); T.hitL = 0.22; }
  if (prevPhase < 0.78 && T.phase >= 0.78) { donk(0.62, pitchMult); T.hitR = 0.22; }
  // RO_LEAD_S: speechSynthesis has startup latency — fire the utterance
  // early so the spoken "RO!" lands audibly at the phase wrap, not after
  // it. Game logic (T.lastRoAt, roCue pop, phase wrap) stays on exactly 1.0.
  const roVoicePhase = 1 - RO_LEAD_S / T.period;
  if (!T.roVoiceFired && prevPhase < roVoicePhase && T.phase >= roVoicePhase) {
    T.roVoiceFired = true;
    roVoice();
  }
  if (T.phase >= 1) {
    T.phase -= 1;
    T.lastRoAt = G.time; // frozen at 0 during countdown — harmless, just a generous first-stroke tempo window (rule 7)
    T.roVoiceFired = false;
    hud.roCue.classList.remove('pop');
    void hud.roCue.offsetWidth;
    hud.roCue.classList.add('pop');
  }
}

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
initChallengeFromURL(); // Fase 2: must run after camPos exists
let shakeAmt = 0;

function update(dt, realDt = dt) {
  // hitstop: brief slow-motion after a crash for impact weight
  if (G.hitStop > 0) {
    G.hitStop -= dt;
    dt *= 0.3;
  }
  waterT += dt;

  // boot preloader — ticks/renders before anything else while active.
  // Deliberately driven by realDt (real wall-clock elapsed time, only loosely
  // bounded), NOT the gameplay-clamped `dt` (capped at 50ms/frame in frame()
  // to keep physics stable under lag spikes). The preloader is cosmetic UI
  // pacing, not physics — but boot is exactly when the main thread is
  // busiest (JS parse/eval, GC, first shader compiles) and real frame rate
  // is at its lowest for the whole session. Driving this bar off the clamped
  // dt meant a depressed boot frame rate silently inflated the "2.2s+0.7s"
  // nominal animation into several real seconds — e.g. measured 29 frames
  // averaging 266ms apiece (clamp hit on every single one) stretched a
  // nominal 2.9s bar into 7.7s of real wall-clock time behind the opaque
  // #preloaderScreen, which is what actually read as "the world takes ~10s
  // to appear". Using realDt makes the bar (and the MUSIC_WAIT_CAP hold)
  // track real time regardless of how choppy boot is.
  stepPreload(realDt);

  // cinematic intro: drive the two-ship sprint (positions/cadence/spray)
  // before the on-water seating below reads them. Holds until the preloader
  // lifts so the choreography starts on the first VISIBLE frame.
  if (INTRO.active && !PRELOAD.active) updateIntroAction(dt);

  // stage-mood crossfade (~1s) + self-terminating bloom pulse — both are
  // pure decays toward rest, cheap no-ops once settled
  tickMood(dt);
  if (bloomPulse > 0) {
    bloomPulse = Math.max(0, bloomPulse - dt * 0.7);
    bloomPass.strength = BLOOM_BASE + bloomPulse;
  }

  // ---- charge meter (pendulum): fills while holding, release in the green zone ----
  if (G.mode === 'racing' || G.mode === 'countdown') {
    let accumulating = false;
    if (G.charging && G.mode === 'racing' && G.stunned <= 0 && G.time - G.lastStrokeAt >= 0.3) {
      accumulating = true;
      const prev = G.charge;
      // The pendulum's slide rate scales with the boat's OWN current speed
      // (eased — T.speedEase, not the raw per-frame value, so one stroke's
      // drag sawtooth doesn't wobble the required hold time mid-charge): the
      // faster you're already going, the faster the bob races across, and
      // the perfect window gets shorter in real time the faster you go
      // (self-scaling difficulty tied to what's actually on the speed HUD).
      const chargeScale = THREE.MathUtils.clamp(
        1 - (T.speedEase / SPEED_FOR_MAX_CHARGE) * (1 - CHARGE_SCALE_FLOOR),
        CHARGE_SCALE_FLOOR, 1
      );
      G.charge += dt / (CHARGE_TIME * chargeScale);
      // anticipation ticks as the power builds
      if ((prev < 0.35 && G.charge >= 0.35) || (prev < 0.7 && G.charge >= 0.7)) hat(0.14);
      if (prev < CHARGE_PERFECT_LO && G.charge >= CHARGE_PERFECT_LO) hat(0.22); // "now!"
      if (G.charge > CHARGE_OVER) {
        // held too long — the oars slip (no splash)
        G.charging = false;
        captureMeterSnapshot(G.charge);
        executeStroke(G.charge);
        G.charge = 0;
        accumulating = false;
      }
    }
    // tick the release-snapshot timer down to idle (kept for state consistency;
    // the pendulum shows the release via its splash/flash, not a frozen bar)
    if (G.meterReleaseT >= 0) {
      G.meterReleaseT += dt;
      if (G.meterReleaseT > METER_HOLD_S + METER_DRAIN_S) G.meterReleaseT = -1;
    }
    // render the pendulum from the live charge value; tempo (T.energy via the
    // donk-synced T.phase) only drives the pulse, never the bob's fill rate
    stepPendulumFX(dt, G.charge, accumulating);
    drawPendulum({
      charge: G.charge,
      charging: G.charging,
      accumulating,
      over: G.charge > CHARGE_PERFECT_HI,
      energy: T.energy,
      phase: T.phase,
    });
  }

  // ---- countdown ----
  // gated on !TROPHY_PAN.active too — the stage-5 pre-race pan (see
  // startRace()) holds the crew at attention on camera before the numeric
  // countdown (and its drum) actually starts
  if (G.mode === 'countdown' && !TROPHY_PAN.active) {
    updateDrum(dt); // metronome counts the crew in — no dead air before GO
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
    if (steerInput !== 0) G.autoAim = false; // any real steering input hands back control for good
    if (G.autoAim) {
      const gate1 = course.gates[0];
      if (gate1 && !gate1.passed && !gate1.missed) {
        // pursuit steering: aim at a fixed point biased toward the LEFT pole
        // but well inside the gap (gate1.w/2 is the pole itself) — the player
        // owns the left half of gate 1, the rival the right, so they split the
        // gate. Steer toward the HEADING that point implies — not straight at
        // the x-offset (a position-error controller here overshoots, since
        // heading is effectively the x-position's second derivative). Feeds the
        // SAME steer pipeline as manual input (smoothing, turn rate, self-
        // centering) so it feels like steering, not an autopilot snap.
        const wantX = gate1.x - (gate1.w / 2 - 3);
        const desiredHeading = Math.atan2(wantX - G.x, G.z - gate1.z);
        steerInput = (desiredHeading - G.heading) * 2.2;
      } else {
        G.autoAim = false; // gate 1 resolved — hand back full manual control
      }
    }
    steerInput = THREE.MathUtils.clamp(steerInput, -1, 1);
    G.steer += (steerInput - G.steer) * Math.min(1, dt * 5);
    const steerRate = 0.55 * (0.4 + Math.min(1, G.speed / 10) * 0.6);
    G.heading += G.steer * steerRate * dt;
    G.heading = THREE.MathUtils.clamp(G.heading, -0.7, 0.7);
    // heading self-centering slightly
    G.heading *= 1 - dt * 0.3;

    // ---- Haaland's drum cycle: donk (0.55), donk (0.78), RO! at the wrap ----
    // (energy decay + dots refresh happen inside updateDrum() every frame)
    updateDrum(dt);

    // drag & speed — full base speed as always; Haaland's tempo raises the CAP further
    if (G.stunned > 0) G.stunned -= dt;
    if (G.boost > 0) G.boost -= dt;
    const dragLoss = G.speed * (0.09 + G.speed * 0.0045) + 0.2;
    G.speed = Math.max(0, G.speed - dragLoss * dt);
    // ONE tempo scalar drives both the pendulum pulse AND the boat's speed cap
    // (T.energy) — they accelerate in lockstep, per the pendulum-control spec.
    // Same 20→26 range as the old T.level*0.75, just continuous on energy.
    const maxSpeed = 20 + T.energy * 6 + (G.boost > 0 ? 3.5 : 0);
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
        c.taken = true; // instanced ball collapses next updateCourse tick
        G.balls++;
        G.boost = 3.2;
        G.speed += 2.4;
        showFeedback('⚽ TURBO!', '#ffd25e');
        whoosh();
        ding(1.3);
        // turbo juice: drum kick + camera punch + a short bloom flash and a
        // handful of golden sparks right where the ball sat — the pulse
        // decays itself in update() (never a stuck flash, Regel 9 spirit)
        kick(0.55);
        G.fovPunch = Math.max(G.fovPunch, 0.8);
        bloomPulse = Math.max(bloomPulse, 0.22);
        spawnFireworkBurst(c.x, 2.6, c.z, 0xffd25e, 14, false);
      }
    }
    // Fase 4a: letter pickup — mirrors the football logic above. NOT written
    // to roway.letters.v1 here: only G.letterTaken (per-race) is set, so a
    // mid-race restart discards it — finishRace() is the only commit point.
    if (LETTER.mesh && LETTER.mesh.visible && !LETTER.taken && Math.abs(LETTER.z - G.z) <= 8) {
      const dx = LETTER.x - G.x, dz = LETTER.z - G.z;
      if (dx * dx + dz * dz < LETTER.r * LETTER.r + 14) {
        LETTER.taken = true;
        G.letterTaken = true;
        LETTER.mesh.visible = false;
        ding(1.6);
        whoosh();
        const preview = loadLetters().have.concat(LETTER.char);
        showFeedback(`✨ ${LETTER.char} COLLECTED — ${letterProgressText(preview)}`, '#ffd25e', true);
      }
    }
    for (const o of course.obstacles) {
      if (o.hit || Math.abs(o.z - G.z) > 8) continue;
      const dx = o.x - G.x, dz = o.z - G.z;
      if (dx * dx + dz * dz < o.r * o.r + 8) {
        o.hit = true;
        G.hitIce = true; // Fase 4a: "vinn uten å treffe et isflak" mission
        G.speed *= 0.35;
        G.stunned = 0.8;
        G.boost = 0;
        G.combo = 0;
        G.charging = false; G.charge = 0; // the impact knocks the oars loose
        T.energy = Math.max(0, T.energy - 3 / TEMPO_MAX); // the crash breaks the crew's tempo
        T.maxAnnounced = false;
        updateComboBadge();
        shakeAmt = 1;
        G.hitStop = 0.22; // brief slow-mo for impact weight
        hud.hitFlash.classList.remove('on');
        void hud.hitFlash.offsetWidth;
        hud.hitFlash.classList.add('on');
        showFeedback('CRASH!', '#ff7a7a');
        thud();
      }
    }
    for (const g of course.gates) {
      // KAPPRO: a gate stays re-checkable even while g.missed is true (the
      // rewind below leaves it dimmed but retriable) — only REISEN treats a
      // miss as terminal, matching the old skip-forever behaviour.
      if (g.passed || G.z > g.z) continue;
      if (g.missed && G.gameMode !== 'kapp') continue;
      // ship crossed the gate line
      if (Math.abs(G.x - g.x) < g.w / 2) {
        g.passed = true;
        g.missed = false; // clear the dim/miss look now that they made it
        G.speed += 1.6;
        showFeedback('GATE! +SPEED', '#7dff9e');
        ding();
      } else if (G.gameMode === 'kapp') {
        // Portstraff: a hard checkpoint now, not a soft one — rewind the
        // boat to the (already ice-floe-free) approach lane and make them
        // redo it. The lost distance/time IS the penalty; see
        // GATE_MISS_PENALTY_S above for why the old flat add-on stays inert.
        g.missed = true;
        g.missFlashUntil = waterT + 0.5;
        G.z = g.z + GATE_REWIND_M;
        G.speed *= 0.25;
        G.hitStop = Math.max(G.hitStop, 0.25);
        showFeedback('⚠️ GATE MISSED — TURN BACK!', '#ffcc33', true, 1500);
        thud();
      } else {
        // REISEN: unchanged soft miss — no penalty, no rewind, just dimmed.
        g.missed = true;
      }
    }

    // ---- rival AI ----
    {
      // accelerate to pace, with rubber-banding that keeps the duel alive.
      // Much tighter than before: eases/digs from a 25 m gap (was 50) and
      // slows harder when ahead (floor 0.66, slope 0.005) so the rival can't
      // build the crushing early lead a player still finding their rhythm
      // could never claw back — past ~60 m ahead it drops to ~2/3 pace and
      // waits, keeping the duel visually neck-and-neck instead of a blowout.
      const gap = G.z - R.z; // positive => rival ahead
      let want = R.pace;
      if (gap > 25) want *= Math.max(0.66, 1 - (gap - 25) * 0.005);  // rival ahead: ease off
      else if (gap < -25) want *= Math.min(1.10, 1 + (-gap - 25) * 0.004); // rival behind: dig in
      R.speed += (want - R.speed) * dt * 0.22; // human-like slow ramp from the start line

      // pick a line through (or occasionally OUTSIDE) the next gate
      const nextRG = course.gates.find((gt) => !gt.rivalDone && gt.z < R.z);
      if (nextRG) {
        if (nextRG.rivalAim === undefined) {
          nextRG.rivalAim = Math.random() < 0.10
            ? (Math.random() < 0.5 ? -1 : 1) * (nextRG.w / 2 + 4.5) // rare blunder: sails outside the pole
            : (Math.random() * 8 - 4);                              // clean line through the gap
        }
        // ease the lateral offset toward this gate's chosen line
        R.aimOff += (nextRG.rivalAim - R.aimOff) * dt * 0.7;
      }
      // Off the start line the rival holds its start lane on the RIGHT half of
      // gate 1 (gate1.x + GATE1_LANE — the player owns the left half) and only
      // converges on the ACTUAL later-gate line as it approaches, so the two
      // hulls split gate 1 and never cross at the start. Blend the WHOLE lateral
      // target between 20 m and 80 m out; gate 1 sits at 140 m, leaving ~5 s of
      // open water to line up the next gap.
      const startHold = THREE.MathUtils.clamp((-R.z - 20) / 60, 0, 1);
      const startLane = course.gates[0] ? course.gates[0].x + GATE1_LANE : GATE1_LANE;
      let wantX = THREE.MathUtils.lerp(startLane, rivalPathX(R.z) + R.aimOff, startHold);
      // Gentle visual spacing only. Hulls are ghosts now (no collision), so
      // the rival no longer needs a physical bump — but the old one-size nudge
      // couldn't win both ways: strong (14/0.9, up to 12.6 m) shoved its line
      // outside gate poles ("Sweden sails around the gates"), weak (8/0.35,
      // max 2.8 m) let the ~5 m-wide hulls visibly pass through each other.
      // The need is LOCATION-dependent, so scale sea-room by distance to the
      // rival's next gate line: near a gate (<25 m) keep the tiny nudge that
      // can never push the clean line (±4) outside the ±8.5 opening; in open
      // water (>45 m) use real separation (radius 10, gain 0.9 → up to 9 m)
      // so the hulls never merge; smooth blend between, no visible pop.
      const latGap = R.x - G.x;
      if (Math.abs(R.z - G.z) < 30 && Math.abs(latGap) < 10) {
        const nextGateZ = nextRG ? nextRG.z : -Infinity;
        const openWater = THREE.MathUtils.clamp(((R.z - nextGateZ) - 25) / 20, 0, 1);
        const avoidR = THREE.MathUtils.lerp(8, 10, openWater);
        const avoidGain = THREE.MathUtils.lerp(0.35, 0.9, openWater);
        if (Math.abs(latGap) < avoidR) {
          wantX += (latGap >= 0 ? 1 : -1) * (avoidR - Math.abs(latGap)) * avoidGain;
        }
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
          showFeedback('SWEDEN MISSED THE GATE! 🙈', '#7dff9e', true);
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

    // ---- ship-vs-ship brush: hulls pass through (ghost), never a physical hit ----
    // A rubber-banded rival that shares the player's racing line AND knocks
    // them off course at every gate reads as unfair — you can't out-steer an
    // AI aiming for the same 17 m gap with only 5 m of hull clearance, so the
    // "collision" always landed at the exact moment you were threading the
    // needle. The rival is now a VISUAL + TIMING duel only (like the challenge
    // ghost): you race its position and its clock, but it can never wreck your
    // run. A soft wake splash on contact sells the near-miss so overlapping
    // hulls read as "brushed oars", not a clipping glitch — no speed loss, no
    // heading kick, no shake, no toast.
    {
      const dx = G.x - R.x;
      const dz = G.z - R.z;
      if (Math.abs(dx) < 5.0 && Math.abs(dz) < 26) {
        if (G.time - (G.lastBumpAt ?? -9) > 2.2) {
          G.lastBumpAt = G.time;
          const mx = (G.x + R.x) / 2, mz = (G.z + R.z) / 2;
          const wy = sampleWater(mx, mz, waterT).y;
          for (let i = 0; i < 8; i++) {
            spawnParticle(
              mx + (Math.random() - 0.5) * 3, wy + 0.2, mz + (Math.random() - 0.5) * 8,
              (Math.random() - 0.5) * 2.5, 1.4 + Math.random() * 1.8, (Math.random() - 0.5) * 2,
              0.4 + Math.random() * 0.3
            );
          }
        }
      }
    }

    // ---- race drama callouts ----
    if (!G.cbHalf && G.z < course.finishZ / 2) {
      G.cbHalf = true;
      showFeedback('HALFWAY! 🇳🇴', '#7dff9e', true);
      ding(0.8);
    }
    if (!G.cbSprint && G.z < course.finishZ + 220) {
      G.cbSprint = true;
      showFeedback('FINAL SPRINT! 🏁', '#ffd25e', true);
      crowd();
    }
    // stage 4: the horizon landmarks (World Cup trophy + Lady Liberty, see
    // buildHorizon in world.js) emerge from the haze on the final stretch —
    // a bloom swell + Norwegian callout marks the moment America comes into view
    if (!G.cbLandmark && G.gameMode === 'voyage' && G.stageAtRunStart === 4
      && G.z < course.finishZ + 650) {
      G.cbLandmark = true;
      bloomPulse = Math.max(bloomPulse, 0.5);
      showFeedback('DER FREMME — FRIHETSGUDINNEN OG VM-TROFEET! 🗽🏆', '#ffd25e', true, 2200);
      crowd();
    }
    const leadNow = G.z <= R.z;
    if (G.time > 6 && G.lastLead !== leadNow) {
      G.lastLead = leadNow;
      if (leadNow) {
        showFeedback('YOU\'RE LEADING! 🇳🇴', '#7dff9e', true);
        ding(1.5);
      } else {
        showFeedback('SWEDEN TAKES THE LEAD!', '#ff9d9d', true);
        ding(0.6);
      }
    }

    // finish
    if (G.z <= course.finishZ) finishRace();

    // HUD
    hud.time.textContent = fmtTime(G.time);
    hud.speed.innerHTML = `${Math.round(G.speed * 3.6 / 1.4)} <small>km/h</small>`;
    hud.balls.textContent = String(G.balls);
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
      // low in the sky band the pitched-down chase camera actually sees.
      // Silent — this loop fires repeatedly for as long as the player sits
      // on the result screen, and a boom every ~0.3-1.4s reads as a
      // relentless drumming instead of a one-off celebration.
      spawnFireworkBurst(
        G.x + (Math.random() - 0.5) * 160,
        9 + Math.random() * 15,
        G.z - 70 - Math.random() * 110,
        FW_COLORS[(Math.random() * FW_COLORS.length) | 0],
        won ? 60 + (Math.random() * 30 | 0) : 40,
        false
      );
      // rides the same global bloom pulse as ball pickups/landmarks — the
      // finish banners' emissive plates (world.js) sit near the bloom
      // threshold, so this reads as them pulsing brighter with each burst.
      bloomPulse = Math.max(bloomPulse, won ? 0.35 : 0.22);
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
    // exit drips only — executeStroke() already owns the racing catch splash
    stepOarWaterFX(OARFX.ship, G.dip, ship, shipData, 0, 0, true);

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
    // idle rowing loop on menu/result screens — the cinematic intro raises
    // the cadence to a full racing stroke while the sprint plays (INTRO.cadence)
    G.strokePhase = (G.strokePhase + dt * (INTRO.active ? INTRO.cadence : 0.35) / STROKE_CYCLE) % 1;
    const p = cyclePose(G.strokePhase);
    poseStroke(shipData, p.reach, p.dip, waterT);
    // entry+exit splashes for the bot rowing: full-power during the intro
    // sprint, a gentle lap on the calm menu/result screens
    const introSprint = INTRO.active && !PRELOAD.active;
    stepOarWaterFX(OARFX.ship, p.dip, ship, shipData, introSprint ? 0.85 : 0.3, 0.5);
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
    // rival blade splashes in every mode (race, intro, menus) — silent while
    // racing so the player's own stroke-feedback audio stays unmistakable
    stepOarWaterFX(
      OARFX.rival, rp.dip, rival, rivalData,
      0.2 + Math.min(1, R.speed / 18) * 0.65,
      G.mode === 'racing' ? 0 : 0.35
    );
    const rw = seatBoatOnWater(rival, R.x, R.z, R.heading, dt, 0, 0);
    updateHullShadow(rivalShadow, R.x, R.z, R.heading, rw.y);
    // rival wake + bow spray — same treatment the player's hull gets below,
    // driven by R.speed so it works in the race AND the cinematic intro
    if (R.speed > 3 && Math.random() < dt * R.speed * 1.6) {
      const wy = sampleWater(R.x, R.z + 8, waterT).y;
      spawnParticle(
        R.x + (Math.random() - 0.5) * 3, wy + 0.1, R.z + 8 + Math.random() * 3,
        (Math.random() - 0.5) * 1.5, 0.8 + Math.random(), 1 + Math.random() * 2,
        0.7
      );
    }
    if (R.speed > 9 && Math.random() < dt * (R.speed - 8) * 2.2) {
      const bx = R.x - Math.sin(R.heading) * -15, bz = R.z - Math.cos(R.heading) * 15;
      const wy = sampleWater(bx, bz, waterT).y;
      for (const side of [-1, 1]) {
        spawnParticle(
          bx + side * (1 + Math.random()), wy + 0.3, bz + Math.random() * 2,
          side * (1.5 + Math.random() * 2), 2.2 + Math.random() * 2, 0.5,
          0.45 + Math.random() * 0.3
        );
      }
    }
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
  // (hidden while a challenge is active — see stepGhost/C block below, and
  // the "Fase 2: hide local ghost during a challenge" note in startRace)
  if (GH.ship && GH.ship.visible && GH.data) {
    const t = (G.mode === 'racing' || G.mode === 'finished') ? G.time : 0;
    const pos = stepGhost(GH, GH.data, t, dt);

    // lowkey lead-change callouts vs your own best (8 m hysteresis, no drama)
    if (G.mode === 'racing' && G.time > 5) {
      const diff = pos.z - G.z; // positive => ghost is behind you
      if (GH.lead === null) GH.lead = diff > 0 ? 'player' : 'ghost';
      else if (GH.lead === 'ghost' && diff > 8) {
        GH.lead = 'player';
        showFeedback('AHEAD OF YOUR BEST! 👻', '#9fd8ff');
      } else if (GH.lead === 'player' && diff < -8) {
        GH.lead = 'ghost';
        showFeedback('YOUR BEST PULLS AHEAD 👻', '#9fd8ff');
      }
    }
  }

  // ---- challenge ghost (Fase 2): the friend you're duelling, laid on top ----
  // no collision, no effect on physics — a visual + timing duel only. Sweden
  // (the rival) is untouched and keeps racing as always.
  if (C.active && C.ship && C.ship.visible && C.track) {
    const t = (G.mode === 'racing' || G.mode === 'finished') ? G.time : 0;
    stepGhost(C, C.track, t, dt);
  }

  // ---- ship on water ----
  const w = seatBoatOnWater(
    ship, G.x, G.z, G.heading, dt,
    -Math.min(0.1, G.speed * 0.004), // slight bow-down lean at speed
    G.heading * 0.14                 // lean into turns
  );
  updateHullShadow(shipShadow, G.x, G.z, G.heading, w.y);

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
  // hull wash (bow wave / side foam / wake) follows both ships' live
  // position+heading+speed in every mode — menu, intro, race, result
  water.setShips(G.x, G.z, G.heading, G.speed, R.x, R.z, R.heading, R.speed);
  updateCourse(course, waterT, G.z);
  sky.position.set(G.x, 0, G.z);
  seagulls.update(waterT, G.x, G.z);

  // ---- camera ----
  if (SHIP_VIEWER.active) {
    // orbit around the ship's current water position — drag-to-rotate only,
    // no chase/intro logic runs at all while this dev viewer is open
    const cx = G.x + Math.sin(SHIP_VIEWER.angle) * SHIP_VIEWER.dist;
    const cz = G.z + Math.cos(SHIP_VIEWER.angle) * SHIP_VIEWER.dist;
    camera.position.set(cx, SHIP_VIEWER.height, cz);
    camera.lookAt(G.x, 2, G.z);
    camera.fov += (50 - camera.fov) * dt * 6;
    camera.updateProjectionMatrix();
    return;
  }
  if (INTRO.active) {
    if (!PRELOAD.active) runIntroCamera(dt); // camera holds still until the preloader finishes
    return;
  }
  if (TROPHY_PAN.active) { runTrophyPanCamera(dt); return; }
  shakeAmt = Math.max(0, shakeAmt - dt * 2.2);
  G.fovPunch = Math.max(0, G.fovPunch - dt * 4);
  const speedK = Math.min(1, G.speed / 22);
  const wantFov = 58 + speedK * 12 + G.fovPunch * 2.5;
  camera.fov += (wantFov - camera.fov) * dt * 6;
  camera.updateProjectionMatrix();
  // finishing-pass uniforms: grain animates continuously, aberration eases
  // toward the current speed so it doesn't snap on/off with each stroke
  finishPass.uniforms.uTime.value = waterT;
  finishPass.uniforms.uAberration.value += (speedK - finishPass.uniforms.uAberration.value) * dt * 3;

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

// Idle menu renders at a capped rate: the splash fjord has only slow ambient
// motion (water, gulls, idle oar-stroke), so there is no need to redraw the
// full scene + bloom at display refresh. The world keeps updating every tick
// (cheap) — only the heavy composer render is throttled. The wordmark/shield
// shine runs on its own canvas/renderer, so it stays perfectly smooth. The
// intro cinematic, countdown and race all still render every frame.
//
// #resultScreen gets the same cap once it's actually up (not during the
// pre-reveal glide/camera settle). Measured: with the full-res scene +
// UnrealBloom rendering uncoupled every frame behind the result HTML, each
// composer.render() burst (RenderPass + bloom's blur chain + OutputPass,
// ~16 sub-draws) cost ~1.8ms avg / ~5.5ms p95 of main-thread JS/GL-submit
// time — time stolen from the exact same thread that has to rasterize the
// .raster-btn:hover CSS transition (filter/transform), which is what read
// as "trege" (sluggish) hovering. The fireworks keep bursting and their
// particle sim still integrates every tick (cheap, dt-based) — only the
// redraw cadence drops, same trick as the menu cap above.
//
// #howtoScreen gets it too, but ONLY while presented as the controls-icon
// MODAL (.howtoModal class, opened via openControlsHelp() — reachable any
// time, including mid-race). The plain pre-race flow (showHowto(), no
// .howtoModal class) is already covered by the G.mode==='menu' branch above
// and doesn't need this. The modal case is the one that was missing: opening
// it mid-race sets G.paused = true but leaves G.mode as 'racing'/'countdown'
// (see openControlsHelp()), so without this check it fell through to the
// same every-frame composer.render() the live race uses — i.e. the full
// scene + bloom rendering at native refresh rate behind a totally static,
// paused backdrop, for as long as the modal stayed open. Gate on the class
// AND !hidden so closing the modal (howtoCloseBtn hides it synchronously,
// see the delayed .howtoModal removal there) restores full-rate rendering
// immediately, not 500ms later when the class itself is stripped.
const MENU_RENDER_INTERVAL = 1 / 30; // seconds
let menuRenderAcc = 0;
function frame(maxDt = 0.05) {
  const now = performance.now();
  const rawDtSec = (now - lastFrameT) / 1000;
  const dt = Math.min(rawDtSec, maxDt); // gameplay clamp — keeps physics stable under lag spikes
  // realDt: only loosely bounded (0.5s, covers a backgrounded-tab resume
  // without one giant catch-up jump) — used for cosmetic, wall-clock-paced
  // UI (currently just the boot preloader bar, see update()). Boot is
  // exactly when real frame rate is at its lowest for the whole session
  // (JS parse/eval, GC, first shader compiles all competing for the main
  // thread), so anything timed off the gameplay-clamped `dt` there silently
  // runs in slow motion relative to the wall clock the player is actually
  // waiting against — measured on a throttled boot: 29 frames averaging
  // 266ms apiece stretched a nominal 2.9s preloader animation into 7.7s of
  // real time behind the opaque #preloaderScreen, i.e. exactly the reported
  // "ship/world appears ~10s late" symptom, with the canvas rendering fine
  // underneath the whole time.
  const realDt = Math.min(rawDtSec, 0.5);
  lastFrameT = now;
  if (!G.paused) update(dt, realDt); // paused: world freezes but keeps rendering
  const resultUp = hud.resultScreen && !hud.resultScreen.classList.contains('hidden');
  const howtoModalUp = hud.howtoScreen && hud.howtoScreen.classList.contains('howtoModal') && !hud.howtoScreen.classList.contains('hidden');
  if ((G.mode === 'menu' && !INTRO.active) || resultUp || howtoModalUp) {
    menuRenderAcc += dt;
    if (menuRenderAcc < MENU_RENDER_INTERVAL) return; // skip this frame's heavy render
    menuRenderAcc = 0;
  }
  composer.render();
}
renderer.setAnimationLoop(() => frame());
// Shader pre-warm: compile every scene material and warm the post-processing
// passes (bloom + output) once up front, so the first visible frame doesn't
// hitch while programs compile lazily (18 -> 26). Deferred via setTimeout so
// it runs AFTER the animation loop above has already started (and therefore
// after the boot preloader's first real-time-paced tick, see frame()/
// update()) instead of blocking it — this compile traverses the whole scene
// and can itself take a real chunk of time on a loaded scene/slow GPU, and
// there is no reason to make the preloader (and the canvas's first paint)
// wait on it: the canvas sits behind the opaque #preloaderScreen for several
// seconds regardless, so any lazy-compile hitch this pre-warm would have
// prevented on frame 1 now just happens for free, invisibly, in that same
// window. It still runs comfortably before the cinematic reveal, so the
// original goal (no visible hitch once the player can actually see the
// canvas) is preserved.
setTimeout(() => {
  renderer.compile(scene, camera);
  composer.render();
}, 0);
// Fallback: if rAF stalls (embedded/backgrounded preview panels), keep the game
// stepping via a timer so it never freezes mid-countdown or mid-race.
// Larger dt cap here so throttled timers still make reasonable progress;
// 0.1 s steps stay well below collision radii even at top speed.
setInterval(() => {
  if (performance.now() - lastFrameT > 200) frame(0.1);
}, 100);

// debug/test handle. Off by default in production — gated behind DEV_TOOLS
// (see the "dev tools online-unlock" block up top), which is true under
// `npm run dev` OR once the roway.devtools localStorage flag is set. An open
// game-state handle lets anyone rewrite time/balls/etc. and submit a
// plausible (but fake) score, so this now ships inside `npm run build`
// instead of being stripped — see submit-score.js's threat model for what
// still catches that. The bot-test pattern in PROSJEKT-OVERSIKT.md still
// works under `npm run dev`.
if (DEV_TOOLS) {
  window.__game = {
    G, R, T, GH, C, INTRO, logoFX, shieldFX, howtoFX, renderer, composer, ship, rival, spawnFireworkBurst,
    dailySeed: DAILY_SEED, get waterT() { return waterT; },
    get voyage() { return voyage; }, set voyage(v) { voyage = v; }, shipData,
    LETTER, loadMissions, loadLetters,
    // Fase 3c: course is rebuilt on stage switches — a getter keeps this handle fresh
    get course() { return course; }, get builtStageId() { return builtStageId; },
    // voyage map v2 — e.g. __game.voyageMap._scrub(0.5) previews the midpoint
    voyageMap: voyageMapApi,
    // pendulum-control test hooks: omega (visual pulse rate from the drum),
    // tempo (T.energy), and the derived speed cap — for bot verification
    PEND,
    get omega() { return (Math.PI * 2) / T.period; },
    get tempo() { return T.energy; },
    get fartCap() { return 20 + T.energy * 6; },
    // isolated ship model viewer (psw gallery) — see openShipViewer() above
    openShipViewer, closeShipViewer,
    TROPHY_PAN, camera,
  };
  // hidden Screen Gallery: type "psw" anywhere, or open /__screens. Dynamic
  // import so the whole feature is stripped from production builds.
  import('./devScreens.js').then((m) => m.initDevScreens());

  // DEV-ONLY "spole" (fast-forward) button: appears while racing, one click
  // finishes the run instantly — every remaining gate is marked cleanly
  // passed (no Portstraff, no missed-gate rewind) and the ship is dropped on
  // the finish line, so Race mode and every Reisen stage can be smoke-tested
  // end-to-end without rowing. Dashed border = deliberately reads as a dev
  // tool, not game UI. Stripped from production builds with the rest of
  // this block.
  const spoleBtn = document.createElement('button');
  spoleBtn.id = 'devSpoleBtn';
  spoleBtn.textContent = '⏩';
  spoleBtn.title = 'DEV: spol til mål';
  spoleBtn.setAttribute('aria-label', 'Dev: finish the race now');
  spoleBtn.style.cssText = [
    'position:absolute', 'top:14px', 'right:118px', 'z-index:20',
    'width:44px', 'height:44px', 'border-radius:50%',
    'display:none', 'align-items:center', 'justify-content:center',
    'font-size:19px', 'cursor:pointer', 'pointer-events:auto', 'color:#fff',
    'background:linear-gradient(180deg, rgba(96,42,0,.85), rgba(64,26,0,.85))',
    'border:1px dashed rgba(255,255,255,.5)',
    'box-shadow:0 4px 16px rgba(0,0,0,.35)',
  ].join(';');
  document.getElementById('hud').appendChild(spoleBtn);
  spoleBtn.addEventListener('click', () => {
    spoleBtn.blur();
    if (G.mode !== 'racing' || G.paused) return;
    for (const g of course.gates) {
      if (!g.passed && !g.missed) g.passed = true; // clean pass — no penalty, no rewind
      g.rivalDone = true;
    }
    G.z = course.finishZ - 1; // next update() tick crosses the line → finishRace()
  });
  // visibility follows the race state — cheap dev-only poll, no hot-path work
  setInterval(() => {
    spoleBtn.style.display = (G.mode === 'racing' && !G.paused) ? 'flex' : 'none';
  }, 250);
}

// Guard against no-op resizes. On mobile the address bar showing/hiding fires
// `resize` with an UNCHANGED width (only the height the bar occupies changes,
// and often it fires repeatedly with identical dimensions), and every
// setSize() call here reallocates the renderer's drawing buffer AND the
// composer's + bloom's render targets — a GPU reallocation that stutters the
// frame. Bailing when neither dimension actually changed keeps genuine
// rotations/window resizes working while dropping the spurious churn.
let lastResizeW = window.innerWidth, lastResizeH = window.innerHeight;
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  if (w === lastResizeW && h === lastResizeH) return;
  lastResizeW = w; lastResizeH = h;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloomPass.setSize(w * BLOOM_RES_SCALE, h * BLOOM_RES_SCALE);
});
