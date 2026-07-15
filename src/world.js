import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { sampleWater } from './water.js';
import { loadBannerTexture, makeBillboard, makeBannerClock } from './billboard.js';

// ---- deterministic 3D value noise + fbm (for mountain deformation) ----
function _vhash(a, b, c) {
  const n = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
function _vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c000 = _vhash(xi, yi, zi), c100 = _vhash(xi + 1, yi, zi);
  const c010 = _vhash(xi, yi + 1, zi), c110 = _vhash(xi + 1, yi + 1, zi);
  const c001 = _vhash(xi, yi, zi + 1), c101 = _vhash(xi + 1, yi, zi + 1);
  const c011 = _vhash(xi, yi + 1, zi + 1), c111 = _vhash(xi + 1, yi + 1, zi + 1);
  const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w; // 0..1
}
function _fbm(x, y, z) {
  let a = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 4; i++) { a += _vnoise(x * f, y * f, z * f) * amp; amp *= 0.5; f *= 2; }
  return a; // ~0..1
}
const _sstep = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export const COURSE_LENGTH = 1500; // meters along -z
export const CHANNEL_HALF = 55; // playable half-width

// ---- Sky dome with gradient + sun + crepuscular rays ----
export function createSky() {
  const geo = new THREE.SphereGeometry(2600, 24, 16);
  const sunDir = new THREE.Vector3(0.35, 0.32, -0.88).normalize();
  // A local 2D basis perpendicular to sunDir, precomputed once in JS (not
  // per-fragment) so the shader can turn each fragment's view direction into
  // an angle AROUND the sun axis — that angle drives the ray "spokes" below.
  const sunRight = new THREE.Vector3().crossVectors(sunDir, new THREE.Vector3(0, 1, 0)).normalize();
  const sunUp = new THREE.Vector3().crossVectors(sunRight, sunDir).normalize();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x0e2454) },   // deep blue-hour zenith
      midColor: { value: new THREE.Color(0x4a6fa8) },
      botColor: { value: new THREE.Color(0xff9e52) },   // burning horizon
      sunDir: { value: sunDir },
      sunRight: { value: sunRight },
      sunUp: { value: sunUp },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // push to far plane
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor; uniform vec3 midColor; uniform vec3 botColor;
      uniform vec3 sunDir; uniform vec3 sunRight; uniform vec3 sunUp;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 col = mix(botColor, midColor, smoothstep(-0.02, 0.18, h));
        col = mix(col, topColor, smoothstep(0.15, 0.65, h));
        float sun = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
        col += vec3(1.0, 0.9, 0.65) * pow(sun, 350.0) * 1.6;   // disc
        col += vec3(1.0, 0.75, 0.45) * pow(sun, 14.0) * 0.28;  // halo
        // crepuscular rays: fan out from the sun using the fragment's angle
        // AROUND the sun axis (in the sunRight/sunUp plane) — a periodic sine
        // makes bright/dark spokes, gated to a tight cone around the disc (pow 8,
        // vs. the halo's pow 14 — just a hair wider) so they read as a handful of
        // soft shafts near the sun, not a screen-filling flare.
        float px = dot(vDir, sunRight), py = dot(vDir, sunUp);
        float ang = atan(py, px);
        float spokes = pow(0.5 + 0.5 * sin(ang * 9.0), 4.0) * 0.6
                     + pow(0.5 + 0.5 * sin(ang * 5.0 + 1.7), 4.0) * 0.4; // two spoke counts, less mechanical
        float reach = pow(max(sun, 0.0), 8.0); // tight falloff — a cone of ~35-40°, not the whole sky
        float belowFade = smoothstep(-0.12, 0.05, h); // fade before it'd shine "through" the ground
        col += vec3(1.0, 0.82, 0.5) * spokes * reach * belowFade * 0.22;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  // stage moods (main.js) retint the gradient live — expose the color
  // uniforms; the sun-direction uniforms stay fixed (the disc never moves)
  mesh.userData.skyUniforms = {
    top: mat.uniforms.topColor.value,
    mid: mat.uniforms.midColor.value,
    bot: mat.uniforms.botColor.value,
  };
  return mesh;
}

// mountain palette (linear-ish vertex colors, lit by scene lights)
const _COL_FOREST = new THREE.Color(0x2c4d38);
const _COL_ROCK = new THREE.Color(0x5b6470);
const _COL_SNOW = new THREE.Color(0xeef3f8);
const _COL_HAZE = new THREE.Color(0x8ea6c4); // distant atmospheric blue-grey

// Build one fbm-deformed peak as a coloured BufferGeometry, positioned in world.
// hazeMix > 0 tints the whole peak toward the atmospheric colour (distant layer).
function _buildPeak(cx, cz, w, h, seed, radial, hazeMix) {
  const geo = new THREE.ConeGeometry(w, h, radial, 5);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const sx = seed * 3.3, sz = seed * 1.7;
  for (let i = 0; i < pos.count; i++) {
    let lx = pos.getX(i), ly = pos.getY(i), lz = pos.getZ(i);
    const hf = (ly + h / 2) / h;              // 0 base .. 1 apex
    // flat near the waterline, craggy through the middle, tapering to the tip
    const taper = Math.min(1, hf / 0.16) * (0.45 + 0.55 * (1 - hf));
    const d = _fbm(lx * 0.05 + sx, ly * 0.05, lz * 0.05 + sz) - 0.5;
    const d2 = _fbm(lx * 0.12 + sx * 2, ly * 0.1 + 5, lz * 0.12 + sz) - 0.5;
    // horizontal ridging + vertical jitter
    const hscale = 1 + (d * 0.85 + d2 * 0.4) * taper;
    lx *= hscale; lz *= hscale;
    ly += (d * 0.9 + d2 * 0.5) * h * 0.16 * taper;
    pos.setXYZ(i, lx, ly, lz);

    // height-based colour with a noise-jittered snow/rock line
    const jitter = _fbm(lx * 0.08 + sx, ly * 0.08, lz * 0.08 + sz) - 0.5;
    const rockStart = 0.24 + jitter * 0.22;
    const snowStart = 0.58 + jitter * 0.36;
    c.copy(_COL_FOREST);
    c.lerp(_COL_ROCK, _sstep(rockStart, rockStart + 0.16, hf));
    c.lerp(_COL_SNOW, _sstep(snowStart, snowStart + 0.12, hf));
    if (hazeMix > 0) c.lerp(_COL_HAZE, hazeMix);
    // subtle per-vertex tonal variation
    const shade = 0.9 + jitter * 0.2;
    colors[i * 3] = c.r * shade;
    colors[i * 3 + 1] = c.g * shade;
    colors[i * 3 + 2] = c.b * shade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.deleteAttribute('uv'); // not needed; keeps merge attribute sets identical
  geo.computeVertexNormals();
  geo.rotateY(seed * 6.283);
  geo.translate(cx, h / 2 - 16, cz);
  return geo;
}

// ---- fbm fjord mountains: near ridge (detailed) + distant hazy layer ----
export function createFjord() {
  const group = new THREE.Group();
  const seededRandom = (() => {
    let s = 1234567;
    return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  })();

  const nearGeos = [];
  const farGeos = [];
  for (const side of [-1, 1]) {
    // near ridge
    let z = 300;
    while (z > -COURSE_LENGTH - 700) {
      const w = 130 + seededRandom() * 160;
      const h = 100 + seededRandom() * 210;
      const x = side * (CHANNEL_HALF + w + 35 + seededRandom() * 200);
      const radial = 7 + Math.floor(seededRandom() * 3);
      nearGeos.push(_buildPeak(x, z, w, h, seededRandom() * 100, radial, 0));
      z -= 90 + seededRandom() * 110;
    }
    // distant hazy layer — lower, farther out, bluer for atmospheric depth
    z = 300;
    while (z > -COURSE_LENGTH - 900) {
      const w = 150 + seededRandom() * 190;
      const h = 70 + seededRandom() * 130;
      const x = side * (CHANNEL_HALF + 300 + seededRandom() * 340);
      farGeos.push(_buildPeak(x, z, w, h, seededRandom() * 100, 6, 0.72));
      z -= 150 + seededRandom() * 170;
    }
  }

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
  // distant layer: unlit-ish so haze reads even in shadow, fog does the blending
  const farMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, emissiveIntensity: 0 });

  const nearGeo = mergeGeometries(nearGeos);
  const farGeo = mergeGeometries(farGeos);
  // silently null on a mismatched attribute set — every peak comes from the
  // same _buildPeak() so this can't fire today, but fail loudly rather than
  // crash on new THREE.Mesh(null) if that ever changes.
  if (!nearGeo || !farGeo) throw new Error('createFjord: attribute mismatch across merged peaks');
  const near = new THREE.Mesh(nearGeo, mat);
  const far = new THREE.Mesh(farGeo, farMat);
  nearGeos.forEach((g) => g.dispose());
  farGeos.forEach((g) => g.dispose());
  group.add(far, near);
  // stage moods (main.js) tint the whole range live: material.color
  // multiplies the baked vertex colors, so one shared color per layer
  // shifts the entire fjord warm/cold without regenerating any geometry
  group.userData.mats = [mat, farMat];
  return group;
}

// ---- Clouds: soft billboards ----
export function createClouds() {
  const group = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 32, 4, 64, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 64);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false });
  let s = 99;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  for (let i = 0; i < 26; i++) {
    const sp = new THREE.Sprite(mat);
    const z = 200 - rnd() * (COURSE_LENGTH + 900);
    sp.position.set((rnd() - 0.5) * 1300, 190 + rnd() * 190, z);
    const sc = 130 + rnd() * 240;
    sp.scale.set(sc, sc * 0.42, 1);
    group.add(sp);
  }
  return group;
}

// ---- Seagulls: simple flapping birds circling ahead of the ship ----
export function createSeagulls() {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xb9c6da, side: THREE.DoubleSide });
  const birds = [];
  for (let i = 0; i < 6; i++) {
    const bird = new THREE.Group();
    const wingGeo = new THREE.PlaneGeometry(2.4, 0.7);
    const l = new THREE.Mesh(wingGeo, mat);
    const r = new THREE.Mesh(wingGeo, mat);
    l.position.x = -1.2; r.position.x = 1.2;
    bird.add(l, r);
    group.add(bird);
    birds.push({
      bird, l, r,
      radius: 20 + Math.random() * 45,
      speed: 0.25 + Math.random() * 0.3,
      phase: Math.random() * Math.PI * 2,
      height: 20 + Math.random() * 22,
      flap: 6 + Math.random() * 4,
    });
  }
  return {
    group,
    update(t, shipX, shipZ) {
      for (const b of birds) {
        const a = t * b.speed + b.phase;
        b.bird.position.set(
          shipX * 0.4 + Math.cos(a) * b.radius,
          b.height + Math.sin(t * 0.7 + b.phase) * 3,
          shipZ - 170 + Math.sin(a) * b.radius
        );
        b.bird.rotation.y = -a - Math.PI / 2;
        const flap = Math.sin(t * b.flap + b.phase) * 0.55;
        b.l.rotation.z = flap;
        b.r.rotation.z = -flap;
      }
    },
  };
}

// ---- Low fog banks hugging the water near the cliffs ----
export function createFogBanks() {
  const group = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 32, 4, 64, 32, 34);
  grad.addColorStop(0, 'rgba(225,236,248,0.55)');
  grad.addColorStop(1, 'rgba(225,236,248,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 64);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false });
  let s = 777;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  for (let i = 0; i < 16; i++) {
    const sp = new THREE.Sprite(mat);
    const side = i % 2 === 0 ? -1 : 1;
    const z = 100 - rnd() * (COURSE_LENGTH + 400);
    sp.position.set(side * (CHANNEL_HALF + 45 + rnd() * 90), 6 + rnd() * 8, z);
    const sc = 160 + rnd() * 200;
    sp.scale.set(sc, sc * 0.22, 1);
    group.add(sp);
  }
  return group;
}

// ---- Football texture for collectibles ----
function makeFootballTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#151515';
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const px = x * 32 + (y % 2) * 16, py = y * 32;
      g.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        const xx = px + Math.cos(a) * 9, yy = py + Math.sin(a) * 9;
        i === 0 ? g.moveTo(xx, yy) : g.lineTo(xx, yy);
      }
      g.closePath(); g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---- Gate banner: bold "GATE" strip readable from far away ----
function makeGateBannerTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 88;
  const g = c.getContext('2d');
  // translucent navy strip with a crisp border
  g.fillStyle = 'rgba(0, 28, 80, 0.72)';
  g.beginPath();
  g.roundRect(4, 8, 504, 72, 14);
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '900 46px Cinzel, system-ui, serif';
  g.fillStyle = '#ffd25e';
  g.fillText('▼', 80, 47);
  g.fillText('▼', 432, 47);
  g.fillStyle = '#ffffff';
  g.fillText('G A T E', 256, 47);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// paints a uniform vertex color across a whole geometry — for merging several
// differently-colored copies of the same shape into one draw call (see
// _buildPeak above, which does the same thing per-vertex for a noise blend;
// this is just the flat/uniform case).
function _paintColor(geo, hex) {
  const c = new THREE.Color(hex);
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

// ================= Stage 5 homecoming: the harbor at the finish =================
// Every other stage's finish is the same generic goal/banner rig floating on
// open water — fine for a mid-voyage leg, but stage 5 IS the "row it home"
// payoff, and arriving to nothing but the usual goalposts read as "still out
// in the open sea" (the actual landfall — buildLandmark's homefjord case — is
// stuck mid-course like every other landmark, "beside the channel", per the
// header comment above). This builds actual land: a low rocky shelf, a small
// cluster of red/white/ochre coastal houses with warm lit windows, and a
// pier reaching toward the goal, planted just past the finish line so it's
// the first thing filling the frame the instant the player crosses it.
// Kept low (Regel 3) and close (~40-90 units behind goalZ) rather than big —
// a near, modest silhouette reads better than a distant grand one at the
// chase camera's shallow viewing angle.
function buildHomecomingHarbor(goalZ, courseGroup) {
  const g = new THREE.Group();
  const z0 = goalZ - 55; // shelf sits behind the goal, not on top of it

  // low rocky shoreline shelf spanning well past the channel's playable width
  const rock = new THREE.Mesh(
    new THREE.BoxGeometry(230, 10, 60),
    new THREE.MeshStandardMaterial({ color: 0x3c4a5e, roughness: 0.95, flatShading: true })
  );
  rock.position.set(0, -3, z0);
  g.add(rock);

  // a handful of small coastal houses (body+roof each merged into one draw
  // call across all houses via vertex colors, same trick as _buildPeak)
  const HOUSE_X = [-88, -58, -30, -4, 24, 52, 82];
  const HOUSE_COLOR = [0xba0c2f, 0xf2ede0, 0xd9a441, 0xba0c2f, 0x5c7a8a, 0xf2ede0, 0xd9a441];
  const bodyGeos = [];
  const roofGeos = [];
  const windows = [];
  for (let i = 0; i < HOUSE_X.length; i++) {
    const hx = HOUSE_X[i];
    const hz = z0 - 6 + (i % 3) * 5;
    const w = 8 + (i % 2) * 2, d = 7, h = 7 + (i % 3) * 1.5;
    const body = new THREE.BoxGeometry(w, h, d).translate(hx, h / 2, hz);
    bodyGeos.push(_paintColor(body, HOUSE_COLOR[i % HOUSE_COLOR.length]));
    const roof = new THREE.ConeGeometry(w * 0.75, h * 0.5, 4).translate(hx, h + h * 0.25, hz);
    roof.rotateY(Math.PI / 4);
    roofGeos.push(_paintColor(roof, 0x2a2a2a));
    // a warm emissive window facing the water — "welcome home" glow at dusk,
    // same emissiveIntensity range as the ship's lanterns/dragon-head eyes
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3),
      new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffd25e, emissiveIntensity: 2.4 }));
    win.position.set(hx, h * 0.45, hz + d / 2 + 0.05);
    windows.push(win);
  }
  const bodyGeo = mergeGeometries(bodyGeos);
  const roofGeo = mergeGeometries(roofGeos);
  if (bodyGeo && roofGeo) {
    g.add(new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })));
    g.add(new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })));
  }
  bodyGeos.forEach((geo) => geo.dispose());
  roofGeos.forEach((geo) => geo.dispose());
  windows.forEach((w) => g.add(w));

  // pier reaching from the shelf out toward the goal, a few pilings under it
  const pier = new THREE.Mesh(
    new THREE.BoxGeometry(9, 1.2, 42),
    new THREE.MeshStandardMaterial({ color: 0x6b4a30, roughness: 0.85 })
  );
  pier.position.set(0, 0.2, z0 + 26);
  g.add(pier);
  const pileMat = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.9 });
  const pileGeos = [];
  for (const pz of [z0 + 10, z0 + 24, z0 + 38]) {
    for (const px of [-3, 3]) pileGeos.push(new THREE.CylinderGeometry(0.5, 0.5, 6, 8).translate(px, -2.5, pz));
  }
  const pileGeo = mergeGeometries(pileGeos);
  if (pileGeo) g.add(new THREE.Mesh(pileGeo, pileMat));
  pileGeos.forEach((geo) => geo.dispose());

  // a big Norwegian flag on the shelf, same canvas-texture approach as the
  // homefjord landmark's flag (buildLandmark below) — welcoming committee
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 14, 8),
    new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6 }));
  pole.position.set(-2, 4, z0 - 12);
  g.add(pole);
  const fc = document.createElement('canvas');
  fc.width = 160; fc.height = 116;
  const fg = fc.getContext('2d');
  fg.fillStyle = '#ba0c2f'; fg.fillRect(0, 0, 160, 116);
  fg.fillStyle = '#fff'; fg.fillRect(36, 0, 32, 116); fg.fillRect(0, 41, 160, 32);
  fg.fillStyle = '#00205b'; fg.fillRect(44, 0, 16, 116); fg.fillRect(0, 49, 160, 16);
  const ftex = new THREE.CanvasTexture(fc);
  ftex.colorSpace = THREE.SRGBColorSpace;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.2),
    new THREE.MeshBasicMaterial({ map: ftex, side: THREE.DoubleSide, toneMapped: false }));
  flag.position.set(-2 + 2.3, 9.5, z0 - 12);
  g.add(flag);

  // ================= Oslo-style skyline behind the wharf =================
  // Arriving must read as reaching the NORWEGIAN COAST — a capital-city
  // waterfront (Rådhuset's twin towers, the Opera's sloping white wedge, a
  // Barcode row, an Akershus-like fortress, forested hills with a ski-jump
  // silhouette) rather than just a few cottages. Same perf discipline as the
  // rest of the world: every static volume bakes into ONE vertex-colored
  // mesh, every lit window/lamp into ONE emissive mesh — the whole skyline
  // costs ~6 draw calls. All positions are fixed constants (no rnd(), so the
  // seeded course stream above is untouched).
  const bld = [];   // vertex-colored volumes (buildings, hills, quay props)
  const glowQ = []; // emissive quads/orbs (windows, clock, lamp orbs)
  const cityZ = z0 - 32; // front building line, well behind the cottages
  const box = (w, h, d, x, z, color, ry = 0) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (ry) geo.rotateY(ry);
    geo.translate(x, h / 2, z);
    bld.push(_paintColor(geo, color));
  };
  // grid of lit windows on a building's +z face (some dark — reads lived-in)
  const frontWins = (x, faceZ, w, y0, y1, rows, cols) => {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (((r * 7 + c * 3) % 5) === 0) continue;
      const q = new THREE.PlaneGeometry(0.9, 1.2);
      q.translate(x - w / 2 + (c + 0.5) * (w / cols), y0 + (r + 0.5) * ((y1 - y0) / rows), faceZ);
      glowQ.push(q);
    }
  };
  // land under the city + the backdrop ridge line
  {
    const base = new THREE.BoxGeometry(520, 8, 130).translate(0, -2.2, z0 - 60);
    bld.push(_paintColor(base, 0x31413a));
    // forested hills — low-poly cones like the fjord peaks, each with its own
    // yaw/depth so the ridge reads as terrain, not a row of dark pyramids
    const HILLS = [
      [-165, 195, 46, 0.4, 0.6, 0x3f5346], [-70, 150, 30, 1.7, 0.5, 0x34443b],
      [10, 250, 38, 1.1, 0.55, 0x3a4a40], [95, 160, 32, 2.6, 0.5, 0x31413a],
      [175, 205, 54, 2.1, 0.6, 0x42564a],
    ];
    for (const [hx, hw, hh, ry, sz, color] of HILLS) {
      const hill = new THREE.ConeGeometry(hw / 2, hh, 7);
      hill.rotateY(ry);
      hill.scale(1, 1, sz);
      hill.translate(hx, hh / 2 - 4, z0 - 116);
      bld.push(_paintColor(hill, color));
    }
    // Holmenkollen-style ski-jump sliver on the west hill
    const jump = new THREE.BoxGeometry(2.6, 30, 2);
    jump.rotateX(0.52);
    jump.translate(-150, 30, z0 - 106);
    bld.push(_paintColor(jump, 0xe8ecf1));
  }
  // Rådhuset: brown-brick block + the two unmistakable towers, lit clock
  {
    box(30, 13, 14, -46, cityZ - 10, 0x8a5a3a);
    box(9, 26, 9, -56, cityZ - 5, 0x855636);
    box(9, 23, 9, -36, cityZ - 5, 0x8f5d3c);
    frontWins(-56, cityZ - 5 + 4.56, 8, 3, 23, 6, 3);
    frontWins(-36, cityZ - 5 + 4.56, 8, 3, 20, 5, 3);
    frontWins(-46, cityZ - 10 + 7.06, 28, 2, 11, 3, 9);
    const clock = new THREE.PlaneGeometry(2.4, 2.4);
    clock.translate(-56, 23, cityZ - 5 + 4.57);
    glowQ.push(clock);
  }
  // Operaen: white wedge sloping into the water + glass hall behind the ridge
  {
    const apron = new THREE.BoxGeometry(26, 1.6, 26);
    apron.rotateX(-0.3); // rises from the waterline up toward the back
    apron.translate(32, 4.0, cityZ + 2);
    bld.push(_paintColor(apron, 0xeef1f4));
    const wing = new THREE.BoxGeometry(16, 1.4, 18);
    wing.rotateX(-0.22); wing.rotateY(0.42);
    wing.translate(44, 3.2, cityZ + 4);
    bld.push(_paintColor(wing, 0xe6eaee));
    box(15, 10, 9, 32, cityZ - 12, 0x2e3742);
    frontWins(32, cityZ - 12 + 4.56, 14, 1.5, 9.5, 4, 7);
  }
  // Barcode row: slim towers, varied heights/tones, deeper into the frame
  {
    const BAR = [
      [8, 22, 0xe8eaee], [6, 30, 0x39424e], [7, 18, 0xb9c0c9],
      [6, 27, 0xe8eaee], [8, 33, 0x39424e], [6, 20, 0x9aa3ad], [7, 26, 0xdfe3e8],
    ];
    let bx = 64;
    for (const [w, h, color] of BAR) {
      box(w, h, 10, bx + w / 2, cityZ - 20, color);
      frontWins(bx + w / 2, cityZ - 20 + 5.06, w - 1, 2.5, h - 2, Math.round(h / 5), Math.max(2, Math.round(w / 3)));
      bx += w + 3;
    }
  }
  // Akershus-like fortress on the west point: stone walls, keep, spired tower
  {
    box(26, 9, 18, -102, cityZ - 14, 0x767c88);
    box(10, 15, 10, -108, cityZ - 18, 0x6d7380);
    const spire = new THREE.ConeGeometry(6, 9, 6).translate(-108, 15 + 4.5, cityZ - 18);
    bld.push(_paintColor(spire, 0x2f353d));
    const tower = new THREE.CylinderGeometry(4, 4.4, 15, 10).translate(-90, 7.5, cityZ - 9);
    bld.push(_paintColor(tower, 0x81879a));
    const cap = new THREE.ConeGeometry(4.8, 6, 10).translate(-90, 15 + 3, cityZ - 9);
    bld.push(_paintColor(cap, 0x2f353d));
  }
  // quay dressing along the shelf's waterfront: lamp posts (orbs glow),
  // extra flag poles, and a little welcoming crowd in Norway colors
  const extraFlags = [];
  {
    for (const lx of [-115, -85, -55, -25, 20, 55, 90, 125]) {
      const post = new THREE.CylinderGeometry(0.12, 0.17, 4.6, 6).translate(lx, 2.3 + 2, z0 + 26);
      bld.push(_paintColor(post, 0x2e3238));
      const orb = new THREE.SphereGeometry(0.34, 8, 8).translate(lx, 4.9 + 2, z0 + 26);
      glowQ.push(orb);
    }
    for (const fx of [-96, -34, 44, 118]) {
      const fp = new THREE.CylinderGeometry(0.14, 0.2, 10, 6).translate(fx, 5 + 2, z0 + 22);
      bld.push(_paintColor(fp, 0xeeeeee));
      const f2 = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.2), flag.material);
      f2.position.set(fx + 1.6, 8.6 + 2, z0 + 22);
      g.add(f2);
      extraFlags.push(f2);
    }
    const CROWD = [0xba0c2f, 0xf2ede0, 0x00205b];
    for (let i = 0; i < 14; i++) {
      const cx = -68 + i * 10 + ((i * 7) % 3) * 2;
      const cz = z0 + 27 - ((i * 5) % 3) * 1.5;
      const p = new THREE.CapsuleGeometry(0.38, 0.9, 3, 8).translate(cx, 0.85 + 2, cz);
      bld.push(_paintColor(p, CROWD[i % 3]));
      const head = new THREE.SphereGeometry(0.26, 8, 8).translate(cx, 1.85 + 2, cz);
      bld.push(_paintColor(head, 0xe8b58f));
    }
  }
  // a few moored small boats just off the quay
  {
    const BOATS = [[-62, 0xba0c2f, 0.18], [-14, 0xf2ede0, -0.12], [98, 0x2e4a68, 0.1]];
    for (const [bxx, color, ry] of BOATS) {
      const hull = new THREE.BoxGeometry(2.0, 1.1, 6.0);
      hull.rotateY(ry);
      hull.translate(bxx, 0.35, z0 + 36);
      bld.push(_paintColor(hull, color));
      const cabin = new THREE.BoxGeometry(1.4, 0.9, 1.8);
      cabin.rotateY(ry);
      cabin.translate(bxx, 1.3, z0 + 35);
      bld.push(_paintColor(cabin, 0xf2ede0));
    }
  }
  const bldGeo = mergeGeometries(bld);
  if (bldGeo) {
    g.add(new THREE.Mesh(bldGeo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true })));
  }
  bld.forEach((geo) => geo.dispose());
  const glowGeo = mergeGeometries(glowQ);
  if (glowGeo) {
    g.add(new THREE.Mesh(glowGeo,
      new THREE.MeshStandardMaterial({ color: 0x1a1408, emissive: 0xffd25e, emissiveIntensity: 1.9 })));
  }
  glowQ.forEach((geo) => geo.dispose());

  courseGroup.add(g);
  return (t) => {
    flag.rotation.y = Math.sin(t * 2.0) * 0.16;
    for (let i = 0; i < extraFlags.length; i++) {
      extraFlags[i].rotation.y = Math.sin(t * 2.0 + (i + 1) * 1.3) * 0.16;
    }
  };
}

