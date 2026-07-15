import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const NO_RED = 0xba0c2f;
const NO_BLUE = 0x00205b;
const NO_WHITE = 0xf4f6fb;
const WOOD_DARK = 0x5a3a22;
const WOOD_MID = 0x7a5230;
const WOOD_LIGHT = 0x99693e;

// viking helmet (external GLB, cloned onto every crew head) — tune here.
// public/3d%20models/helmet.glb: 1 mesh / 1 material, Y-up, centered at
// origin, no node transform. Bounding box X=1.0 (horns), Y=0.70, Z=0.58.
const HELMET_URL = '/3d%20models/helmet.glb';
const HELMET_FIT_DEPTH = 0.46; // target size.z after auto-fit scale
const HELMET_Y = 1.34;         // anchor height in figure-local space (head center is y=1.38)
const HELMET_ROT_Y = 0;        // model is symmetrical — 0 is fine

// World Cup trophy (external GLB) — same auto-fit-on-load approach as the
// helmet above. Replaces the old procedural pedestal/cup/handles build.
const TROPHY_URL = '/3d%20models/trophy.glb';
const TROPHY_FIT_HEIGHT = 3.2; // target size.y after auto-fit scale — bigger, per request

// Norway's gunwale shield (external GLB) — replaces the old procedural
// disc+boss+painted-motif build, Norway only (Sweden keeps its own
// procedural yellow/blue shields). Same auto-fit-on-load approach as the
// trophy above: fits the FACE (max of X/Y) to SHIELD_FIT_SIZE so the model
// lands at the same footprint the old 0.62-radius disc had (diameter 1.24),
// keeping the oar-clearance geometry from addShields()'s SHIELD_Z untouched.
const SHIELD_URL = '/3d%20models/skjord.glb';
const SHIELD_FIT_SIZE = 1.24;

function woodMat(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.05 });
}

