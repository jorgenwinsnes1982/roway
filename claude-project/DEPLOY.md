# Deploy Vikingferd til Netlify

Statisk Vite-frontend (Three.js) + to Netlify Functions med Netlify Blobs for
den globale topplista. All konfig ligger i `netlify.toml`.

## Miljøvariabler

| Variabel | Hvor | Hva |
|---|---|---|
| `SCORE_SECRET` | Server (function) | Hemmelig nøkkel som signaturen verifiseres mot i `submit-score`. |
| `VITE_SCORE_SECRET` | Klient (build) | **Samme verdi** — Vite eksponerer bare `VITE_`-prefiks til nettleseren. Signaturen genereres her. |

> ⚠️ Begge MÅ være samme streng, ellers avvises alle innsendinger (403 bad-sig).
> Hemmeligheten havner i klient-bundelen — den hever terskelen mot juks, men er
> ikke vanntett (se trusselmodellen øverst i `submit-score.js`). **Ikke commit
> den.** Sett den i Netlify-dashbordet, ikke i en committet `.env`.

Lokalt (for `netlify dev`): lag en `.env` i rota (den er git-ignorert):

```
SCORE_SECRET=en-lang-tilfeldig-streng
VITE_SCORE_SECRET=en-lang-tilfeldig-streng
```

I Netlify-dashbordet: **Site configuration → Environment variables → Add** →
legg til begge to med samme verdi. Rebygg etter endring (`VITE_`-vars bakes inn
ved build).

---

## Verifiser bygget lokalt

```bash
npm install
npm run build        # → dist/
npm run preview      # → http://localhost:4173
```

## Test hele stacken lokalt (functions + Blobs)

```bash
npm install -D netlify-cli      # eller: npm install -g netlify-cli
npx netlify dev                 # → http://localhost:8888
```

`netlify dev` kjører Vite + functions sammen og gir en lokal Blobs-sandkasse,
så den globale topplista virker uten sky. Åpne `http://localhost:8888`, ro et
løp, lagre score → den skal dukke opp i lista. Test-API-et direkte:

```bash
curl http://localhost:8888/.netlify/functions/get-scores      # → {scores:[…], nonce:"…"}
```

---

## Alternativ A — Netlify CLI

```bash
npx netlify login
npx netlify deploy --build            # draft-URL for test
npx netlify deploy --build --prod     # produksjon
```

Første gang: velg «Create & configure a new site». Sett `SCORE_SECRET` og
`VITE_SCORE_SECRET` i dashbordet (eller `npx netlify env:set SCORE_SECRET …`)
og deploy på nytt så klient-secreten bakes inn.

## Alternativ B — koble GitHub-repo i dashbordet (auto-deploy)

1. Push prosjektet til GitHub (må inneholde `netlify.toml` og `netlify/`).
2. <https://app.netlify.com> → **Add new site → Import an existing project** → GitHub → velg repoet.
3. `netlify.toml` fyller ut alt: build `npm run build`, publish `dist`, functions `netlify/functions`. Bekreft.
4. **Site configuration → Environment variables:** legg til `SCORE_SECRET` og `VITE_SCORE_SECRET` (samme verdi).
5. **Deploy site.** Hver `git push` til hovedgrenen trigger nytt bygg.
6. Blobs aktiveres automatisk første gang en function skriver til en store.

**Finn URL-en:** øverst i site-oversikten står `https://<ditt-site>.netlify.app`.
**Site configuration → Change site name** for et lesbart navn (f.eks. `roway`).

---

## Teste på mobil

Åpne `.netlify.app`-URL-en i mobilnettleseren. iOS spør om bevegelses-/
orienteringstilgang ved første trykk — «Tillat» for logo-/skjold-tilt. Global
topplista fungerer på tvers av alle enheter; uten nett faller den tilbake til
den lokalt lagrede lista med en diskret melding.

## Merknader

- Topplista lever i Netlify Blobs (`leaderboard`-store, topp 100). `nonces`- og
  `rate`-storene bruker korte tidsvinduer; utløpte nonces avvises på lesing (Blobs
  har ingen native TTL, så gamle nøkler kan hope seg opp harmløst).
- **REISEN-toppliste** (`issue-stage-token` / `submit-voyage` / `get-voyage`)
  bruker en egen `voyage-scores`-store — ALDRI KAPPRO sin `leaderboard`-store.
  Den gjenbruker samme `nonces`- og `rate`-store som KAPPRO (samme SECRET,
  ingen nye miljøvariabler). Rangeres etter SAMLET tid (lavest vinner) på tvers
  av de 5 reise-etappene; siden REISEN er en permanent, gradvis fremgang uten
  noe fast "start/slutt"-tidspunkt, er hver etappes beste tid sin egen
  permanente tilstand som forbedres over så mange økter det tar — se
  kommentarene i `src/voyage.js` og `submit-voyage.js` for begrunnelsen.
- Asset-stiene er absolutte-fra-rot — riktig for Netlify (rot-hosting), brekker
  under sub-sti-hosting (f.eks. GitHub Pages `/repo/`).
- **Ingen SPA catch-all redirect.** Appen har ingen client-side routing, og en
  `/* → /index.html`-rewrite knekker `netlify dev` (den omskriver Vites dev-
  moduler `/src/*` til index.html). Se kommentar i `netlify.toml` hvis routing
  noen gang legges til.
- `[dev]` i `netlify.toml` pinner Vite til port 5288 for `netlify dev` — bare
  lokalt, påvirker ikke prod-bygget. Endre om porten er opptatt.
- **`window.__game`-debughandtaket finnes bare i dev** (`import.meta.env.DEV`),
  og strippes helt fra prod-bygget — ellers kunne hvem som helst skrive om
  spilltilstanden og sende inn en plausibel falsk score.