// ================= Stage 4 finish: the New York skyline =================
// Stage 4 IS the "reach America" leg (the Statue of Liberty landmark stands
// mid-course), but its finish used to be the same open-water goal rig as
// everywhere else. This plants Manhattan behind the line — per request:
// like stage 5's Oslo harbor build, but with HIGHER and TALLER buildings.
// Two rows of 30-90-unit towers (a stepped Empire State-style crown, a
// tapered One-WTC-style obelisk with antenna, a Chrysler-style cone crown)
// over a dark shoreline, every facade carrying a lit window grid. Same perf
// discipline as the Oslo skyline: ONE vertex-colored mesh for all volumes +
// ONE emissive mesh for all windows (~4 draw calls total). Fully static (no
// tick) and no rnd() draws, so the seeded course stream stays untouched.
function buildNewYorkSkyline(goalZ, courseGroup) {
  const g = new THREE.Group();
  const z0 = goalZ - 60;
  const bld = [];
  const winQ = [];
  const box = (w, h, d, x, z, color) => {
    bld.push(_paintColor(new THREE.BoxGeometry(w, h, d).translate(x, h / 2, z), color));
  };
  const frontWins = (x, faceZ, w, y0, y1, rows, cols) => {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (((r * 7 + c * 3) % 4) === 0) continue; // some dark windows
      const q = new THREE.PlaneGeometry(1.1, 1.6);
      q.translate(x - w / 2 + (c + 0.5) * (w / cols), y0 + (r + 0.5) * ((y1 - y0) / rows), faceZ);
      winQ.push(q);
    }
  };
  // dark shoreline strip under the city
  bld.push(_paintColor(new THREE.BoxGeometry(560, 8, 130).translate(0, -2.4, z0 - 48), 0x232a33));

  // BACK row — the tallest silhouettes give the skyline its height
  const BACK = [
    [-185, 13, 60, 0x3a4250], [-142, 11, 72, 0x2b3442], [-58, 12, 64, 0x39424e],
    [34, 13, 74, 0x2b3442], [100, 11, 62, 0x3a4250], [172, 13, 68, 0x39424e],
  ];
  for (const [x, w, h, color] of BACK) {
    box(w, h, w, x, z0 - 55, color);
    frontWins(x, z0 - 55 + w / 2 + 0.06, w - 2, 4, h - 4, Math.round(h / 8), 3);
  }
  // One WTC-style tapered obelisk + antenna (back row, near centre)
  {
    const owtc = new THREE.CylinderGeometry(4.2, 6.6, 90, 4);
    owtc.rotateY(Math.PI / 4);
    owtc.translate(-14, 45, z0 - 58);
    bld.push(_paintColor(owtc, 0x9fb4c8));
    bld.push(_paintColor(new THREE.CylinderGeometry(0.28, 0.5, 18, 6).translate(-14, 99, z0 - 58), 0x39424e));
  }
  // Empire State-style stepped tower + spire (front row, east side)
  {
    box(17, 36, 15, 64, z0 - 30, 0x8a8578);
    box(12, 22, 11, 64, z0 - 30, 0x938e80); // rides on top via translate below
    bld[bld.length - 1].translate(0, 36, 0);
    box(7, 14, 7, 64, z0 - 30, 0x9c968a);
    bld[bld.length - 1].translate(0, 58, 0);
    bld.push(_paintColor(new THREE.CylinderGeometry(0.3, 0.7, 14, 6).translate(64, 79, z0 - 30), 0x6e6a63));
    frontWins(64, z0 - 30 + 7.56, 15, 3, 33, 5, 4);
  }
  // Chrysler-style tower with a cone crown (front row, west side)
  {
    box(11, 50, 10, -44, z0 - 26, 0xa8a294);
    bld.push(_paintColor(new THREE.ConeGeometry(5.6, 15, 8).translate(-44, 50 + 7.5, z0 - 26), 0xc9ccd4));
    frontWins(-44, z0 - 26 + 5.06, 9, 3, 47, 7, 3);
  }
  // FRONT row — varied mid-rises, denser lit grids
  const FRONT = [
    [-210, 14, 36, 0x545e6e], [-172, 11, 46, 0x6e6a63], [-112, 13, 42, 0x545e6e],
    [-78, 10, 52, 0x9aa3ad], [-12, 12, 38, 0x6e6a63], [22, 10, 48, 0x545e6e],
    [104, 14, 40, 0x9aa3ad], [140, 10, 54, 0x545e6e], [186, 12, 44, 0x6e6a63],
  ];
  for (const [x, w, h, color] of FRONT) {
    box(w, h, 12, x, z0 - 24, color);
    frontWins(x, z0 - 24 + 6.06, w - 2, 2.5, h - 3, Math.round(h / 7), Math.max(2, Math.round(w / 4)));
  }

  const bldGeo = mergeGeometries(bld);
  if (bldGeo) {
    g.add(new THREE.Mesh(bldGeo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true })));
  }
  bld.forEach((geo) => geo.dispose());
  const winGeo = mergeGeometries(winQ);
  if (winGeo) {
    g.add(new THREE.Mesh(winGeo,
      new THREE.MeshStandardMaterial({ color: 0x1a1408, emissive: 0xffd25e, emissiveIntensity: 1.9 })));
  }
  winQ.forEach((geo) => geo.dispose());
  courseGroup.add(g);
}

// ---- Course: gates (buoy pairs), footballs, obstacles, finish goal ----
// ================= Fase 3c: stage landmarks =================
// One procedural landmark per voyage stage, placed BESIDE the channel (never
// in it, no collision) and kept LOW — Regel 3: the chase camera only sees
// ~10° above the horizon, so near-and-modest beats far-and-huge. Blue-hour
// palette with emissive accents (same treatment as lanterns/dragon eyes).
// Returns a tick(t) function for the landmark's idle animation, or null.
function buildLandmark(kind, length, group) {
  const g = new THREE.Group();
  group.add(g);
  let tick = null;

  if (kind === 'lighthouse' || kind === 'homefjord') {
    // striped tower on a headland; homefjord adds a Norwegian flag — welcome home
    const x = kind === 'homefjord' ? -78 : 78;
    g.position.set(x, 0, -length * 0.55);
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(9, 0),
      new THREE.MeshStandardMaterial({ color: 0x3c4a5e, roughness: 0.9, flatShading: true }));
    rock.scale.y = 0.35;
    g.add(rock);
    for (let i = 0; i < 4; i++) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(2.2 - i * 0.25, 2.4 - i * 0.25, 3.2, 12),
        new THREE.MeshStandardMaterial({ color: i % 2 ? 0xffffff : 0xba0c2f, roughness: 0.6 }));
      band.position.y = 3 + 1.6 + i * 3.2;
      g.add(band);
    }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffd25e, emissiveIntensity: 2.4 }));
    lamp.position.y = 3 + 13.6;
    g.add(lamp);
    // rotating beam — a long thin emissive box sweeping like a light
    const beam = new THREE.Mesh(new THREE.BoxGeometry(26, 0.25, 0.9),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.35, depthWrite: false }));
    beam.position.y = lamp.position.y;
    g.add(beam);
    tick = (t) => { beam.rotation.y = t * 0.7; };
    if (kind === 'homefjord') {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6 }));
      pole.position.set(6.5, 8, 2);
      g.add(pole);
      const fc = document.createElement('canvas');
      fc.width = 128; fc.height = 93;
      const fg = fc.getContext('2d');
      fg.fillStyle = '#ba0c2f'; fg.fillRect(0, 0, 128, 93);
      fg.fillStyle = '#fff'; fg.fillRect(29, 0, 26, 93); fg.fillRect(0, 33, 128, 26);
      fg.fillStyle = '#00205b'; fg.fillRect(35, 0, 14, 93); fg.fillRect(0, 40, 128, 13);
      const ftex = new THREE.CanvasTexture(fc);
      ftex.colorSpace = THREE.SRGBColorSpace;
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.4),
        new THREE.MeshBasicMaterial({ map: ftex, side: THREE.DoubleSide,
          color: 0xffffff, toneMapped: false })); // toneMapped off = flag reads bright at dusk (emissive-like)
      flag.position.set(6.5 + 1.8, 11.8, 2);
      g.add(flag);
      const beamTick = tick;
      tick = (t) => { beamTick(t); flag.rotation.y = Math.sin(t * 2.2) * 0.18; };
    }
  } else if (kind === 'whale') {
    // dark back arcing out of the water off to the side, spout puffing up
    g.position.set(-85, 0, -length * 0.45);
    const back = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x22303f, roughness: 0.55 }));
    back.scale.set(1, 0.42, 1.9);
    back.position.y = -1.2;
    g.add(back);
    const fin = new THREE.Mesh(new THREE.ConeGeometry(1.4, 2.6, 6),
      new THREE.MeshStandardMaterial({ color: 0x1a2530, roughness: 0.6 }));
    fin.position.set(0, 1.6, -2);
    g.add(fin);
    const spout = new THREE.Mesh(new THREE.ConeGeometry(1.1, 4.5, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xcfe6f5, transparent: true, opacity: 0.55, depthWrite: false }));
    spout.position.set(0, 3.4, 4.5);
    g.add(spout);
    tick = (t) => {
      const w = sampleWater(g.position.x, g.position.z, t);
      g.position.y = w.y + Math.sin(t * 0.5) * 0.6;
      const puff = Math.max(0, Math.sin(t * 0.9)); // surfaces to breathe on a slow cycle
      spout.scale.setScalar(0.2 + puff * 1.1);
      spout.material.opacity = puff * 0.55;
    };
  } else if (kind === 'volcano') {
    // low hazy cone with an orange glow simmering at the crater
    g.position.set(88, 0, -length * 0.55);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(26, 15, 10),
      new THREE.MeshStandardMaterial({ color: 0x2e3844, roughness: 0.95, flatShading: true }));
    cone.position.y = 5.5;
    g.add(cone);
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0xff7030, emissive: 0xff5010, emissiveIntensity: 2.0,
    });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(2.6, 10, 10), glowMat);
    glow.scale.y = 0.4;
    glow.position.y = 13;
    g.add(glow);
    tick = (t) => { glowMat.emissiveIntensity = 1.6 + Math.sin(t * 1.7) * 0.7; };
  }
  // kind === 'liberty' (stage 4): the real GLB model now stands in for this
  // — see addLibertyCloseup() below, wired directly from createCourse() so
  // it can load/auto-fit/clone like the other external GLB props (skjord.glb
  // in ship.js) instead of the old procedural stand-in built here.
  return tick;
}

