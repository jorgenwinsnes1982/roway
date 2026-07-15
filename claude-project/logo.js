import * as THREE from 'three';
import { MENU_INPUT, initMenuInput, autoDrift } from './menuInput.js';

// Shared "premium key-art" FX: a tiny dedicated WebGL renderer that draws an
// image on a full-quad plane with a travelling diagonal shine, plus a shared
// pointer/device 3D tilt. Mounted as a <canvas> inserted just before an anchor
// element (which it visually replaces — the anchor is hidden while WebGL is
// live, and stays as the plain-DOM fallback if WebGL/the PNG can't load).
// Used by both the splash key art (createLogoFX) and the how-to hero
// (createHowtoFX). Menu-only — main.js stops the loops when a race starts.
function mountShineFX(anchorEl, opts) {
  const api = {
    ok: false,
    reveal() {},
    reset() {},
    stop() {},
    isRunning: () => false,
    _debug: () => ({}),
  };
  if (!anchorEl) return api;

  let canvas = null;
  try {
    if (new URLSearchParams(location.search).has('nologo')) throw new Error('forced fallback (?nologo)');

    // ---- canvas-texture source: optional procedural fallback content first,
    // then overridden by the real PNG once it decodes ----
    const tc = document.createElement('canvas');
    tc.width = opts.texW || 1024; tc.height = opts.texH || 768;
    const tg = tc.getContext('2d');
    if (opts.fallbackDraw) opts.fallbackDraw(tg, tc);
    const tex = new THREE.CanvasTexture(tc);
    tex.minFilter = THREE.LinearFilter;
    let aspect = tc.width / tc.height;

    // load the real art — its own alpha channel already defines the silhouette.
    // texSize: the texture's pixel width. The 1024 default is plenty for the
    // small fixed-box canvases (splash logo, how-to hero), but a FULL-BLEED
    // target (the Voyage Complete photo) stretches across the whole viewport
    // — 1024 there means visibly soft upscaling, so it passes 2048.
    const img = new Image();
    img.onload = () => {
      try {
        const w = Math.min(opts.texSize || 1024, img.width), h = Math.round((w * img.height) / img.width);
        tc.width = w; tc.height = h;
        tg.clearRect(0, 0, w, h);
        tg.drawImage(img, 0, 0, w, h);
        aspect = w / h;
        if (canvas) canvas.style.aspectRatio = `${w} / ${h}`;
        tex.needsUpdate = true;
      } catch { /* keep the fallback content */ }
    };
    img.onerror = () => { /* PNG missing -> fallback content / DOM anchor stays */ };
    img.src = opts.src;

    // ---- tiny dedicated renderer (isolated from the game's pipeline) ----
    canvas = document.createElement('canvas');
    canvas.id = opts.canvasId || 'shineCanvas';
    if (opts.canvasClass) canvas.className = opts.canvasClass;
    anchorEl.parentNode.insertBefore(canvas, anchorEl);
    if (opts.initAspect) canvas.style.aspectRatio = opts.initAspect;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const uniforms = {
      uTex: { value: tex },
      uTime: { value: 0 },
      uPar: { value: new THREE.Vector2(0, 0) },
      // default matches the original hardcoded 0.35 exactly (both existing
      // callers below rely on that) — only createVoyageDoneFX() below passes
      // a higher value, since its photo is a much busier/brighter stadium
      // shot (floodlights, confetti, an already-shiny gold trophy) where the
      // glint needs more contrast to actually read against all that.
      uIntensity: { value: opts.intensity ?? 0.35 },
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
        uniform float uIntensity;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(uTex, vUv);
          // travelling shine: a soft diagonal glint sweeping across the metal,
          // nudged slightly by the pointer so it feels connected to the tilt
          float band = (vUv.x + (1.0 - vUv.y)) * 0.55 - fract(uTime * 0.06) * 2.0 + 0.5 - uPar.x * 0.25;
          float shine = exp(-band * band * 60.0);
          c.rgb += vec3(1.0, 0.98, 0.9) * shine * uIntensity * c.a;
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
    const tiltY = opts.tiltY ?? 7;   // deg of rotateY per unit pointer.x
    const tiltX = opts.tiltX ?? 6;   // deg of rotateX per unit pointer.y

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
        `perspective(800px) rotateY(${(par.x * tiltY).toFixed(2)}deg) rotateX(${(-par.y * tiltX).toFixed(2)}deg)`;
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
    // exposed so a caller that needs non-default CSS sizing (e.g.
    // createVoyageDoneFX's full-bleed "cover" fit below) can resize the
    // WebGL renderer right after it resizes the <canvas> element itself,
    // instead of waiting for the next window resize event.
    api.resize = resize;
    api._debug = () => ({
      running,
      aspect,
      par: { x: par.x, y: par.y },
      target: { x: parTarget.x, y: parTarget.y },
    });

    anchorEl.classList.add(opts.hideClass || 'logoHidden'); // WebGL took over; DOM anchor is the fallback
  } catch (err) {
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    anchorEl.classList.remove(opts.hideClass || 'logoHidden');
  }
  return api;
}

// Splash key art: public/keyart_final.png (characters + shield + trophy +
// ROWAY wordmark in one image — same 1448x1086 canvas as the retired
// keyart_logo.png, so every size/aspect rule carries over untouched) with a
// shared pointer/tilt 3D lean plus a travelling shine.
// Until the PNG loads (or if it fails) a procedural "ROWAY" wordmark stands in,
// and if WebGL can't init at all the plain HTML .title remains.
export function createLogoFX() {
  return mountShineFX(document.querySelector('#startScreen .title'), {
    src: '/keyart_final.png',
    canvasId: 'logoCanvas',
    hideClass: 'logoHidden',
    texW: 1024, texH: 768,
    fallbackDraw(tg, tc) {
      // procedural fallback wordmark, ~4:3 so there's no jump when the PNG loads
      tg.clearRect(0, 0, tc.width, tc.height);
      try { tg.letterSpacing = '10px'; } catch { /* older browsers */ }
      tg.font = '900 140px Cinzel, "Segoe UI", system-ui, serif';
      tg.textAlign = 'center';
      tg.textBaseline = 'middle';
      const grad = tg.createLinearGradient(0, 320, 0, 480);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, '#6f9bd6');
      tg.fillStyle = grad;
      tg.fillText('ROWAY', 512, 400);
    },
  });
}

