# Vikingferd — prosjektoversikt

3D-rospill i nettleseren. Norge (spilleren) kappror mot Sverige (AI) gjennom en 1500 m fjord til et gigantisk fotballmål. Vite + Three.js, ren JS (ES-moduler), null eksterne assets — all grafikk er prosedural geometri/canvas-teksturer og all lyd er WebAudio-syntese, med ÉTT bevisst unntak: `public/sounds/drum.mp3` (Haalands ekte trommeslag, spilles i `donk()` via en dekodet AudioBuffer — `donkSynth()` i `src/audio.js` er den opprinnelige prosedurale lyden, beholdt som fallback hvis samplen ikke laster).

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
| `src/main.js` | Spillmotoren: game state (`G`), rival (`R`), tempo (`T`), fysikk, kollisjoner, kamera (chase + filmatisk intro `INTRO_SHOTS`), partikler (splash + fyrverkeri), HUD-kobling, toppliste (localStorage), post-processing (EffectComposer + UnrealBloom + OutputPass). Blad-splash: `stepOarWaterFX()` vokter dip-verdien som poserte hver båt denne framen (spiller-input, meny-idle, intro-bot ELLER rival-AI) og spawner entry-krans + skumflekk / exit-drypp på hvert blads faktiske verdensposisjon (`bladeWorld()` leser featherPivot). `OARFX.*.wasIn` nullstilles i `startRace()` (Regel 1). Racing-entry eies fortsatt av `executeStroke()` (kraftskalert + `splash(power)`-lyd). |
| `src/ship.js` | Skipbygging parametrisert per lag (`buildShip('norway'|'sweden')`): skrog, seil/flagg (canvas-teksturer), roere, årer, Haaland med tromme. Ro-poser: `poseStroke(shipData, reach, dip, t)` og `cyclePose(phase)` for kontinuerlig syklus (rivalen + idle). Åre-fjæring: hver åre har `outerPivot`→`dipPivot`→`featherPivot`; bladet står på HØYKANT i vannet (entry/drag/exit) og FLATT over vannet i recovery, easet med smoothstep på dip-signalet (`_squaredK`, konstantene `FEATHER_LOW/HIGH/ANGLE`). |
| `src/water.js` | Gerstner-bølger: delt konstant `WAVES`, GPU-vertexshader OG CPU-`sampleWater(x,z,t)` — alltid i sync. Fragment: fresnel, subsurface-glød, mikro-krusninger, sol-glitter + skrog-vask (`hullWash()`): baugbølge, side-skvulp og kjølvann for BEGGE skip via uniforms `uShipA/uShipB` (x, z, heading, fart — settes per frame fra main.js med `water.setShips(...)`). Rent additivt skum oppå bølgene — kjerne-`WAVES` røres aldri (Regel 6). |
| `src/world.js` | Fjell, himmel (gradient-shader), skyer, tåkebanker, måker, løypa: porter (med pulserende «neste»-logikk), isflak, fotballer, målet. `updateCourse` bobber alt på bølgene. |
| `src/audio.js` | WebAudio-syntese: splash, ding (pitch-parameter), thud, whistle, crowd, kick/hat/bass (rytme), donk (Haalands tromme), roVoice (talesyntese nb-NO + synth-fallback), whoosh, fireworkBoom. `setMuted/isMuted` styrer master-gain. |

## Spillflyt (skjermer)
Boot-preloader (rune-bar 0→100 %) → filmatisk intro (9,5 s action-sekvens: begge skip sprinter og bytter ledelse; fem skipsforankrede kameraklipp — vid etablering, vannskims, drone-orbit, bauglinje, kran opp i menykamera; lander eksakt på meny-posisjonene; hoppes over med tast/klikk) → splash (`#startScreen`: ROW RACE + BRING HOME THE TROPHY + Leaderboard) → instruksjonsmodal (`#howtoScreen`) → nedtelling → løp → målgang.

**Row Race-resultat**: placement-hero («1ST TODAY» / «3rd All-time») + poeng + roterende reward-ticker → claim-steg VISES ETTER HVERT LØP (navnefelt ferdig utfylt fra forrige gang, «Claim your place» / «Skip for now») → etter claim/skip: ROW AGAIN / CHALLENGE A FRIEND + Top 3 + full toppliste-lenke (`setResultNameState()`-maskinen i main.js).

**Reisen-resultat**: samme layout som Race — «STAGE N/5 COMPLETED»-hero + «Nth place so far» + etappepoeng + «Voyage total» + ticker; knapper «Row stage N again» / «Row stage N+1». Etappekart-skjermene bruker delt kartvideo-loop + per-etappe ruteoverlegg (`public/3d map/`); mellom etapper: stage-interlude med samme kartstack. Etter fullført reise (stage 5 er one-shot): Ullevaal-fotoskjerm (`public/3d ulleval/ulleval.png`) med VOYAGE COMPLETE-wordmark (`public/voyagecomplete.png`), «The trophy is home» + rank-linje, START NEW VOYAGE (rød CTA) over BACK i splash-stakk-layout, og full scrollbar kombinert-toppliste med egen rad sentrert.

## Debug og testing (viktig!)
`window.__game` (KUN dev-bygg) eksponerer `{ G, R, T, GH, C, INTRO, course, builtStageId, voyage (get/set), shipData, LETTER, PEND, omega, tempo, fartCap, voyageMap, renderer, ship, rival, spawnFireworkBurst, waterT, openShipViewer }`.

Dev-verktøy (alle strippet fra produksjonsbygg): **⏩ spole-knappen** (øverst til høyre under et løp — markerer alle porter som rent passert og fullfører løpet umiddelbart; perfekt for å teste resultatskjermer og alle 5 reise-etapper), **psw-galleriet** (skriv «psw» → meny med alle skjermer inkl. resultat-varianter med testdata, eller /__screens), og **Settings → Reset voyage progress** (to-trykks bekreftelse, nullstiller reisen).

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
Komplett kildekode-snapshot per 2026-07-12: `index.html`, `main.js`, `ship.js`, `water.js`, `world.js`, `audio.js`, `voyage.js`, `missions.js`, `voyagemap.js`, `map/voyageMap.js`, `logo.js`, `shield.js`, `runeButtons.js`, `menuInput.js`, `screens.js`, `devScreens.js`, `netlify/functions/*` (leaderboard/challenge/voyage-API), `package.json`, `netlify.toml`, `vite.config.js`. NB: i det ekte repoet ligger js-filene under `src/` (unntatt index.html/package.json/netlify.toml/vite.config.js i rota). Be brukeren lime inn oppdaterte filer hvis koden har endret seg siden.
