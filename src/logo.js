import * as THREE from 'three';
import { MENU_INPUT, initMenuInput, autoDrift } from './menuInput.js';

// Splash wordmark: the ROWAY logo (public/roway-logo.png) with the same premium
// treatment as the shield — a shared pointer/tilt 3D lean plus a travelling
// shine. The PNG has a black backdrop, so we key it out by luminance (keeps
// enclosed counters like the O, unlike a border flood-fill). Until the image
// loads (or if it fails) a procedural "ROWAY" wordmark stands in, and if WebGL
// can't init at all the plain HTML title remains. Menu-only — main.js stops the
// loop when a race starts.
export function createLogoFX() {
  const api = {
    ok: false,
    reveal() {},
    reset() {},
    stop() {},
    isRunning: () => false,
    _debug: () => ({}),
  };
  const titleEl = document.querySelector('#startScreen .title');
  if (!titleEl) return api;

  let canvas = null;
  try {
    if (new URLSearchParams(location.search).has('nologo')) throw new Error('forced fallback (?nologo)');

    // ---- immediate procedural fallback wordmark (also drawn if the PNG fails) ----
    const tc = document.createElement('canvas');
    tc.width = 1024; tc.height = 340;
    const tg = tc.getContext('2d');
    function drawProceduralWordmark() {
      tg.clearRect(0, 0, tc.width, tc.height);
      try { tg.letterSpacing = '10px'; } catch { /* older browsers */ }
      tg.font = '900 190px "Avenir Next", "Segoe UI", system-ui, sans-serif';
      tg.textAlign = 'center';
      tg.textBaseline = 'middle';
      const grad = tg.createLinearGradient(0, 40, 0, 300);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, '#6f9bd6');
      tg.fillStyle = grad;
      tg.fillText('ROWAY', 512, 180);
    }
    drawProceduralWordmark();
    const tex = new THREE.CanvasTexture(tc);
    tex.minFilter = THREE.LinearFilter;
    let aspect = tc.width / tc.height;

    // load the real logo and key out its black background by luminance
    const img = new Image();
    img.onload = () => {
      try {
        const w = 1024, h = Math.round((1024 * img.height) / img.width);
        tc.width = w; tc.height = h;
        tg.clearRect(0, 0, w, h);
        tg.drawImage(img, 0, 0, w, h);
        const id = tg.getImageData(0, 0, w, h);
        const d = id.data;
        for (let i = 0; i < d.length; i += 4) {
          const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
          // dark backdrop/shadow -> transparent; chrome text -> opaque
          let a = (lum - 0.10) / 0.14;
          a = a < 0 ? 0 : a > 1 ? 1 : a;
          d[i + 3] = Math.round(a * 255);
        }
        tg.putImageData(id, 0, 0);
        aspect = w / h;
        if (canvas) canvas.style.aspectRatio = `${w} / ${h}`;
        tex.needsUpdate = true;
      } catch { /* keep the procedural wordmark */ }
    };
    img.onerror = () => { /* PNG missing -> procedural ROWAY stays */ };
    img.src = '/roway-logo.png';

    // ---- tiny dedicated renderer (isolated from the game's pipeline) ----
    canvas = document.createElement('canvas');
    canvas.id = 'logoCanvas';
    titleEl.parentNode.insertBefore(canvas, titleEl);
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const uniforms = {
      uTex: { value: tex },
      uTime: { value: 0 },
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
        uniform vec2 uPar;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(uTex, vUv);
          // travelling shine: a soft diagonal glint sweeping across the metal,
          // nudged slightly by the pointer so it feels connected to the tilt
          float band = (vUv.x + (1.0 - vUv.y)) * 0.55 - fract(uTime * 0.06) * 2.0 + 0.5 - uPar.x * 0.25;
          float shine = exp(-band * band * 60.0);
          c.rgb += vec3(1.0, 0.98, 0.9) * shine * 0.35 * c.a;
          gl_FragColor = c;
        }
      `,
    });
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

    function resize() {
      renderer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1, false);
    }
    window.addEventListener('resize', resize);

    // ---- input: shared with the shield FX (one listener set, one iOS prompt) ----
    initMenuInput();
    const par = new THREE.Vector2(0, 0);
    const parTarget = new THREE.Vector2(0, 0);

    // ---- render loop (menu only; rAF simply pauses in hidden tabs) ----
    let running = false;
    let rafId = 0;
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
      par.lerp(parTarget, Math.min(1, dt * 4));
      uniforms.uPar.value.copy(par);
      // subtle 3D tilt toward the pointer / device tilt (like the shield)
      canvas.style.transform =
        `perspective(800px) rotateY(${(par.x * 7).toFixed(2)}deg) rotateX(${(-par.y * 6).toFixed(2)}deg)`;
      renderer.render(scene, cam);
    }

    api.ok = true;
    api.isRunning = () => running;
    api.reveal = () => {
      canvas.classList.add('in');
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
      canvas.classList.remove('in');
    };
    api._debug = () => ({
      running,
      aspect,
      par: { x: par.x, y: par.y },
      target: { x: parTarget.x, y: parTarget.y },
    });

    titleEl.classList.add('logoHidden'); // WebGL took over; HTML title is the fallback
  } catch (err) {
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    titleEl.classList.remove('logoHidden');
  }
  return api;
}