// ---- draw-call batching helpers ----
// The boats are built from dozens of tiny primitives; each used to be its own
// mesh (= its own draw call). Static parts that share a lighting model are
// baked into ONE vertex-colored geometry instead: bakePart() positions a
// primitive and stamps its flat color per-vertex, mergeParts() fuses a set
// into a single geometry. Animated pivots (rower arms, oars) keep their own
// mesh inside the same group hierarchy, so poseStroke() is untouched.
const _bakeEuler = new THREE.Euler();
const _bakeQuat = new THREE.Quaternion();
const _bakePos = new THREE.Vector3();
const _bakeScale = new THREE.Vector3(1, 1, 1);
const _bakeMtx = new THREE.Matrix4();
function bakePart(geo, colorHex, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0) {
  _bakeEuler.set(rx, ry, rz);
  _bakeQuat.setFromEuler(_bakeEuler);
  _bakePos.set(px, py, pz);
  _bakeMtx.compose(_bakePos, _bakeQuat, _bakeScale);
  geo.applyMatrix4(_bakeMtx);
  if (colorHex != null) {
    geo.deleteAttribute('uv'); // flat colors only — keeps merged attribute sets identical
    const c = new THREE.Color(colorHex);
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  return geo;
}
// straight rope run between two points — a thin cylinder aligned to the
// segment, color baked like every other part so it can join a vertex-colored
// bake (used for the standing rigging: stays + shrouds)
const _ropeDir = new THREE.Vector3(), _ropeMid = new THREE.Vector3();
const _ropeQuat = new THREE.Quaternion(), _ropeUp = new THREE.Vector3(0, 1, 0);
const _ropeMtx = new THREE.Matrix4(), _ropeOne = new THREE.Vector3(1, 1, 1);
function ropePart(from, to, radius, colorHex) {
  _ropeDir.subVectors(to, from);
  const len = _ropeDir.length();
  const geo = new THREE.CylinderGeometry(radius, radius, len, 5);
  _ropeQuat.setFromUnitVectors(_ropeUp, _ropeDir.normalize());
  _ropeMid.addVectors(from, to).multiplyScalar(0.5);
  _ropeMtx.compose(_ropeMid, _ropeQuat, _ropeOne);
  geo.applyMatrix4(_ropeMtx);
  return bakePart(geo, colorHex);
}

// a tapered round segment between two points — ropePart with independent
// end radii, so a chain of these along a curve reads as one smoothly
// flaring tube (used for the horn-blower's curved war horn)
function hornPart(from, to, rFrom, rTo, colorHex) {
  _ropeDir.subVectors(to, from);
  const len = _ropeDir.length();
  // CylinderGeometry's +Y end is radiusTop; setFromUnitVectors maps +Y onto
  // the from->to direction, so radiusTop is the radius at `to`
  const geo = new THREE.CylinderGeometry(rTo, rFrom, len * 1.08, 8);
  _ropeQuat.setFromUnitVectors(_ropeUp, _ropeDir.normalize());
  _ropeMid.addVectors(from, to).multiplyScalar(0.5);
  _ropeMtx.compose(_ropeMid, _ropeQuat, _ropeOne);
  geo.applyMatrix4(_ropeMtx);
  return bakePart(geo, colorHex);
}

// a flat-sided "wooden blade" segment between two points — like ropePart but
// rectangular (width × thickness) instead of round, and independently sized
// per call so a chain of these (each a hair wider than the last) reads as
// one continuous, tapering carved timber instead of a uniform tube. Used for
// the bow/stern stem posts, which need to look like a wide, integrated
// extension of the hull planking rather than a thin round neck bolted on.
function bladePart(from, to, width, thickness, colorHex, overlap = 1.06) {
  _ropeDir.subVectors(to, from);
  const len = _ropeDir.length();
  const geo = new THREE.BoxGeometry(width, len * overlap, thickness);
  _ropeQuat.setFromUnitVectors(_ropeUp, _ropeDir.normalize());
  _ropeMid.addVectors(from, to).multiplyScalar(0.5);
  _ropeMtx.compose(_ropeMid, _ropeQuat, _ropeOne);
  geo.applyMatrix4(_ropeMtx);
  return bakePart(geo, colorHex);
}

// samples `curve` into `segs` blade segments, width/thickness tapering per
// widthFn(tc)/thickFn(tc) (tc = segment-centre param, 0..1) — the reusable
// loft behind buildStem's bow/stern posts.
function bladeStem(curve, segs, widthFn, thickFn, colorHex, parts) {
  for (let i = 0; i < segs; i++) {
    const p0 = curve.getPoint(i / segs);
    const p1 = curve.getPoint((i + 1) / segs);
    const tc = (i + 0.5) / segs;
    parts.push(bladePart(p0, p1, widthFn(tc), thickFn(tc), colorHex));
  }
}

function mergeParts(parts) {
  const merged = mergeGeometries(parts, false);
  // mergeGeometries silently returns null on a mismatched attribute set (e.g. a
  // part missing 'color' or 'uv') — fail loudly here instead of crashing deep
  // inside the render loop on `new THREE.Mesh(null)` with no pointer back to
  // the offending part.
  if (!merged) throw new Error('mergeParts: attribute mismatch across merged geometries');
  for (const p of parts) p.dispose();
  return merged;
}

// ---- Hull wood texture (canvas): painterly clinker planking ----
// Mapped so the texture's Y (0..1) wraps once AROUND the hull half-section
// (the ring angle) and its X runs along the LENGTH — so the horizontal plank
// seams read as lengthwise clinker strakes, wood grain runs bow-to-stern.
// One shared instance (both boats' hulls are the same wood).
let _hullWoodTex = null;
function makeHullWoodTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  // warm wood base with a gentle top(rail)->bottom(keel) tone shift
  const base = g.createLinearGradient(0, 0, 0, 256);
  base.addColorStop(0, '#8a5e37');
  base.addColorStop(0.5, '#79512e');
  base.addColorStop(1, '#684325');
  g.fillStyle = base; g.fillRect(0, 0, 1024, 256);
  // lengthwise grain streaks (subtle, wandering)
  g.globalAlpha = 0.13;
  for (let i = 0; i < 130; i++) {
    const y0 = Math.random() * 256;
    g.strokeStyle = Math.random() < 0.5 ? '#4c3216' : '#a7764c';
    g.lineWidth = 0.5 + Math.random() * 1.3;
    g.beginPath(); g.moveTo(0, y0);
    let x = 0, yy = y0;
    while (x < 1024) { x += 36 + Math.random() * 64; yy = y0 + (Math.random() - 0.5) * 7; g.lineTo(x, yy); }
    g.stroke();
  }
  g.globalAlpha = 1;
  // plank seams — ~10 lengthwise strakes, each a dark groove + a lit overlap
  // lip + a soft shadow band below (the overlapping clinker plank shading
  // itself) + a row of rivet heads, so every strake reads as a separate
  // overlapping board like the reference, not just a scribed line
  const PLANKS = 10;
  for (let p = 0; p <= PLANKS; p++) {
    const y = (p / PLANKS) * 256;
    // clinker overlap shadow: the board above shades the top of the one below
    const shadow = g.createLinearGradient(0, y, 0, y + 11);
    shadow.addColorStop(0, 'rgba(20,12,5,0.42)');
    shadow.addColorStop(1, 'rgba(20,12,5,0)');
    g.fillStyle = shadow; g.fillRect(0, y, 1024, 11);
    g.strokeStyle = 'rgba(33,20,9,0.85)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= 1024; x += 16) g.lineTo(x, y + Math.sin(x * 0.03) * 1.3);
    g.stroke();
    g.strokeStyle = 'rgba(196,156,104,0.34)'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(0, y + 3);
    for (let x = 0; x <= 1024; x += 16) g.lineTo(x, y + 3 + Math.sin(x * 0.03) * 1.3);
    g.stroke();
    // rivet/nail heads along the seam (offset every other strake, like real
    // clinker fastening) — dark head + tiny top highlight
    if (p > 0 && p < PLANKS) {
      for (let x = (p % 2) * 24 + 14; x < 1024; x += 48) {
        const ry = y + 5 + Math.sin(x * 0.03) * 1.3;
        g.fillStyle = 'rgba(24,15,8,0.85)';
        g.beginPath(); g.arc(x, ry, 2.3, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(212,178,130,0.5)';
        g.beginPath(); g.arc(x - 0.7, ry - 0.7, 0.9, 0, Math.PI * 2); g.fill();
      }
    }
  }
  // weathering blotches
  g.globalAlpha = 0.10;
  for (let i = 0; i < 46; i++) {
    g.fillStyle = Math.random() < 0.5 ? '#382510' : '#b98d60';
    g.beginPath();
    g.ellipse(Math.random() * 1024, Math.random() * 256, 8 + Math.random() * 30, 5 + Math.random() * 14, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
function hullWoodTexture() {
  if (!_hullWoodTex) _hullWoodTex = makeHullWoodTexture();
  return _hullWoodTex;
}

// ---- Deck plank texture (canvas): lengthwise boards across the width ----
// BoxGeometry's default UV maps the top face 0..1 across width (u) and
// length (v) — a texture with only VERTICAL seams (no horizontal ones) tiles
// cleanly along v even though each deck segment resets its own 0..1 range.
let _deckTex = null;
function makeDeckTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  const base = g.createLinearGradient(0, 0, 512, 0);
  base.addColorStop(0, '#8f6440');
  base.addColorStop(0.5, '#a3754e');
  base.addColorStop(1, '#8f6440');
  g.fillStyle = base; g.fillRect(0, 0, 512, 512);
  // lengthwise grain streaks — short and wandering, deck boards are shorter
  // runs than the full hull strakes
  g.globalAlpha = 0.10;
  for (let i = 0; i < 90; i++) {
    const x0 = Math.random() * 512;
    g.strokeStyle = Math.random() < 0.5 ? '#4c3216' : '#c99a68';
    g.lineWidth = 0.6 + Math.random() * 1.2;
    g.beginPath(); g.moveTo(x0, 0);
    let y = 0, xx = x0;
    while (y < 512) { y += 26 + Math.random() * 40; xx = x0 + (Math.random() - 0.5) * 5; g.lineTo(xx, y); }
    g.stroke();
  }
  g.globalAlpha = 1;
  // plank seams — vertical dark grooves across the width, evenly spaced,
  // with a lit overlap lip + peg/nail dots along each one
  const PLANKS = 6;
  for (let p = 0; p <= PLANKS; p++) {
    const x = (p / PLANKS) * 512;
    g.strokeStyle = 'rgba(30,18,8,0.75)'; g.lineWidth = 3.5;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke();
    g.strokeStyle = 'rgba(210,170,120,0.25)'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(x + 3, 0); g.lineTo(x + 3, 512); g.stroke();
    if (p < PLANKS) {
      for (let ny = 30; ny < 512; ny += 90) {
        g.fillStyle = 'rgba(20,12,6,0.5)';
        g.beginPath(); g.arc(x + 8, ny, 2.2, 0, Math.PI * 2); g.fill();
      }
    }
  }
  // gentle weathering blotches (foot traffic, water stains)
  g.globalAlpha = 0.08;
  for (let i = 0; i < 30; i++) {
    g.fillStyle = Math.random() < 0.5 ? '#3a2410' : '#c19a68';
    g.beginPath();
    g.ellipse(Math.random() * 512, Math.random() * 512, 10 + Math.random() * 26, 6 + Math.random() * 14, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
function deckTexture() {
  if (!_deckTex) _deckTex = makeDeckTexture();
  return _deckTex;
}

// ---- Sail texture: the sail IS the national flag (reference-ship style —
// full-bleed cross layout), dressed as woven, sewn, weathered cloth ----
function makeSailTexture(team = 'norway') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  if (team === 'sweden') {
    // Swedish flag, 16:10 proportions mapped to the full canvas:
    // vertical band 5-2-9, horizontal band 4-2-4
    g.fillStyle = '#005ba0'; g.fillRect(0, 0, 512, 512);
    g.fillStyle = '#fecc02';
    g.fillRect(160, 0, 64, 512);
    g.fillRect(0, 205, 512, 102);
  } else {
    // Norwegian flag, 22:16 proportions mapped to the full canvas:
    // vertical 6-1-2-1-12, horizontal 6-1-2-1-6 (white borders around blue)
    g.fillStyle = '#ba0c2f'; g.fillRect(0, 0, 512, 512);
    g.fillStyle = '#f4f6fb';
    g.fillRect(140, 0, 93, 512);
    g.fillRect(0, 192, 512, 128);
    g.fillStyle = '#00205b';
    g.fillRect(163, 0, 47, 512);
    g.fillRect(0, 224, 512, 64);
  }
  // sewn cloth panels — faint horizontal stitch seams across the whole sail,
  // like the reference's banded canvas
  for (let y = 64; y < 512; y += 64) {
    g.strokeStyle = 'rgba(0,0,0,0.10)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, y + 2); g.lineTo(512, y + 2); g.stroke();
  }
  // woven-fabric crosshatch — faint diagonal threads both ways, so the
  // sail reads as cloth instead of a flat clean color fill
  g.globalAlpha = 0.05;
  g.strokeStyle = '#000000'; g.lineWidth = 1;
  for (let x = -512; x < 512 * 2; x += 6) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 512, 512); g.stroke();
    g.beginPath(); g.moveTo(x, 512); g.lineTo(x + 512, 0); g.stroke();
  }
  g.globalAlpha = 1;
  // weathering blotches — the flag cloth is sea-worn, not print-fresh
  g.globalAlpha = 0.07;
  for (let i = 0; i < 26; i++) {
    g.fillStyle = Math.random() < 0.5 ? '#241a10' : '#e8dcc8';
    g.beginPath();
    g.ellipse(Math.random() * 512, Math.random() * 512, 14 + Math.random() * 40, 8 + Math.random() * 20, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  // worn/frayed bottom edge — a scalloped shadow line a little way up from
  // the foot of the sail
  g.globalAlpha = 0.16;
  g.fillStyle = '#000000';
  g.beginPath(); g.moveTo(0, 512);
  for (let x = 0; x <= 512; x += 24) g.lineTo(x, 500 - Math.sin(x * 0.13) * 6 - Math.random() * 4);
  g.lineTo(512, 512); g.closePath(); g.fill();
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---- Hull built from lofted cross-sections ----
function buildHull(woodVertexMat) {
  const group = new THREE.Group();

  // Hull via lathe-like custom geometry: series of ribs from bow to stern
  const L = 16; // half-length reach
  const segs = 34;
  const ringPts = 9;
  const positions = [];
  const indices = [];
  const uvs = [];

  // hull profile: width & depth vary along length. Deeper and rounder than
  // the old shallow-dish profile (max depth ~2.3 vs the old ~1.6), with a
  // long, even sheerline instead of a dramatic late upswing — reshaped to
  // match a reference photo (see CROSS_PWR/prof below for the how/why).
  const prof = (t) => {
    // t in [0,1] bow->stern
    const s = Math.sin(t * Math.PI); // 0 at ends, 1 middle
    const width = 2.5 * Math.pow(s, 0.62); // plan-view taper — unchanged
    const depth = 2.2 * Math.pow(s, 0.5) + 0.12; // was 1.45 -> deeper, sturdier hull
    // sheerline: a long, even S-curve. The old ^3.2 power kept the rail
    // almost flat until literally the last few percent of the length, then
    // snapped upward — a dramatic, exaggerated "crescent moon" silhouette.
    // This one starts easing up at the outer third (riseStart) and grows in
    // with a smoothstep, so the rise is gradual and visible well before the
    // stem, with no sudden kink where the hull hands off to the bow/stern
    // stem geometry above.
    const k = Math.abs(t - 0.5) * 2; // 0 at midship, 1 at the very tip
    const riseStart = 0.34;
    const k2 = Math.max(0, (k - riseStart) / (1 - riseStart));
    const ease = k2 * k2 * (3 - 2 * k2); // smoothstep
    // ease^1.7 * 4.4: exponent/peak tuned together so the sweep at the
    // deck/rail/shield band (t≈0.175..0.825) stays within a few percent of
    // the original calibration — none of that moves — while the hull's own
    // PLANKED ends rise in one grand arc from the waterline (the reference's
    // "store bue"); the compact carved hook + head then crowns that arc
    // instead of providing the height themselves.
    const sweep = Math.pow(ease, 1.7) * 4.4;
    return { width, depth, sweep };
  };

  // Cross-section: `a` sweeps 0 (rail) -> π/2 (keel) -> π (other rail). Raising
  // sin(a) to a sub-1 power spends the depth FASTER near the rail — the
  // topsides stay closer to vertical for longer before rounding smoothly
  // through the bilge into the keel — instead of the old plain ellipse
  // (power 1), which read as a shallow, flat-bottomed dish at low depth.
  const CROSS_PWR = 0.62;
  const crossPoint = (a, width, depth, sweep) => ({
    x: Math.cos(a) * width,
    y: -Math.pow(Math.sin(a), CROSS_PWR) * depth + sweep,
  });

  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const z = (t - 0.5) * 2 * L;
    const { width, depth, sweep } = prof(t);
    for (let j = 0; j <= ringPts; j++) {
      const a = (j / ringPts) * Math.PI; // half circle, port->starboard
      const { x, y } = crossPoint(a, width, depth, sweep);
      positions.push(x, y, z);
      // u = along the length (grain runs bow->stern), v = around the ring
      // (plank seams stack from the keel up to the rails)
      uvs.push(t, j / ringPts);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < ringPts; j++) {
      const a = i * (ringPts + 1) + j;
      const b = a + ringPts + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const hullGeo = new THREE.BufferGeometry();
  hullGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  hullGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  hullGeo.setIndex(indices);
  hullGeo.computeVertexNormals();
  const hull = new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({
    map: hullWoodTexture(), roughness: 0.85, metalness: 0.04, side: THREE.DoubleSide,
  }));
  hull.castShadow = true;
  group.add(hull);

  // all static wood trim baked into ONE vertex-colored mesh (was ~14 meshes):
  // plank ribs, gunwale rails, deck, dragon neck/head/horns, stern tail
  const woodParts = [];
  // clinker plank ribs — raised strakes that FOLLOW the hull surface (via the
  // same prof()), so they hug the curve at bow/stern instead of the old
  // straight boxes that poked out past the hull where it sweeps upward.
  // Each rib = a TubeGeometry through surface points sampled along the length.
  // six strakes per side (was three) so the clinker stepping reads clearly
  // from the chase camera, like the reference's tightly stacked bordganger
  const RIB_ANGLES = [0.18, 0.32, 0.46, 0.60, 0.74, 0.88]; // fraction of the top->keel quarter-turn
  for (const side of [-1, 1]) {
    for (const af of RIB_ANGLES) {
      const a = af * (Math.PI / 2); // 0 = at the rail, π/2 = toward the keel
      const ca = Math.cos(a), sa = Math.sin(a);
      const pts = [];
      for (let s = 0; s <= 14; s++) {
        const t = 0.09 + (s / 14) * 0.82;
        const { width, depth, sweep } = prof(t);
        // surface point (same crossPoint formula as the hull ring itself, so
        // the rib always sits flush on the new surface) + a small outward
        // offset so the rib sits proud of the hull skin
        const base = crossPoint(a, width, depth, sweep);
        const x = (base.x + ca * 0.05) * side;
        const y = base.y - sa * 0.05;
        pts.push(new THREE.Vector3(x, y, (t - 0.5) * 2 * L));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      woodParts.push(bakePart(new THREE.TubeGeometry(curve, 26, 0.05, 6), WOOD_DARK));
    }
  }
  // gunwale rails — cut to the same safe t-range as the deck below (0.18..
  // 0.82, re-derived for the new deeper/reshaped hull): past that the hull
  // has already swept upward into the bow/stern curve, so a rail running
  // the old full length stuck out through open air right where the hull
  // curved away above it.
  const RAIL_LEN = (0.82 - 0.18) * 2 * L;
  for (const side of [-1, 1]) {
    woodParts.push(bakePart(new THREE.BoxGeometry(0.22, 0.22, RAIL_LEN), WOOD_LIGHT, side * 2.42, 0.28, 0));
  }
  // deck — segmented so its width follows the hull's taper (via the same
  // prof() used for the hull rings) instead of one fixed-width plank that
  // overhangs the sides right where the bow/stern sweep upward. Textured
  // (not vertex-colored), so it gets its own merge + material rather than
  // joining woodParts/woodVertexMat.
  // T0/T1 stop well short of the bow/stern: past t≈0.167/0.833 the hull's
  // sweep has already lifted its own wall above the deck's fixed y=-0.28
  // (re-derived numerically for the new deeper/reshaped hull profile — the
  // old 0.185/0.815 was calibrated for the old, shallower one and no longer
  // matches). 0.175..0.825 stays safely inside the hull's cross-section at
  // every point while still reaching the stern figure at t≈0.81.
  const deckParts = [];
  const DECK_SEGS = 7, DECK_T0 = 0.175, DECK_T1 = 0.825;
  for (let i = 0; i < DECK_SEGS; i++) {
    const t0 = DECK_T0 + (i / DECK_SEGS) * (DECK_T1 - DECK_T0);
    const t1 = DECK_T0 + ((i + 1) / DECK_SEGS) * (DECK_T1 - DECK_T0);
    const tc = (t0 + t1) / 2;
    const deckW = Math.min(2.2, prof(tc).width * 0.86) * 2; // stay safely inside the hull wall
    const z = (tc - 0.5) * 2 * L;
    const segLen = (t1 - t0) * 2 * L * 1.04; // tiny overlap so seams don't gap
    deckParts.push(bakePart(new THREE.BoxGeometry(deckW, 0.14, segLen), null, 0, -0.28, z));
  }
  group.add(new THREE.Mesh(mergeParts(deckParts), new THREE.MeshStandardMaterial({
    map: deckTexture(), roughness: 0.88, metalness: 0.03,
  })));

  // ---- bow stem: a wide, tapering carved post that grows straight out of
  // the hull's own forward planking (base width/position matched to prof()
  // at t=0.04, where the hull already has real substance), instead of a
  // thin round tube neck bolted on top with a gap. Reference-photo style:
  // broad and continuous with the hull, narrowing gradually toward a
  // compact head — not a long thin neck with separate horn/fin parts.
  // anchored at t=0.02 (near the hull's very tip) so the hook grows out of
  // the TOP of the hull's grand planked arc and wraps its knife edge,
  // rather than standing inboard of it
  const bowBase = prof(0.02);
  const bowBaseZ = (0.02 - 0.5) * 2 * L;
  // compact reference-style bow: a SHORT, tight hook — rises out of the
  // hull planking, arcs up-forward, and bends gently BACKWARD at the top
  // (recurve), so the head sits close over the prow instead of on a long
  // near-vertical neck. 14 segments keep the tight arc smooth.
  const stemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, bowBase.sweep, bowBaseZ),
    new THREE.Vector3(0, bowBase.sweep + 0.5, bowBaseZ - 0.49),
    new THREE.Vector3(0, bowBase.sweep + 0.95, bowBaseZ - 0.69),
    new THREE.Vector3(0, bowBase.sweep + 1.25, bowBaseZ - 0.44),
  ]);
  bladeStem(
    stemCurve, 14,
    (tc) => THREE.MathUtils.lerp(bowBase.width * 1.85, 0.36, tc),
    (tc) => THREE.MathUtils.lerp(0.62, 0.3, tc),
    WOOD_DARK, woodParts,
  );
  // head: crowns the recurved tip — compact, close to the hull, snout
  // reaching forward and dipping slightly (same carved style as before,
  // just mounted low on the tight arc instead of a tall neck)
  const stemTip = stemCurve.getPoint(1);
  const headCurve = new THREE.CatmullRomCurve3([
    stemTip,
    new THREE.Vector3(0, stemTip.y + 0.03, stemTip.z - 0.35),
    new THREE.Vector3(0, stemTip.y - 0.17, stemTip.z - 0.68),
  ]);
  bladeStem(
    headCurve, 7,
    (tc) => THREE.MathUtils.lerp(0.5, 0.26, tc),
    (tc) => THREE.MathUtils.lerp(0.42, 0.2, tc),
    WOOD_DARK, woodParts,
  );
  // lower jaw — a short blade offset below the snout with a visible gap, so
  // the head reads as an open, carved mouth (opening forward-down now)
  const snoutTip = headCurve.getPoint(1);
  const jawBase = new THREE.Vector3(0, snoutTip.y - 0.06, snoutTip.z + 0.42);
  const jawTip = new THREE.Vector3(0, snoutTip.y - 0.32, snoutTip.z - 0.1);
  woodParts.push(bladePart(jawBase, jawTip, 0.22, 0.16, WOOD_DARK));
  // teeth — a couple of small light nubs right at the jaw gap
  for (const s of [-1, 1]) {
    woodParts.push(bakePart(new THREE.ConeGeometry(0.028, 0.13, 5), HORN_COLOR, s * 0.07, jawBase.y - 0.02, jawBase.z - 0.12, Math.PI, 0, 0));
  }
  // small rounded ears — swept back behind the crown like the reference
  const earP = headCurve.getPoint(0.15);
  for (const s of [-1, 1]) {
    woodParts.push(bakePart(new THREE.ConeGeometry(0.055, 0.2, 6), WOOD_LIGHT, s * 0.16, earP.y + 0.1, earP.z + 0.1, 0.35, 0, -s * 0.6));
  }
  // serrated mane crest down the bow stem — a run of small fins matching the
  // reference's feathered dragon-neck edge (mirrors the stern's crest row)
  for (const tf of [0.3, 0.48, 0.66, 0.84]) {
    const p = stemCurve.getPoint(tf);
    const h = 0.24 - tf * 0.07; // scaled down with the shorter, compact stem
    woodParts.push(bakePart(new THREE.ConeGeometry(0.06, h, 5), WOOD_LIGHT, p.x, p.y + h * 0.55, p.z, -0.5, 0, 0));
  }

  // ---- stern stem: same wide, integrated-with-the-hull language as the
  // bow, ending in a small, tight carved spiral instead of the old large
  // loose curl.
  const sternBase = prof(0.98);
  const sternBaseZ = (0.98 - 0.5) * 2 * L;
  // same compact hook as the bow, mirrored: rises out of the TOP of the
  // hull's grand planked arc, arcs up-backward, bends gently FORWARD at
  // the top — the scroll finial is anchored to the curve tip, so it rides
  // the recurve
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, sternBase.sweep, sternBaseZ),
    new THREE.Vector3(0, sternBase.sweep + 0.5, sternBaseZ + 0.49),
    new THREE.Vector3(0, sternBase.sweep + 0.95, sternBaseZ + 0.69),
    new THREE.Vector3(0, sternBase.sweep + 1.25, sternBaseZ + 0.44),
  ]);
  bladeStem(
    tailCurve, 10,
    (tc) => THREE.MathUtils.lerp(sternBase.width * 1.85, 0.3, tc),
    (tc) => THREE.MathUtils.lerp(0.62, 0.22, tc),
    WOOD_DARK, woodParts,
  );
  // serrated mane crest down the stern stem — a run of small fins like the
  // reference's feathered stem edge (the bow stem gets the same treatment)
  for (const tf of [0.28, 0.46, 0.64, 0.82]) {
    const p = tailCurve.getPoint(tf);
    const h = 0.22 - tf * 0.07; // scaled down with the shorter, compact stem
    woodParts.push(bakePart(new THREE.ConeGeometry(0.055, h, 5), WOOD_LIGHT, p.x, p.y + h * 0.55, p.z, -0.5, 0, 0));
  }
  // large carved scroll finial — a proper fern-spiral like the reference's
  // stern: ~2.2 turns tightening inward, built as two tube halves so the
  // outer run is visibly thicker than the inner curl (TubeGeometry itself
  // can't taper). The spiral center sits above/behind the stem tip so the
  // curl sweeps up-forward over the top and winds in on itself.
  {
    const tipBase = tailCurve.getPoint(1);
    // tighter center offset = smaller scroll, in scale with the compact stem
    const C = new THREE.Vector3(0, tipBase.y + 0.26, tipBase.z + 0.26);
    const r0 = C.distanceTo(tipBase);
    const th0 = Math.atan2(tipBase.y - C.y, tipBase.z - C.z);
    const SPIRAL_TURNS = 2.2, PTS = 44;
    const spiralPoint = (t) => {
      const th = th0 - t * SPIRAL_TURNS * Math.PI * 2; // minus: tangent continues the stem's up-forward sweep
      const r = r0 * (1 - 0.88 * t) + 0.02;
      return new THREE.Vector3(0, C.y + Math.sin(th) * r, C.z + Math.cos(th) * r);
    };
    const outer = [], inner = [];
    for (let k = 0; k <= PTS; k++) {
      const t = k / PTS;
      (t <= 0.52 ? outer : inner).push(spiralPoint(t));
    }
    inner.unshift(outer[outer.length - 1]); // share the seam point — no gap
    woodParts.push(bakePart(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(outer), 26, 0.085, 7), WOOD_DARK));
    woodParts.push(bakePart(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(inner), 22, 0.052, 6), WOOD_DARK));
  }
  group.add(new THREE.Mesh(mergeParts(woodParts), woodVertexMat));

  // eyes — hot emissive so the bloom pass makes them burn at dusk (one mesh)
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffd25e, emissive: 0xffa500, emissiveIntensity: 2.2 });
  const eyeP = headCurve.getPoint(0.35);
  const eyeParts = [-1, 1].map((s) => bakePart(new THREE.SphereGeometry(0.075, 8, 8), null, s * 0.15, eyeP.y + 0.08, eyeP.z));
  group.add(new THREE.Mesh(mergeParts(eyeParts), eyeMat));

  return { group, L };
}

