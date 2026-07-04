# Vikingferd — prosjektoversikt

3D-rospill i nettleseren. Norge (spilleren) kappror mot Sverige (AI) gjennom en 1500 m fjord til et gigantisk fotballmål. Vite + Three.js, ren JS (ES-moduler), null eksterne assets — all grafikk er prosedural geometri/canvas-teksturer og all lyd er WebAudio-syntese.

## Kjøring
```bash
npm install
npx vite --port 5178
# → http://localhost:5178
npx vite build   # produksjonsbygg (skal alltid være grønt før man er ferdig)
```

## Filstruktur og ansvar
| Fil | Ansvar |
|---|---|
| `index.html` | All HUD/UI (skjermer, meter, toppliste, touch-kontroller) + all CSS. Ingen templating — ren HTML med id-er. |
| `src/main.js` | Spillmotoren: game state (`G`), rival (`R`), tempo (`T`), fysikk, kollisjoner, kamera (chase + filmatisk intro `INTRO_SHOTS`), partikler (splash + fyrverkeri), HUD-kobling, toppliste (localStorage), post-processing (EffectComposer + UnrealBloom + OutputPass). |
| `src/ship.js` | Skipbygging parametrisert per lag (`buildShip('norway'|'sweden')`): skrog, seil/flagg (canvas-teksturer), roere, årer, Haaland med tromme. Ro-poser: `poseStroke(shipData, reach, dip, t)` og `cyclePose(phase)` for kontinuerlig syklus (rivalen + idle). |
| `src/water.js` | Gerstner-bølger: delt konstant `WAVES`, GPU-vertexshader OG CPU-`sampleWater(x,z,t)` — alltid i sync. Fragment: fresnel, subsurface-glød, mikro-krusninger, sol-glitter. |
| `src/world.js` | Fjell, himmel (gradient-shader), skyer, tåkebanker, måker, løypa: porter (med pulserende «neste»-logikk), isflak, fotballer, målet. `updateCourse` bobber alt på bølgene. |
| `src/audio.js` | WebAudio-syntese: splash, ding (pitch-parameter), thud, whistle, crowd, kick/hat/bass (rytme), donk (Haalands tromme), roVoice (talesyntese nb-NO + synth-fallback), whoosh, fireworkBoom. `setMuted/isMuted` styrer master-gain. |

## Spillflyt (skjermer)
Filmatisk intro (5 s, tre kameraklipp, hoppes over med tast/klikk) → splash (`#startScreen`: START + Toppliste) → instruksjonsmodal (`#howtoScreen`) → nedtelling → løp → målgang: fyrverkeri + «DU ENDTE PÅ X. PLASS» + navnefelt (`resultStage 1`) → etter lagring/hopp over: toppliste + «Ro igjen» (`resultStage 2`).

## Debug og testing (viktig!)
`window.__game` eksponerer `{ G, R, T, course, renderer, ship, rival, spawnFireworkBurst, waterT }`.

Bot-mønster for å teste roing (hold-og-slipp):
```js
const {G} = window.__game;
const down = () => window.dispatchEvent(new KeyboardEvent('keydown', {code:'Space', bubbles:true}));
const up   = () => window.dispatchEvent(new KeyboardEvent('keyup',   {code:'Space', bubbles:true}));
setInterval(() => {
  if (G.mode !== 'racing') return;
  if (!G.charging && G.driveT <= 0 && G.time - G.lastStrokeAt >= 0.3) down();
  if (G.charging && G.charge >= 0.85 && G.charge <= 1.05) up();  // slipp i gullsonen
}, 40);
```
Teleport-triks for å teste hendelser: sett `G.x/G.z` rett før et objekt (`course.collectibles/obstacles/gates`, `course.finishZ`), eller flytt `R.z/R.x` for rival-scenarier. NB: syntetiske events utløser IKKE native knapp-aktivering — test ekte museklikk-flyt separat (se LÆRDOMMER.md).

## Vedlagte kildefiler
`index.html`, `main.js`, `ship.js`, `water.js`, `world.js`, `audio.js`, `package.json` — snapshot per 2026-07-03. Be brukeren lime inn oppdaterte filer hvis koden har endret seg siden.