// ================= Stage 4: close-up Statue of Liberty by the course side =================
// public/3d models/frihets.gib.glb replaces the old procedural stand-in
// (pedestal/body/torch primitives, formerly the 'liberty' branch above) with
// the real textured model. Same async-load-once/clone approach as skjord.glb
// in ship.js: full scene clone (materials kept, unlike the silhouette-only
// horizon trophy above), auto-fit by HEIGHT since a statue reads tall-and-
// narrow rather than flat like a shield.
const LIBERTY_URL = '/3d%20models/frihets.gib.glb';
const LIBERTY_FIT_HEIGHT = 42; // dialed back from 72 (3x) — still a real monument, just not oversized
let libertyProto = null;
let libertyLoadStarted = false;
const libertyPendingAnchors = [];

function ensureLibertyLoading() {
  if (libertyLoadStarted) return;
  libertyLoadStarted = true;
  new GLTFLoader().load(
    LIBERTY_URL,
    (gltf) => {
      const scene = gltf.scene;
      const box = new THREE.Box3().setFromObject(scene);
      if (box.isEmpty()) {
        console.warn(`[world] liberty GLB "${LIBERTY_URL}" contains no visible geometry — stage 4 stays statue-less.`);
        libertyPendingAnchors.length = 0;
        return;
      }
      // same lightless-scene PBR fix as the shield/trophy props (ship.js) —
      // a fully metallic response reads near-black with no environment map
      scene.traverse((child) => {
        if (!child.isMesh) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of mats) {
          if (!mat.isMeshStandardMaterial) continue;
          mat.metalness = Math.min(mat.metalness, 0.4);
          mat.roughness = Math.max(mat.roughness, 0.5);
        }
      });
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      // recenter horizontally, drop the underside to y=0, scale so the
      // HEIGHT matches LIBERTY_FIT_HEIGHT
      scene.position.set(-center.x, -box.min.y, -center.z);
      const wrapper = new THREE.Group();
      wrapper.add(scene);
      const s = size.y > 0 ? LIBERTY_FIT_HEIGHT / size.y : 1;
      wrapper.scale.setScalar(s);
      libertyProto = wrapper;
      for (const anchor of libertyPendingAnchors) anchor.add(libertyProto.clone(true));
      libertyPendingAnchors.length = 0;
    },
    undefined,
    (err) => {
      console.warn(`[world] failed to load liberty GLB "${LIBERTY_URL}":`, err);
      libertyPendingAnchors.length = 0;
    }
  );
}

// off the channel (CHANNEL_HALF = 55), on the LEFT side (-x — the side that
// reads as "left" from the chase cam looking down -z toward the goal), and
// 200 units before the finish line (was 90) so the player meets it earlier —
// well before the final approach, not right on top of the goal. Dipped a
// little into the water (negative y) so the base visibly sinks below the
// waterline instead of floating clear of it — the exact same trick as the
// "A game by Winsen" billboards (see BANNER_Y / flankBanner above).
function addLibertyCloseup(courseGroup, length) {
  const anchor = new THREE.Group();
  anchor.position.set(-72, -1.6, -(length - 200));
  ensureLibertyLoading();
  if (libertyProto) anchor.add(libertyProto.clone(true));
  else libertyPendingAnchors.push(anchor);
  courseGroup.add(anchor);
}

// ================= Stage 1: "herbern" landmark by gate 1 =================
// public/3d models/herbern.glb — same async-load-once/clone-per-anchor
// approach as the shield/trophy/liberty props above: full scene clone
// (materials kept), auto-fit by WIDTH this time (fit to a gate's own opening,
// not height) since the request was "a bit wider than gate 1".
const HERBERN_URL = '/3d%20models/herbern.glb';
const HERBERN_FIT_WIDTH = 25.2; // 20% bigger than the original 21 (gate 1's opening, GATE_W, is 17)
let herbernProto = null;
let herbernLoadStarted = false;
const herbernPendingAnchors = [];

function ensureHerbernLoading() {
  if (herbernLoadStarted) return;
  herbernLoadStarted = true;
  new GLTFLoader().load(
    HERBERN_URL,
    (gltf) => {
      const scene = gltf.scene;
      const box = new THREE.Box3().setFromObject(scene);
      if (box.isEmpty()) {
        console.warn(`[world] herbern GLB "${HERBERN_URL}" contains no visible geometry — stage 1 stays herbern-less.`);
        herbernPendingAnchors.length = 0;
        return;
      }
      // This export's normal/metallic-roughness/emissive maps are corrupted
      // in a way that blacks out the ENTIRE frame the instant the mesh
      // enters view (confirmed by isolating each map in turn) — but the
      // base COLOUR map is completely fine and is exactly what makes this
      // model read as a real Norwegian villa (white timber siding, dark
      // shingled roof, turrets), so it stays. Only the broken maps are
      // stripped; metalness/roughness fall back to flat lightless-scene
      // defaults (same treatment as every other external GLB prop here).
      scene.traverse((child) => {
        if (!child.isMesh) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of mats) {
          if (!mat.isMeshStandardMaterial) continue;
          mat.metalness = 0.1;
          mat.roughness = 0.85;
          mat.emissive.set(0x000000);
          mat.emissiveIntensity = 0;
          if (mat.emissiveMap) { mat.emissiveMap.dispose(); mat.emissiveMap = null; }
          if (mat.normalMap) { mat.normalMap.dispose(); mat.normalMap = null; }
          if (mat.metalnessMap) { mat.metalnessMap.dispose(); mat.metalnessMap = null; }
          if (mat.roughnessMap) { mat.roughnessMap.dispose(); mat.roughnessMap = null; }
          mat.needsUpdate = true;
        }
      });
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      // recenter horizontally, drop the underside to y=0, scale so the WIDTH
      // (X) matches HERBERN_FIT_WIDTH
      scene.position.set(-center.x, -box.min.y, -center.z);
      const wrapper = new THREE.Group();
      wrapper.add(scene);
      const s = size.x > 0 ? HERBERN_FIT_WIDTH / size.x : 1;
      wrapper.scale.setScalar(s);
      herbernProto = wrapper;
      for (const anchor of herbernPendingAnchors) anchor.add(herbernProto.clone(true));
      herbernPendingAnchors.length = 0;
    },
    undefined,
    (err) => {
      console.warn(`[world] failed to load herbern GLB "${HERBERN_URL}":`, err);
      herbernPendingAnchors.length = 0;
    }
  );
}

// stage 1 only: off gate 1's LEFT post (outside the opening and outside the
// gate's own ice-floe keep-out zone — see GATE_HALF_CLEAR_X above, ~15.5),
// so it reads as "close to gate 1" without ever sitting in the playable
// lane. Pushed further left than the original 14 units past the post, per
// request. x/z are gate 1's own position, passed in from createCourse.
function addHerbernNearGate1(courseGroup, gate1X, gate1Z, gateW) {
  const anchor = new THREE.Group();
  anchor.position.set(gate1X - gateW / 2 - 24, 0, gate1Z);
  ensureHerbernLoading();
  if (herbernProto) anchor.add(herbernProto.clone(true));
  else herbernPendingAnchors.push(anchor);
  courseGroup.add(anchor);
}

// ================= Boot intro: conceptual landmarks =================
// The boot cinematic (main.js runIntroCamera) plays out entirely in open
// water near the start line — normally nothing out there but sky/water/
// mountains. Per request, this drops BOTH external-GLB landmarks into the
// base scene as pure set dressing for the cinematic, glimpsed flanking the
// fjord during the wide establishing/orbit shots: herbern (home) on one
// side, frihets/liberty (the destination, USA) on the other. Conceptual,
// not literal geography — the fleet is nowhere near either landmark for
// real mid-voyage, this is scene-setting for the trailer-style intro only.
// Reuses the SAME cached protos/loaders as the close-up stage 1/4 props
// above (one GLB fetch total, however many places clone it). main.js calls
// scene.add() once at boot and toggles the returned group's .visible off
// the instant the intro ends (endIntro()), so it never lingers into the
// menu or double-shows alongside stage 1's own herbern / stage 4's liberty.
export function createIntroLandmarks(scene) {
  const group = new THREE.Group();
  scene.add(group);

  // much more prominent than the other landmark here: pushed further left
  // and pulled closer to the fleet's own path (z 0-148 during the sprint,
  // see INTRO_START_Z in main.js), with an EXTRA scale on top of the shared
  // fit-width — this is the intro's own instance, so bumping it here doesn't
  // touch the close-up stage-1 size beside gate 1.
  const herbernAnchor = new THREE.Group();
  herbernAnchor.position.set(-95, 0, 55);
  herbernAnchor.scale.setScalar(1.6);
  ensureHerbernLoading();
  if (herbernProto) herbernAnchor.add(herbernProto.clone(true));
  else herbernPendingAnchors.push(herbernAnchor);
  group.add(herbernAnchor);

  const libertyAnchor = new THREE.Group();
  libertyAnchor.position.set(60, 0, 45);
  ensureLibertyLoading();
  if (libertyProto) libertyAnchor.add(libertyProto.clone(true));
  else libertyPendingAnchors.push(libertyAnchor);
  group.add(libertyAnchor);

  return group;
}

// ================= C5: horizon backdrop — the goal you're rowing TOWARD =================
// Stages 1-4: a distant World Cup trophy silhouette past the finish line,
// growing closer/clearer each stage; stage 4 adds a hazy Statue of Liberty.
// Stage 5 shows neither (the trophy is on deck; home is the goal).
// HARD RULES: fog:false materials with manual haze tinting (scene fog would
// erase anything this far out — same trick as the sky dome), everything low
// (Regel 3: the chase camera sees ~10° above the horizon), NO rnd() usage —
// this runs after the seeded layout and must never touch the seed stream.
const HAZE = new THREE.Color(0x8fa9cf); // = FOG_COLOR in main.js
function hazyColor(hex, k) { // k = how far toward the fog the silhouette sits
  return new THREE.Color(hex).lerp(HAZE, k);
}

// ---- horizon trophy silhouette (external GLB, replaces the old procedural
// plinth/stem/globe build) ----
// Every stage needs its OWN haze-tinted material (haze varies 1→4), so what's
// cached here is just the auto-fit GEOMETRY, not a ready mesh — each call
// below builds its own Mesh from it once loaded. buildHorizon() must stay
// synchronous (createCourse() does), so a call landing before the GLB
// resolves queues its builder closure instead of building immediately.
let horizonTrophyGeo = null;
let horizonTrophyLoadStarted = false;
const horizonTrophyPending = [];
const HORIZON_TROPHY_FIT_HEIGHT = 34.5; // ≈ the old procedural silhouette's own height (plinth to glint)

