// ================= Atlanterhavsferden voyage map v2 =================
// Renders the "ATLANTERHAVSFERDEN" screen's map from the real asset package
// at public/roway_map_dev_package/ (manifest.json + sprites + two inline
// SVG layers). Framework-free — mountVoyageMap(root) builds every layer as
// plain DOM into `root` and returns a small imperative API. No dependency on
// src/voyagemap.js's procedural bezier system (that module still serves the
// separate Fase 3e stage-interlude mini-map — deliberately untouched here).
//
// Coordinate system: the package's canvas is 1448x1086 (4:3). Every layer is
// positioned in % of CANVAS_W/CANVAS_H, never px, so it's pixel-accurate to
// the manifest at any container size (the caller just needs a container with
// aspect-ratio: 1448/1086 — see #voyageMapWrap in index.html).
//
// NOTE on manifest/SVG loading: the asset package lives under public/, which
// Vite serves as-is but does NOT include in its module graph — a static
// `import manifest from '.../manifest.json'` (as suggested in the original
// brief) does not work for files under public/. This fetches them at runtime
// instead, which is the Vite-correct equivalent of "read at runtime".

export const CANVAS_W = 1448;
export const CANVAS_H = 1086;

// Phase-3's real cumulative voyage-distance total is still being decided.
// This is ONLY a fallback for isolated/dev use before a real caller wires in
// real numbers — every real call site MUST pass its own total to
// setProgress(current, total); nothing here hardcodes the meters range.
export const DEFAULT_TOTAL_METERS = 3000; // PLACEHOLDER — replace once Phase-3 total is final

// Off by default per the brief: the map sits over the live 3D scene, and the
// scrim layer is what makes it readable — the background PNG is optional set
// dressing, not a required base layer. Flip this to true to preview it.
export const SHOW_BACKGROUND_PNG = false;

const PACKAGE_BASE = '/roway_map_dev_package/';
const MANIFEST_URL = `${PACKAGE_BASE}manifest.json`;
const TOP_ROUTE_SVG_URL = `${PACKAGE_BASE}assets/svg/top_route_layer_1448x1086.svg`;
const BOTTOM_PROGRESS_SVG_URL = `${PACKAGE_BASE}assets/svg/bottom_progress_layer_1448x1086.svg`;
const SMOKE_URL = `${PACKAGE_BASE}assets/overlays/smoke_embers_overlay_transparent.png`;
const BG_URL = `${PACKAGE_BASE}assets/background/map_background_clean_1448x1086.png`;

// two-leg one-way journey: USA -> Island/Grønland -> Norge. Progress 0..0.5
// covers the first leg, 0.5..1 the second — this is the model the shipped
// route SVG's two <path> segments are built for.
const SEGMENTS = [
  { id: 'usa-island', pathId: 'route-usa-island' },
  { id: 'island-norway', pathId: 'route-island-norway' },
];
const DEST_LABELS = { usa: 'USA', island: 'Iceland / Greenland', norway: 'Norway' };
// which manifest sprite key represents which destination badge
const BADGE_TO_DEST = {
  usa_destination_badge: 'usa',
  island_greenland_badge: 'island',
  norway_destination_badge: 'norway',
};

function pctX(x) { return (x / CANVAS_W) * 100; }
function pctY(y) { return (y / CANVAS_H) * 100; }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function reducedMotion() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// tiny internal event emitter — zero deps
function createEmitter() {
  const listeners = new Map();
  return {
    on(evt, cb) {
      if (!listeners.has(evt)) listeners.set(evt, new Set());
      listeners.get(evt).add(cb);
      return () => listeners.get(evt)?.delete(cb);
    },
    emit(evt, payload) { listeners.get(evt)?.forEach((cb) => cb(payload)); },
    clear() { listeners.clear(); },
  };
}

// makes an element act like a button: focusable, Enter/Space activates,
// always blur()s after activation (repo rule — a focused button lets a
// stray Space keypress elsewhere in the game retrigger it)
function makeActivatable(el, label, onActivate) {
  el.setAttribute('tabindex', '0');
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', label);
  el.addEventListener('click', () => { onActivate(); el.blur(); });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); el.blur(); }
  });
}

