import * as THREE from 'three';

// Shared wave definition — keep GPU shader and CPU sampler in sync.
// Each wave: [dirX, dirZ, amplitude, wavelength, speed]
export const WAVES = [
  [1.0, 0.25, 0.55, 46.0, 1.9],
  [0.7, -0.6, 0.32, 23.0, 2.6],
  [-0.4, 0.9, 0.18, 12.0, 3.4],
  [0.2, 1.0, 0.09, 6.5, 4.6],
];

// Per-stage sea state (voyage stages get rougher toward America). ONE source
// of truth for BOTH sides: this module variable scales sampleWater() below,
// and setWaveScale() pushes the exact same value into the uWaveScale uniform
// the vertex shader multiplies its amplitudes by (Regel 6/8: the WAVES
// numbers themselves are never touched — only this shared multiplier).
// KAPPRO always runs 1.0 (see ensureCourseForMode in main.js).
let waveScale = 1.0;
let _waveScaleUniform = null; // wired up in createWater()
export function setWaveScale(s) {
  waveScale = s;
  if (_waveScaleUniform) _waveScaleUniform.value = s;
}

// ---- Procedural normal map for micro-ripples ----
// Replaces the in-shader hash-noise normal derivation with a precomputed
// tiling normal map. A canvas-generated 256×256 fbm heightfield is converted
// to normals; two scrolling UV layers sample it in the fragment shader.
// This gives anisotropic, wind-like streaks instead of the previous
// purely mathematical noise, and is typically cheaper on mobile GPUs
// (one texture sample vs many hash/gradient evaluations).
function _makeWaterNormalMap(size = 256) {
  function h(x, y) {
    const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return v - Math.floor(v);
  }
  function n(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const q = fx * fx * (3 - 2 * fx);
    const r = fy * fy * (3 - 2 * fy);
    const a = h(ix, iy), b = h(ix + 1, iy);
    const c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
    return (a + (b - a) * q + (c - a) * r + (a - b - c + d) * q * r);
  }
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let amp = 0.5, freq = 0.025, hgt = 0;
      for (let o = 0; o < 4; o++) {
        hgt += n(x * freq, y * freq + o * 13.7) * amp;
        amp *= 0.5;
        freq *= 2;
      }
      heights[y * size + x] = hgt;
    }
  }
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const id = g.createImageData(size, size);
  const data = id.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const x0 = heights[y * size + ((x - 1 + size) % size)];
      const x1 = heights[y * size + ((x + 1) % size)];
      const y0 = heights[((y - 1 + size) % size) * size + x];
      const y1 = heights[((y + 1) % size) * size + x];
      const dx = (x1 - x0) * 0.5;
      const dy = (y1 - y0) * 0.5;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const i = idx * 4;
      data[i] = Math.floor((-dx / len * 0.5 + 0.5) * 255);
      data[i + 1] = Math.floor((1.0 / len * 0.5 + 0.5) * 255);
      data[i + 2] = Math.floor((-dy / len * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  g.putImageData(id, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// CPU-side wave height + normal-ish slope sampling (matches vertex shader)
export function sampleWater(x, z, t) {
  let y = 0, dx = 0, dz = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const [wx, wz, amp, len, spd] = WAVES[i];
    const k = (Math.PI * 2) / len;
    const il = 1 / Math.hypot(wx, wz);
    const dxn = wx * il, dzn = wz * il;
    const phase = (x * dxn + z * dzn) * k + t * spd;
    y += amp * waveScale * Math.sin(phase);
    const d = amp * waveScale * k * Math.cos(phase);
    dx += dxn * d;
    dz += dzn * d;
  }
  return { y, dx, dz };
}

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uWaveScale; // per-stage sea state — same value sampleWater() uses
  varying vec3 vWorldPos;
  varying float vWaveH;
  varying vec3 vNormal;
  varying float vCurvature;

  const int NW = ${WAVES.length};
  uniform vec4 uWaveA[NW]; // dirX, dirZ, amp, wavelength
  uniform float uWaveSpd[NW];

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float y = 0.0;
    float ddx = 0.0;
    float ddz = 0.0;
    float curve = 0.0;
    for (int i = 0; i < NW; i++) {
      vec2 dir = normalize(uWaveA[i].xy);
      float k = 6.28318 / uWaveA[i].w;
      float phase = dot(wp.xz, dir) * k + uTime * uWaveSpd[i];
      float amp = uWaveA[i].z * uWaveScale;
      y += amp * sin(phase);
      float d = amp * k * cos(phase);
      ddx += dir.x * d;
      ddz += dir.y * d;
      // second derivative tells us how sharply the wave crest is curling;
      // passed to the fragment shader for foam placement
      curve += -amp * k * k * sin(phase);
    }
    wp.y += y;
    vWaveH = y;
    vCurvature = curve;
    vWorldPos = wp.xyz;
    vNormal = normalize(vec3(-ddx, 1.0, -ddz));
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uSkyColor;
  uniform vec3 uWarmColor;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec4 uShipA; // player hull: x, z, heading, speed — drives hull wash
  uniform vec4 uShipB; // rival hull: same layout
  // ---- water-look tunables (all live-adjustable via water.params.* — see
  // createWater; defaults chosen for a cold, calm nordic fjord) ----
  uniform float uDetail;      // global micro-ripple weight (mobile runs lower)
  uniform float uNormalStrA;  // fine ripple-layer normal strength
  uniform float uNormalStrB;  // coarse ripple-layer normal strength
  uniform float uFresnelPow;  // Schlick exponent (higher = reflection only at grazing)
  uniform float uFresnelStr;  // overall reflection weight
  uniform float uSunStr;      // sun-glitter brightness
  uniform float uSunSharp;    // sun-glitter tightness (higher = smaller corridor)
  uniform float uSparkStr;    // hot specular sparkle strength (reaches bloom)
  uniform sampler2D uNormalMap; // procedural tiling normal map for micro-ripples
  varying vec3 vWorldPos;
  varying float vWaveH;
  varying vec3 vNormal;
  varying float vCurvature;

  // cheap hash noise for sparkle / foam breakup
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }

  // Hull wash: foam rim hugging the ACTUAL hull outline + bow V-arms +
  // trailing wake for one ship, computed in the hull's local frame (ship
  // forward is (sin h, -cos h), matching main.js's movement integration) and
  // scaled by its speed. The rim follows a viking-hull beam profile (pointed
  // bow/stern, widest midship) instead of a box band, and the foam is
  // ANIMATED: its noise is advected sternward in hull space so the churn
  // visibly streams along the planks, faster the faster the ship rows. This
  // is a purely ADDITIVE foam term layered on top of the existing waves —
  // the core WAVES definition stays untouched on both GPU and CPU (Regel 6).
  float hullWash(vec4 ship, vec2 p, float t) {
    vec2 d = p - ship.xy;
    if (dot(d, d) > 4900.0) return 0.0; // everything lives within ~70 m
    float c = cos(ship.z), s = sin(ship.z);
    float along = d.x * s - d.y * c;  // + toward the bow
    float across = d.x * c + d.y * s; // + to starboard
    float k = clamp(ship.w / 18.0, 0.0, 1.0);

    // viking beam profile: half-width at this station — 0 at the pointed
    // stem/stern (|along| = 15.5), widest (2.55) midship
    float HL = 15.5;
    float u = clamp(along / HL, -1.0, 1.0);
    float hullW = 2.55 * pow(max(0.0, 1.0 - u * u), 0.62);
    float edge = abs(across) - hullW; // metres outside the hull's edge here

    // animated churn: two noise octaves advected sternward in HULL space —
    // the pattern streams backward along the hull, crawling slowly at rest
    // and rushing at sprint speed; ship.xy offsets decorrelate the two ships
    float flow = t * (1.5 + 6.0 * k);
    float n1 = noise(vec2(along * 0.9 + flow, across * 1.6 + ship.x));
    float n2 = noise(vec2(along * 2.2 + flow * 1.7, across * 3.1 - ship.y));
    float lap = 0.35 + 0.65 * (0.6 * n1 + 0.4 * n2);

    // foam rim hugging the outline — thickness breathes with the noise so
    // the waterline visibly laps against the planks even at rest
    float rimW = (0.55 + 0.9 * k) * (0.75 + 0.5 * n1);
    float rim = smoothstep(rimW, 0.0, abs(edge))
              * smoothstep(HL + 1.0, HL - 2.0, abs(along))
              * (0.30 + 0.55 * k);

    // bow V-arms: two foam lines diverging from the stem (only under way)
    float bx = HL - along; // metres behind the bow point
    float armC = abs(across) - (0.4 + bx * (0.38 + 0.22 * k));
    float bowArms = smoothstep(1.1, 0.15, abs(armC))
                  * smoothstep(6.0 + 8.0 * k, 0.0, bx) * step(0.0, bx) * k;
    // white water right at the stem itself
    float stem = smoothstep(2.0 + k * 1.2, 0.4, length(vec2(across, along - HL)))
               * (0.10 + 0.90 * k);

    // wake: a widening foam wedge trailing the pointed stern
    float back = -along - HL + 1.0;
    float wakeLen = 12.0 + 46.0 * k;
    float halfW = 1.4 + back * 0.30;
    float wake = smoothstep(halfW, halfW * 0.4, abs(across))
               * smoothstep(0.0, 4.0, back)
               * max(0.0, 1.0 - back / wakeLen) * k;

    return clamp(rim + bowArms + stem + wake, 0.0, 1.0) * lap;
  }

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunDir);

    // micro-ripples: TWO decorrelated normal-map layers scrolling at different
    // scales/speeds/directions. A precomputed fbm normal map replaces the old
    // in-shader hash/gradient noise: it gives wind-like anisotropic streaks,
    // is cheaper on mobile (one texture sample per layer vs many hash ops),
    // and the same map tiles forever so there is no visible repeat cell.
    // Faded at BOTH ends of the view: gone right at the camera (no
    // high-frequency hammering underfoot) and toward the horizon. The far
    // fade runs 150-380m — that mid-distance band toward the sun is where
    // the glitter corridor lives, so we keep ripple detail there.
    float dist = distance(cameraPosition, vWorldPos);
    float detail = smoothstep(8.0, 30.0, dist) * (1.0 - smoothstep(150.0, 380.0, dist)) * uDetail;
    // layer A: fine (~1.1m world period), drifting one way
    vec2 uva = vWorldPos.xz * 0.03 + vec2(uTime * 0.05, uTime * 0.02);
    // layer B: coarser (~2.4m world period), drifting the other way
    vec2 uvb = vWorldPos.xz * 0.015 + vec2(-uTime * 0.03, uTime * 0.04);
    // RG stores xy perturbation; reconstruct a reasonable z via normalization
    vec3 na = normalize(texture2D(uNormalMap, uva).rgb * 2.0 - 1.0);
    vec3 nb = normalize(texture2D(uNormalMap, uvb).rgb * 2.0 - 1.0);
    vec2 mg = na.xy * uNormalStrA + nb.xy * uNormalStrB;
    N = normalize(N + vec3(mg.x, 0.0, mg.y) * detail);

    // ---- water body: deep turquoise-black -> greenish shallows ----
    float hMix = smoothstep(-0.9, 1.1, vWaveH);
    vec3 body = mix(uDeepColor, uShallowColor, hMix);

    // view angle: 1 = looking straight down INTO the water, 0 = grazing.
    // Steeper views see deeper, darker water; grazing views catch the sky.
    float cosV = clamp(dot(N, V), 0.0, 1.0);
    body *= mix(1.0, 0.78, cosV * cosV);   // deepen the body when looking down

    // subsurface glow: sunlight through the crests toward the viewer
    float sss = pow(max(dot(V, -L), 0.0), 3.5) * smoothstep(0.1, 1.1, vWaveH);
    body += vec3(0.04, 0.40, 0.34) * sss * 0.9;

    // directional wind streaks drifting down the fjord (stretched along z)
    float streak = noise(vec2(vWorldPos.x * 1.1, vWorldPos.z * 0.05 - uTime * 0.18));
    streak = streak * 0.5 + 0.5 * noise(vec2(vWorldPos.x * 2.3 + 7.0, vWorldPos.z * 0.09 - uTime * 0.11));
    body *= 0.94 + streak * 0.10;

    // ---- Schlick fresnel: reflection grows toward grazing angles, and is
    // capped so a large flat area never turns into one white mirror sheet ----
    // (this shader has no envMap, so the Fresnel-weighted sky/horizon mix IS
    // the reflection term; the cap is the equivalent of envMapIntensity on a
    // PBR material. 0.55 — a 0.5 attempt read as dull/static on real phones.)
    float F = uFresnelStr * (0.02 + 0.98 * pow(1.0 - cosV, uFresnelPow));
    F = clamp(F, 0.0, 0.55);
    vec3 R = reflect(-V, N);
    float ry = clamp(R.y, 0.0, 1.0);
    // tight lobe where the reflected ray points AT the sun — reused below by
    // the sun glint so the warm highlight and the reflection stay coherent
    float sunLobe = pow(max(dot(normalize(R), L), 0.0), uSunSharp);
    vec3 horizonCol = mix(uFogColor, uWarmColor, sunLobe * 0.7);
    vec3 reflCol = mix(horizonCol, uSkyColor, pow(ry, 0.65));
    vec3 col = mix(body, reflCol, F);

    // ---- foam: crest height, geometric slope AND curvature, broken up by noise ----
    // Curvature (second derivative of the wave height) makes foam appear on
    // crests that are actually curling, not just high and flat.
    float slope = 1.0 - normalize(vNormal).y;
    float curveTerm = abs(vCurvature) * 0.12;
    float foamN = noise(vWorldPos.xz * 1.4 + uTime * 0.35);
    float foam = smoothstep(0.030, 0.085, slope + curveTerm) * smoothstep(0.30, 0.95, vWaveH);
    foam *= 0.45 + 0.55 * foamN;
    foam = min(foam, 1.0);
    col = mix(col, vec3(0.90, 0.95, 0.99), foam * 0.7);

    // ---- hull wash: bow wave / side lapping / wake for both ships ----
    float wash = hullWash(uShipA, vWorldPos.xz, uTime) + hullWash(uShipB, vWorldPos.xz, uTime);
    col = mix(col, vec3(0.90, 0.95, 0.99), clamp(wash, 0.0, 1.0) * 0.62);

    // ---- sun glint: ONE concentrated warm-white highlight, gated by BOTH the
    // sun-reflection lobe AND fresnel, so it only fires where the surface is
    // angled toward the sun at a grazing view — a glitter corridor, not the
    // thousands of identical white pinpricks a raw pow(N·H, 300) sprayed over
    // the whole sea. Drifting noise makes the corridor twinkle instead of
    // reading as a solid bar; warm-white keeps colour (never pure #fff). ----
    float glintMask = noise(vWorldPos.xz * 1.1 + uTime * 0.9);
    // gate 0.4-0.9: enough noise cells qualify as "bright" that the corridor
    // visibly twinkles (a tighter 0.55-0.95 attempt starved it into a static,
    // lifeless patch on real phones). F softened to (0.3 + 0.7F) so the warm
    // sheen stays visible at moderate view angles too, not only at grazing.
    float glint = sunLobe * (0.30 + 0.70 * F) * (0.35 + 0.65 * smoothstep(0.4, 0.9, glintMask)) * uSunStr;
    col += mix(uWarmColor, vec3(1.0, 0.97, 0.9), 0.55) * glint;

    // ---- hot sparkle: a tight Blinn-Phong lobe that actually EXCEEDS the
    // bloom threshold (0.9) inside the sun corridor, so individual wave
    // facets flash and bleed like real sun-on-water — the one ingredient the
    // purely Fresnel-capped glint above can never provide (its max is ~0.5).
    // Differs from the old plastic-era pow-300 carpet in three ways: the
    // micro-normals feeding N are gentle and distance-faded (so facets are
    // sparse, not thousands of identical pinpricks), the noise mask varies
    // each facet's brightness, and the colour is warm — never pure white.
    // Cost: one normalize + one pow, reusing the glintMask noise sample. ----
    vec3 Hv = normalize(L + V);
    float spark = pow(max(dot(N, Hv), 0.0), 170.0)
                * (0.35 + 0.65 * smoothstep(0.45, 0.85, glintMask)) * uSparkStr;
    col += vec3(1.0, 0.95, 0.84) * spark;

    // distance fog (reuses the dist computed in the micro-ripple block above)
    float fogF = smoothstep(uFogNear, uFogFar, dist);
    col = mix(col, uFogColor, fogF);

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---- Water plane extent (perf trim, fully reversible) ----
// The ocean plane used to be 1400 × 3400 (190 × 420 segments = 159,600 tris,
// ~62% of the whole frame's triangle budget). Most of that was never visible:
// scene.fog fully occludes everything past ~1150 m (fogFar), and the forward-
// facing chase camera never sees the 1700 m of plane BEHIND the ship. This
// trims the LENGTH only and biases the plane forward, so coverage becomes
// ~1600 m ahead (comfortably past the fog wall) / ~400 m behind the ship.
//
// Vertex DENSITY is preserved exactly (WATER_SEG_* below derive the segment
// counts from the ORIGINAL 1400/190 and 3400/420 spacing), so every wave is
// byte-identical — this removes only fully-fogged / off-screen ocean, never
// wave detail. Width is left at the original 1400 so the lateral extent, which
// already ~matched the view frustum, is untouched (no horizon-edge risk).
//
// TO REVERT to the original full plane, set:
//   WATER_W = 1400, WATER_L = 3400, WATER_FWD_BIAS = 0
// (the segment counts and the update() offset then follow automatically).
const WATER_W = 1400;        // width — unchanged from the original
const WATER_L = 2000;        // length — was 3400 (the trimmed dimension)
const WATER_FWD_BIAS = 600;  // metres the plane is shifted forward of the ship (−z); was 0
const _SPACING_W = 1400 / 190; // original vertex spacing, kept identical
const _SPACING_L = 3400 / 420;
const WATER_SEG_W = Math.round(WATER_W / _SPACING_W); // = 190 (unchanged)
const WATER_SEG_L = Math.round(WATER_L / _SPACING_L); // = 247