function ensureHorizonTrophyLoading() {
  if (horizonTrophyLoadStarted) return;
  horizonTrophyLoadStarted = true;
  new GLTFLoader().load(
    '/3d%20models/trophy.glb',
    (gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const geoms = [];
      gltf.scene.traverse((child) => {
        if (!child.isMesh || !child.geometry) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', child.geometry.getAttribute('position').clone());
        g.applyMatrix4(child.matrixWorld);
        geoms.push(g);
      });
      if (!geoms.length) {
        console.warn('[world] trophy GLB contains no visible geometry — horizon stays trophy-less.');
        horizonTrophyPending.length = 0;
        return;
      }
      const merged = geoms.length > 1 ? mergeGeometries(geoms, false) : geoms[0];
      merged.computeBoundingBox();
      const box = merged.boundingBox;
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      // recenter horizontally, drop the underside to y=0, scale so the
      // HEIGHT matches HORIZON_TROPHY_FIT_HEIGHT — same auto-fit idea as the
      // on-deck trophy/helmet in ship.js, just baked into the geometry
      // itself (via BufferGeometry.translate/scale) instead of a wrapper
      // Object3D, since this geometry gets cloned per stage below, not the
      // whole node.
      merged.translate(-center.x, -box.min.y, -center.z);
      const s = size.y > 0 ? HORIZON_TROPHY_FIT_HEIGHT / size.y : 1;
      merged.scale(s, s, s);
      merged.computeVertexNormals();
      horizonTrophyGeo = merged;
      for (const build of horizonTrophyPending) build();
      horizonTrophyPending.length = 0;
    },
    undefined,
    (err) => {
      console.warn('[world] failed to load trophy GLB for the horizon:', err);
      horizonTrophyPending.length = 0;
    }
  );
}

// builds the tinted silhouette mesh + glint into group `t`, using the shared
// auto-fit geometry once it's ready (immediately if already loaded). Each
// call gets its OWN geometry .clone() — course.group's disposeCourse() below
// traverse-disposes every mesh's geometry unconditionally on a stage switch,
// so sharing the one horizonTrophyGeo instance directly across stages would
// let stage N's disposal free the geometry stage N+1 is still using.
// Returns a mutable ref ({mat: null} until the async load resolves, then
// {mat: <the glint's material>}) — buildHorizon()'s pulse tick reads THIS,
// not a bare closure variable, since the glint itself may not exist yet at
// the moment the tick function is created (the GLB load is async, but the
// tick has to be returned synchronously alongside everything else here).
function addHorizonTrophyBody(t, haze) {
  ensureHorizonTrophyLoading();
  const glintRef = { mat: null };
  const build = () => {
    const bodyMat = new THREE.MeshBasicMaterial({ color: hazyColor(0x8a6a20, haze), fog: false });
    t.add(new THREE.Mesh(horizonTrophyGeo.clone(), bodyMat));
    // the glint: a small over-bright cap that trips the bloom pass — this is
    // what actually reads at stage-1 distances (toneMapped:false = HDR-bright,
    // same trick as the homefjord flag)
    const glintMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8, fog: false, toneMapped: false });
    const glint = new THREE.Mesh(new THREE.SphereGeometry(2.0, 8, 8), glintMat);
    glint.position.y = HORIZON_TROPHY_FIT_HEIGHT * 0.96; // near the model's own peak
    t.add(glint);
    glintRef.mat = glintMat;
  };
  if (horizonTrophyGeo) build();
  else horizonTrophyPending.push(build);
  return glintRef;
}

function buildHorizon(stageId, length, group) {
  if (!stageId || stageId < 1 || stageId > 4) return null;
  const g = new THREE.Group();
  group.add(g);
  const far = -(length + 520); // well past the goal — a destination, not an obstacle
  // per-stage presence: tiny glint on stage 1 → unmistakable on stage 4
  const scale = [0, 1.0, 1.4, 1.85, 2.4][stageId];
  const haze = [0, 0.82, 0.74, 0.66, 0.55][stageId]; // nearer = less haze

  const t = new THREE.Group();
  t.position.set(26, 0, far);
  const glintRef = addHorizonTrophyBody(t, haze);
  t.scale.setScalar(scale);
  g.add(t);

  // --- stage 4: Lady Liberty in the same far haze layer, off the other bow ---
  if (stageId === 4) {
    const L = new THREE.Group();
    L.position.set(-95, 0, far + 40);
    const patina = new THREE.MeshBasicMaterial({ color: hazyColor(0x5fa08a, haze), fog: false });
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(14, 12, 14), patina);
    pedestal.position.y = 6;
    L.add(pedestal);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 5.2, 20, 10), patina);
    body.position.y = 22;
    L.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(2.3, 10, 10), patina);
    head.position.y = 33.6;
    L.add(head);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 13, 8), patina);
    arm.position.set(4.8, 36, 0);
    arm.rotation.z = -0.35;
    L.add(arm);
    const torch = new THREE.Mesh(new THREE.SphereGeometry(1.8, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false, toneMapped: false }));
    torch.position.set(7, 43, 0);
    L.add(torch);
    g.add(L);
  }

  // slow warm pulse on the glint — a beacon, not a strobe. glintRef.mat is
  // null until the trophy GLB's async load resolves (see
  // addHorizonTrophyBody) — the tick already runs every frame before then,
  // so it has to check rather than assume the material exists yet.
  return (time) => {
    if (glintRef.mat) glintRef.mat.color.set(0xffe9a8).multiplyScalar(1 + Math.sin(time * 1.3) * 0.25);
  };
}

// ================= Per-stage ambient decor (voyage only) =================
// Procedural set-dressing that makes each leg read differently at a glance:
// islets, navigation stakes, icebergs, lantern buoys. EVERYTHING sits outside
// the playable channel (|x| > CHANNEL_HALF + margin) — pure scenery, never a
// hazard or a pickup blocker. KAPPRO passes stageId=null and gets none, so
// the daily layout (and its rnd() stream) is untouched; for voyage stages
// this runs AFTER all layout consumption, so decor rnd() draws can never
// shift balls/floes/gates for a given seed.
function buildStageDecor(stageId, length, group, rnd) {
  if (!stageId) return null;
  const decor = new THREE.Group();
  group.add(decor);
  const alongZ = () => -100 - rnd() * (length - 60);
  const outsideX = (min, max) => (rnd() < 0.5 ? -1 : 1) * (min + rnd() * (max - min));

  // -- islets: low rocky humps with a mood-tinted cap (stages 1/2/4/5) --
  const isletSpec = {
    1: { n: 7, cap: 0x2c4d38 },  // fjord green
    2: { n: 5, cap: 0x3a5a44 },  // sparser, open sea
    4: { n: 8, cap: 0x6a5a38 },  // sun-scorched american coast
    5: { n: 9, cap: 0x24463a },  // home waters, dusk green
  }[stageId];
  if (isletSpec) {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 1, flatShading: true });
    const capMat = new THREE.MeshStandardMaterial({ color: isletSpec.cap, roughness: 1, flatShading: true });
    for (let i = 0; i < isletSpec.n; i++) {
      const w = 6 + rnd() * 14, h = 2.5 + rnd() * 4.5;
      const x = outsideX(CHANNEL_HALF + 14, CHANNEL_HALF + 55), z = alongZ();
      const rock = new THREE.Mesh(new THREE.ConeGeometry(w, h, 7, 2), rockMat);
      rock.position.set(x, -0.6, z);
      rock.rotation.y = rnd() * Math.PI;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(w * 0.55, h * 0.5, 7, 1), capMat);
      cap.position.set(x, h * 0.62, z);
      cap.rotation.y = rnd() * Math.PI;
      decor.add(rock, cap);
    }
  }

  // -- navigation stakes: red/white sea marks hugging the channel edges
  //    (stages 1/2 — busy coastal waters) --
  if (stageId === 1 || stageId === 2) {
    const n = stageId === 2 ? 12 : 7;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.7 });
    const topMatR = new THREE.MeshStandardMaterial({ color: 0xba0c2f, roughness: 0.6 });
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (CHANNEL_HALF + 4 + rnd() * 5), z = alongZ();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 5.2, 6), poleMat);
      pole.position.set(x, 2.2, z);
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 8), topMatR);
      top.position.set(x, 5.1, z);
      decor.add(pole, top);
    }
  }

  // -- icebergs: towering white-blue giants in the far side band (stage 3) --
  if (stageId === 3) {
    const bergMat = new THREE.MeshStandardMaterial({ color: 0xe8f2fa, roughness: 0.25, flatShading: true });
    const n = 11;
    const bergs = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), bergMat, n);
    for (let i = 0; i < n; i++) {
      const s = 7 + rnd() * 13;
      _d.position.set(outsideX(CHANNEL_HALF + 18, CHANNEL_HALF + 80), s * 0.28, alongZ());
      _d.rotation.set(rnd() * 0.2 - 0.1, rnd() * Math.PI, rnd() * 0.2 - 0.1);
      _d.scale.set(s, s * 0.85, s);
      _d.updateMatrix();
      bergs.setMatrixAt(i, _d.matrix);
    }
    bergs.instanceMatrix.needsUpdate = true;
    bergs.frustumCulled = false;
    decor.add(bergs);
  }

  // -- lantern buoys: a glowing welcome-home lane along both channel edges
  //    (stage 5) — emissive gold, pulsing gently via the returned tick --
  let lanternMat = null;
  if (stageId === 5) {
    const n = 18;
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x35291c, roughness: 0.8 });
    lanternMat = new THREE.MeshStandardMaterial({
      color: 0xffd25e, emissive: 0xffb52e, emissiveIntensity: 1.8, roughness: 0.4,
    });
    const hulls = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.7, 0.9, 1.6, 7), hullMat, n);
    const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 8, 8), lanternMat, n);
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (CHANNEL_HALF + 3.5 + rnd() * 3);
      const z = -120 - (i / n) * (length - 220) - rnd() * 20;
      _d.rotation.set(0, 0, 0); _d.scale.setScalar(1);
      _d.position.set(x, 0.6, z); _d.updateMatrix();
      hulls.setMatrixAt(i, _d.matrix);
      _d.position.y = 2.0; _d.updateMatrix();
      lamps.setMatrixAt(i, _d.matrix);
    }
    for (const im of [hulls, lamps]) { im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; }
    decor.add(hulls, lamps);
  }

  return lanternMat
    ? (t) => { lanternMat.emissiveIntensity = 1.6 + Math.sin(t * 2.2) * 0.5; }
    : null;
}

// Fase 3c: stage-parametrised course generation. Defaults are EXACTLY the
// historical daily-course values (1500 m / 26 balls / 22 floes / 9 gates) —
// KAPPRO calls this with no opts and MUST get a bit-identical layout for a
// given seed (the main leaderboard's premise). Voyage stages pass their own
// values. All meshes go into one group so a stage switch can dispose cleanly.
// scratch Object3D for composing instance matrices (build + per-frame updates)
const _d = new THREE.Object3D();