// ---- Shield motif atlas (canvas): one painted Norse motif per colour slot,
// laid out as 3 tiles side by side so all 14 shields' motifs share ONE
// texture + ONE merged mesh (no extra draw calls). ----
// vegvisir/rune-compass: 8 radial staves, each with a crossbar partway out
// and alternating fork/T-bar terminals — the painted motif on the reference
// ship's shields. `variant` flips which staves get forks so the two
// vegvisir tiles don't read as identical.
function drawVegvisirMotif(g, cx, cy, r, ink, variant = 0) {
  g.strokeStyle = ink; g.lineCap = 'round';
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const ux = Math.cos(a), uy = Math.sin(a);
    const bx = -uy, by = ux; // perpendicular to the stave
    const P = (d, o = 0) => [cx + ux * d + bx * o, cy + uy * d + by * o];
    g.lineWidth = r * 0.07;
    g.beginPath(); g.moveTo(...P(r * 0.14)); g.lineTo(...P(r * 0.94)); g.stroke();
    // crossbar partway out
    g.beginPath(); g.moveTo(...P(r * 0.52, r * 0.13)); g.lineTo(...P(r * 0.52, -r * 0.13)); g.stroke();
    if ((k + variant) % 2 === 0) {
      // fork terminal — two prongs splaying outward from near the tip
      for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(...P(r * 0.76)); g.lineTo(...P(r * 0.98, s * r * 0.15)); g.stroke();
      }
    } else {
      // T-bar terminal
      g.beginPath(); g.moveTo(...P(r * 0.94, r * 0.14)); g.lineTo(...P(r * 0.94, -r * 0.14)); g.stroke();
    }
  }
  // small center ring
  g.lineWidth = r * 0.06;
  g.beginPath(); g.arc(cx, cy, r * 0.13, 0, Math.PI * 2); g.stroke();
}
function drawVegvisirAltMotif(g, cx, cy, r, ink) {
  drawVegvisirMotif(g, cx, cy, r, ink, 1);
}
// 8-spoke compass cross — the simpler companion motif between the vegvisirs
function drawCrossMotif(g, cx, cy, r, ink) {
  g.strokeStyle = ink; g.lineCap = 'round';
  g.lineWidth = r * 0.14;
  g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx, cy + r); g.stroke();
  g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.stroke();
  g.lineWidth = r * 0.08;
  const d = r * 0.68;
  g.beginPath(); g.moveTo(cx - d, cy - d); g.lineTo(cx + d, cy + d); g.stroke();
  g.beginPath(); g.moveTo(cx - d, cy + d); g.lineTo(cx + d, cy - d); g.stroke();
  g.lineWidth = r * 0.07;
  g.beginPath(); g.arc(cx, cy, r * 0.92, 0, Math.PI * 2); g.stroke();
}
function makeShieldMotifTexture(team = 'norway') {
  const colors = team === 'sweden' ? [0xfecc02, 0x0072ce, 0x005ba0] : [NO_RED, NO_WHITE, NO_BLUE];
  const motifs = [drawVegvisirMotif, drawCrossMotif, drawVegvisirAltMotif];
  const TILE = 256;
  const c = document.createElement('canvas');
  c.width = TILE * 3; c.height = TILE;
  const g = c.getContext('2d');
  colors.forEach((hex, i) => {
    const cx = i * TILE + TILE / 2, cy = TILE / 2;
    const base = '#' + hex.toString(16).padStart(6, '0');
    g.save();
    g.beginPath(); g.arc(cx, cy, TILE / 2 - 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = base; g.fillRect(i * TILE, 0, TILE, TILE);
    // domed-metal shading so the flat paint reads as a worked disc
    const rg = g.createRadialGradient(cx, cy - 24, 8, cx, cy, TILE / 2);
    rg.addColorStop(0, 'rgba(255,255,255,0.20)');
    rg.addColorStop(0.6, 'rgba(255,255,255,0)');
    rg.addColorStop(1, 'rgba(0,0,0,0.28)');
    g.fillStyle = rg; g.fillRect(i * TILE, 0, TILE, TILE);
    // light wear scuffs
    g.globalAlpha = 0.12;
    for (let k = 0; k < 10; k++) {
      g.strokeStyle = Math.random() < 0.5 ? '#000' : '#fff';
      g.lineWidth = 1 + Math.random() * 2;
      g.beginPath();
      const a = Math.random() * Math.PI * 2, rr = Math.random() * TILE * 0.4;
      g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      g.lineTo(cx + Math.cos(a) * rr + (Math.random() - 0.5) * 30, cy + Math.sin(a) * rr + (Math.random() - 0.5) * 30);
      g.stroke();
    }
    g.globalAlpha = 1;
    // radial board seams — the shield face is built from planks
    g.strokeStyle = 'rgba(0,0,0,0.14)'; g.lineWidth = 1.5;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI;
      g.beginPath();
      g.moveTo(cx - Math.cos(a) * TILE * 0.5, cy - Math.sin(a) * TILE * 0.5);
      g.lineTo(cx + Math.cos(a) * TILE * 0.5, cy + Math.sin(a) * TILE * 0.5);
      g.stroke();
    }
    const ink = (hex === NO_WHITE || hex === 0xfecc02) ? 'rgba(25,22,18,0.72)' : 'rgba(240,232,215,0.82)';
    motifs[i % motifs.length](g, cx, cy, TILE * 0.34, ink);
    // painted rim ring — dark band around the edge with a thin light inline,
    // like the reference shields' bound rims
    g.strokeStyle = 'rgba(30,20,10,0.75)'; g.lineWidth = TILE * 0.045;
    g.beginPath(); g.arc(cx, cy, TILE * 0.462, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = ink; g.lineWidth = TILE * 0.014;
    g.beginPath(); g.arc(cx, cy, TILE * 0.43, 0, Math.PI * 2); g.stroke();
    g.restore();
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---- Shields along the gunwale ----
// Norway: the real skjord.glb model, one clone per slot (createSkjordAnchor,
// defined below near its loader). Sweden: unchanged procedural yellow/blue
// discs — this team never asked for the model swap.
function addShields(group, L, team = 'norway') {
  // Shield slots sit MIDWAY between the oarlock rows (oars pivot at
  // z = -6.95, -3.85, -0.75, 2.35, 5.45 — see the rower loops in
  // buildShip), so a shaft can never clip a shield: every slot is ≥1.55
  // in z from the nearest oarlock, and a collision needs < ~0.68 (shield
  // radius 0.62 + shaft radius, at the same gunwale x). The old evenly-
  // spread slots (±0.45L/±0.225L/0) put two shields within 0.25 of an
  // oarlock — the shafts ran straight through them. All slots stay inside
  // the same flat-rail range as before (|z| ≤ ~8.5, well short of the
  // t≈0.815 bow/stern sweep).
  const SHIELD_Z = [-8.5, -5.4, -2.3, 0.8, 3.9, 7.2];
  if (team === 'norway') {
    for (const z of SHIELD_Z) {
      for (const side of [-1, 1]) {
        const anchor = createSkjordAnchor();
        anchor.position.set(side * 2.52, 0.42, z);
        // face outward — same convention the old painted motif disc used
        anchor.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        group.add(anchor);
      }
    }
    return;
  }
  const colors = [0xfecc02, 0x0072ce, 0x005ba0];
  const bossMat = new THREE.MeshStandardMaterial({ color: 0xc9cdd6, metalness: 0.8, roughness: 0.35 });
  // all 12 shields in ONE vertex-colored mesh (color alternation baked in),
  // all 12 metal bosses in one more, all 12 painted motifs in a third
  const shieldParts = [];
  const bossParts = [];
  const motifParts = [];
  for (let i = 0; i < SHIELD_Z.length; i++) {
    const z = SHIELD_Z[i];
    for (const side of [-1, 1]) {
      const colorIdx = (i + (side > 0 ? 1 : 0)) % 3;
      // r=0.62 (was 0.55): closer to the reference's rail-filling shields
      const sg = new THREE.CylinderGeometry(0.62, 0.62, 0.1, 16);
      sg.rotateZ(Math.PI / 2);
      shieldParts.push(bakePart(sg, colors[colorIdx], side * 2.52, 0.42, z));
      bossParts.push(bakePart(new THREE.SphereGeometry(0.14, 8, 8), null, side * 2.62, 0.42, z));

      // painted motif: a flat disc facing outward, sitting just proud of the
      // shield face, UV-remapped to sample tile `colorIdx` of the shared
      // 3-tile atlas (CircleGeometry's default UV is a clean unit circle
      // centred at 0.5,0.5, so u' = (colorIdx + u) / 3 picks the right tile)
      const mg = new THREE.CircleGeometry(0.52, 20);
      mg.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
      const uvAttr = mg.attributes.uv;
      for (let k = 0; k < uvAttr.count; k++) uvAttr.setX(k, (colorIdx + uvAttr.getX(k)) / 3);
      mg.translate(side * 2.572, 0.42, z);
      motifParts.push(mg);
    }
  }
  const shieldMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
  group.add(new THREE.Mesh(mergeParts(shieldParts), shieldMat));
  group.add(new THREE.Mesh(mergeParts(bossParts), bossMat));
  const motifMat = new THREE.MeshStandardMaterial({
    map: makeShieldMotifTexture(team), roughness: 0.5, side: THREE.DoubleSide,
  });
  group.add(new THREE.Mesh(mergeParts(motifParts), motifMat));
}

// ---- viking helmet (external GLB) ----
// buildShip() must stay synchronous (main.js builds both boats on the same
// frame), so the GLB loads once, async, in the background: every head gets
// an empty anchor Group immediately (createHelmetAnchor), and the loaded
// prototype mesh gets clone()'d into every anchor — pending ones the moment
// the load resolves, future ones (the second boat, a rebuilt ship) the
// instant they're created, since createHelmetAnchor checks the now-ready
// proto directly. Mesh.clone() shares geometry + material by reference, so
// N helmets cost exactly one geometry and one material.
let helmetProto = null;
let helmetLoadStarted = false;
const helmetPendingAnchors = [];

function extractFirstMesh(root) {
  let found = null;
  root.traverse((child) => { if (!found && child.isMesh) found = child; });
  return found;
}

function ensureHelmetLoading() {
  if (helmetLoadStarted) return;
  helmetLoadStarted = true;
  new GLTFLoader().load(
    HELMET_URL,
    (gltf) => {
      const srcMesh = extractFirstMesh(gltf.scene);
      if (!srcMesh) {
        console.warn(`[ship] helmet GLB "${HELMET_URL}" contains no mesh — crew stays bare-headed.`);
        helmetPendingAnchors.length = 0;
        return;
      }
      const geo = srcMesh.geometry;
      geo.computeBoundingBox();
      const box = geo.boundingBox;
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      // auto-fit: recenter horizontally (X/Z), drop the underside to y=0, then
      // scale uniformly so the DEPTH (Z) matches HELMET_FIT_DEPTH — the dome
      // sits on the skull and the sideways horns fall out proportionally.
      geo.translate(-center.x, -box.min.y, -center.z);
      const scale = size.z > 0 ? HELMET_FIT_DEPTH / size.z : 1;
      const proto = new THREE.Mesh(geo, srcMesh.material);
      proto.scale.setScalar(scale);
      proto.rotation.y = HELMET_ROT_Y;
      helmetProto = proto;
      for (const anchor of helmetPendingAnchors) anchor.add(helmetProto.clone());
      helmetPendingAnchors.length = 0;
    },
    undefined,
    (err) => {
      console.warn(`[ship] failed to load helmet GLB "${HELMET_URL}":`, err);
      helmetPendingAnchors.length = 0;
    }
  );
}

// call at every crew head — returns an empty Group positioned at helmet
// height, already carrying a clone if the proto is ready, or queued for one
// the moment it loads. Safe to call before/after/never resolving the load.
function createHelmetAnchor() {
  ensureHelmetLoading();
  const anchor = new THREE.Group();
  anchor.position.y = HELMET_Y;
  if (helmetProto) anchor.add(helmetProto.clone());
  else helmetPendingAnchors.push(anchor);
  return anchor;
}

// ---- One rower in team football kit ----
// Perf: a rower used to be 13 tiny meshes (13 draw calls, ×9 rowers ×2 boats).
// The static body (torso, head, band, horns, legs) is baked into ONE
// vertex-colored geometry, each arm (arm+hand) into another — 3 draw calls per
// rower. The group + shoulder-pivot hierarchy is identical, so the poseStroke
// animation (group.rotation.x + pivot.rotation.x) is byte-for-byte unchanged.
const SKIN_COLOR = 0xe8b58f;
const HORN_COLOR = 0xf0ead8;
const EYE_COLOR = 0x241c14;
// look: optional per-rower flavour — { hair: color, beard: color } — so the
// crew reads as individuals instead of nine identical clones. The plain
// look ({}) is what Haaland/the captain use (Haaland gets his own blond mop).
function buildRowerGeos(kit, look = {}) {
  const body = [
    // torso (shirt)
    bakePart(new THREE.CapsuleGeometry(0.26, 0.42, 4, 8), kit.shirt, 0, 0.78, 0),
    // head + helmet-ish hair band (viking football hybrid: team headband)
    bakePart(new THREE.SphereGeometry(0.2, 10, 10), SKIN_COLOR, 0, 1.38, 0),
    bakePart(new THREE.TorusGeometry(0.19, 0.045, 6, 12), kit.shorts, 0, 1.45, 0, Math.PI / 2.4, 0, 0),
  ];
  // simple face: two dark eyes on the bow-facing side (crew faces -z)
  for (const s of [-1, 1]) {
    body.push(bakePart(new THREE.SphereGeometry(0.035, 6, 6), EYE_COLOR, s * 0.075, 1.42, -0.175));
  }
  if (look.hair) {
    const hg = new THREE.SphereGeometry(0.21, 10, 10);
    hg.scale(1, 0.6, 1);
    body.push(bakePart(hg, look.hair, 0, 1.5, 0.02));
  }
  if (look.beard) {
    const bg = new THREE.SphereGeometry(0.13, 8, 8);
    bg.scale(1, 1.2, 0.7);
    body.push(bakePart(bg, look.beard, 0, 1.23, -0.13));
  }
  for (const s of [-1, 1]) {
    // tiny horns on the headband — viking touch
    body.push(bakePart(new THREE.ConeGeometry(0.05, 0.18, 6), HORN_COLOR, s * 0.17, 1.52, 0, 0, 0, -s * 0.7));
    // legs (shorts + socks) — static, seated forward
    body.push(bakePart(new THREE.CapsuleGeometry(0.1, 0.3, 4, 6), kit.shorts, s * 0.15, 0.42, -0.22, Math.PI / 2.2, 0, 0));
    body.push(bakePart(new THREE.CapsuleGeometry(0.08, 0.3, 4, 6), kit.sock, s * 0.15, 0.22, -0.42, 0.25, 0, 0));
  }
  const arm = [
    bakePart(new THREE.CapsuleGeometry(0.08, 0.42, 4, 6), kit.shirt, 0, -0.05, -0.3, Math.PI / 2.1, 0, 0),
    // sized to comfortably wrap the oar's handle grip (see GRIP_COLOR cylinder
    // in buildShip) rather than a bare fingertip-sized touch point
    bakePart(new THREE.SphereGeometry(0.11, 8, 8), SKIN_COLOR, 0, -0.08, -0.56),
  ];
  return { body: mergeParts(body), arm: mergeParts(arm) };
}

function buildRower(rowerGeos, crewMat, withHelmet = true) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(rowerGeos.body, crewMat));
  if (withHelmet) g.add(createHelmetAnchor());
  // arms — two pivots at the shoulders so they can swing with the oar
  const arms = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.28, 1.05, 0);
    pivot.add(new THREE.Mesh(rowerGeos.arm, crewMat));
    g.add(pivot);
    arms.push(pivot);
  }
  return { group: g, arms };
}