// ---- MOBILE / DESKTOP look presets ----
// This is a hand-written, non-PBR ShaderMaterial — there is no metalness or
// roughness property to set (it has never had a metallic term; that's a
// fixed 0-equivalent by construction, not a value to toggle). The nearest
// real controls are: normalStrA/B (micro-detail strength), fresnelStr (the
// Fresnel-weighted sky/horizon mix — this shader's only "reflection", since
// there is no envMap to turn down), and sunStr/sunSharp (the sun-glint
// highlight's brightness/width — narrower+brighter reads glossier, wider+
// dimmer reads rougher). Both presets keep the SAME Fresnel shape
// (fresnelPow) — grazing angles reflect more than looking straight down in
// both — desktop just runs a bit brighter/crisper throughout. Overridable
// afterward via water.params.* either way (unchanged API).
// Field-tested on a real phone: the first preset round (mobile sunStr 0.42,
// normalStr 0.05/0.03, detail 0.55) killed the sun glitter and read as
// "static, boring water". These values restore the round-one liveliness —
// visible glitter corridor, moving micro-ripples — while keeping the
// anti-plastic work (two decorrelated layers, Fresnel-gated glint, no
// pow-300 specular). Mobile sits just under desktop, not at half.
export const WATER_PRESETS = {
  mobile: {
    detail: 0.85, normalStrA: 0.10, normalStrB: 0.065,
    fresnelPow: 5.0, fresnelStr: 0.70, sunStr: 0.85, sunSharp: 58.0,
    sparkStr: 1.1,
  },
  desktop: {
    detail: 1.0, normalStrA: 0.11, normalStrB: 0.07,
    fresnelPow: 5.0, fresnelStr: 0.72, sunStr: 0.85, sunSharp: 60.0,
    sparkStr: 1.25,
  },
};

