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
};
window.__glDiag = glDiag;

const now = () => Math.round(performance.now());

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