// ---- bow figure: the horn-blower (lur-blåser) ----
// A STANDING crewman sounding a curved viking war horn from the foredeck.
// Same visual language as the seated crew (bakePart + the shared
// vertex-colored crew material, helmet via the same GLB anchor), but the
// seated-rower geometry can't be reused: its legs are baked folded-forward
// for the benches, so this builds its own body with planted legs. The horn
// is baked in the RAISED arm's pivot-local space, so the same forward-down
// arc that all arm meshes use reads as "horn raised skyward" once the pivot
// is rotated up — no per-frame animation needed, he holds the pose.
const HORN_BONE = 0xe9ddc2, HORN_BAND = 0xc9ccd4, HORN_MOUTHPIECE = 0x3a2e24;
function buildHornBlower(kit, crewMat) {
  const body = [
    bakePart(new THREE.CapsuleGeometry(0.26, 0.42, 4, 8), kit.shirt, 0, 0.78, 0),
    bakePart(new THREE.SphereGeometry(0.2, 10, 10), SKIN_COLOR, 0, 1.38, 0),
    bakePart(new THREE.TorusGeometry(0.19, 0.045, 6, 12), kit.shorts, 0, 1.45, 0, Math.PI / 2.4, 0, 0),
  ];
  for (const s of [-1, 1]) {
    body.push(bakePart(new THREE.SphereGeometry(0.035, 6, 6), EYE_COLOR, s * 0.075, 1.42, -0.175));
    body.push(bakePart(new THREE.ConeGeometry(0.05, 0.18, 6), HORN_COLOR, s * 0.17, 1.52, 0, 0, 0, -s * 0.7));
    // standing legs: vertical thigh (shorts) + shin (sock) + a boot toe
    // pointing at the bow (the whole figure faces -z, like the crew's eyes)
    body.push(bakePart(new THREE.CapsuleGeometry(0.1, 0.34, 4, 6), kit.shorts, s * 0.13, 0.4, 0));
    body.push(bakePart(new THREE.CapsuleGeometry(0.08, 0.18, 4, 6), kit.sock, s * 0.13, 0.14, 0));
    body.push(bakePart(new THREE.BoxGeometry(0.14, 0.08, 0.26), 0x2e2018, s * 0.13, 0.04, -0.06));
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(mergeParts(body), crewMat));
  g.add(createHelmetAnchor());
  const armGeo = buildRowerGeos(kit).arm; // same arm+hand as the crew
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.28, 1.05, 0);
    pivot.add(new THREE.Mesh(armGeo, crewMat));
    if (s > 0) {
      // RIGHT arm raised: the arm mesh points forward-down in pivot space,
      // so +x rotation swings the hand up beside the head (hand lands at
      // ~y1.5/z-0.33 — right where a horn pressed to the lips would sit)
      pivot.rotation.x = 0.95;
      // the war horn, gripped in that hand: a flaring arc from the dark
      // mouthpiece through bone segments to a silver-banded bell — baked in
      // pivot space along the hand's own forward arc, so the raised pose
      // carries the bell up over his head like the real lur in the reference
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, -0.08, -0.62),
        new THREE.Vector3(0, -0.12, -1.1),
        new THREE.Vector3(0, -0.45, -1.42),
      );
      const hornParts = [
        bakePart(new THREE.CylinderGeometry(0.035, 0.035, 0.09, 8), HORN_MOUTHPIECE, 0, -0.08, -0.6, Math.PI / 2, 0, 0),
      ];
      const SEGS = 6;
      for (let i = 0; i < SEGS; i++) {
        const p0 = curve.getPoint(i / SEGS), p1 = curve.getPoint((i + 1) / SEGS);
        const r = (t) => 0.03 + t * 0.09;
        // second-to-last segment is the silver band around the bell throat
        const color = i === SEGS - 2 ? HORN_BAND : HORN_BONE;
        hornParts.push(hornPart(p0, p1, r(i / SEGS), r((i + 1) / SEGS), color));
      }
      // bell flare past the curve's end, continuing its final direction
      const tip = curve.getPoint(1);
      const dir = tip.clone().sub(curve.getPoint(0.92)).normalize().multiplyScalar(0.14);
      hornParts.push(hornPart(tip, tip.clone().add(dir), 0.12, 0.16, HORN_BONE));
      pivot.add(new THREE.Mesh(mergeParts(hornParts), crewMat));
    } else {
      pivot.rotation.x = -1.25; // LEFT arm hangs at his side
    }
    g.add(pivot);
  }
  return g;
}

