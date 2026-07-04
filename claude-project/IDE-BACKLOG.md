# Idé-backlog

## Fra Jørgen (ikke bygget ennå)
- **⚽ Fotballmål-porter**: hver port føles som et fotballmål der man «sparker»/dytter en ball i mål når man passerer → ekstrapoeng. (Idéen ble påbegynt beskrevet, aldri implementert — avklar detaljer: ligger det en ball ved porten? treffer baugen den? straffe-bom hvis man bommer på mål?)

## Naturlige neste steg
- **Online-toppliste**: felles liste på tvers av spillere (krever liten backend / Supabase e.l. — i dag kun localStorage).
- ~~**Ghost-båt**~~ ✅ BYGGET (2026-07-03): gjennomsiktig hologram-replay av bestetiden (`GH` i main.js, `vikingferd_ghost` i localStorage, 10 Hz-sampling, «DITT BESTE»-label, lavmælte forbi/drar-ifra-callouts med 8 m hysterese, ingen kollisjon).
- **Flere motstandere**: Danmark, Island … felt på 3–4 skip.
- **Vær/varianter**: motvind-seksjoner («MOTVIND!» = tyngre drag), medvind, regn/snø, natt-løp der nordlyset endelig kan brukes (krever friere kameravinkel — se LÆRDOMMER.md pkt. 4).
- **Power-ups utover turbo**: skjold (tåler ett isflak), Haaland-brøl (øyeblikkelig full tempo).
- **Achievements/medaljer**: «Ro et helt løp uten bom», «Slå Sverige med >10 s», «MAX FART i 20 s sammenhengende».
- **Vanskelighetsgrader**: Sverige-pace som «Lett/Middels/VM-finale».
- **Mobil-finpuss**: haptics (navigator.vibrate) på PERFEKT/kræsj, fullskjerm-API, PWA-manifest for hjemskjerm.
- **Replay/foto-modus**: fri kamera etter målgang (gjenbruk intro-kamerasystemet `INTRO_SHOTS`).

## Kjente småting
- Talesyntese-stemmen («RO!») varierer med OS/nettleser — vurder innspilt lyd som fallback hvis den skurrer.
- Touch-knappene vises via `pointer: coarse` — kan ikke verifiseres i desktop-emulator, test på ekte mobil.
- Fyrverkeri + konfetti samtidig ved seier er bevisst overdådig — juster hvis det blir for mye.
