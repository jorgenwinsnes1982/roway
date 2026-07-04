import * as THREE from 'three';
import { MENU_INPUT, initMenuInput, autoDrift } from './menuInput.js';

// WebGL shader shield for the splash screen — same treatment as the logo:
// shared pointer/tilt parallax (true 3D tilt via CSS perspective), travelling
// gold sheen, rim glow and a top-down materialise sweep choreographed with
// the logo reveal. Texture priority: the NORGE shield PNG (background
// flood-filled away so effects hug the silhouette) -> procedurally drawn
// shield if the PNG is missing. If WebGL itself fails, today's <img>
// (and its flag-band fallback) stays untouched.
export function createShieldFX() {
  const api = {
    ok: false,
    reveal() {},
    reset() {},
    stop() {},
    isRunning: () => false,
    _debug: () => ({}),
  };
  const imgEl = document.getElementById('logoShield');
  if (!imgEl) return api;

  let wrap = null;
  try {
    if (new URLSearchParams(location.search).has('nologo')) throw new Error('forced fallback (?nologo)');

    // ---- texture canvas: procedural shield first, PNG composited when ready ----
    const tc = document.createElement('canvas');
    tc.width = 512; tc.height = 768;
    const tg = tc.getContext('2d');
    drawProceduralShield(tg, 512, 768);
    const tex = new THREE.CanvasTexture(tc);
    tex.minFilter = THREE.LinearFilter;

    const img = new Image();
    img.onload = () => {
      try {
        tg.clearRect(0, 0, 512, 768);
        tg.drawImage(img, 0, 0, 512, 768);
        removeWhiteBackground(tg, 512, 768); // flood-fill from the borders only
        tex.needsUpdate = true;
      } catch { /* keep the procedural drawing */ }
    };
    img.onerror = () => { /* PNG missing -> procedural shield stays */ };
    img.src = '/norge-skjold.png';

    // ---- wrapper (landing animation) + canvas (per-frame 3D tilt) ----
    wrap = document.createElement('div');
    wrap.id = 'shieldWrap';
    const canvas = document.createElement('canvas');
    canvas.id = 'shieldCanvas';
    wrap.appendChild(canvas);
    imgEl.parentNode.insertBefore(wrap, imgEl);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const uniforms = {
      uTex: { value: tex },
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uPar: { value: new THREE.Vector2(0, 0) },
    };
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex;
        uniform float uTime;
        uniform float uReveal;
        uniform vec2 uPar;
        varying vec2 vUv;
        vec4 tap(vec2 uv) {
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
          return texture2D(uTex, uv);
        }
        void main() {
          // slight parallax shift on top of the CSS 3D tilt
          vec2 uv = vUv - uPar * 0.02;
          vec4 c = tap(uv);

          // travelling gold sheen across the metalwork
          float band = (uv.x + (1.0 - uv.y)) * 0.7 - fract(uTime * 0.05) * 2.1 + 0.55 - uPar.x * 0.3;
          float sheen = exp(-band * band * 70.0);
          c.rgb += vec3(1.0, 0.9, 0.6) * sheen * 0.4 * c.a;

          // cool rim glow just outside the silhouette
          float glow = tap(uv + vec2(0.0, 0.016)).a + tap(uv - vec2(0.0, 0.016)).a
                     + tap(uv + vec2(0.016, 0.0)).a + tap(uv - vec2(0.016, 0.0)).a;
          glow = glow * 0.25 * (1.0 - c.a);
          c.rgb += vec3(1.0, 0.85, 0.5) * glow * 0.4;
          c.a = max(c.a, glow * 0.55);

          // top-down materialise sweep with a gold frontier
          float d = 1.0 - uv.y;                    // 0 at the top of the shield
          float sweep = uReveal * 1.3 - 0.15;
          float rev = smoothstep(d - 0.07, d + 0.07, sweep);
          float frontier = exp(-pow((d - sweep) * 14.0, 2.0));
          c.rgb += vec3(1.0, 0.85, 0.45) * frontier * (1.0 - uReveal) * 1.3 * c.a;

          gl_FragColor = vec4(c.rgb * rev, c.a * rev);
        }
      `,
    });
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

    function resize() {
      renderer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1, false);
    }
    window.addEventListener('resize', resize);

    initMenuInput(); // shared with the logo — no second listener set, no second iOS prompt
    const parTarget = new THREE.Vector2(0, 0);

    let running = false;
    let rafId = 0;
    let revealTarget = 0;
    let lastT = 0;
    function tick(now) {
      if (!running) return;
      rafId = requestAnimationFrame(tick);
      const dt = Math.min((now - lastT) / 1000 || 0.016, 0.05);
      lastT = now;
      uniforms.uTime.value += dt;
      if (performance.now() - MENU_INPUT.lastAt > 2500) {
        autoDrift(uniforms.uTime.value, parTarget);
      } else {
        parTarget.set(MENU_INPUT.x, MENU_INPUT.y);
      }
      uniforms.uPar.value.lerp(parTarget, Math.min(1, dt * 4));
      uniforms.uReveal.value += (revealTarget - uniforms.uReveal.value) * Math.min(1, dt * 2.4);
      // true 3D: the canvas itself tilts toward the pointer / device tilt
      const p = uniforms.uPar.value;
      canvas.style.transform = `perspective(700px) rotateY(${(p.x * 9).toFixed(2)}deg) rotateX(${(-p.y * 8).toFixed(2)}deg)`;
      renderer.render(scene, cam);
    }

    api.ok = true;
    api.isRunning = () => running;
    api.reveal = () => {
      revealTarget = 1;
      wrap.classList.add('in');
      if (!running) {
        running = true;
        lastT = performance.now();
        resize();
        rafId = requestAnimationFrame(tick);
      }
    };
    api.stop = () => {
      running = false;
      cancelAnimationFrame(rafId);
    };
    api.reset = () => {
      revealTarget = 0;
      uniforms.uReveal.value = 0;
      wrap.classList.remove('in');
    };
    api._debug = () => ({
      running,
      reveal: uniforms.uReveal.value,
      par: { x: uniforms.uPar.value.x, y: uniforms.uPar.value.y },
    });

    imgEl.classList.add('logoHidden'); // WebGL took over; <img> (→ flag-band) is the fallback
  } catch (err) {
    if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    imgEl.classList.remove('logoHidden');
  }
  return api;
}

// flood-fill near-white pixels connected to the borders → transparent, so the
// shield keeps its interior whites (cross, top band) but loses the backdrop
function removeWhiteBackground(g, w, h) {
  const id = g.getImageData(0, 0, w, h);
  const d = id.data;
  const visited = new Uint8Array(w * h);
  const stack = [];
  const isWhite = (i) => d[i * 4] > 238 && d[i * 4 + 1] > 238 && d[i * 4 + 2] > 238;
  for (let x = 0; x < w; x++) { stack.push(x, x + (h - 1) * w); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop();
    if (visited[i] || !isWhite(i)) continue;
    visited[i] = 1;
    d[i * 4 + 3] = 0;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  g.putImageData(id, 0, 0);
}

// procedural fallback shield: Norway colours, gold trim, NORGE banner, nordic cross
function drawProceduralShield(g, w, h) {
  const shieldPath = (inset) => {
    const l = inset, r = w - inset, t = inset, b = h - inset;
    const midX = w / 2;
    g.beginPath();
    g.moveTo(l + 30, t);
    g.lineTo(r - 30, t);
    g.quadraticCurveTo(r, t, r, t + 40);
    g.lineTo(r, b * 0.62);
    g.quadraticCurveTo(r, b * 0.85, midX, b);
    g.quadraticCurveTo(l, b * 0.85, l, b * 0.62);
    g.lineTo(l, t + 40);
    g.quadraticCurveTo(l, t, l + 30, t);
    g.closePath();
  };
  g.clearRect(0, 0, w, h);
  shieldPath(8);
  g.fillStyle = '#c9a24b'; g.fill();          // gold rim
  shieldPath(26);
  g.fillStyle = '#00205b'; g.fill();          // navy frame
  shieldPath(40);
  g.fillStyle = '#ba0c2f'; g.fill();          // red field
  g.save();
  shieldPath(40);
  g.clip();
  // white top band + NORGE
  g.fillStyle = '#f4f6fb';
  g.fillRect(0, 40, w, 130);
  g.fillStyle = '#00205b';
  g.font = '900 72px "Avenir Next", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('NORGE', w / 2, 108);
  // nordic cross (white + navy), offset like the flag
  const cx = w * 0.42, cy = 170 + (h - 170) * 0.42;
  g.fillStyle = '#f4f6fb';
  g.fillRect(cx - 52, 170, 104, h);
  g.fillRect(0, cy - 52, w, 104);
  g.fillStyle = '#00205b';
  g.fillRect(cx - 30, 170, 60, h);
  g.fillRect(0, cy - 30, w, 60);
  g.restore();
}