const TEAM_KITS = {
  norway: { shirt: NO_RED, shorts: NO_WHITE, sock: NO_BLUE },
  sweden: { shirt: 0xfecc02, shorts: 0x0072ce, sock: 0xfecc02 },
};

// ---- Oar-rowing crew rig: hip (static) + chest (lean/twist) + true 2-bone
// IK arms — a materially different rig from the simple single-pivot arms
// above (buildRower/buildRowerGeos), which stay in use for Haaland/the
// captain since they don't hold an oar. Real sweep-rowers sit facing the
// STERN with ONE oar per rower, gripped with BOTH hands at different points
// along the same diagonal handle, and the whole torso — not just the arms —
// drives the stroke. Splitting hip/chest lets the hips stay planted on the
// bench while the chest leans and twists independently; the arms are true
// two-bone (upper arm + forearm) chains solved with law-of-cosines IK so the
// hands land exactly on the oar's inner/outer grip points every frame.
// The chest hinges at the WAIST — where the torso meets the hips/thighs —
// not at the figure's origin down at the seat. Rotating around seat level
// arcs the whole torso away from the hips (a visible body/legs disconnect at
// the exaggerated ~55° finish layback, per bug report); a waist hinge keeps
// the torso's base planted ON the white thighs no matter how far it leans.
// All chest-mesh parts are baked RELATIVE to this pivot (y minus
// CHEST_PIVOT_Y), and buildOarRower() lifts the chest group back up by the
// same amount, so the rest pose is byte-identical to before.
const CHEST_PIVOT_Y = 0.45;
function buildOarCrewGeos(kit, look = {}) {
  const hip = [];
  for (const s of [-1, 1]) {
    hip.push(bakePart(new THREE.CapsuleGeometry(0.1, 0.3, 4, 6), kit.shorts, s * 0.15, 0.42, -0.22, Math.PI / 2.2, 0, 0));
    hip.push(bakePart(new THREE.CapsuleGeometry(0.08, 0.3, 4, 6), kit.sock, s * 0.15, 0.22, -0.42, 0.25, 0, 0));
  }
  const P = CHEST_PIVOT_Y;
  const chest = [
    bakePart(new THREE.CapsuleGeometry(0.26, 0.42, 4, 8), kit.shirt, 0, 0.78 - P, 0),
    bakePart(new THREE.SphereGeometry(0.2, 10, 10), SKIN_COLOR, 0, 1.38 - P, 0),
    bakePart(new THREE.TorusGeometry(0.19, 0.045, 6, 12), kit.shorts, 0, 1.45 - P, 0, Math.PI / 2.4, 0, 0),
  ];
  for (const s of [-1, 1]) {
    chest.push(bakePart(new THREE.SphereGeometry(0.035, 6, 6), EYE_COLOR, s * 0.075, 1.42 - P, -0.175));
  }
  if (look.hair) {
    const hg = new THREE.SphereGeometry(0.21, 10, 10);
    hg.scale(1, 0.6, 1);
    chest.push(bakePart(hg, look.hair, 0, 1.5 - P, 0.02));
  }
  if (look.beard) {
    const bg = new THREE.SphereGeometry(0.13, 8, 8);
    bg.scale(1, 1.2, 0.7);
    chest.push(bakePart(bg, look.beard, 0, 1.23 - P, -0.13));
  }
  for (const s of [-1, 1]) {
    chest.push(bakePart(new THREE.ConeGeometry(0.05, 0.18, 6), HORN_COLOR, s * 0.17, 1.52 - P, 0, 0, 0, -s * 0.7));
  }
  return { hip: mergeParts(hip), chest: mergeParts(chest) };
}

// upper arm (shoulder->elbow) + forearm/hand (elbow->grip), both canonical
// straight shapes pointing down local -Y — solveArmIK() below aims + places
// them every frame. UPPER_ARM_LEN + FOREARM_LEN is the arm's max reach;
// their difference is the minimum (fully folded) reach.
const UPPER_ARM_LEN = 0.36, FOREARM_LEN = 0.4;
function buildArmBoneGeos(kit) {
  const upper = mergeParts([
    bakePart(new THREE.CapsuleGeometry(0.078, UPPER_ARM_LEN - 0.16, 4, 6), kit.shirt, 0, -UPPER_ARM_LEN / 2, 0),
  ]);
  const fore = mergeParts([
    bakePart(new THREE.CapsuleGeometry(0.065, FOREARM_LEN - 0.14, 4, 6), SKIN_COLOR, 0, -FOREARM_LEN / 2, 0),
    bakePart(new THREE.SphereGeometry(0.1, 8, 8), SKIN_COLOR, 0, -FOREARM_LEN, 0),
  ]);
  return { upper, fore };
}

function buildOarRower(geos, armGeos, crewMat, withHelmet = true) {
  const hipGroup = new THREE.Group();
  hipGroup.add(new THREE.Mesh(geos.hip, crewMat));
  // waist hinge (see CHEST_PIVOT_Y above): the group sits AT the waist and
  // its contents are baked relative to it, so rotation bends at the waist
  // instead of sweeping the whole torso around the seat.
  const chestGroup = new THREE.Group();
  chestGroup.position.y = CHEST_PIVOT_Y;
  chestGroup.add(new THREE.Mesh(geos.chest, crewMat));
  // on the chest, so the helmet leans/twists with the head under poseStroke —
  // createHelmetAnchor() positions for figure-local space (HELMET_Y), so
  // re-anchor it into the chest's waist-relative space here
  if (withHelmet) {
    const helmet = createHelmetAnchor();
    helmet.position.y -= CHEST_PIVOT_Y;
    chestGroup.add(helmet);
  }
  hipGroup.add(chestGroup);
  const arms = [];
  for (const s of [-1, 1]) {
    const upperBone = new THREE.Group();
    upperBone.add(new THREE.Mesh(armGeos.upper, crewMat));
    const foreBone = new THREE.Group();
    foreBone.add(new THREE.Mesh(armGeos.fore, crewMat));
    chestGroup.add(upperBone, foreBone);
    // shoulder height in the chest's waist-relative space (was 1.05 figure-local)
    arms.push({ shoulderLocal: new THREE.Vector3(s * 0.28, 1.05 - CHEST_PIVOT_Y, 0), upperBone, foreBone });
  }
  return { group: hipGroup, chest: chestGroup, arms };
}