export function createCourse(scene, seed = 424242, opts = {}) {
  const {
    length = COURSE_LENGTH,
    balls: ballCount = 26,
    ice: iceCount = 22,
    gates: gateCount = 9,
    landmark = null,
    id: stageId = null, // voyage stage id (1-5) — drives the C5 horizon backdrop; null for KAPPRO
  } = opts;
  // Daily-challenge seed drives the whole layout. Normalise into the LCG's
  // valid range [1, 2147483646] — a seed of 0 would freeze the generator.
  let s = Math.abs(Math.floor(seed)) % 2147483646 || 424242;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };

  const courseGroup = new THREE.Group(); // world transform = identity, so child world-positions are unchanged
  scene.add(courseGroup);

  // "A game by Winsen" signature billboards — one pair near the START (so
  // they're readable immediately, not 140m in at gate 1), one pair flanking
  // the finish. One texture load shared by all four (loadBannerTexture) and
  // one shared position/rotation formula (flankBanner) so a tweak to one
  // pair's look doesn't let the other visually drift. Not part of the
  // seeded layout — no rnd() involved.
  const winsenBannerTex = loadBannerTexture();
  // one shared clock object — updateCourse() below writes .value once per
  // frame and all four banner materials read the same reference, so the
  // shine sweeps stay perfectly in sync with no per-mesh loop.
  const winsenBannerClock = makeBannerClock();
  const BANNER_CLEARANCE = 6;  // world units beyond the gate/goal half-width
  const BANNER_TOE = 0.35;     // rad, toe-in so the face reads as the player approaches
  // lowered further so the banner's own base actually dips below the
  // waterline (plane height ~2.12 at width 9 — see BANNER_ASPECT in
  // billboard.js) instead of floating clear above it
  const BANNER_Y = 0.75;
  const flankBanner = (centerX, halfWidth, z, side, emissive, sparkleIntensity, fresnelIntensity) => makeBillboard({
    texture: winsenBannerTex,
    timeClock: winsenBannerClock,
    position: { x: centerX + side * (halfWidth + BANNER_CLEARANCE), y: BANNER_Y, z },
    rotationY: -side * BANNER_TOE,
    width: 9,
    emissive,
    sparkleIntensity,
    fresnelIntensity,
  });

  const collectibles = []; // {index, x, z, r, taken, spin} — index into ballMesh/glowMesh instances
  const obstacles = [];    // {index, x, z, r, hit} — index into floeMesh instances
  const gates = [];        // {left, right, x, z, passed}

  // footballs — ALL balls in one InstancedMesh + all glow shells in another
  // (perf: 52 draw calls → 2). Per-ball position/spin/taken state lives in
  // collectibles[]; updateCourse rewrites the instance matrices from it.
  const ballGeo = new THREE.SphereGeometry(1.15, 14, 14);
  const ballMat = new THREE.MeshStandardMaterial({ map: makeFootballTexture(), roughness: 0.35 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd25e, transparent: true, opacity: 0.22, side: THREE.BackSide });
  const ballMesh = new THREE.InstancedMesh(ballGeo, ballMat, ballCount);
  const glowMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1.7, 10, 10), glowMat, ballCount);
  for (const im of [ballMesh, glowMesh]) {
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false; // instances span the whole course; the geometry's local bounds would mis-cull
  }

  for (let i = 0; i < ballCount; i++) {
    const z = -90 - (i / ballCount) * (length - 200) - rnd() * 30;
    const x = (rnd() - 0.5) * 2 * (CHANNEL_HALF - 12);
    _d.position.set(x, 1.2, z);
    _d.rotation.set(0, 0, 0);
    _d.scale.setScalar(1);
    _d.updateMatrix();
    ballMesh.setMatrixAt(i, _d.matrix);
    glowMesh.setMatrixAt(i, _d.matrix);
    collectibles.push({ index: i, x, z, r: 3.4, taken: false, spin: rnd() * 6 });
  }
  courseGroup.add(ballMesh, glowMesh);

  // Gate centers computed up front — single source of truth used by both the
  // ice-floe clear-zone check below and the gate-building loop (ENDRING 2).
  const GATE_W = 17;
  // seed-derived phase shifts the whole slalom so each daily course weaves
  // differently (still fully deterministic for a given seed).
  const gatePhase = rnd() * Math.PI * 2;
  const gatePositions = [];
  for (let i = 0; i < gateCount; i++) {
    gatePositions.push({
      x: Math.sin(i * 1.7 + gatePhase) * (CHANNEL_HALF - 30),
      z: -140 - (i / gateCount) * (length - 300),
    });
  }

  // Keep-out zone for each gate. X: half the opening + size of the largest
  // possible floe + a generous buffer so nothing ever pokes into the gap.
  // Z: a floe only sits "in an opening" when it's near the gate in z too — a
  // floe sharing a gate's x but 400 m away in z blocks nothing. The z-window
  // (< half the ~133 m gate spacing) guarantees at most ONE gate qualifies per
  // floe, so the single push below always fully clears it.
  const GATE_HALF_CLEAR_X = GATE_W / 2 + 3.5 + 3; // half-opening + max floe radius + buffer
  // Asymmetric keep-out in z: a floe sitting on the APPROACH LANE right in front
  // of a gate (the line you must steer down) is just as blocking as one in the
  // opening itself — so clear a long run in front (player rows toward -z, so the
  // approach side is z > g.z) and only a short run behind. FRONT+BACK stays under
  // half the ~133 m gate spacing, so still ≤1 gate qualifies per floe.
  const GATE_CLEAR_FRONT = 46; // approach lane ahead of the gate (z > g.z)
  const GATE_CLEAR_BACK = 16;  // just past the gate (z < g.z)
  const floeLimit = CHANNEL_HALF - 8;

  // obstacles: ice floes only — compact, readable hazards. All floes render
  // as ONE InstancedMesh over a unit dodecahedron (perf: ~22 draw calls → 1);
  // per-floe size/heading bake into the instance matrix (scale/rotation), and
  // updateCourse rewrites matrices each frame for the same bobbing as before.
  const iceMat = new THREE.MeshStandardMaterial({ color: 0xdcecf7, roughness: 0.3, flatShading: true });
  const floeSpecs = [];
  for (let i = 0; i < iceCount; i++) {
    // Consume RNG in original order (z, x, size, rotY, rot) on every iteration
    // so floes that don't conflict stay byte-identical to the old layout.
    const z    = -160 - (i / iceCount) * (length - 320) - rnd() * 40;
    let   x    = (rnd() - 0.5) * 2 * floeLimit;
    const size =  1.8 + rnd() * 1.7;
    const rotY =  rnd() * Math.PI;
    const rot  =  rnd() * 0.3 - 0.15;

    // Check against every gate whose opening this floe could actually sit in
    // (near in BOTH z and x). The guarantee holds over the whole course.
    let skip = false;
    for (const g of gatePositions) {
      const dz = z - g.z;                                   // >0 = in front (approach), <0 = past
      const inZ = dz >= 0 ? dz < GATE_CLEAR_FRONT : -dz < GATE_CLEAR_BACK;
      if (!inZ) continue;                                   // not this gate's opening/approach (z)
      if (Math.abs(x - g.x) >= GATE_HALF_CLEAR_X) continue; // already clear (x)
      // Floe sits in the gap: push it just PAST the clear line (a small margin
      // beyond GATE_HALF_CLEAR_X avoids landing exactly on the boundary, which
      // float rounding could leave a hair inside). No RNG re-roll.
      const push = GATE_HALF_CLEAR_X + 1;
      const sign = x >= g.x ? 1 : -1;
      x = g.x + sign * push;
      if (Math.abs(x) > floeLimit) {
        x = g.x - sign * push; // try the other bank
        if (Math.abs(x) > floeLimit) skip = true; // neither bank fits — drop floe
      }
      break; // z-window guarantees ≤1 gate qualifies, so one push clears it
    }
    if (skip) continue;
    floeSpecs.push({ x, z, size, rotY, rot });
  }
  let floeMesh = null;
  if (floeSpecs.length) {
    floeMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), iceMat, floeSpecs.length);
    floeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    floeMesh.frustumCulled = false;
    floeSpecs.forEach((f, i) => {
      _d.position.set(f.x, 0.3, f.z);
      _d.rotation.set(0, f.rotY, 0);
      _d.scale.set(f.size, f.size * 0.45, f.size); // radius + the old squashed scale.y
      _d.updateMatrix();
      floeMesh.setMatrixAt(i, _d.matrix);
      obstacles.push({ index: i, x: f.x, z: f.z, r: f.size + 1.6, hit: false, rot: f.rot, size: f.size, rotY: f.rotY });
    });
    courseGroup.add(floeMesh);
  }

  // ---- football reachability post-pass ----
  // The raw ball spread (±(CHANNEL_HALF-12), uniform) could demand wild
  // zig-zags or park a turbo right behind an ice floe. This pass — pure
  // post-processing, NO rnd() draws, so the seeded stream above is untouched
  // — makes the ENTIRE chain of balls collectable in ONE run by a player
  // rowing through the gates ("all balls caught" must always be possible):
  //  · gate band: a ball's offset from the slalom line is capped by its
  //    z-distance to the nearest gate — at a gate it sits inside the opening
  //    (≤6 m off centre, half-opening is 8.5 m); the cap grows 0.42 m per m
  //    of run-up, to 30 m for the far "harder but worth it" detour balls,
  //  · chain: consecutive balls stay within 0.5 m lateral per m of ACTUAL
  //    z-gap (z jitter can put two balls just ~20 m apart — a fixed cap there
  //    would demand steeper steering than full lock covers),
  //  · floes: a shadowed ball slides to whichever side of the floe violates
  //    those two constraints least.
  // Balls exactly ON the line satisfy everything (line slope ≤0.45 < 0.5), so
  // a feasible layout always exists; three alternating forward/backward
  // relaxation sweeps settle into one while keeping the seeded variation.
  // updateCourse() reads collectibles[].x every frame, so updating the data
  // here is enough — the instance matrices follow on the next tick.
  {
    const gateLineX = (z) => {
      if (!gatePositions.length) return 0;
      if (z >= gatePositions[0].z) return gatePositions[0].x;
      for (let i = 0; i < gatePositions.length - 1; i++) {
        const a = gatePositions[i], b = gatePositions[i + 1];
        if (z <= a.z && z >= b.z) return a.x + (b.x - a.x) * ((a.z - z) / (a.z - b.z));
      }
      return gatePositions[gatePositions.length - 1].x;
    };
    const nearestGateDz = (z) => {
      let d = Infinity;
      for (const g of gatePositions) d = Math.min(d, Math.abs(z - g.z));
      return d;
    };
    const BALL_EDGE = CHANNEL_HALF - 14;
    const bandOf = (z) => (gatePositions.length ? Math.min(30, 6 + 0.42 * nearestGateDz(z)) : Infinity);
    // one relaxation step: clamp ball c into [neighbour ± chain] ∩ [line ±
    // band]; if a rare geometry leaves them disjoint the gate band wins (a
    // missed detour ball costs points; a ball forcing you out of a gate
    // breaks the race) and the band edge nearest the neighbour keeps the
    // chain break minimal. Floe shadows resolve to the least-violating side.
    const settle = (c, nb) => {
      const line = gateLineX(c.z);
      const maxDev = bandOf(c.z);
      const maxJump = Math.max(4, 0.5 * Math.abs(nb.z - c.z));
      let x = c.x;
      const lo = Math.max(line - maxDev, nb.x - maxJump);
      const hi = Math.min(line + maxDev, nb.x + maxJump);
      if (lo <= hi) x = Math.max(lo, Math.min(hi, x));
      else x = nb.x < line ? line - maxDev : line + maxDev;
      x = Math.max(-BALL_EDGE, Math.min(BALL_EDGE, x));
      for (const f of floeSpecs) {
        if (Math.abs(f.z - c.z) < 10 && Math.abs(f.x - x) < f.size + 4.5) {
          const cands = [f.x + (f.size + 5.5), f.x - (f.size + 5.5)];
          const score = (v) => (Math.abs(v) > BALL_EDGE ? 1e9
            : Math.max(0, Math.abs(v - line) - maxDev) * 2 + Math.max(0, Math.abs(v - nb.x) - maxJump));
          x = score(cands[0]) <= score(cands[1]) ? cands[0] : cands[1];
        }
      }
      c.x = Math.max(-BALL_EDGE, Math.min(BALL_EDGE, x));
    };
    // seeded variation survives as each ball's starting offset from the line
    for (const c of collectibles) {
      const line = gateLineX(c.z);
      c.x = line + (c.x - line) * 0.6;
    }
    const start = { x: 0, z: 0 }; // both boats launch near the centre
    for (let sweep = 0; sweep < 3; sweep++) {
      if (sweep % 2 === 0) {
        let nb = start;
        for (const c of collectibles) { settle(c, nb); nb = c; }
      } else {
        let nb = null;
        for (let i = collectibles.length - 1; i >= 0; i--) {
          if (nb) settle(collectibles[i], nb);
          nb = collectibles[i];
        }
      }
    }

    // ---- guarded balls: risk vs reward ----
    // "All balls" should be a challenge, not a formality. A deterministic
    // subset (~35%, chosen by each ball's seeded spin — no extra rnd() draws)
    // gets an ice floe TIGHT beside it: the ball sits ~2 m outside the floe's
    // hit circle (hit ≈ size+2.6, catch reach ≈ 5), so a precise line takes
    // it clean while a sloppy one bumps the ice (stun + tempo loss). Two ways
    // to pair up: pull the ball to a floe that's already close, or — budget-
    // capped so the floe field keeps its normal spread — MOVE an idle floe
    // (one not guarding anything) to the ball. Either way the pairing only
    // happens when EVERY hard guarantee still holds — gate band + keep-out,
    // 0.5 m/m chain to BOTH neighbours, channel edge, clear of every other
    // floe/ball — so "all balls" stays genuinely possible.
    const TIGHT = 4.8;
    let relocBudget = Math.max(2, Math.round(ballCount / 8));
    const gateKeepOutOk = (fx, fz) => {
      for (const g of gatePositions) {
        const dz = fz - g.z;
        const inZ = dz >= 0 ? dz < GATE_CLEAR_FRONT : -dz < GATE_CLEAR_BACK;
        if (inZ && Math.abs(fx - g.x) < GATE_HALF_CLEAR_X) return false;
      }
      return true;
    };
    for (let i = 0; i < collectibles.length; i++) {
      const c = collectibles[i];
      if (c.spin % 1 >= 0.35) continue;
      const line = gateLineX(c.z);
      const maxDev = bandOf(c.z);
      const prev = i > 0 ? collectibles[i - 1] : start;
      const next = i < collectibles.length - 1 ? collectibles[i + 1] : null;
      const valid = (v, guard) => {
        if (Math.abs(v) > BALL_EDGE) return false;
        if (Math.abs(v - line) > maxDev) return false;
        if (Math.abs(v - prev.x) > Math.max(4, 0.5 * Math.abs(prev.z - c.z))) return false;
        if (next && Math.abs(v - next.x) > Math.max(4, 0.5 * Math.abs(next.z - c.z))) return false;
        for (const f of floeSpecs) {
          if (f !== guard && Math.abs(f.z - c.z) < 10 && Math.abs(v - f.x) < f.size + 4.5) return false;
        }
        return true;
      };
      // 1) a floe already close by? pull the ball tight against it
      let bestFloe = null, bestD = 26;
      for (const f of floeSpecs) {
        const d = Math.abs(f.x - c.x);
        if (Math.abs(f.z - c.z) < 9 && d < bestD) { bestFloe = f; bestD = d; }
      }
      if (bestFloe) {
        const near = bestFloe.x + (c.x >= bestFloe.x ? 1 : -1) * (bestFloe.size + TIGHT);
        const far  = bestFloe.x + (c.x >= bestFloe.x ? -1 : 1) * (bestFloe.size + TIGHT);
        if (valid(near, bestFloe)) { c.x = near; continue; }
        if (valid(far, bestFloe))  { c.x = far;  continue; }
        continue; // a floe is near but no tight spot validates — leave as is
      }
      // 2) no floe in reach — move an idle one (not guarding any ball) here
      if (relocBudget <= 0) continue;
      let donor = null, donorDz = Infinity;
      for (const f of floeSpecs) {
        let busy = false;
        for (const b of collectibles) {
          if (Math.abs(b.z - f.z) < 12 && Math.abs(b.x - f.x) < f.size + 8) { busy = true; break; }
        }
        if (busy) continue;
        const d = Math.abs(f.z - c.z);
        if (d < donorDz) { donor = f; donorDz = d; }
      }
      if (!donor) continue;
      const oi = floeSpecs.indexOf(donor);
      for (const side of [1, -1]) {
        const fx = c.x + side * (donor.size + TIGHT);
        if (Math.abs(fx) > floeLimit) continue;
        if (!gateKeepOutOk(fx, c.z)) continue;
        let blocked = false;
        for (let j = 0; j < collectibles.length && !blocked; j++) {
          if (j === i) continue;
          const b = collectibles[j];
          if (Math.abs(b.z - c.z) < 10 && Math.abs(b.x - fx) < donor.size + 4.5) blocked = true;
        }
        for (const f2 of floeSpecs) {
          if (blocked) break;
          if (f2 !== donor && Math.abs(f2.z - c.z) < 12 && Math.abs(f2.x - fx) < donor.size + f2.size + 2) blocked = true;
        }
        if (blocked) continue;
        donor.x = fx; donor.z = c.z;
        obstacles[oi].x = fx; obstacles[oi].z = c.z;
        // refresh the build-time instance matrix too — the per-frame rewrite
        // in updateCourse only covers floes within 400 m of the ship
        _d.position.set(fx, 0.3, c.z);
        _d.rotation.set(0, donor.rotY, 0);
        _d.scale.set(donor.size, donor.size * 0.45, donor.size);
        _d.updateMatrix();
        floeMesh.setMatrixAt(oi, _d.matrix);
        relocBudget--;
        break;
      }
    }
  }

  // gates: unmissable slalom ports — tall flag poles, glowing beacon orbs and
  // a banner spanning the whole gap so players instantly read where to steer.
  // Perf: the 18 poles, 18 cone bases and 18 flags across all gates render as
  // THREE InstancedMeshes (red/blue via per-instance color); updateCourse
  // rewrites their matrices from the same wave data that bobs the sg groups.
  // Orbs and banners stay individual meshes — each carries per-gate emissive/
  // opacity state (passed/missed/next pulsing) that instancing can't express.
  const orbGeo = new THREE.SphereGeometry(0.4, 12, 12);
  const gateN = gatePositions.length * 2;
  const gatePoles = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.09, 0.13, 6.5, 8),
    new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6 }), gateN);
  const gateBases = new THREE.InstancedMesh(
    new THREE.ConeGeometry(1.15, 2.3, 8),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }), gateN);
  const gateFlags = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1.8, 1.05),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), gateN);
  const BASE_RED = new THREE.Color(0xba0c2f), BASE_BLUE = new THREE.Color(0x00205b);
  const FLAG_RED = new THREE.Color(0xd81a3f), FLAG_BLUE = new THREE.Color(0x2a6fd6);
  for (const im of [gatePoles, gateBases, gateFlags]) {
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false;
  }
  const gateBannerTex = makeGateBannerTexture();
  for (let i = 0; i < gatePositions.length; i++) {
    const { x, z } = gatePositions[i];
    const gateGroup = new THREE.Group();
    gateGroup.position.set(x, 0, z);
    const sides = [];
    for (const [k, side] of [[0, -1], [1, 1]]) {
      const sg = new THREE.Group();
      sg.position.x = side * (GATE_W / 2);
      const slot = i * 2 + k;
      // initial (un-bobbed) matrices — same rest pose the meshes used to have
      _d.rotation.set(0, 0, 0);
      _d.scale.setScalar(1);
      _d.position.set(x + side * (GATE_W / 2), 0.9, z);
      _d.updateMatrix();
      gateBases.setMatrixAt(slot, _d.matrix);
      gateBases.setColorAt(slot, side < 0 ? BASE_RED : BASE_BLUE);
      _d.position.y = 4.4;
      _d.updateMatrix();
      gatePoles.setMatrixAt(slot, _d.matrix);
      _d.position.set(x + side * (GATE_W / 2) + side * -1.0, 6.7, z); // flag points in toward the gap
      _d.updateMatrix();
      gateFlags.setMatrixAt(slot, _d.matrix);
      gateFlags.setColorAt(slot, side < 0 ? FLAG_RED : FLAG_BLUE);
      const orb = new THREE.Mesh(orbGeo, new THREE.MeshStandardMaterial({
        color: 0xffd25e, emissive: 0xffb52e, emissiveIntensity: 1.2,
      }));
      orb.position.y = 7.9;
      sg.add(orb);
      gateGroup.add(sg);
      sides.push({ sg, orb });
    }
    const bannerMat = new THREE.MeshBasicMaterial({
      map: gateBannerTex, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(GATE_W - 3.2, 2.2), bannerMat);
    banner.position.y = 5.7;
    gateGroup.add(banner);
    courseGroup.add(gateGroup);
    gates.push({
      group: gateGroup, sideL: sides[0], sideR: sides[1], banner, bannerMat,
      slot: i * 2, x, z, w: GATE_W, passed: false, missed: false,
    });
  }
  courseGroup.add(gatePoles, gateBases, gateFlags);
  // voyage stage 1 AND Time Attack/KAPPRO (stageId === null — the daily
  // course, same start line and gate 1) both want the "herbern" landmark
  // close beside gate 1, visible right from the start line — only stages
  // 2-5 (a different voyage leg entirely) skip it. See addHerbernNearGate1.
  if ((stageId === 1 || stageId === null) && gatePositions[0]) {
    addHerbernNearGate1(courseGroup, gatePositions[0].x, gatePositions[0].z, GATE_W);
  }

  // "A game by Winsen" entry banners — near the START LINE (not gate 1,
  // 140m in) so they're readable the moment the race begins. x is centred
  // on gate 1 (both boats spawn at gate1.x ± GATE1_LANE, main.js:2951/2953
  // — mirrored here as START_LANE_CLEARANCE since world.js can't import a
  // main.js constant), not world x=0, since gate 1's x is seed-dependent.
  // Weaker glow than the finish pair — discreet, not an ad. Added straight
  // to courseGroup (identity transform), so these ARE world coordinates.
  const START_LANE_CLEARANCE = 13; // clears both boats' hulls + oar sweep at the spawn lanes
  // z pushed from -16 to -30 — at -16 these sat almost exactly at the bow
  // tip's own depth (hull's dragon-head ornament reaches to roughly
  // z -12.5..-15.5), so from the intro cinematic's straight-down-the-hull
  // camera angle a banner read as pinned right against the boat
  //
  // x: the boot INTRO cinematic parks the fleet at FIXED world spots
  // (G.x=0, R.x=14 — main.js) that have nothing to do with this seed's
  // gate1.x, unlike a real race start where the boats actually sit at
  // gate1.x +/- GATE1_LANE. On a day gate1.x lands left of centre (as low
  // as here), the plain gate1.x-relative formula below can leave the RIGHT
  // banner closer to world x=14 than the rival boat itself, reading as
  // planted right on the Swedish ship. introSafeX clamps each banner to a
  // minimum distance from world x=0 that clears R's fixed intro spot with
  // real room to spare, regardless of which way gate1.x drifts that day —
  // whichever constraint (the gate1 formula or this floor) demands more
  // clearance wins, so real KAPPRO starts are untouched when it's already safe.
  const introSafeX = 34; // R's fixed intro rest x (14) + a comfortable margin
  const gx = gates[0].x;
  const hwLeft = Math.max(START_LANE_CLEARANCE, introSafeX + gx - BANNER_CLEARANCE);
  const hwRight = Math.max(START_LANE_CLEARANCE, introSafeX - gx - BANNER_CLEARANCE);
  const entryBanners = [
    flankBanner(gx, hwLeft, -30, -1, 0.12),
    flankBanner(gx, hwRight, -30, 1, 0.12),
  ];
  entryBanners.forEach((b) => courseGroup.add(b));

  // ---- Finish: giant football goal spanning the fjord ----
  const goalGroup = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const GOAL_W = 46, GOAL_H = 16;
  // both posts + crossbar merged into one mesh (perf: 3 draw calls → 1)
  const frameGeos = [
    new THREE.CylinderGeometry(0.8, 0.8, GOAL_H, 10).translate(-GOAL_W / 2, GOAL_H / 2, 0),
    new THREE.CylinderGeometry(0.8, 0.8, GOAL_H, 10).translate(GOAL_W / 2, GOAL_H / 2, 0),
    new THREE.CylinderGeometry(0.8, 0.8, GOAL_W + 1.6, 10).rotateZ(Math.PI / 2).translate(0, GOAL_H, 0),
  ];
  const goalFrameGeo = mergeGeometries(frameGeos);
  if (!goalFrameGeo) throw new Error('createGoal: attribute mismatch across merged posts');
  goalGroup.add(new THREE.Mesh(goalFrameGeo, postMat));
  frameGeos.forEach((g) => g.dispose());
  // net: wireframe plane angled back
  const netGeo = new THREE.PlaneGeometry(GOAL_W, GOAL_H + 4, 22, 10);
  const net = new THREE.Mesh(netGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.5 }));
  net.position.set(0, GOAL_H / 2 - 1, -6);
  net.rotation.x = 0.28;
  goalGroup.add(net);
  // FINISH banner — font size auto-shrinks to fit the canvas width (64px
  // Cinzel Bold badly overflowed a 512px-wide canvas for this string, which
  // baked clipped text right into the texture: "ISH — GO NORW"). Measuring
  // first keeps this correct regardless of exact string/font metrics.
  const bc = document.createElement('canvas');
  bc.width = 512; bc.height = 96;
  const bg = bc.getContext('2d');
  bg.fillStyle = '#ba0c2f'; bg.fillRect(0, 0, 512, 96);
  bg.fillStyle = '#fff';
  bg.textAlign = 'center'; bg.textBaseline = 'middle';
  const bannerText = 'FINISH — GO NORWAY!';
  const bannerMaxW = 472; // 512 canvas width minus ~20px margin each side
  let bannerFontSize = 64;
  bg.font = `900 ${bannerFontSize}px Cinzel, system-ui, serif`;
  while (bg.measureText(bannerText).width > bannerMaxW && bannerFontSize > 10) {
    bannerFontSize -= 2;
    bg.font = `900 ${bannerFontSize}px Cinzel, system-ui, serif`;
  }
  bg.fillText(bannerText, 256, 52);
  const bannerTex = new THREE.CanvasTexture(bc);
  bannerTex.colorSpace = THREE.SRGBColorSpace;
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(30, 5.6), new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide }));
  banner.position.y = GOAL_H + 5.4;
  goalGroup.add(banner);

  // "A game by Winsen" finish banners — flank the goal, stronger glow (base
  // color + shine + fresnel all bumped) than the entry pair so the lime
  // logo reads as backlit at the victory moment (main.js bumps bloomPulse
  // on the result-screen firework loop, which pulses these along with
  // everything else — no per-object code needed).
  const finishBanners = [-1, 1].map((side) => flankBanner(0, GOAL_W / 2, 5, side, 0.4, 0.22, 0.35));
  finishBanners.forEach((b) => goalGroup.add(b));

  goalGroup.position.set(0, 0, -length);
  courseGroup.add(goalGroup);

  // Fase 3c: the stage's landmark — built after ALL rnd() consumption so the
  // seeded layout above stays byte-identical whether or not one is requested.
  // C5: same rule for the horizon backdrop (it uses no rnd() at all).
  const landmarkOnlyTick = landmark ? buildLandmark(landmark, length, courseGroup) : null;
  const horizonTick = buildHorizon(stageId, length, courseGroup);
  // per-stage ambient decor (voyage only — see buildStageDecor). Runs after
  // every other rnd() consumer, so its draws can never shift the layout.
  const decorTick = buildStageDecor(stageId, length, courseGroup, rnd);
  // stage 5 only: actual land at the finish itself — see buildHomecomingHarbor
  const harborTick = stageId === 5 ? buildHomecomingHarbor(-length, courseGroup) : null;
  // stage 4 only: Manhattan behind the finish line — see buildNewYorkSkyline
  // (static, so no tick to combine below)
  if (stageId === 4) buildNewYorkSkyline(-length, courseGroup);
  // stage 4 only: the real close-up Statue of Liberty by the course side,
  // just before the finish — see addLibertyCloseup (also static)
  if (stageId === 4) addLibertyCloseup(courseGroup, length);
  const landmarkTick = (landmarkOnlyTick || horizonTick || decorTick || harborTick)
    ? (t) => {
        if (landmarkOnlyTick) landmarkOnlyTick(t);
        if (horizonTick) horizonTick(t);
        if (decorTick) decorTick(t);
        if (harborTick) harborTick(t);
      }
    : null;

  return {
    collectibles, obstacles, gates, goalGroup, group: courseGroup, finishZ: -length, landmarkTick,
    // instanced batches — updateCourse rewrites their matrices from the
    // collectibles/obstacles/gates data every frame
    ballMesh, glowMesh, floeMesh, gatePoles, gateBases, gateFlags,
    // "A game by Winsen" signature billboards — for verification via
    // window.__game.course.banners (see billboard.js). bannerClock is the
    // shared uTime uniform object; updateCourse() below writes .value each
    // frame and every banner material picks it up automatically.
    banners: { entry: entryBanners, finish: finishBanners },
    bannerClock: winsenBannerClock,
  };
}

