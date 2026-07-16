// Tiny WebGL diagnostics collector — hunting the iPhone 16 Pro / Pro Max
// blank-canvas bug (the 3D world never paints while the DOM UI shows fine;
// works on iPhone 12). Prime suspects are WebKit's per-page WebGL context/
// memory budget evicting the MAIN context (H1) and the half-float MSAA
// composer target (H2) — see the investigation notes in main.js.
//
// Collection is unconditional but near-zero cost: a handful of array pushes
// at boot, nothing per-frame. DISPLAY is dev-gated — the on-screen overlay
// only exists behind the ?dev=roway2026 unlock (main.js DEV_TOOLS block);
// everything is also readable from a console via window.__glDiag.
export const glDiag = {
  ctx: [],      // every WebGL context created: { id, t }
  lost: [],     // webglcontextlost events: { id, t }
  restored: [], // webglcontextrestored events: { id, t }
  errors: [],   // gl.getError() captures: { where, code, t }
  notes: [],    // free-form fallback decisions / recovery attempts
  boot: {},     // boot phase timestamps (ms since page start)
  env: {},      // context/extension support snapshot (filled by main.js)
  frames: 0,    // incremented every frame() tick — proves the loop is ALIVE
  pixel: null,  // periodic canvas-centre readback { f, rgba } — proves paint
};
window.__glDiag = glDiag;

// Trap the errors we can't see without a cabled Web Inspector: an uncaught
// exception in the rAF callback kills three's setAnimationLoop silently —
// on-device that reads as "the world just never appears" with zero console.
// First finding on iPhone 16 Pro (iOS 18.7): context alive, framebuffer
// COMPLETE, no GL errors — so the remaining suspects are exactly this kind
// of invisible JS failure. Cap the log so a repeating error can't grow it.
window.addEventListener('error', (e) => {
  if (glDiag.notes.length < 40) {
    glDiag.notes.push(`JS ERR: ${e.message} @${(e.filename || '').split('/').pop()}:${e.lineno}`);
  }
});
window.addEventListener('unhandledrejection', (e) => {
  if (glDiag.notes.length < 40) {
    const r = e.reason;
    glDiag.notes.push(`REJECTION: ${r && (r.message || String(r))}`);
  }
});

const now = () => Math.round(performance.now());

// iOS/iPadOS (every iOS browser is WebKit, incl. Chrome-on-iOS). iPadOS 13+
// masquerades as "MacIntel" desktop — the maxTouchPoints check catches it.
// Shared here because main.js (composer fallbacks + paint watchdog) AND
// logo.js/shield.js (static-image mode, see below) all branch on it.
export const IS_IOS_WEBKIT = /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function glDiagCtx(id) {
  glDiag.ctx.push({ id, t: now() });
}

export function glDiagNote(msg) {
  glDiag.notes.push(`${now()}ms ${msg}`);
}

// Attach lost/restored listeners to a canvas. three.js's WebGLRenderer already
// registers its own webglcontextlost handler that calls preventDefault() (which
// is what permits a later restore), so these listeners are purely for evidence
// + optional recovery hooks — they never replace three's own handling.
export function glDiagWatch(canvas, id, { onLost, onRestored } = {}) {
  canvas.addEventListener('webglcontextlost', (e) => {
    glDiag.lost.push({ id, t: now() });
    if (onLost) onLost(e);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    glDiag.restored.push({ id, t: now() });
    if (onRestored) onRestored();
  });
}
