import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sampleWater } from './water.js';

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

// ---- Sky dome with gradient + sun ----
export function createSky() {
  const geo = new THREE.SphereGeometry(2600, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x0e2454) },   // deep blue-hour zenith
      midColor: { value: new THREE.Color(0x4a6fa8) },
      botColor: { value: new THREE.Color(0xff9e52) },   // burning horizon
      sunDir: { value: new THREE.Vector3(0.35, 0.32, -0.88).normalize() },
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
      uniform vec3 topColor; uniform vec3 midColor; uniform vec3 botColor; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 col = mix(botColor, midColor, smoothstep(-0.02, 0.18, h));
        col = mix(col, topColor, smoothstep(0.15, 0.65, h));
        float sun = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
        col += vec3(1.0, 0.9, 0.65) * pow(sun, 350.0) * 1.6;   // disc
        col += vec3(1.0, 0.75, 0.45) * pow(sun, 14.0) * 0.28;  // halo
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
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

  const near = new THREE.Mesh(mergeGeometries(nearGeos), mat);
  const far = new THREE.Mesh(mergeGeometries(farGeos), farMat);
  nearGeos.forEach((g) => g.dispose());
  farGeos.forEach((g) => g.dispose());
  group.add(far, near);
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

// ---- Aurora borealis: additive shader ribbons dancing over the fjord ----
export function createAurora() {
  const group = new THREE.Group();
  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.y += sin(uv.x * 9.0 + uTime * 0.35) * 26.0;
        p.z += sin(uv.x * 5.0 - uTime * 0.22) * 30.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                   mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        // slow drifting bands + faster shimmering curtains
        float bands = noise(vec2(vUv.x * 4.0 - uTime * 0.04, vUv.y * 1.2 + uTime * 0.02));
        float curtain = noise(vec2(vUv.x * 16.0 + uTime * 0.1, vUv.y * 2.0 - uTime * 0.06));
        float a = smoothstep(0.28, 0.85, bands * 0.65 + curtain * 0.45);
        // soft top/bottom falloff
        float edge = smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.5, vUv.y);
        vec3 col = mix(vec3(0.15, 1.0, 0.45), vec3(0.45, 0.25, 1.0), vUv.y * 0.9 + curtain * 0.25);
        float glow = a * edge;
        gl_FragColor = vec4(col * glow * 2.4, glow * 0.85);
      }
    `,
  });
  // two ribbons at different heights/angles for depth
  // low over the ridgeline — the chase camera pitches down, so the visible sky
  // band is only ~10° above the horizon
  const r1 = new THREE.Mesh(new THREE.PlaneGeometry(3200, 300, 72, 6), mat);
  r1.position.set(-150, 235, -1300);
  r1.rotation.x = 0.22;
  const r2 = new THREE.Mesh(new THREE.PlaneGeometry(2600, 220, 60, 6), mat);
  r2.position.set(300, 340, -1550);
  r2.rotation.x = 0.28;
  r2.rotation.z = -0.05;
  r1.frustumCulled = r2.frustumCulled = false;
  group.add(r1, r2);
  return { group, update(t) { uniforms.uTime.value = t; } };
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

// ---- Gate banner: bold "PORT" strip readable from far away ----
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
  g.font = '900 46px "Avenir Next", system-ui, sans-serif';
  g.fillStyle = '#ffd25e';
  g.fillText('▼', 80, 47);
  g.fillText('▼', 432, 47);
  g.fillStyle = '#ffffff';
  g.fillText('P O R T', 256, 47);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---- Course: gates (buoy pairs), footballs, obstacles, finish goal ----
export function createCourse(scene) {
  let s = 424242;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };

  const collectibles = []; // {mesh, x, z, r, taken, spin}
  const obstacles = [];    // {mesh, x, z, r, hit}
  const gates = [];        // {left, right, x, z, passed}

  // footballs
  const ballGeo = new THREE.SphereGeometry(1.15, 14, 14);
  const ballMat = new THREE.MeshStandardMaterial({ map: makeFootballTexture(), roughness: 0.35 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd25e, transparent: true, opacity: 0.22, side: THREE.BackSide });

  for (let i = 0; i < 26; i++) {
    const z = -90 - (i / 26) * (COURSE_LENGTH - 200) - rnd() * 30;
    const x = (rnd() - 0.5) * 2 * (CHANNEL_HALF - 12);
    const ball = new THREE.Mesh(ballGeo, ballMat);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(1.7, 10, 10), glowMat);
    ball.add(glow);
    ball.position.set(x, 1.2, z);
    scene.add(ball);
    collectibles.push({ mesh: ball, x, z, r: 3.4, taken: false, spin: rnd() * 6 });
  }

  // obstacles: ice floes only — compact, readable hazards
  const iceMat = new THREE.MeshStandardMaterial({ color: 0xdcecf7, roughness: 0.3, flatShading: true });
  for (let i = 0; i < 22; i++) {
    const z = -160 - (i / 22) * (COURSE_LENGTH - 320) - rnd() * 40;
    const x = (rnd() - 0.5) * 2 * (CHANNEL_HALF - 8);
    const size = 1.8 + rnd() * 1.7; // varied floe sizes
    const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), iceMat);
    mesh.scale.y = 0.45;
    mesh.rotation.y = rnd() * Math.PI;
    mesh.position.set(x, 0.3, z);
    scene.add(mesh);
    obstacles.push({ mesh, x, z, r: size + 1.6, hit: false, rot: rnd() * 0.3 - 0.15 });
  }

  // gates: unmissable slalom ports — tall flag poles, glowing beacon orbs and
  // a banner spanning the whole gap so players instantly read where to steer
  const GATE_W = 17;
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 6.5, 8);
  const baseGeo = new THREE.ConeGeometry(1.15, 2.3, 8);
  const orbGeo = new THREE.SphereGeometry(0.4, 12, 12);
  const flagGeo = new THREE.PlaneGeometry(1.8, 1.05);
  const matPole = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6 });
  const matBaseR = new THREE.MeshStandardMaterial({ color: 0xba0c2f, roughness: 0.5 });
  const matBaseB = new THREE.MeshStandardMaterial({ color: 0x00205b, roughness: 0.5 });
  const matFlagR = new THREE.MeshBasicMaterial({ color: 0xd81a3f, side: THREE.DoubleSide });
  const matFlagB = new THREE.MeshBasicMaterial({ color: 0x2a6fd6, side: THREE.DoubleSide });
  const gateBannerTex = makeGateBannerTexture();
  for (let i = 0; i < 9; i++) {
    const z = -140 - (i / 9) * (COURSE_LENGTH - 300);
    const x = Math.sin(i * 1.7) * (CHANNEL_HALF - 30);
    const gateGroup = new THREE.Group();
    gateGroup.position.set(x, 0, z);
    const sides = [];
    for (const [side, baseMat, flagMat] of [[-1, matBaseR, matFlagR], [1, matBaseB, matFlagB]]) {
      const sg = new THREE.Group();
      sg.position.x = side * (GATE_W / 2);
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = 0.9;
      sg.add(base);
      const pole = new THREE.Mesh(poleGeo, matPole);
      pole.position.y = 4.4;
      sg.add(pole);
      const flag = new THREE.Mesh(flagGeo, flagMat);
      flag.position.set(side * -1.0, 6.7, 0); // flag points in toward the gap
      sg.add(flag);
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
    scene.add(gateGroup);
    gates.push({
      group: gateGroup, sideL: sides[0], sideR: sides[1], banner, bannerMat,
      x, z, w: GATE_W, passed: false, missed: false,
    });
  }

  // ---- Finish: giant football goal spanning the fjord ----
  const goalGroup = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const GOAL_W = 46, GOAL_H = 16;
  const postGeo = new THREE.CylinderGeometry(0.8, 0.8, GOAL_H, 10);
  const lp = new THREE.Mesh(postGeo, postMat); lp.position.set(-GOAL_W / 2, GOAL_H / 2, 0);
  const rp = new THREE.Mesh(postGeo, postMat); rp.position.set(GOAL_W / 2, GOAL_H / 2, 0);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, GOAL_W + 1.6, 10), postMat);
  bar.rotation.z = Math.PI / 2; bar.position.y = GOAL_H;
  goalGroup.add(lp, rp, bar);
  // net: wireframe plane angled back
  const netGeo = new THREE.PlaneGeometry(GOAL_W, GOAL_H + 4, 22, 10);
  const net = new THREE.Mesh(netGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.5 }));
  net.position.set(0, GOAL_H / 2 - 1, -6);
  net.rotation.x = 0.28;
  goalGroup.add(net);
  // MÅL banner
  const bc = document.createElement('canvas');
  bc.width = 512; bc.height = 96;
  const bg = bc.getContext('2d');
  bg.fillStyle = '#ba0c2f'; bg.fillRect(0, 0, 512, 96);
  bg.fillStyle = '#fff'; bg.font = '900 64px system-ui';
  bg.textAlign = 'center'; bg.textBaseline = 'middle';
  bg.fillText('MÅL — HEIA NORGE!', 256, 52);
  const bannerTex = new THREE.CanvasTexture(bc);
  bannerTex.colorSpace = THREE.SRGBColorSpace;
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(30, 5.6), new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide }));
  banner.position.y = GOAL_H + 5.4;
  goalGroup.add(banner);
  goalGroup.position.set(0, 0, -COURSE_LENGTH);
  scene.add(goalGroup);

  return { collectibles, obstacles, gates, goalGroup, finishZ: -COURSE_LENGTH };
}

// bob course objects on the waves
export function updateCourse(course, t, shipZ) {
  const { collectibles, obstacles, gates } = course;
  for (const c of collectibles) {
    if (c.taken) continue;
    if (Math.abs(c.z - shipZ) > 400) continue; // only animate near ship
    const w = sampleWater(c.x, c.z, t);
    c.mesh.position.y = w.y + 1.3; // clear of short chop so waves never swallow the ball
    c.mesh.rotation.y = t * 1.4 + c.spin;
  }
  for (const o of obstacles) {
    if (Math.abs(o.z - shipZ) > 400) continue;
    const w = sampleWater(o.x, o.z, t);
    o.mesh.position.y = w.y + 0.25;
    o.mesh.rotation.x = w.dx * 0.4 + (o.rot || 0);
  }
  const nextGate = gates.find((g) => !g.passed && !g.missed && g.z < shipZ);
  for (const g of gates) {
    if (Math.abs(g.z - shipZ) > 500) continue;
    const wl = sampleWater(g.x - g.w / 2, g.z, t);
    const wr = sampleWater(g.x + g.w / 2, g.z, t);
    g.sideL.sg.position.y = wl.y;
    g.sideR.sg.position.y = wr.y;
    g.sideL.sg.rotation.z = wl.dx * 0.25;
    g.sideR.sg.rotation.z = wr.dx * 0.25;
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
      g.sideL.orb.material.emissiveIntensity = 0.15;
      g.sideR.orb.material.emissiveIntensity = 0.15;
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
}