// How-to hero: public/howto-play.png (the longship + "HOW TO PLAY" ice title)
// gets the exact same shine/tilt treatment as the splash key art. No procedural
// fallback — if the PNG or WebGL fails, the plain <img class="howtoTitleImg">
// stays visible.
export function createHowtoFX() {
  return mountShineFX(document.querySelector('.howtoTitleImg'), {
    src: '/howto-play.png',
    canvasId: 'howtoLogoCanvas',
    hideClass: 'logoHidden',
    initAspect: '704 / 596',
  });
}

// Voyage-complete photo: public/3d ulleval/ulleval.png (the Ullevaal
// homecoming shot — trophy + the 4 viking-footballers, roughly centred in
// frame). Same shine/tilt mechanism as the two above, just anchored to the
// full-bleed photo instead of a small fixed-box logo, so it needs actual
// object-fit:cover behaviour instead of a fixed aspect-ratio box: the
// screen's own aspect varies with the viewport while the photo's (1920/1200)
// doesn't. The usual pure-CSS "cover" trick (min-width/height:100% + a
// locked aspect-ratio) turns out unreliable for an absolutely-positioned,
// non-replaced canvas with only top/left set (no right/bottom) — the
// shrink-to-fit width resolution it depends on doesn't reliably land on
// "100% of the container", so this does the same cover math explicitly in
// JS instead and sets the canvas's pixel size directly.
const PHOTO_ASPECT = 1920 / 1200;
export function createVoyageDoneFX() {
  const anchor = document.querySelector('#voyageDoneImg');
  const fx = mountShineFX(anchor, {
    src: '/3d%20ulleval/ulleval.png',
    canvasId: 'voyageDoneShineCanvas',
    hideClass: 'logoHidden',
    intensity: 0.6, // busier/brighter photo than the other two shine targets — needs more contrast to read
    texSize: 2048,  // full-bleed target — the 1024 default reads visibly soft stretched across the viewport
  });
  if (!fx.ok || !anchor) return fx; // WebGL/PNG failed — mountShineFX already restored the plain <img>
  const canvas = document.getElementById('voyageDoneShineCanvas');
  function fitCover() {
    const wrap = anchor.parentNode; // #voyageDoneWrap — position:absolute, full-bleed over the screen
    const cw = wrap.clientWidth || 1, ch = wrap.clientHeight || 1;
    const wide = cw / ch > PHOTO_ASPECT; // container wider (relative to height) than the photo itself
    const w = wide ? cw : ch * PHOTO_ASPECT;
    const h = wide ? cw / PHOTO_ASPECT : ch;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    // centred via explicit pixel left/top, NOT a translate(-50%,-50%)
    // transform — mountShineFX's own per-frame tilt loop OVERWRITES
    // canvas.style.transform wholesale every frame (it doesn't merge with
    // whatever's already there), which would silently wipe out a
    // transform-based centering trick the very first time the tilt kicks in.
    canvas.style.left = (cw - w) / 2 + 'px';
    canvas.style.top = (ch - h) / 2 + 'px';
    fx.resize(); // the WebGL renderer/viewport must match the new CSS size right away
  }
  window.addEventListener('resize', fitCover);
  const reveal = fx.reveal;
  fx.reveal = () => { fitCover(); reveal(); };
  return fx;
}
