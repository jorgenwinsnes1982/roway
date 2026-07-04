# Vikingferd — spilldesign og balanseverdier

## Kjernemekanikk: hold-og-slipp-roing («ta i»-følelsen)
- HOLD Space / RO-knapp → kraft lades: `charge += dt / 0.95` (CHARGE_TIME 0.95 s). Mannskapet lener seg frem, årene svinger mot baugen.
- SLIPP → taket utføres. Soner på kraftmåleren:
  - `0.78–1.08` (gull): **PERFEKT** — power 1.0, combo++
  - `0.55–0.78`: BRA — power 0.7, combo nullstilles
  - `0.18–0.55`: FOR TIDLIG — power 0.35
  - `> 1.18`: auto-slipp **«ÅRENE SKLIR!»** — power 0.45 (risiko/belønning: hold lengst mulig, men ikke for lenge)
- Recovery-gate: hold aksepteres alltid, men ladningen starter først 0.3 s etter forrige tak (aldri stille avvist input).
- Impuls: `speed += power * 3.8 * boostMult * comboMult`
  - `boostMult` = 1.35 under turbo, `comboMult` = 1 + min(combo,10)*0.04 (opptil +40 %)
- Drag: `speed -= (speed*(0.09 + speed*0.0045) + 0.2) * dt`
- Fartstak: `20 + tempoLevel*0.75 + (boost ? 3.5 : 0)` → 20 baseline, 26 ved full takt, 29.5 med turbo.

## Haaland-tempoet (alltid bonus, aldri straff)
- Haaland (stor blond figur m/ tromme + «HAALAND 9»-skilt, kun Norge-skipet) trommer «donk (fase 0.55), donk (0.78)» og roper **«RO!»** (talesyntese + stor tekst) ved fasestart.
- Syklus: `period = 1.95 - level*0.06` (→ 1.47 s ved maks — nær naturlig ro-rytme 1.25–1.5 s).
- Slipp innen **+0.45 s etter / −0.4 s før** et RO-rop med power ≥ 0.7 → `level++` (maks 8, vist som trommeprikker over meteret).
- Forfall: −1 nivå per 4 s uten takt-treff. Kræsj: −3. **Tak utenfor takta straffes ALDRI per tak** (det låste farten — se LÆRDOMMER.md).
- Nivå 8: «🔥 MAX FART! 🔥» + publikum.

## Løypa (1500 m)
- **9 porter**: sinuslagt (`sin(i*1.7) * (CHANNEL_HALF-30)`), bredde 17. Passering: +1.6 fart. Visuelt: flaggstenger + glødende kuler + «▼ PORT ▼»-banner; NESTE port pulserer, passert = grønn, bommet = grå.
- **26 fotballer**: turbo 3.2 s (+2.4 fart umiddelbart), gullglød + whoosh.
- **22 isflak** (kun steiner — tømmerstokker fjernet som for brede): størrelse 1.8–3.5, treff-radius størrelse+1.6. Kræsj: fart×0.35, stun 0.8 s, combo 0, tempo −3, hitstop 0.22 s + rødt flash.
- Kanal-halvbredde 55; myk vegg bremser utenfor.

## Rivalen (Sverige)
- Pace 12.3–12.9 m/s (`R.pace`, trekkes per løp), menneskelig langsom start (`accel-faktor 0.22`).
- Rubber-band: >50 m foran → inntil ×0.82; >50 m bak → inntil ×1.12. Målet: casual taper knepent (~4 s), god spiller vinner.
- Følger portlinja med egen linje per port; **28 % sjanse for å blingse** (sikter utenfor stanga) → «BOM!»-sprite over skipet, skam-vingling, splash, −15 % fart, callout «SVERIGE BOMMET PORTEN! 🙈».
- Rormann-unnvikelse: styrer unna spilleren når < 12 m sideveis og < 45 m på langs.
- Skip-kollisjon: skrog kan aldri overlappe (HULL_W 5, HULL_L 26; spilleren tar 65 % av separasjonen). Dytt-hendelse (cooldown 2.2 s): heading ±0.2, fart ×0.88, «SAMMENSTØT! ⚔️».

## Poeng og toppliste
```
score = round(250000 / max(30, tid))   // tidspoeng — dominerer
      + fotballer * 200
      + perfekte_tak * 25
      + porter * 100
      + (slo_sverige ? 2000 : 0)
```
Topp 10 i `localStorage['vikingferd_leaderboard']`, alias i `vikingferd_alias`, bestetid i `vikingferd_best`. Resultatflyt: steg 1 = fyrverkeri + plassering + navnefelt; steg 2 (etter lagring/hopp over) = toppliste + «Ro igjen». Space-restart er sperret til steg 2.

## Callouts og feiring
«HALVVEIS! 🇳🇴», «SISTE SPURT! 🏁» (+publikum), «DU LEDER!»/«SVERIGE TAR LEDELSEN!» (prioritetslås 1.2 s så tak-labels ikke overskriver), konfetti (DOM) ved seier, 3D-fyrverkeri (additive Points, lav høyde 9–24 pga. kameravinkel) ved målgang — tettere kadens ved seier.

## Grafikkprofil
«Blå time»: himmel-topp 0x0e2454 → horisont 0xff9e52, fog 0x8fa9cf (320→1150). UnrealBloom 0.45/0.55/0.9 + 4×MSAA HalfFloat + OutputPass. Emissive lykter/drageøyne/port-kuler gløder. Vann: fresnel + subsurface mot sola + avstandsdempede mikro-krusninger + skarpt glitter.
