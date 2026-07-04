// Shared pointer/tilt state for the menu FX (logo + shield).
// ONE set of listeners and ONE iOS permission request — both effects read the
// same smoothed target so they move in concert instead of competing.
export const MENU_INPUT = { x: 0, y: 0, lastAt: 0 };

let inited = false;
export function initMenuInput() {
  if (inited) return;
  inited = true;

  window.addEventListener('pointermove', (e) => {
    MENU_INPUT.x = (e.clientX / window.innerWidth - 0.5) * 2;
    MENU_INPUT.y = (e.clientY / window.innerHeight - 0.5) * 2;
    MENU_INPUT.lastAt = performance.now();
  }, { passive: true });

  const clamp = (v) => Math.max(-1, Math.min(1, v));
  let tiltNeutral = null;
  function onTilt(e) {
    if (e.beta == null || e.gamma == null) return;
    if (!tiltNeutral) tiltNeutral = { b: e.beta, g: e.gamma }; // resting pose = neutral
    MENU_INPUT.x = clamp((e.gamma - tiltNeutral.g) / 25);
    MENU_INPUT.y = clamp((e.beta - tiltNeutral.b) / 25);
    MENU_INPUT.lastAt = performance.now();
  }
  if (typeof DeviceOrientationEvent !== 'undefined') {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS 13+: a single request, hung on a gesture the player makes anyway
      const startScreenEl = document.getElementById('startScreen');
      const onGesture = () => {
        startScreenEl.removeEventListener('pointerdown', onGesture);
        DeviceOrientationEvent.requestPermission()
          .then((s) => { if (s === 'granted') window.addEventListener('deviceorientation', onTilt); })
          .catch(() => { /* denied -> auto-drift takes over */ });
      };
      startScreenEl.addEventListener('pointerdown', onGesture);
    } else {
      window.addEventListener('deviceorientation', onTilt); // Android / desktop
    }
  }
}

// calm lissajous drift when there has been no real input for a while
export function autoDrift(t, out) {
  out.x = Math.sin(t * 0.4) * 0.35;
  out.y = Math.cos(t * 0.3) * 0.3;
}