// Two-bone (shoulder->elbow->hand) IK, law-of-cosines style: bends the elbow
// toward `poleLocal` (a reference point behind + outside the shoulder — see
// the pole targets in poseStroke) and clamps the reach to what the two bone
// lengths can actually cover, so it degrades gracefully instead of blowing up
// when the oar's grip swings further than the arm's max/min reach.
//
// IK_MIN_BEND_SLACK keeps the elbow from EVER going perfectly straight: at
// true full extension the elbow sits exactly on the dead-straight
// shoulder->target line (sin of the bend angle is 0), which for the outer
// arm's grip at the catch/finish extremes runs close enough to the torso's
// own centerline to visibly clip through it — the pole vector has zero
// influence at that exact point, no matter how far outward it's aimed,
// because a fully straight arm has no freedom left to bend toward it. By
// capping the usable reach a bit short of the two bones' true combined
// length, there's always a small guaranteed bend for the pole to act on,
// which keeps the elbow (and the whole forearm) safely clear of the body.
const IK_MIN_BEND_SLACK = 0.16;
const _ikDir = new THREE.Vector3();
const _ikPoleVec = new THREE.Vector3();
const _ikBendAxis = new THREE.Vector3();
const _ikElbow = new THREE.Vector3();
const _ikClampedTarget = new THREE.Vector3();
const _ikAimDir = new THREE.Vector3();
const _IK_DOWN = new THREE.Vector3(0, -1, 0);
function solveArmIK(shoulderLocal, targetLocal, poleLocal, upperLen, foreLen, upperBone, foreBone) {
  _ikDir.copy(targetLocal).sub(shoulderLocal);
  const rawDist = _ikDir.length();
  const maxLen = upperLen + foreLen - IK_MIN_BEND_SLACK;
  const minLen = Math.abs(upperLen - foreLen) + 0.001;
  const dist = Math.min(maxLen, Math.max(minLen, rawDist || minLen));
  _ikDir.normalize();

  _ikPoleVec.copy(poleLocal).sub(shoulderLocal);
  const along = _ikPoleVec.dot(_ikDir);
  _ikBendAxis.copy(_ikDir).multiplyScalar(along);
  _ikBendAxis.subVectors(_ikPoleVec, _ikBendAxis);
  if (_ikBendAxis.lengthSq() < 1e-6) _ikBendAxis.set(0, -1, 0);
  _ikBendAxis.normalize();

  const cosA = (upperLen * upperLen + dist * dist - foreLen * foreLen) / (2 * upperLen * dist);
  const angA = Math.acos(Math.min(1, Math.max(-1, cosA)));

  _ikElbow.copy(_ikDir).multiplyScalar(Math.cos(angA));
  _ikElbow.addScaledVector(_ikBendAxis, Math.sin(angA));
  _ikElbow.multiplyScalar(upperLen).add(shoulderLocal);

  _ikClampedTarget.copy(_ikDir).multiplyScalar(dist).add(shoulderLocal);

  upperBone.position.copy(shoulderLocal);
  _ikAimDir.copy(_ikElbow).sub(shoulderLocal).normalize();
  upperBone.quaternion.setFromUnitVectors(_IK_DOWN, _ikAimDir);

  foreBone.position.copy(_ikElbow);
  _ikAimDir.copy(_ikClampedTarget).sub(_ikElbow).normalize();
  foreBone.quaternion.setFromUnitVectors(_IK_DOWN, _ikAimDir);
}

// ---- The full ship ----
// World Cup trophy (external GLB, Fase 3: Atlanterhavsferden) — same
// async-load-once/clone-per-instance approach as the helmet above, since
// buildShip() must also stay synchronous here. Unlike the helmet (1 mesh,
// 1 material), the trophy GLB may carry several meshes/materials, so this
// fits the WHOLE loaded scene (via a Box3 over the traversed hierarchy)
// rather than extractFirstMesh()'s single-mesh shortcut, and clones the
// whole Object3D subtree (clone(true) shares geometries/materials by
// reference, same as the helmet's per-mesh clone).
let trophyProto = null;
let trophyLoadStarted = false;
const trophyPendingAnchors = [];

function ensureTrophyLoading() {
  if (trophyLoadStarted) return;
  trophyLoadStarted = true;
  new GLTFLoader().load(
    TROPHY_URL,
    (gltf) => {
      const scene = gltf.scene;
      const box = new THREE.Box3().setFromObject(scene);
      if (box.isEmpty()) {
        console.warn(`[ship] trophy GLB "${TROPHY_URL}" contains no visible geometry — deck stays trophy-less.`);
        trophyPendingAnchors.length = 0;
        return;
      }
      // the GLB ships with metalness:1 PBR materials — correct for a real
      // render pipeline with environment/IBL lighting, but this scene has
      // none, so a fully metallic surface has almost no diffuse response and
      // reads as near-black. Dial metalness/roughness back and add the same
      // emissive gold glow the old procedural trophy used (same range as the
      // dragon-head eyes/deck lanterns) so it still reads as a lit highlight
      // against the dusk — texture detail (the color/normal maps) stays.
      // metalness/roughness tuned LOW/HIGH (not the 0.7/0.3 first draft) —
      // with only a couple of point lights and no environment map, a glossier
      // metal surface catches a narrow specular glint that sweeps in and out
      // as the boat rocks on waves, reading as a blink. Low metalness leans
      // on the steady emissive term instead of that moving reflection; high
      // roughness spreads what specular IS left into a broad, stable sheen.
      scene.traverse((child) => {
        if (!child.isMesh) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of mats) {
          if (!mat.isMeshStandardMaterial) continue;
          mat.metalness = 0.35;
          mat.roughness = 0.6;
          mat.emissive = new THREE.Color(0xffb100);
          // pushed up from 2.4 — with metalness down, emissive carries most of
          // the "gold glow" load now, and it's bigger, so it wants more of it
          mat.emissiveIntensity = 3.0;
        }
      });
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      // auto-fit: recenter horizontally (X/Z), drop the underside to y=0,
      // then scale uniformly so the HEIGHT (Y) matches TROPHY_FIT_HEIGHT —
      // a standing prop, so height (not depth, like the helmet) is the
      // dimension that actually needs pinning down.
      scene.position.set(-center.x, -box.min.y, -center.z);
      const wrapper = new THREE.Group();
      wrapper.add(scene);
      const scale = size.y > 0 ? TROPHY_FIT_HEIGHT / size.y : 1;
      wrapper.scale.setScalar(scale);
      trophyProto = wrapper;
      for (const anchor of trophyPendingAnchors) anchor.add(trophyProto.clone(true));
      trophyPendingAnchors.length = 0;
    },
    undefined,
    (err) => {
      console.warn(`[ship] failed to load trophy GLB "${TROPHY_URL}":`, err);
      trophyPendingAnchors.length = 0;
    }
  );
}

// returns an empty Group, already carrying a clone if the proto is ready,
// or queued for one the moment it loads — safe to call before/after/never
// resolving. Position/visibility are the caller's job (see buildShip()).
function createTrophyAnchor() {
  ensureTrophyLoading();
  const anchor = new THREE.Group();
  if (trophyProto) anchor.add(trophyProto.clone(true));
  else trophyPendingAnchors.push(anchor);
  return anchor;
}

// Norway's gunwale shield (external GLB) — same async-load-once/clone-per-
// anchor approach as the trophy above (whole-subtree clone, since the shield
// GLB can carry several meshes/materials — metal boss, painted face, rim —
// unlike the helmet's single mesh).
let skjordProto = null;
let skjordLoadStarted = false;
const skjordPendingAnchors = [];

function ensureSkjordLoading() {
  if (skjordLoadStarted) return;
  skjordLoadStarted = true;
  new GLTFLoader().load(
    SHIELD_URL,
    (gltf) => {
      const scene = gltf.scene;
      const box = new THREE.Box3().setFromObject(scene);
      if (box.isEmpty()) {
        console.warn(`[ship] shield GLB "${SHIELD_URL}" contains no visible geometry — gunwale stays shield-less.`);
        skjordPendingAnchors.length = 0;
        return;
      }
      // same lightless-scene PBR fix as the trophy: dial back a fully
      // metallic response (near-black with no environment map) and lean on
      // a modest emissive lift instead, so the boss/rim still reads under
      // just the deck's point lights
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
      // auto-fit: recenter on all 3 axes, then scale uniformly so the FACE
      // (the larger of X/Y — a shield is authored roughly flat, Z is just
      // its thickness) matches SHIELD_FIT_SIZE, same footprint the old
      // 0.62-radius procedural disc had.
      scene.position.set(-center.x, -center.y, -center.z);
      const wrapper = new THREE.Group();
      wrapper.add(scene);
      const face = Math.max(size.x, size.y);
      const scale = face > 0 ? SHIELD_FIT_SIZE / face : 1;
      wrapper.scale.setScalar(scale);
      skjordProto = wrapper;
      for (const anchor of skjordPendingAnchors) anchor.add(skjordProto.clone(true));
      skjordPendingAnchors.length = 0;
    },
    undefined,
    (err) => {
      console.warn(`[ship] failed to load shield GLB "${SHIELD_URL}":`, err);
      skjordPendingAnchors.length = 0;
    }
  );
}

function createSkjordAnchor() {
  ensureSkjordLoading();
  const anchor = new THREE.Group();
  if (skjordProto) anchor.add(skjordProto.clone(true));
  else skjordPendingAnchors.push(anchor);
  return anchor;
}

