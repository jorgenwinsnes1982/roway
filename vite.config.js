// three.js + its postprocessing addons (EffectComposer, RenderPass,
// UnrealBloomPass, OutputPass) are this game's entire rendering engine, and
// they're needed on the very first frame — even the splash screen is the
// live 3D scene, not a static image, so there's no route/page boundary to
// code-split behind. three.js alone accounts for the large majority of the
// bundle; Vite's default 500 kB warning is calibrated for typical DOM apps,
// not WebGL games, so it fires here even though nothing is actually bloated.
export default {
  build: {
    chunkSizeWarningLimit: 750,
  },
};