export function mountVoyageMap(root) {
  const emitter = createEmitter();
  let destroyed = false;
  let loaded = false;
  let manifest = null;
  // Rule 1: this is per-screen-open display state, not persistent game
  // state — it always starts fresh at mount and is fully re-derived by
  // whatever setProgress() call the caller makes on open.
  const state = { current: 0, total: DEFAULT_TOTAL_METERS };
  const destinationEls = {};
  const checkpointEls = {};
  const pathEls = {};

  root.innerHTML = '';
  root.classList.add('voyageMapV2');

  const scrimEl = document.createElement('div');
  scrimEl.className = 'vm-layer vm-scrim';
  root.appendChild(scrimEl);

  if (SHOW_BACKGROUND_PNG) {
    const bg = document.createElement('img');
    bg.className = 'vm-layer vm-bg';
    bg.alt = '';
    bg.src = BG_URL;
    root.appendChild(bg);
  }

  const routeLayer = document.createElement('div');
  routeLayer.className = 'vm-layer vm-route-layer';
  root.appendChild(routeLayer);

  const spriteLayer = document.createElement('div');
  spriteLayer.className = 'vm-layer vm-sprites';
  root.appendChild(spriteLayer);

  const boat = document.createElement('img');
  boat.className = 'vm-sprite vm-boat';
  boat.alt = '';

  const progressLayer = document.createElement('div');
  progressLayer.className = 'vm-layer vm-progress-layer';
  root.appendChild(progressLayer);

  const footer = document.createElement('div');
  footer.className = 'vm-footer';
  root.appendChild(footer);

  const smoke = document.createElement('img');
  smoke.className = 'vm-layer vm-smoke';
  smoke.alt = '';
  smoke.src = SMOKE_URL;
  root.appendChild(smoke);

  let routeSvg = null;
  let progressSvg = null;

  async function init() {
    const [manifestJson, topRouteText, bottomProgressText] = await Promise.all([
      fetch(MANIFEST_URL).then((r) => r.json()),
      fetch(TOP_ROUTE_SVG_URL).then((r) => r.text()),
      fetch(BOTTOM_PROGRESS_SVG_URL).then((r) => r.text()),
    ]);
    if (destroyed) return;
    manifest = manifestJson;

    routeLayer.innerHTML = topRouteText;
    routeSvg = routeLayer.querySelector('svg');
    prepSvg(routeSvg, 'vm-route-svg');
    pathEls.usaIsland = routeLayer.querySelector(`#${SEGMENTS[0].pathId}`);
    pathEls.islandNorway = routeLayer.querySelector(`#${SEGMENTS[1].pathId}`);

    progressLayer.innerHTML = bottomProgressText;
    progressSvg = progressLayer.querySelector('svg');
    prepSvg(progressSvg, 'vm-progress-svg');
    checkpointEls.usa = progressLayer.querySelector('#checkpoint-usa');
    checkpointEls.island = progressLayer.querySelector('#checkpoint-island');
    checkpointEls.norway = progressLayer.querySelector('#checkpoint-norway');
    for (const [key, el] of Object.entries(checkpointEls)) {
      if (!el) continue;
      el.classList.add('vm-checkpoint');
      makeActivatable(el, DEST_LABELS[key], () => emitter.emit('checkpoint', key));
    }

    // sprites from the manifest — position/size are pure % of CANVAS_W/H,
    // never px, so this stays accurate at any container size
    const spriteKeys = [
      'metlife_stadium', 'usa_destination_badge', 'island_greenland_badge',
      'norway_destination_badge', 'route_buoy_left', 'route_buoy_right',
    ];
    for (const key of spriteKeys) {
      const def = manifest.sprites[key];
      if (!def) continue;
      const img = document.createElement('img');
      img.alt = '';
      img.src = PACKAGE_BASE + def.file;
      img.className = 'vm-sprite';
      img.style.left = `${pctX(def.x)}%`;
      img.style.top = `${pctY(def.y)}%`;
      img.style.width = `${pctX(def.width)}%`;
      img.style.height = `${pctY(def.height)}%`;
      const destKey = BADGE_TO_DEST[key];
      if (destKey) {
        img.classList.add('vm-sprite--interactive');
        makeActivatable(img, DEST_LABELS[destKey], () => emitter.emit('destination', destKey));
        destinationEls[destKey] = img;
      }
      spriteLayer.appendChild(img);
    }

    // the rowing boat's position is driven entirely by setProgress(), not by
    // its manifest x/y (those describe the PNG's own native size only)
    const boatDef = manifest.sprites.rowing_boat;
    boat.src = PACKAGE_BASE + boatDef.file;
    boat.style.width = `${pctX(boatDef.width)}%`;
    boat.style.height = `${pctY(boatDef.height)}%`;
    spriteLayer.appendChild(boat);

    loaded = true;
    applyProgress(); // paint whatever setProgress() was called with before load finished
  }

  function prepSvg(svg, cssClass) {
    svg.classList.add(cssClass);
    svg.setAttribute('viewBox', `0 0 ${CANVAS_W} ${CANVAS_H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.removeAttribute('width');
    svg.removeAttribute('height');
  }

  function segmentForFraction(f) {
    return f < 0.5 ? SEGMENTS[0] : SEGMENTS[1];
  }

  function applyProgress() {
    if (!loaded) return; // init() re-runs this once the fetches resolve
    const total = state.total > 0 ? state.total : 1;
    const fraction = clamp01(state.current / total);
    const complete = fraction >= 1;
    const seg = segmentForFraction(fraction);
    const motionOk = !reducedMotion();

    // ---- top route: completed segment brighter, active pulses, future dim ----
    const { usaIsland, islandNorway } = pathEls;
    if (usaIsland) {
      const done = complete || fraction >= 0.5;
      const active = !complete && seg.id === 'usa-island';
      usaIsland.setAttribute('stroke', done ? '#FFE9A8' : '#FFD36A');
      usaIsland.setAttribute('opacity', done ? '1' : active ? '0.95' : '0.8');
      usaIsland.classList.toggle('vm-route-active', active && motionOk);
    }
    if (islandNorway) {
      const done = complete;
      const active = !complete && seg.id === 'island-norway';
      islandNorway.setAttribute('stroke', done ? '#FFE9A8' : '#FFD36A');
      islandNorway.setAttribute('opacity', done ? '1' : active ? '0.95' : '0.4');
      islandNorway.classList.toggle('vm-route-active', active && motionOk);
    }

    // ---- boat: sample the ACTIVE path directly, per the brief ----
    const activePath = seg.id === 'usa-island' ? usaIsland : islandNorway;
    if (activePath && manifest) {
      const localT = clamp01(seg.id === 'usa-island' ? fraction / 0.5 : (fraction - 0.5) / 0.5);
      const len = activePath.getTotalLength();
      const pt = activePath.getPointAtLength(localT * len);
      const boatDef = manifest.sprites.rowing_boat;
      // centre the hull on the sampled point (offset by half the sprite box)
      boat.style.left = `${pctX(pt.x) - pctX(boatDef.width) / 2}%`;
      boat.style.top = `${pctY(pt.y) - pctY(boatDef.height) / 2}%`;
    }

    // ---- bottom progress bar: active line fill + lit checkpoints ----
    const base = progressLayer.querySelector('#progress-base');
    const activeLine = progressLayer.querySelector('#progress-active');
    if (base && activeLine) {
      const x1 = Number(base.getAttribute('x1'));
      const x2 = Number(base.getAttribute('x2'));
      activeLine.setAttribute('x2', String(x1 + (x2 - x1) * fraction));
      activeLine.classList.add('vm-progress-active-line');
    }
    const litCount = complete ? 3 : fraction >= 0.5 ? 2 : 1; // USA is always lit (the start)
    ['usa', 'island', 'norway'].forEach((key, i) => {
      const el = checkpointEls[key];
      if (!el) return;
      const lit = i < litCount;
      // NOTE: SVG presentation attributes (setAttribute('fill', ...)) do NOT
      // resolve CSS custom properties — only genuine inline style does.
      el.style.fill = lit ? 'var(--gold-deep)' : 'var(--navy)';
      el.style.stroke = lit ? 'var(--gold)' : 'var(--gold-shadow)';
    });

    // ---- destination badges: the current target glows strongest ----
    const currentDest = seg.id === 'usa-island' ? 'island' : 'norway';
    for (const [key, el] of Object.entries(destinationEls)) {
      el.classList.toggle('vm-sprite--current', key === currentDest);
    }

    emitter.emit('progress', { current: state.current, total: state.total, fraction, activeSegment: seg.id });
  }

  init();

  const api = {
    // currentMeters/totalMeters: pass the real Phase-3 cumulative voyage
    // distance here (see the wiring note in main.js) — never hardcoded here.
    setProgress(current, total = state.total) {
      state.current = Math.max(0, Number(current) || 0);
      state.total = Math.max(1, Number(total) || DEFAULT_TOTAL_METERS);
      applyProgress();
    },
    setStatusText(text) { footer.textContent = text; },
    get activeSegment() { return segmentForFraction(clamp01(state.current / (state.total || 1))).id; },
    on: emitter.on,
    destroy() {
      destroyed = true;
      emitter.clear();
      root.innerHTML = '';
    },
  };

  if (import.meta.env.DEV) {
    // dev-only scrub hook (window.__game.voyageMap._scrub(0..1)) — previews
    // any point along the journey without touching real save data
    api._scrub = (fraction) => {
      const total = state.total || DEFAULT_TOTAL_METERS;
      api.setProgress(total * clamp01(fraction), total);
    };
  }

  return api;
}