// Fase 3c: removes a course from the scene and frees its GPU resources —
// called on stage switches (Regel 1-discipline at scene level). Geometries,
// materials and their textures are all per-course, so a full traverse-dispose
// is safe; nothing here is shared with the ships/water/mountains.
export function disposeCourse(scene, course) {
  if (!course || !course.group) return;
  scene.remove(course.group);
  course.group.traverse((o) => {
    if (o.isInstancedMesh) o.dispose(); // frees instanceMatrix/instanceColor GPU buffers
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      if (m.map) m.map.dispose();
      // ShaderMaterial (the banner shine — billboard.js) has no .map; its
      // texture lives in a uniform (uTex) instead, so the check above
      // misses it. Sweep every uniform value for a texture and dispose it
      // too, otherwise the shared banner.png GPU texture leaks on a stage
      // switch. Harmless if called 4x for the one shared texture — dispose
      // is idempotent.
      if (m.uniforms) {
        for (const key in m.uniforms) {
          const v = m.uniforms[key]?.value;
          if (v && v.isTexture) v.dispose();
        }
      }
      m.dispose();
    }
  });
}

// write one gate side's pole/base/flag instance matrices: the same transform
// the old sg group applied — bob to wave height, tilt rotation.z about the
// sg origin at (g.x + side*w/2, waveY, g.z) — with each part's local offset.
function _writeGateSide(course, g, k, side, w) {
  const rz = w.dx * 0.25;
  const cos = Math.cos(rz), sin = Math.sin(rz);
  const ox = g.x + side * (g.w / 2), oy = w.y;
  const slot = g.slot + k;
  const set = (im, lx, ly) => {
    _d.position.set(ox + lx * cos - ly * sin, oy + lx * sin + ly * cos, g.z);
    _d.rotation.set(0, 0, rz);
    _d.updateMatrix();
    im.setMatrixAt(slot, _d.matrix);
  };
  _d.scale.setScalar(1);
  set(course.gateBases, 0, 0.9);
  set(course.gatePoles, 0, 4.4);
  set(course.gateFlags, side * -1.0, 6.7);
}

