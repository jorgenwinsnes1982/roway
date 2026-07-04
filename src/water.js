import * as THREE from 'three';

// Shared wave definition — keep GPU shader and CPU sampler in sync.
// Each wave: [dirX, dirZ, amplitude, wavelength, speed]
export const WAVES = [
  [1.0, 0.25, 0.55, 46.0, 1.9],
  [0.7, -0.6, 0.32, 23.0, 2.6],
  [-0.4, 0.9, 0.18, 12.0, 3.4],
  [0.2, 1.0, 0.09, 6.5, 4.6],
];

// CPU-side wave height + normal-ish slope sampling (matches vertex shader)
export function sampleWater(x, z, t) {
  let y = 0, dx = 0, dz = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const [wx, wz, amp, len, spd] = WAVES[i];
    const k = (Math.PI * 2) / len;
    const il = 1 / Math.hypot(wx, wz);
    const dxn = wx * il, dzn = wz * il;
    const phase = (x * dxn + z * dzn) * k + t * spd;
    y += amp * Math.sin(phase);
    const d = amp * k * Math.cos(phase);
    dx += dxn * d;
    dz += dzn * d;
  }
  return { y, dx, dz };
}

const vertexShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorldPos;
  varying float vWaveH;
  varying vec3 vNormal;

  const int NW = ${WAVES.length};
  uniform vec4 uWaveA[NW]; // dirX, dirZ, amp, wavelength
  uniform float uWaveSpd[NW];

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float y = 0.0;
    float ddx = 0.0;
    float ddz = 0.0;
    for (int i = 0; i < NW; i++) {
      vec2 dir = normalize(uWaveA[i].xy);
      float k = 6.28318 / uWaveA[i].w;
      float phase = dot(wp.xz, dir) * k + uTime * uWaveSpd[i];
      float amp = uWaveA[i].z;
      y += amp * sin(phase);
      float d = amp * k * cos(phase);
      ddx += dir.x * d;
      ddz += dir.y * d;
    }
    wp.y += y;
    vWaveH = y;
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
  varying vec3 vWorldPos;
  varying float vWaveH;
  varying vec3 vNormal;

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

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunDir);

    // micro-ripples: perturb the normal with a noise gradient for close-up detail
    vec2 mp = vWorldPos.xz * 2.6 + uTime * 0.55;
    float me = 0.3;
    vec2 mg = vec2(
      noise(mp + vec2(me, 0.0)) - noise(mp - vec2(me, 0.0)),
      noise(mp + vec2(0.0, me)) - noise(mp - vec2(0.0, me))
    );
    // detail fades with distance so the horizon stays calm
    float detail = 1.0 - smoothstep(60.0, 420.0, distance(cameraPosition, vWorldPos));
    N = normalize(N + vec3(mg.x, 0.0, mg.y) * 0.42 * detail);

    // ---- water body: deep turquoise-black -> greenish shallows ----
    float hMix = smoothstep(-0.9, 1.1, vWaveH);
    vec3 body = mix(uDeepColor, uShallowColor, hMix);

    // subsurface glow: sunlight through the crests toward the viewer
    float sss = pow(max(dot(V, -L), 0.0), 3.5) * smoothstep(0.1, 1.1, vWaveH);
    body += vec3(0.04, 0.40, 0.34) * sss * 0.9;

    // directional wind streaks drifting down the fjord (stretched along z)
    float streak = noise(vec2(vWorldPos.x * 1.1, vWorldPos.z * 0.05 - uTime * 0.18));
    streak = streak * 0.5 + 0.5 * noise(vec2(vWorldPos.x * 2.3 + 7.0, vWorldPos.z * 0.09 - uTime * 0.11));
    body *= 0.94 + streak * 0.10;

    // ---- Schlick fresnel with view-dependent reflection colour ----
    float cosT = max(dot(N, V), 0.0);
    float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
    vec3 R = reflect(-V, N);
    float ry = clamp(R.y, 0.0, 1.0);
    // warm glow only where the reflected ray actually points AT the sun —
    // a tight 3D lobe gives the classic glitter corridor, not an orange sea
    float sunLobe = pow(max(dot(normalize(R), L), 0.0), 24.0);
    vec3 horizonCol = mix(uFogColor, uWarmColor, sunLobe * 0.85);
    vec3 reflCol = mix(horizonCol, uSkyColor, pow(ry, 0.65));
    vec3 col = mix(body, reflCol, clamp(F, 0.0, 0.6));

    // ---- foam: crest height AND geometric slope, broken up by noise ----
    float slope = 1.0 - normalize(vNormal).y;
    float foamN = noise(vWorldPos.xz * 1.4 + uTime * 0.35);
    float foam = smoothstep(0.030, 0.085, slope) * smoothstep(0.30, 0.95, vWaveH);
    foam *= 0.45 + 0.55 * foamN;
    foam = min(foam, 1.0);
    col = mix(col, vec3(0.90, 0.95, 0.99), foam * 0.7);

    // ---- sun glitter, noise-modulated so it breaks into individual sparks ----
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 300.0) * 1.5;
    spec += pow(max(dot(N, H), 0.0), 70.0) * 0.10;
    float sparkMask = noise(vWorldPos.xz * 3.4 + uTime * 1.1);
    spec *= 0.35 + 1.65 * smoothstep(0.55, 0.95, sparkMask);
    col += vec3(1.0, 0.93, 0.78) * spec;

    // moving micro-sparkle (subtle)
    float sp = noise(vWorldPos.xz * 1.6 + uTime * 0.7);
    sp = smoothstep(0.94, 1.0, sp) * 0.18;
    col += vec3(sp);

    // distance fog
    float dist = distance(cameraPosition, vWorldPos);
    float fogF = smoothstep(uFogNear, uFogFar, dist);
    col = mix(col, uFogColor, fogF);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createWater({ sunDir, fogColor, fogNear, fogFar }) {
  const geo = new THREE.PlaneGeometry(1400, 3400, 190, 420);
  geo.rotateX(-Math.PI / 2);

  const uniforms = {
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
  };

  const mat = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;

  return {
    mesh,
    update(t, shipZ) {
      uniforms.uTime.value = t;
      // keep the water plane centered under the ship along the course
      mesh.position.z = shipZ;
    },
  };
}