export function createWater({ sunDir, fogColor, fogNear, fogFar, mobile = false }) {
  const geo = new THREE.PlaneGeometry(WATER_W, WATER_L, WATER_SEG_W, WATER_SEG_L);
  geo.rotateX(-Math.PI / 2);
  const preset = mobile ? WATER_PRESETS.mobile : WATER_PRESETS.desktop;
  const normalMap = _makeWaterNormalMap(256);

  const uniforms = {
    uNormalMap: { value: normalMap },
    uTime: { value: 0 },
    uSunDir: { value: sunDir.clone() },
    uDeepColor: { value: new THREE.Color(0x03151e) },   // turquoise-black depths
    uShallowColor: { value: new THREE.Color(0x14584e) }, // greenish shallows
    uSkyColor: { value: new THREE.Color(0x7fa3d0) },
    uWarmColor: { value: new THREE.Color(0xff9e52) },    // blue-hour horizon glow
    uFogColor: { value: new THREE.Color(fogColor) },
    uFogNear: { value: fogNear },
    uFogFar: { value: fogFar },
    uWaveA: { value: WAVES.map((w) => new THREE.Vector4(w[0], w[1], w[2], w[3])) },
    uWaveSpd: { value: WAVES.map((w) => w[4]) },
    uWaveScale: { value: waveScale },
    // hull-wash inputs (x, z, heading, speed per ship) — parked far away
    // until the first setShips() so no phantom wash renders at the origin
    uShipA: { value: new THREE.Vector4(1e6, 1e6, 0, 0) },
    uShipB: { value: new THREE.Vector4(1e6, 1e6, 0, 0) },
    // ---- water-look tunables (see fragment shader + WATER_PRESETS above).
    // Every value now differs by device, not just detail. All exposed via
    // the returned `params` API for live tuning from the dev console. ----
    uDetail: { value: preset.detail },
    uNormalStrA: { value: preset.normalStrA },
    uNormalStrB: { value: preset.normalStrB },
    uFresnelPow: { value: preset.fresnelPow },
    uFresnelStr: { value: preset.fresnelStr },
    uSunStr: { value: preset.sunStr },
    uSunSharp: { value: preset.sunSharp },
    uSparkStr: { value: preset.sparkStr },
  };
  _waveScaleUniform = uniforms.uWaveScale; // setWaveScale() drives GPU+CPU from here on

  const mat = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;

  return {
    mesh,
    update(t, shipZ) {
      uniforms.uTime.value = t;
      // follow the ship, biased forward (−z) so the trimmed plane's coverage
      // sits ahead of the boat where the camera actually looks (see the
      // WATER_FWD_BIAS note above). WATER_FWD_BIAS = 0 restores dead-centre.
      mesh.position.z = shipZ - WATER_FWD_BIAS;
    },
    // hull-wash driver — called once per frame from main.js with both ships'
    // live position/heading/speed so the wash follows them in every mode
    // (menu idle, cinematic intro, race and result screens alike)
    setShips(ax, az, ah, av, bx, bz, bh, bv) {
      uniforms.uShipA.value.set(ax, az, ah, av);
      uniforms.uShipB.value.set(bx, bz, bh, bv);
    },
    // stage-mood palette hook — main.js lerps these Color objects directly
    // for the ~1s stage crossfade, so expose the live uniform values rather
    // than a set-once API. Core WAVES stay untouched (Regel 6) — this is
    // colour only, never geometry.
    tone: {
      deep: uniforms.uDeepColor.value,
      shallow: uniforms.uShallowColor.value,
      sky: uniforms.uSkyColor.value,
      warm: uniforms.uWarmColor.value,
      fog: uniforms.uFogColor.value,
    },
    // live water-look tuning (exposed via window.__game.water.params under
    // DEV_TOOLS — see main.js). Setting any of these updates the uniform in
    // place, no recompile: e.g. __game.water.params.normalStrA = 0.05
    params: {
      get detail() { return uniforms.uDetail.value; },
      set detail(v) { uniforms.uDetail.value = v; },
      get normalStrA() { return uniforms.uNormalStrA.value; },
      set normalStrA(v) { uniforms.uNormalStrA.value = v; },
      get normalStrB() { return uniforms.uNormalStrB.value; },
      set normalStrB(v) { uniforms.uNormalStrB.value = v; },
      get fresnelPow() { return uniforms.uFresnelPow.value; },
      set fresnelPow(v) { uniforms.uFresnelPow.value = v; },
      get fresnelStr() { return uniforms.uFresnelStr.value; },
      set fresnelStr(v) { uniforms.uFresnelStr.value = v; },
      get sunStr() { return uniforms.uSunStr.value; },
      set sunStr(v) { uniforms.uSunStr.value = v; },
      get sunSharp() { return uniforms.uSunSharp.value; },
      set sunSharp(v) { uniforms.uSunSharp.value = v; },
      get sparkStr() { return uniforms.uSparkStr.value; },
      set sparkStr(v) { uniforms.uSparkStr.value = v; },
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      normalMap.dispose();
    },
  };
}