// bob course objects on the waves
export function updateCourse(course, t, shipZ) {
  const { collectibles, obstacles, gates } = course;
  if (course.landmarkTick) course.landmarkTick(t); // Fase 3c: stage landmark animation
  // "A game by Winsen" banner shine — one write reaches all four shader
  // materials (they share this exact object as their uTime uniform). Runs
  // in every mode (menu/intro/race/result), same as the rest of this
  // function, driven by waterT (see main.js), which update(dt) advances
  // from BOTH the rAF loop and the setInterval fallback — never stalls in
  // a backgrounded tab.
  if (course.bannerClock) course.bannerClock.value = t;
  // Only touch a ball's instance matrix when its pose actually needs to change:
  // 'near' animates every frame (bobbing), but 'taken'/'rest' are static poses —
  // rewriting + re-uploading all 26×2 matrices every frame (even on the idle
  // menu) was pure waste. c._vis caches the last written state per ball; a
  // state change (including undefined → anything on the very first frame)
  // triggers exactly one write.
  let ballsDirty = false;
  for (const c of collectibles) {
    let state;
    if (c.taken) {
      state = 'taken';
      if (c._vis !== state) {
        _d.scale.setScalar(0); // collected — collapse the instance (invisible)
        _d.position.set(c.x, -10, c.z);
        _d.rotation.set(0, 0, 0);
      }
    } else if (Math.abs(c.z - shipZ) > 400) {
      state = 'rest';
      if (c._vis !== state) {
        _d.scale.setScalar(1); // far from ship: rest pose (also restores after a race reset)
        _d.position.set(c.x, 1.2, c.z);
        _d.rotation.set(0, 0, 0);
      }
    } else {
      state = 'near'; // always animated while in range
      const w = sampleWater(c.x, c.z, t);
      _d.scale.setScalar(1);
      _d.position.set(c.x, w.y + 1.3, c.z); // clear of short chop so waves never swallow the ball
      _d.rotation.set(0, t * 1.4 + c.spin, 0);
    }
    if (state === 'near' || c._vis !== state) {
      _d.updateMatrix();
      course.ballMesh.setMatrixAt(c.index, _d.matrix);
      course.glowMesh.setMatrixAt(c.index, _d.matrix);
      ballsDirty = true;
    }
    c._vis = state;
  }
  if (ballsDirty) {
    course.ballMesh.instanceMatrix.needsUpdate = true;
    course.glowMesh.instanceMatrix.needsUpdate = true;
  }
  if (course.floeMesh) {
    let floesDirty = false;
    for (const o of obstacles) {
      if (Math.abs(o.z - shipZ) > 400) continue;
      const w = sampleWater(o.x, o.z, t);
      _d.position.set(o.x, w.y + 0.25, o.z);
      _d.rotation.set(w.dx * 0.4 + (o.rot || 0), o.rotY, 0);
      _d.scale.set(o.size, o.size * 0.45, o.size);
      _d.updateMatrix();
      course.floeMesh.setMatrixAt(o.index, _d.matrix);
      floesDirty = true;
    }
    if (floesDirty) course.floeMesh.instanceMatrix.needsUpdate = true;
  }
  const nextGate = gates.find((g) => !g.passed && !g.missed && g.z < shipZ);
  let gatesDirty = false;
  for (const g of gates) {
    if (Math.abs(g.z - shipZ) > 500) continue;
    const wl = sampleWater(g.x - g.w / 2, g.z, t);
    const wr = sampleWater(g.x + g.w / 2, g.z, t);
    g.sideL.sg.position.y = wl.y;
    g.sideR.sg.position.y = wr.y;
    g.sideL.sg.rotation.z = wl.dx * 0.25;
    g.sideR.sg.rotation.z = wr.dx * 0.25;
    _writeGateSide(course, g, 0, -1, wl);
    _writeGateSide(course, g, 1, 1, wr);
    gatesDirty = true;
    g.banner.position.y = 5.7 + (wl.y + wr.y) * 0.35;

    // visual state: green when passed, faded when missed, pulsing when next
    if (g.passed) {
      g.bannerMat.color.setHex(0x6fff9e);
      g.bannerMat.opacity = 0.95;
      g.sideL.orb.material.emissive.setHex(0x2eff6e);
      g.sideR.orb.material.emissive.setHex(0x2eff6e);
      g.sideL.orb.material.emissiveIntensity = 2.2;
      g.sideR.orb.material.emissiveIntensity = 2.2;
      g.banner.scale.setScalar(1);
    } else if (g.missed) {
      g.bannerMat.color.setHex(0x8a93a5);
      g.bannerMat.opacity = 0.22;
      if (g.missFlashUntil && t < g.missFlashUntil) {
        // Portstraff: brief red flash on the orbs right when a KAPPRO miss
        // registers, then settle back to the normal dimmed-missed look
        g.sideL.orb.material.emissive.setHex(0xff2200);
        g.sideR.orb.material.emissive.setHex(0xff2200);
        g.sideL.orb.material.emissiveIntensity = 2.4;
        g.sideR.orb.material.emissiveIntensity = 2.4;
      } else {
        g.sideL.orb.material.emissive.setHex(0xffb52e);
        g.sideR.orb.material.emissive.setHex(0xffb52e);
        g.sideL.orb.material.emissiveIntensity = 0.15;
        g.sideR.orb.material.emissiveIntensity = 0.15;
      }
    } else if (g === nextGate) {
      // the gate to aim for: banner and beacons pulse
      const pulse = Math.sin(t * 5);
      g.bannerMat.color.setHex(0xffffff);
      g.bannerMat.opacity = 0.8 + pulse * 0.2;
      g.sideL.orb.material.emissive.setHex(0xffb52e);
      g.sideR.orb.material.emissive.setHex(0xffb52e);
      g.sideL.orb.material.emissiveIntensity = 2.4 + pulse * 1.4;
      g.sideR.orb.material.emissiveIntensity = 2.4 + pulse * 1.4;
      g.banner.scale.setScalar(1 + pulse * 0.035);
    } else {
      g.bannerMat.color.setHex(0xffffff);
      g.bannerMat.opacity = 0.6;
      g.sideL.orb.material.emissive.setHex(0xffb52e);
      g.sideR.orb.material.emissive.setHex(0xffb52e);
      g.sideL.orb.material.emissiveIntensity = 1.2;
      g.sideR.orb.material.emissiveIntensity = 1.2;
      g.banner.scale.setScalar(1);
    }
  }
  if (gatesDirty) {
    course.gatePoles.instanceMatrix.needsUpdate = true;
    course.gateBases.instanceMatrix.needsUpdate = true;
    course.gateFlags.instanceMatrix.needsUpdate = true;
  }
}
