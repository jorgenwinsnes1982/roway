import * as THREE from 'three';

// ---- "A game by Winsen" signature billboard ----
// public/banner.png is a deliberate branding exception (same category as
// roway-logo.png / norge-skjold.png) — everything else on the course is
// procedural. 450×106 px; height is always derived from this so the plate
// never stretches regardless of the width a call site asks for.
const BANNER_ASPECT = 450 / 106;

// One network/decode per call site — createCourse() (world.js) calls this
// once per course build and shares the resulting texture across all four
// billboards, so disposeCourse()'s traverse-dispose frees exactly one GPU
// texture on a stage switch, not four, and nothing outlives its course.
export function loadBannerTexture() {
  const tex = new THREE.TextureLoader().load(
    '/banner.png', undefined, undefined,
    (err) => console.error('banner.png failed to load', err)
  );
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// One shared clock for every banner's shine sweep — createCourse() drives
// this from waterT (the same clock water/sail/landmark animation already
// uses, itself stepped by update(dt) from BOTH the rAF loop and the
// setInterval(...) rAF-stall fallback in main.js, so the sweep never
// freezes in a backgrounded/throttled tab). One object, mutated in place,
// referenced by every banner material's uTime — a single write here
// reaches all four meshes, no per-mesh loop needed.
export function makeBannerClock() {
  return { value: 0 };
}

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// v2: the first version's single diagonal sweep read as a deliberate
// spotlight wipe — too "look at me" for a discreet credit. What's wanted
// instead is a hint of the FJORD'S OWN glitter catching the plate, so this
// reuses water.js's actual sun-glitter/micro-sparkle technique (hash/value
// noise thresholded with smoothstep — see water.js's hullWash/spec/sp
// terms) rather than a smooth deterministic band: small flickering specks
// that drift, at a fraction of the water's own intensity, as if a sliver of
// the same glinting is landing on the sign — not an independent light show.
// A flat-plane fresnel rim adds edge-catch at oblique viewing angles (Regel
// 3: banners sit low, seen nearly head-on/at a shallow angle, so a modest
// power is enough to actually show up instead of only firing at extreme
// grazing angles). Both terms are additive and toneMapped:false (see
// makeBillboard) so they feed straight into UnrealBloomPass, tinted
// creme/lime — never pure white.
const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uTime;
  uniform float uColorMul;
  uniform float uSparkleSpeed;
  uniform float uSparkleThreshold;
  uniform float uSparkleIntensity;
  uniform float uFresnelIntensity;
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewDir;

  // same cheap hash/value-noise pair as water.js's sparkle/foam terms
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  void main() {
    vec4 tex = texture2D(uTex, vUv);
    vec3 base = tex.rgb * uColorMul;

    // noise cells scaled ~4.245:1 (the plate's own aspect) so specks read
    // as roughly round instead of stretched along the wide axis. Time
    // offset on both axes drifts the field diagonally, same trick as
    // water.js's moving micro-sparkle (uTime*0.7) — with a busy noise field
    // that reads as flicker, not a visible directional wipe.
    vec2 sp = vec2(vUv.x * 30.0, vUv.y * 7.0) + uTime * uSparkleSpeed;
    float sparkMask = noise(sp);
    float sparkle = smoothstep(uSparkleThreshold, 1.0, sparkMask) * uSparkleIntensity;
    vec3 sparkleColor = vec3(1.0, 0.95, 0.82) * sparkle;

    vec3 N = normalize(vNormalV) * (gl_FrontFacing ? 1.0 : -1.0);
    float fresnel = pow(1.0 - clamp(dot(N, normalize(vViewDir)), 0.0, 1.0), 2.5);
    vec3 fresnelColor = vec3(0.70, 0.92, 0.45) * fresnel * uFresnelIntensity;

    vec3 color = base + (sparkleColor + fresnelColor) * tex.a;
    gl_FragColor = vec4(color, tex.a);
  }
`;

// width in world units; height is derived from the texture's real aspect
// ratio so it's never guessed/stretched. emissive (0..~1): 0 keeps the plate
// at normal brightness (only the texture's own bright pixels can bloom);
// >0 pushes the base color multiplier past white so the creme text and lime
// logo cross UnrealBloomPass's threshold further and read as backlit — same
// toneMapped:false trick already used for the homefjord flag and the
// stage-1 trophy glint (world.js). timeClock is the shared object from
// makeBannerClock() — pass the SAME instance to every banner that should
// sparkle in sync. sparkleThreshold close to 1 = rare/sparse specks (water's
// own micro-sparkle uses 0.94); sparkleIntensity/fresnelIntensity are both
// deliberately faint by default — call sites bump them for the stronger
// finish-line glow, never past "a hint".
export function makeBillboard({
  texture, position, rotationY = 0, width = 9, emissive = 0, timeClock,
  sparkleSpeed = 0.7, sparkleThreshold = 0.92, sparkleIntensity = 0.12, fresnelIntensity = 0.2,
}) {
  const height = width / BANNER_ASPECT;
  const mat = new THREE.ShaderMaterial({
    transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
    uniforms: {
      uTex: { value: texture },
      uTime: timeClock,
      uColorMul: { value: 1 + emissive },
      uSparkleSpeed: { value: sparkleSpeed },
      uSparkleThreshold: { value: sparkleThreshold },
      uSparkleIntensity: { value: sparkleIntensity },
      uFresnelIntensity: { value: fresnelIntensity },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  mesh.position.set(position.x, position.y, position.z);
  mesh.rotation.y = rotationY;
  return mesh;
}
