# Lærdommer og feller (dyrekjøpte — les før du endrer koden)

1. **Fokusert knapp + Space = katastrofe.** Museklikk på en knapp beholder fokus; hvert Space-slipp fyrer da et nytt native klikk på knappen → `startRace()` restartet løpet ved hvert åretak. Ga to «spillet virker ikke»-rapporter. Fiks: `blur()` i `startRace()` + vakt (`if (mode === 'racing'|'countdown') return`). **Alle nye knapper skal blur()es etter klikk.**

2. **Syntetiske events avslører ikke alt.** `dispatchEvent(new KeyboardEvent(...))` utløser ikke native knapp-aktivering — bot-testene fanget derfor aldri feilen over. Test ekte input-flyter (mus → tastatur) separat.

3. **Per-løp-state MÅ nullstilles i `startRace()`.** `lastStrokeAt` overlevde en gang omstart → anti-mash-sjekken blokkerte alle tak i hele neste løp (usynlig feil: båten sto stille). Sjekkliste ved ny state: legg den i reset-blokken.

4. **Kameraet ser bare ~10° over horisonten** (chase-cam pitcher ned). Nordlys ble bygget og måtte kuttes — usynlig uansett plassering. Fyrverkeriet måtte senkes til y 9–24. Alt i lufta må ligge lavt og langt frem.

5. **Punktstørrelse skalerer med avstand**: `gl_PointSize = K * alpha / -mv.z`. Fyrverkeri 100–170 m unna trengte K=1050 (K=240 ga 1–2 px usynlige gnister).

6. **rAF pauses i skjulte faner/paneler** → spillet frøs midt i nedtellingen. Fallback: `setInterval(100ms)` som kaller `frame(0.1)` hvis rAF ikke har kjørt på 200 ms. Ikke fjern. Tester må polle spilltilstand, ikke veggklokke (throttling gjør spilltid ≪ sanntid).

7. **`stopPropagation` stopper IKKE andre lyttere på samme node.** Intro-skip på window (capture) lakk til meny-handleren (også window) → Space hoppet over intro OG åpnet modalen. Bruk `stopImmediatePropagation()` og registrer skip-lytteren først.

8. **GPU- og CPU-bølger må være identiske.** `WAVES`-konstanten deles av vertexshaderen og `sampleWater`. Endre begge eller ingen — ellers flyter båtene feil. Båter settes på vannet med 6-punkts sampling + fribord 1.0 (`seatBoatOnWater`) — verifisert at vann aldri når dekk (mål ved endring: verste inntrengning < 0).

9. **Rytme skal være bonus, aldri straff.** Første tempo-system senket grunnfarten OG trakk nivå for tak utenfor takta; med naturlig ro-rate ~1.3 s mot trommeperiode 2.35 s var det matematisk umulig å klatre (+1/−1-oscillasjon). Riktig: full grunnfart alltid, tempo hever bare taket, forfall over tid i stedet for per-tak-straff, trommeperiode nær naturlig rytme.

10. **Balansér med bots, ikke magefølelse.** «Perfekt bot» (treffer alt) skal vinne mot Sverige; «casual bot» (35 % av vinduer, slurvete timing) skal tape knepent (~4 s). Rivalens rubber-band + langsom start gjør løpene jevne. Kjør begge etter fysikkendringer.

11. **To sider som speiler hverandre er ikke roing.** Original åreanimasjon svingte sidene motsatt (pivot.rotation.y likt fortegn på begge). Ekte roing: `rotation.y = side * -reach * 0.62` — alle årer i unison, dipp via `rotation.z = side * (0.16 - dip*0.58)` (blad 0.36 m under vannflaten ved full dipp).

12. **Duplikate variabelnavn i samme scope** stoppet hele modul-grafen én gang (`bannerTex` fantes to steder i `createCourse`) — siden lastet «tomt» uten synlig konsollfeil i verktøyet. Kjør `npx vite build` som røykt-test etter endringer.

13. **Talesyntese går utenom WebAudio-master** — `roVoice()` må selv sjekke `isMuted()`; husk dette for alle nye TTS-innslag.

14. **Shader-feil ser ut som scene-feil.** En udeklarert uniform (`uWarmColor` brukt uten `uniform vec3`-linje) fikk HELE vann-meshen til å forsvinne — og sky-domens varme horisontfarge skinte gjennom, så «havet ble en ørken». To feilsøkingsrunder gikk med på fargeteori før konsollen ble sjekket. Regel: ved ENHVER visuell anomali etter shader-endring — **sjekk konsollen FØRST** (`THREE.WebGLProgram: Shader Error`), gjett aldri på estetikk før kompilatoren er frikjent. Bonus: mesh som ikke rendrer = bakgrunnen bak avslører seg selv.

15. **Kamera-mot-sola gjør asimut ubrukelig.** Chase-kameraet ser rett mot sola, så alle refleksjonsvektorer deler solas kompassretning — asimut-basert «varm horisontglød» farget hele havet oransje. Riktig verktøy: 3D-lobe `pow(dot(R, L), n)` som kun treffer glitterkorridoren under sola.

16. **SPA `/* → /index.html`-rewrite knekker `netlify dev`.** Catch-all-redirecten
    omskriver Vites dev-modulforespørsler (`/src/main.js`) til index.html, som Vite
    så prøver å import-analysere som JS → «Failed to parse source ... invalid JS
    syntax», svart skjerm, ingen canvas, ingen `__game` — helt stille i nettleser-
    konsollen (feilen ligger i netlify dev-serverloggen: «Rewrote URL to /index.html»).
    I prod er den harmløs (ekte `/assets/*`-filer serveres først). Fiks: dropp
    catch-all-en (appen har ingen routing) eller ekskluder `/src/*`, `/@vite/*`,
    `/node_modules/*`. Diagnose-tips: `curl localhost:PORT/src/main.js` — får du
    `<!DOCTYPE html>` er redirecten synderen.

17. **`netlify dev` proxyer feil app ved port-kollisjon.** Kjører et annet Vite-
    prosjekt allerede på 5173, proxyer netlify dev til DET (feil tittel/app) i
    stedet for å feile. Fiks: pin `[dev] targetPort` + `command = "npx vite --port
    NNNN --strictPort"` til en ledig port.

18. **Netlify Blobs krever v2-funksjoner lokalt.** Klassiske `exports.handler`-
    funksjoner får ikke Blobs-sandkassen auto-injisert under `netlify dev`
    («environment has not been configured to use Netlify Blobs», 500). Bruk v2-
    formen (`export default async (req, context) => new Response(...)`) — da virker
    Blobs uten linking både lokalt og i prod.

19. **Input skal aldri avvises stille.** Recovery-vinduet avviste først hold-input helt (spilleren holdt uten at noe skjedde). Riktig mønster: aksepter holdet, la effekten starte når systemet er klart.