export function buildShip(team = 'norway', opts = {}) {
  const ship = new THREE.Group();
  // one vertex-colored wood material shared by all baked wood trim on this boat
  const woodVertexMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.05 });
  const { group: hullGroup, L } = buildHull(woodVertexMat);
  ship.add(hullGroup);
  addShields(hullGroup, L, team);

  // mast + yard (+ lantern posts and, for Norway, the war drum below) — all
  // static ship-level wood, baked into one mesh
  const shipWood = [
    bakePart(new THREE.CylinderGeometry(0.14, 0.2, 9.4, 8), WOOD_DARK, 0, 4.4, 0),  // mast
    bakePart(new THREE.CylinderGeometry(0.09, 0.09, 7.6, 8), WOOD_DARK, 0, 7.6, 0, 0, 0, Math.PI / 2), // yard
  ];
  // standing rigging — forestay/backstay from the masthead to the stem/stern
  // deck, plus two shroud pairs from the yard down to the gunwales, so the
  // mast reads as actually held up instead of a bare pole
  const ROPE_COLOR = 0x4a3826;
  shipWood.push(ropePart(new THREE.Vector3(0, 8.9, 0), new THREE.Vector3(0, 1.7, -L * 0.88), 0.03, ROPE_COLOR));
  shipWood.push(ropePart(new THREE.Vector3(0, 8.9, 0), new THREE.Vector3(0, 1.7, L * 0.82), 0.03, ROPE_COLOR));
  // yard lifts — from each yard tip up to the masthead, like the reference's
  // rigging triangle (yard is at y=7.6, half-length 3.8; masthead at 8.9)
  for (const s of [-1, 1]) {
    shipWood.push(ropePart(new THREE.Vector3(s * 3.7, 7.6, 0), new THREE.Vector3(0, 8.9, 0), 0.022, ROPE_COLOR));
  }
  for (const s of [-1, 1]) {
    for (const rz of [-2.4, 2.4]) {
      shipWood.push(ropePart(new THREE.Vector3(0, 7.5, 0), new THREE.Vector3(s * 2.35, 0.5, rz), 0.022, ROPE_COLOR));
    }
  }
  // coiled spare rope resting on deck near the mast foot — a flattened spiral
  // (loops tighten and lift slightly per turn, like a real hand-coil)
  {
    const coilPts = [];
    const turns = 3.2, r0 = 0.26;
    for (let k = 0; k <= 48; k++) {
      const t = k / 48;
      const a = t * turns * Math.PI * 2;
      const r = r0 * (1 - t * 0.18);
      coilPts.push(new THREE.Vector3(Math.cos(a) * r, t * 0.05, Math.sin(a) * r));
    }
    const coilCurve = new THREE.CatmullRomCurve3(coilPts);
    shipWood.push(bakePart(new THREE.TubeGeometry(coilCurve, 70, 0.035, 6), ROPE_COLOR, 0.75, -0.19, 1.6));
  }

  // sail — slightly curved plane, raised high so the view ahead stays clear.
  // baseZ stashes the static billow curve so poseStroke can layer a wind
  // ripple on top each frame without losing the underlying shape.
  const sailGeo = new THREE.PlaneGeometry(6.6, 3.2, 16, 8);
  const sailPos = sailGeo.attributes.position;
  const sailBaseZ = new Float32Array(sailPos.count);
  for (let i = 0; i < sailPos.count; i++) {
    const x = sailPos.getX(i), y = sailPos.getY(i);
    const z = Math.sin((x / 6.6 + 0.5) * Math.PI) * 0.7 * (0.4 + 0.6 * (0.5 - y / 3.2));
    sailPos.setZ(i, z);
    sailBaseZ[i] = z;
  }
  sailGeo.computeVertexNormals();
  const sail = new THREE.Mesh(
    sailGeo,
    new THREE.MeshStandardMaterial({ map: makeSailTexture(team), side: THREE.DoubleSide, roughness: 0.9 })
  );
  sail.position.y = 6.0; // hangs from the yard, readable from the chase camera
  sail.userData.baseZ = sailBaseZ;
  ship.add(sail);

  // ---- rowers + oars ----
  const kit = TEAM_KITS[team] || TEAM_KITS.norway;
  // one vertex-colored material + one merged body/arm geometry pair serves the
  // whole crew — kit colors are baked per-vertex, so the two boats' kits
  // (Norway red vs Sweden yellow/blue) never share a geometry or material
  const crewMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  // a small pool of looks cycled across the benches — hair/beard colors vary
  // so the crew reads as individuals. Index 0 (plain) is reserved for the
  // stern figure (Haaland's blond mop / the captain).
  const CREW_LOOKS = [
    {},
    { hair: 0x6b4a2f, beard: 0x6b4a2f }, // brown hair + full beard
    { hair: 0x2f2a26 },                  // dark hair, clean-shaven
    { beard: 0xa8542e },                 // red beard, band only
    { hair: 0xd9b366 },                  // blond hair
  ];
  const rowerVariants = CREW_LOOKS.map((look) => buildOarCrewGeos(kit, look));
  const armGeos = buildArmBoneGeos(kit);
  // Haaland/the captain don't row (drum-hitting / just standing) — they keep
  // the simpler single-pivot rig (buildRower/buildRowerGeos) unchanged.
  const rowerGeos = buildRowerGeos(kit, {});
  // goalkeeper — same crew, same rig, just a green shirt instead of the
  // team's red/yellow so they read as "the keeper" among the outfield rowers
  const KEEPER_GREEN = 0x2f9e44;
  const keeperGeos = buildOarCrewGeos({ ...kit, shirt: KEEPER_GREEN }, {});
  const keeperArmGeos = buildArmBoneGeos({ ...kit, shirt: KEEPER_GREEN });
  // oar = shaft + blade fused into one mesh per side (blade carries kit color)
  const oarMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.04 });
  const GRIP_COLOR = 0x2e2018;
  // one oar per rower, held with BOTH hands (real sweep-rowing technique) —
  // the inner grip sits nearer the oarlock/pivot, the outer grip nearer the
  // free end of the handle, matching how a rower's near hand steers close to
  // the gunwale while the far hand crosses in to drive the far end.
  const INNER_GRIP_LOCAL_X = -0.45, OUTER_GRIP_LOCAL_X = -0.8;
  const oarGeo = {};
  for (const side of [-1, 1]) {
    oarGeo[side] = mergeParts([
      // shaft extends far enough inboard to clear both grip points below
      bakePart(new THREE.CylinderGeometry(0.055, 0.055, 5.3, 6), WOOD_LIGHT, side * 1.65, 0, 0, 0, 0, Math.PI / 2),
      bakePart(new THREE.BoxGeometry(1.0, 0.05, 0.34), kit.shirt, side * 4.2, 0, 0),
      bakePart(new THREE.CylinderGeometry(0.09, 0.085, 0.4, 8), GRIP_COLOR, side * INNER_GRIP_LOCAL_X, 0, 0, 0, 0, Math.PI / 2),
      bakePart(new THREE.CylinderGeometry(0.09, 0.085, 0.4, 8), GRIP_COLOR, side * OUTER_GRIP_LOCAL_X, 0, 0, 0, 0, Math.PI / 2),
    ]);
  }

  // one oar = 3 nested pivots so sweep, dip, and blade-feather each rotate
  // around their own natural axis instead of being coupled through one
  // Euler triple: outerPivot (the oarlock mount) sweeps fore/aft, dipPivot
  // (child) tilts the whole oar for water depth, featherPivot (innermost,
  // holds the actual mesh) spins the blade around the oar's OWN length axis
  // (local X) — the grip points sit ON that axis, so feathering never moves
  // them, and hands never lose contact with the oar because of it.
  function buildOarPivots(side, z, geo) {
    const outerPivot = new THREE.Group();
    outerPivot.position.set(side * 2.45, 0.35, z);
    const dipPivot = new THREE.Group();
    outerPivot.add(dipPivot);
    const featherPivot = new THREE.Group();
    featherPivot.add(new THREE.Mesh(geo, oarMat));
    dipPivot.add(featherPivot);
    ship.add(outerPivot);
    return { pivot: outerPivot, dipPivot, featherPivot, side };
  }

  // determine, from ACTUAL built geometry, which of a rower's 2 local arms
  // ends up physically nearer the oarlock after the stern-facing flip below
  // (a 180° yaw swaps which local arm projects to which world side) — safer
  // than hand-deriving the sign convention, and correct regardless of it.
  const _shoulderWorld = new THREE.Vector3();
  function pickInnerOuterArm(r, oarWorldPos) {
    r.chest.updateWorldMatrix(true, false);
    let bestIdx = 0, bestDist = Infinity;
    for (let k = 0; k < r.arms.length; k++) {
      _shoulderWorld.copy(r.arms[k].shoulderLocal).applyMatrix4(r.chest.matrixWorld);
      const d = _shoulderWorld.distanceTo(oarWorldPos);
      if (d < bestDist) { bestDist = d; bestIdx = k; }
    }
    return { innerIdx: bestIdx, outerIdx: 1 - bestIdx };
  }

  // Face-the-drummer orientation: the drummer (Haaland/captain) sits at
  // (0, *, L*0.62) — built further down, but the position is a known
  // constant so rowers don't need to wait on that object existing. Each
  // rower's exact bearing to the drummer is computed on the deck plane
  // (Y ignored) instead of assuming every rower needs the same flat 180°
  // turn: a rower's seat is offset sideways (x=±1.7) from the drummer's own
  // centreline position, so the true "look at the drummer" angle is a few
  // degrees off square per row, more so for the rows closest to the stern.
  // Applied to the HIP (legs/feet — static, never touched again, so the
  // rower stays planted) and used as the chest's base yaw too (poseStroke
  // adds the small per-frame lean/twist on top of this, not instead of it).
  const DRUMMER_X = 0, DRUMMER_Z = L * 0.62;
  function faceDrummerAngle(x, z) {
    return Math.atan2(-(DRUMMER_X - x), -(DRUMMER_Z - z));
  }

  const rowers = [];
  const oars = [];
  const N_PER_SIDE = 4;
  for (let i = 0; i < N_PER_SIDE; i++) {
    const z = (i - (N_PER_SIDE - 1) / 2) * 3.1 + 0.8;
    // rowing thwart (bench) — one solid plank per row, spanning both rowers'
    // seats, filling the deck-to-seat gap they used to just float above with
    // nothing visibly holding them up.
    shipWood.push(bakePart(new THREE.BoxGeometry(4.0, 0.33, 0.4), WOOD_DARK, 0, -0.045, z));
    for (const side of [-1, 1]) {
      // cycle the look pool (skipping the reserved plain look at index 0)
      const look = rowerVariants[1 + ((i * 2 + (side > 0 ? 1 : 0)) % (rowerVariants.length - 1))];
      const r = buildOarRower(look, armGeos, crewMat, team === 'norway');
      r.group.position.set(side * 1.7, -0.2, z);
      const faceAngle = faceDrummerAngle(side * 1.7, z);
      r.group.rotation.y = faceAngle; // legs/feet — exact bearing, fixed
      r.chest.rotation.y = faceAngle; // same base; poseStroke adds lean/twist on top
      ship.add(r.group);

      const oar = buildOarPivots(side, z, oarGeo[side]);
      oars.push(oar);

      const { innerIdx, outerIdx } = pickInnerOuterArm(r, oar.pivot.position);
      // small, fixed per-rower variation (not randomness — deterministic from
      // row/side so the same crew looks the same every load) on lean/twist
      // AMPLITUDE only, never on timing: everyone still strokes in exact
      // lockstep with the drummer's beat, but no two rowers move by exactly
      // the same amount, so the crew doesn't read as identical clones.
      const varK = 0.88 + 0.24 * (((i * 3 + (side > 0 ? 1 : 0)) * 7) % 5) / 4;
      rowers.push({ ...r, side, innerIdx, outerIdx, varK, faceAngle, phase: i * 0.0 });
    }
  }

  // one extra row, one more rowing bench beyond the bow-most existing row
  // (same 3.1 spacing) — 2 more crew, rowing exactly like the rest; the
  // starboard seat is the goalkeeper (green shirt) instead of an outfield look
  {
    const z = (-1 - (N_PER_SIDE - 1) / 2) * 3.1 + 0.8;
    shipWood.push(bakePart(new THREE.BoxGeometry(4.0, 0.33, 0.4), WOOD_DARK, 0, -0.045, z));
    for (const side of [-1, 1]) {
      const geos = side > 0 ? keeperGeos : rowerVariants[1];
      const arms = side > 0 ? keeperArmGeos : armGeos;
      const r = buildOarRower(geos, arms, crewMat, team === 'norway');
      r.group.position.set(side * 1.7, -0.2, z);
      const faceAngle = faceDrummerAngle(side * 1.7, z);
      r.group.rotation.y = faceAngle;
      r.chest.rotation.y = faceAngle;
      ship.add(r.group);

      const oar = buildOarPivots(side, z, oarGeo[side]);
      oars.push(oar);

      const { innerIdx, outerIdx } = pickInnerOuterArm(r, oar.pivot.position);
      const varK = 0.88 + 0.24 * (((N_PER_SIDE * 3 + (side > 0 ? 1 : 0)) * 7) % 5) / 4;
      rowers.push({ ...r, side, innerIdx, outerIdx, varK, faceAngle, phase: 0 });
    }
  }

  // lanterns fore and aft — warm glow against the dusk (bloom picks these up).
  // Both lamps in one mesh; the posts join the ship-wood bake.
  const lanternMat = new THREE.MeshStandardMaterial({
    color: 0xffc46b, emissive: 0xff9540, emissiveIntensity: 2.6,
  });
  const lampParts = [];
  for (const lz of [-L * 0.7, L * 0.7]) {
    shipWood.push(bakePart(new THREE.CylinderGeometry(0.06, 0.08, 1.1, 6), WOOD_DARK, 0, 1.6, lz));
    lampParts.push(bakePart(new THREE.SphereGeometry(0.22, 10, 10), null, 0, 2.25, lz));
  }
  ship.add(new THREE.Mesh(mergeParts(lampParts), lanternMat));

  // ---- stern figure: HAALAND on the drum (Norway) / plain captain (others) ----
  let haaland = null;
  if (team === 'norway') {
    const h = buildRower(rowerGeos, crewMat);
    h.group.position.set(0, 0.15, L * 0.62);
    h.group.scale.setScalar(1.45); // unmistakably the big man
    ship.add(h.group);
    // his own seat — sized/placed for the 1.45x-scaled figure (the regular
    // rower bench sits 0.32 above a rower's group origin; scaled up by the
    // same 1.45x that scales the rest of him, so he doesn't just float above
    // an empty deck like the plain rowers used to before they got benches).
    shipWood.push(bakePart(new THREE.BoxGeometry(3.2, 0.82, 0.55), WOOD_DARK, 0, 0.2, L * 0.62));
    // blond mop of hair
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.215, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0xf2dc8a, roughness: 0.85 })
    );
    hair.position.y = 1.5;
    hair.scale.y = 0.7;
    h.group.add(hair);
    // war drum in front of him — styled after the real Norwegian supporter
    // drum (ref photo): straight RED shell with white side patches, chrome
    // hoops + six tension-lug casings, a white head on top, and three thin
    // wire legs splaying down to the deck (-0.21) so it stands like the real
    // thing instead of floating. Shell/patches join the ship-wood bake; the
    // chrome parts merge into ONE mesh on their own metal material (the
    // wood bake's material can't go shiny).
    const DRUM_Z = L * 0.62 - 1.6;
    shipWood.push(bakePart(new THREE.CylinderGeometry(0.55, 0.55, 0.68, 16), NO_RED, 0, 0.78, DRUM_Z));
    for (const s of [-1, 1]) {
      shipWood.push(bakePart(new THREE.BoxGeometry(0.04, 0.24, 0.3), 0xf2f2ee, s * 0.545, 0.8, DRUM_Z));
    }
    const drumMetal = [];
    for (const y of [1.13, 0.45]) { // hoops at the head and the bottom edge
      drumMetal.push(bakePart(new THREE.TorusGeometry(0.565, 0.035, 8, 22), null, 0, y, DRUM_Z, Math.PI / 2, 0, 0));
    }
    for (let i = 0; i < 6; i++) { // vertical lug casings around the shell
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      drumMetal.push(bakePart(new THREE.BoxGeometry(0.07, 0.34, 0.05), null,
        Math.sin(a) * 0.565, 0.78, DRUM_Z + Math.cos(a) * 0.565, 0, a, 0));
    }
    for (let i = 0; i < 3; i++) { // wire legs, splayed like the photo's stand
      const a = (i / 3) * Math.PI * 2 + Math.PI / 3;
      drumMetal.push(ropePart(
        new THREE.Vector3(Math.sin(a) * 0.42, 0.45, DRUM_Z + Math.cos(a) * 0.42),
        new THREE.Vector3(Math.sin(a) * 0.7, -0.19, DRUM_Z + Math.cos(a) * 0.7),
        0.018, null));
    }
    ship.add(new THREE.Mesh(
      mergeParts(drumMetal),
      new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.35, metalness: 0.85 })
    ));
    const drumTop = new THREE.Mesh(
      new THREE.CylinderGeometry(0.555, 0.555, 0.05, 16),
      new THREE.MeshStandardMaterial({ color: 0xf6f2e7, roughness: 0.85 })
    );
    drumTop.position.set(0, 1.145, DRUM_Z);
    ship.add(drumTop);
    haaland = { group: h.group, arms: h.arms, drumTop };
    // ---- bow horn-blower: helmeted, red kit, sounding the war horn ----
    // foredeck, AHEAD of the trophy (z=-6.5) but clear of the bow stem
    // ornament (~-12.5..-15.5); feet on the same deck top the trophy
    // stands on (y=-0.21). Static pose — no per-frame animation.
    const hornBlower = buildHornBlower(kit, crewMat);
    hornBlower.position.set(0, -0.21, -8.8);
    hornBlower.scale.setScalar(1.15); // captain-ish presence, still under Haaland's 1.45
    ship.add(hornBlower);
  } else {
    const captain = buildRower(rowerGeos, crewMat, false); // non-Norway crews stay bare-headed
    captain.group.position.set(0, 0.1, L * 0.62);
    captain.group.scale.setScalar(1.15);
    ship.add(captain.group);
  }
  // ship-level wood is complete — bake it (mast, yard, lantern posts, drum)
  ship.add(new THREE.Mesh(mergeParts(shipWood), woodVertexMat));
  const football = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
  );
  football.position.set(0.7, 0.35, L * 0.52);
  ship.add(football);

  // Fase 3: the Atlantic-voyage trophy — Norway's deck only, Sweden never
  // gets it. Always built (so main.js can flip it on live, mid-session, the
  // moment a run crosses the trophy milestone) but hidden unless requested.
  let trophyMesh = null;
  if (team === 'norway') {
    trophyMesh = createTrophyAnchor();
    // forward deck, centred on the boat's width (per request — previously
    // offset to starboard), standing right on the deck surface. Clear of the
    // rower benches (z -3.85..5.45) and the bow dragon-head ornament
    // (z ~ -12.5..-15.5). y = the deck's own top surface (deckParts:
    // BoxGeometry height 0.14 at y=-0.28, so top = -0.28+0.07 = -0.21 —
    // confirmed by the rower thwarts, whose underside sits at the same -0.21).
    trophyMesh.position.set(0, -0.21, -6.5);
    trophyMesh.visible = !!opts.trophy;
    ship.add(trophyMesh);
  }

  return { ship, rowers, oars, sail, L, haaland, trophyMesh };
}

// Convert a continuous cycle phase (0..1) into a rowing pose.
// Drive (blades buried) is the first 42% of the cycle, recovery the rest.
export function cyclePose(phase) {
  if (phase < 0.42) {
    const k = phase / 0.42;
    const kk = k * k * (3 - 2 * k);
    return { reach: -1 + 2 * kk, dip: Math.pow(Math.sin(k * Math.PI), 0.7) };
  }
  const k = (phase - 0.42) / 0.58;
  return { reach: 1 - 2 * (k * k * (3 - 2 * k)), dip: 0 };
}

// scratch objects reused every poseStroke call instead of allocating fresh
// Vector3s per rower per frame
const _gripWorld = new THREE.Vector3();
const _gripLocal = new THREE.Vector3();
const _poleLocal = new THREE.Vector3();
const _poleHip = new THREE.Vector3();
const _wristTwist = new THREE.Quaternion();
// must match INNER_GRIP_LOCAL_X / OUTER_GRIP_LOCAL_X in buildShip's oarGeo
const INNER_GRIP_X = -0.45, OUTER_GRIP_X = -0.8;
// chest lean (fore/aft) and twist (toward the oar side at the catch, away
// from it at the finish). Catch stays close to real-rowing scale (~13°
// forward) — the hips stay visibly planted on the bench while the arms +
// oar (IK, below) do the bulk of the visible work there. The FINISH lean is
// deliberately exaggerated well past real rowing (per request): at the old
// ~9° the torso barely moved, so the arms — swinging the oar handle all the
// way aft to the grip point — had nowhere to go but through the chest. ~55°
// of layback (within the requested 45-60° range) actually clears the torso
// out of the arms' way.
const CHEST_LEAN_CATCH = 0.22, CHEST_LEAN_FINISH = 55 * Math.PI / 180;
const CHEST_TWIST_AMT = 0.16;
// Blade feathering, real-rowing orientation: SQUARED (blade face vertical,
// biting the water) while `dip` is high — through entry, the submerged pull
// and extraction — and FEATHERED (blade flat, skimming the air) while `dip`
// is low on the recovery. Driven purely off the EXISTING dip signal (no
// separate phase state) — dip is already a 0->1->0 hump across the
// catch/drive/extraction window (see cyclePose), so a single smoothstep on
// it naturally produces both required transitions as eased animations, not
// jumps: feathered -> squared right at the catch, squared -> feathered
// right after extraction.
const FEATHER_LOW = 0.12, FEATHER_HIGH = 0.35, FEATHER_ANGLE = Math.PI / 2 - 0.08;
const _squaredK = (dip) => {
  const k = Math.min(1, Math.max(0, (dip - FEATHER_LOW) / (FEATHER_HIGH - FEATHER_LOW)));
  return k * k * (3 - 2 * k);
};

// Pose crew and oars directly, ALL oars in unison like a real crew:
// reach: -1 = catch (blades swung toward the bow) .. +1 = finish (astern)
// dip:    0 = blades high on the recovery .. 1 = buried in the water
export function poseStroke({ rowers, oars, sail }, reach, dip, t) {
  // 0 = feathered flat (recovery), FEATHER_ANGLE = squared vertical (in water)
  const featherAngle = _squaredK(dip) * FEATHER_ANGLE;
  for (let i = 0; i < oars.length; i++) {
    const { pivot, dipPivot, featherPivot, side } = oars[i];
    pivot.rotation.y = side * -reach * 0.48;          // fore-aft sweep, both sides together
    dipPivot.rotation.z = side * (0.16 - dip * 0.58); // 0.16 = clear of the water, -0.42 = buried
    // spin around the oar's OWN length axis (local X) — grip points sit ON
    // that axis so they never move, no coupling with the sweep/dip above.
    featherPivot.rotation.x = featherAngle;
  }
  for (let i = 0; i < rowers.length; i++) {
    const r = rowers[i];
    // hips stay planted on the bench — only the chest leans/twists. varK is
    // a small fixed per-rower amplitude scale (see buildShip) — everyone
    // still moves on the exact same beat as the drummer, just not by
    // identical amounts, so the crew doesn't read as clones.
    const vk = r.varK || 1;
    r.chest.rotation.x = reach * (reach < 0 ? CHEST_LEAN_CATCH : CHEST_LEAN_FINISH) * vk;
    r.chest.rotation.y = r.faceAngle + r.side * reach * CHEST_TWIST_AMT * vk;
    // rowers[i] and oars[i] are pushed in lockstep in buildShip (same row,
    // same side), so index i always pairs a rower with ITS oar.
    const oar = oars[i];
    if (!oar) continue;
    oar.featherPivot.updateWorldMatrix(true, false);
    r.chest.updateWorldMatrix(true, false);
    for (let ai = 0; ai < r.arms.length; ai++) {
      const arm = r.arms[ai];
      const gripX = ai === r.innerIdx ? INNER_GRIP_X : OUTER_GRIP_X;
      // hand target: the oar's actual inner/outer grip point, converted into
      // the CHEST's local space (the arms are children of the chest, which
      // leans/twists independently of the static hip) every frame — sweep,
      // dip AND feather together (feather doesn't move these points at all,
      // since they sit on its rotation axis, but reading the innermost
      // pivot's matrixWorld keeps this correct even if that ever changes) —
      // so the hand is always exactly on the oar instead of approximating it
      // with an independent rotation formula.
      _gripWorld.set(oar.side * gripX, 0, 0).applyMatrix4(oar.featherPivot.matrixWorld);
      _gripLocal.copy(_gripWorld);
      r.chest.worldToLocal(_gripLocal);
      // elbow pole target: behind and outward on THIS ARM's own side (left
      // arm bends toward the rower's left, right arm toward their right —
      // arm.shoulderLocal.x's sign, fixed regardless of lean), so elbows
      // bend back and out instead of forward through the chest or straight
      // down. Computed in the HIP's frame, NOT the chest's: the chest
      // carries the per-frame lean (up to ~55° at the finish, see
      // CHEST_LEAN_FINISH), and a pole offset fixed in chest-local space
      // rotates right along with it — past a small lean that swings "behind
      // and out" into a nonsensical direction, visibly bending the elbow
      // backward through the torso instead of around it. The hip only ever
      // carries the rower's static seating yaw (set once in buildShip, never
      // touched per-frame), so a hip-local offset keeps meaning "behind and
      // outward, roughly at shoulder height" regardless of how far the chest
      // itself leans. Pushed well outside the torso's own 0.26 radius (see
      // IK_MIN_BEND_SLACK above) — combined, the two keep the elbow (and
      // forearm) clear of the body even at the catch/finish extremes.
      const sideSign = Math.sign(arm.shoulderLocal.x) || 1;
      _poleHip.copy(arm.shoulderLocal).applyMatrix4(r.chest.matrixWorld);
      r.group.worldToLocal(_poleHip); // world -> the stable hip frame
      _poleHip.x += sideSign * 0.8;
      _poleHip.z += 0.5;
      r.group.localToWorld(_poleHip); // hip frame -> world
      _poleLocal.copy(_poleHip);
      r.chest.worldToLocal(_poleLocal); // world -> chest-local, for solveArmIK below
      solveArmIK(arm.shoulderLocal, _gripLocal, _poleLocal, UPPER_ARM_LEN, FOREARM_LEN, arm.upperBone, arm.foreBone);
      // wrist/forearm follows the blade's twist — a small roll around the
      // forearm's own pointing axis, layered on top of the IK aim so the
      // hand doesn't move, just the wrist orientation reads as turning the
      // oar with the blade instead of a bare aimed cylinder.
      _wristTwist.setFromAxisAngle(_IK_DOWN, featherAngle * sideSign * 0.6);
      arm.foreBone.quaternion.multiply(_wristTwist);
    }
  }
  if (sail) {
    // wind ripple layered on top of the sail's static billow curve (baseZ,
    // stashed in buildShip) — two waves at different speeds/frequencies so
    // it reads as cloth moving in the wind rather than a single pulse, and
    // scaled toward the loose foot (bottom) since the top is lashed to the
    // yard and should stay comparatively still.
    const pos = sail.geometry.attributes.position;
    const baseZ = sail.userData.baseZ;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const foot = Math.max(0, 0.5 - y / 3.2);
      const ripple = (Math.sin(x * 1.4 + t * 2.0) * 0.09 + Math.sin(x * 2.6 - t * 3.1 + y * 0.8) * 0.05) * (0.3 + 0.7 * foot);
      pos.setZ(i, baseZ[i] + ripple);
    }
    pos.needsUpdate = true;
    sail.geometry.computeVertexNormals();
  }
}
