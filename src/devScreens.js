// DEV-ONLY hidden Screen Gallery. Never shipped: main.js imports this only
// behind `import.meta.env.DEV`, so in a production build the dynamic import is
// dead-code-eliminated and this module (plus screens.js) is dropped entirely.
//
//   • Type "psw" anywhere (outside inputs) to open a floating menu that lists
//     every registered screen; click one to jump straight to it.
//   • Once you've jumped to a screen, type "psw" again (or hit Esc) to close
//     that preview and restore whatever screen was showing before the jump.
//   • The menu links to /__screens — a full-page gallery of the same screens
//     (served by index.html under Vite's dev SPA fallback; 404 in production
//     since there's no catch-all redirect, so the route is truly dev-only).
//   • Escape or a click outside the menu closes it.
//
// Nothing here alters the normal experience: the key listener only ever
// intercepts a key (preventDefault/stopPropagation) for Esc while a preview
// is active, and only reacts to that or the exact "psw" sequence otherwise —
// the menu is created lazily on demand.

import { SCREENS, showScreen } from './screens.js';

const SEQ = 'psw';
const GALLERY_PATH = '/__screens';

// Don't hijack typing in editable controls.
function isTypingTarget(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

// ---- shared styling helpers (all inline so the module needs no CSS file) ----
function styleButton(el) {
  el.style.cssText = [
    'display:block', 'width:100%', 'box-sizing:border-box', 'text-align:left',
    'padding:9px 12px', 'margin:0', 'border:1px solid rgba(255,255,255,.18)',
    'border-radius:8px', 'background:rgba(255,255,255,.06)', 'color:#eaf2ff',
    'font:600 13px/1.2 system-ui,sans-serif', 'letter-spacing:.3px',
    'cursor:pointer', 'text-decoration:none', 'transition:background .12s ease',
  ].join(';');
  el.addEventListener('pointerenter', () => { el.style.background = 'rgba(120,190,255,.22)'; });
  el.addEventListener('pointerleave', () => { el.style.background = 'rgba(255,255,255,.06)'; });
  return el;
}

// Build one clickable row: a <button> that jumps to a screen, or an <a> link.
function screenRow(label, onClick, href) {
  const el = document.createElement(href ? 'a' : 'button');
  el.textContent = label;
  if (href) el.href = href;
  else { el.type = 'button'; el.addEventListener('click', onClick); }
  return styleButton(el);
}

// ================= test-data population =================
// Fill the (otherwise data-driven) result screen with representative values so
// it can be previewed without playing a full race. The result screen renders
// very differently per game mode (see the `G.gameMode === 'kapp'` branch in
// finishRace(), src/main.js) — these two fillers mirror that branch field-for-
// field (same elements shown/hidden, same text templates) rather than unioning
// every possible field, so each preview matches what a player actually sees.
function fillResultShared() {
  const el = (id) => document.getElementById(id);
  el('resultTitle').textContent = '🇳🇴 NORWAY 1 – 0 SWEDEN 🇸🇪';
  // always hidden by the result-card redesign — the headline is #placeBanner
  // in every mode now (see finishRace() in main.js)
  el('resultTitle').classList.add('hiddenMsg');
}

// Race result renders in TWO steps (see setResultNameState() in main.js):
// step 1 "claim": EVERY finish shows the name field (pre-filled with the
// name saved last time) + "Claim your place" + "Skip for now" — nothing
// else; step 2 "claimed": the form is gone, the confirmation line + Edit,
// the Row again/Challenge buttons and the Top 3 board are in. One preview
// variant per step so both real states can be inspected.
function fillResultRaceShared() {
  fillResultShared();
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const html = (id, s) => { const el = document.getElementById(id); if (el) el.innerHTML = s; };
  const hide = (id) => { const el = document.getElementById(id); if (el) el.classList.add('hiddenMsg'); };

  // Result-card redesign: the headline just names the moment; the actual
  // rank/score/time all live inside #resultCard's stat card.
  set('placeBanner', 'RACE COMPLETED');
  hide('stageNameBanner'); // KAPPRO has no stage concept
  set('resScore', '14,820');
  set('resTime', '1:24.6');
  set('resRank', '#1');
  set('resBalls', '19/26');
  hide('newBestBadge'); // typical run: not a personal record
  // rotating ticker — preview just the first message (real code cycles them)
  set('resultTicker', '🔥 +450 Perfect strokes bonus');

  // duel card only appears after a challenge-link run — hidden on a normal race
  hide('duelCard');
  html('voyageMilestones', ''); // typical run: no distance milestone crossed

  // voyage-only sections stay hidden in Race mode
  hide('stageContext');
  hide('voyageRankBanner');
  hide('voyageLbWrap');
  document.getElementById('savedMsg').classList.remove('show'); // voyage-owned line
}

function fillResultRaceClaimTestData() {
  fillResultRaceShared();
  const hideBtn = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
  // step 1: the claim form IS the view — name pre-filled from last time
  document.getElementById('lbNameHeadline').classList.remove('hiddenMsg');
  document.getElementById('lbNameSubtext').classList.remove('hiddenMsg');
  document.getElementById('saveRow').style.display = 'flex';
  document.getElementById('aliasInput').value = 'TestViking';
  document.getElementById('saveScoreBtn').disabled = false;
  document.getElementById('saveScoreBtn').textContent = 'Claim your place';
  document.getElementById('lbNameError').textContent = '';
  // Row Race dropped both the "skip" side-door and the main-menu escape —
  // claiming your place is now the only way off this screen (see
  // applyResultNameState() in main.js)
  hideBtn('skipSaveBtn');
  hideBtn('resultMenuBtn');
  // buttons/board arrive only after claiming/skipping
  hideBtn('retryBtn');
  hideBtn('challengeBtn');
  hideBtn('viewFullLbBtn');
  document.getElementById('lbResultWrap').style.display = 'none';
  hideBtn('repeatStageBtn');
  hideBtn('nextStageBtn');
}

function fillResultRaceClaimedTestData() {
  fillResultRaceShared();
  const html = (id, s) => { const el = document.getElementById(id); if (el) el.innerHTML = s; };
  const showBtn = (id) => { const el = document.getElementById(id); if (el) el.style.display = ''; };
  const hideBtn = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
  const lbRow = (name, time, score, me, flag) =>
    `<li${me ? ' class="me"' : ''}><span class="lbName">${name}</span>` +
    `<span class="lbTime">${time}${flag ? ' 🇳🇴' : ''}</span><span class="lbScore">${score}</span></li>`;
  // step 2: form gone, buttons + Top 3 board in
  document.getElementById('lbNameHeadline').classList.add('hiddenMsg');
  document.getElementById('lbNameSubtext').classList.add('hiddenMsg');
  document.getElementById('saveRow').style.display = 'none';
  hideBtn('skipSaveBtn');
  hideBtn('resultMenuBtn'); // Row Race never shows this, claimed or not
  showBtn('retryBtn');
  showBtn('challengeBtn');
  showBtn('viewFullLbBtn');
  document.getElementById('lbResultWrap').style.display = '';
  html('leaderboard',
    lbRow('Haaland', '1:20.2', '15,420', false, true) +
    lbRow('TestViking', '1:24.6', '14,820', true) +
    lbRow('Kari', '1:26.0', '14,110'));
  hideBtn('repeatStageBtn');
  hideBtn('nextStageBtn');
}

function fillResultVoyageTestData() {
  fillResultShared();
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const html = (id, s) => { const el = document.getElementById(id); if (el) el.innerHTML = s; };
  const show = (id) => { const el = document.getElementById(id); if (el) el.classList.remove('hiddenMsg'); };
  const hide = (id) => { const el = document.getElementById(id); if (el) el.classList.add('hiddenMsg'); };
  const showBtn = (id) => { const el = document.getElementById(id); if (el) el.style.display = ''; };
  const hideBtn = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };

  const vRow = (name, time, me) =>
    `<li${me ? ' class="me"' : ''}><span class="lbName">${name}</span><span class="lbTime">${time}</span></li>`;

  // Reisen result mirrors Race's layout: stage-completion headline + the
  // same stat card (points/time/"so far" rank), with the reward ticker
  // rotating below — texts mirror finishRace's voyage branch /
  // applyVoyageStageRanks formats
  hide('resultTitle'); // same single-hero focus as Race now
  // the stage NAME is its own small pill above the "COMPLETED" headline now
  show('stageNameBanner');
  set('stageNameBanner', 'THE ICELAND PASSAGE');
  set('placeBanner', 'COMPLETED');
  set('resScore', '11,212');
  set('resTime', '1:24.6');
  set('resRank', '#21');
  set('resBalls', '30/30');
  hide('newBestBadge'); // typical stage run: not a personal record
  set('resultTicker', '⛵ +1,700 m on the voyage'); // first message of the rotation

  hide('duelCard'); // challenge links replay the daily course only

  show('stageContext');
  set('stageContext', '14th on this stage');
  html('voyageMilestones', ''); // milestones only fire on the trophy/home crossings (stage 4/5)
  hide('voyageRankBanner'); // only shown while the combined rank is still pending (offline caveat)
  show('voyageLbWrap');
  html('voyageLeaderboard',
    vRow('Haaland', '6:12.4') + vRow('Ødegaard', '6:20.1') + vRow('Nora', '6:34.8') +
    vRow('TestViking', '6:41.2', true) + vRow('Ola', '6:58.9'));

  // no claim prompt / no today's leaderboard — voyage mode has neither
  // (the name field only appears on the one-shot stage-5 final submission)
  document.getElementById('lbNameHeadline').classList.add('hiddenMsg');
  document.getElementById('lbNameSubtext').classList.add('hiddenMsg');
  document.getElementById('saveRow').style.display = 'none';
  hideBtn('skipSaveBtn');
  showBtn('resultMenuBtn'); // voyage-stage result keeps the menu escape (only Row Race drops it)
  document.getElementById('savedMsg').classList.remove('show');
  document.getElementById('lbResultWrap').style.display = 'none';
  hideBtn('viewFullLbBtn');

  hideBtn('retryBtn');
  showBtn('repeatStageBtn'); document.getElementById('repeatStageBtn').textContent = 'Row stage 3 again';
  showBtn('nextStageBtn'); document.getElementById('nextStageBtn').textContent = 'Row stage 4';
  hideBtn('challengeBtn');
}

// Stage maps v3 previews: the voyage stage card and the between-stages
// interlude both render the shared looping 3D-map video under a per-stage
// route overlay + the "STAGE N/5" badge (see index.html's .mapVideoBox).
// Stage 3 is used as the representative stage everywhere above.
function fillVoyageStageCardTestData() {
  const scr = document.getElementById('voyageScreen');
  scr.classList.add('stage-card-mode');
  document.getElementById('voyageStageCardWrap').classList.remove('hiddenMsg');
  const img = document.getElementById('voyageStageCardImg');
  img.src = '/3d%20map/stage3.png'; img.classList.add('loaded');
  const badge = document.getElementById('voyageStageBadgeImg');
  badge.src = '/stage_maps/stage3.png'; badge.classList.add('loaded');
  const title = document.getElementById('voyageScreenTitle');
  title.classList.remove('voyageDoneMsg');
  title.textContent = 'THE ICELAND PASSAGE';
  const startBtn = document.getElementById('voyageStartRaceBtn');
  startBtn.style.display = '';
  startBtn.textContent = 'Row! — Start Stage 3';
  document.getElementById('startNewVoyageBtn').style.display = 'none';
  const vid = document.getElementById('voyageStageVideo');
  const p = vid.play(); if (p && p.catch) p.catch(() => {});
}
function fillVoyageMapTestData() {
  // the casual "se reisen" view — no stage card, just the painted route map
  document.getElementById('voyageScreen').classList.remove('stage-card-mode');
  document.getElementById('voyageStageCardWrap').classList.add('hiddenMsg');
  const title = document.getElementById('voyageScreenTitle');
  title.classList.remove('voyageDoneMsg');
  title.textContent = 'The Atlantic Voyage';
  document.getElementById('voyageStartRaceBtn').style.display = 'none';
  document.getElementById('startNewVoyageBtn').style.display = 'none';
}
function fillInterludeTestData() {
  const img = document.getElementById('interludeMapImg');
  img.src = '/3d%20map/stage3.png'; img.classList.add('loaded');
  const badge = document.getElementById('interludeStageBadgeImg');
  badge.src = '/stage_maps/stage3.png'; badge.classList.add('loaded');
  document.getElementById('interludeTrophyBanner').classList.add('hiddenMsg');
  document.getElementById('interludeGoBtn').textContent = 'START STAGE 4';
  const vid = document.getElementById('interludeMapVideo');
  const p = vid.play(); if (p && p.catch) p.catch(() => {});
}

// Standalone Leaderboard modal (#lbScreen) — mirrors paintBoard()'s row markup
// exactly (src/main.js) so it's visually identical to a real fetched board.
function fillLeaderboardTestData() {
  const rows = [
    { name: 'Haaland', time: '1:18.4', score: '15,940', win: true },
    { name: 'Ada', time: '1:19.9', score: '15,410' },
    { name: 'Ola', time: '1:21.2', score: '14,980' },
    { name: 'YOU', time: '1:24.6', score: '14,820', me: true },
    { name: 'Kari', time: '1:26.0', score: '14,110' },
    { name: 'Magnus', time: '1:27.8', score: '13,760' },
    { name: 'Sindre', time: '1:29.1', score: '13,290' },
    { name: 'Nora', time: '1:31.5', score: '12,870' },
  ];
  const html = rows.map((r) =>
    `<li${r.me ? ' class="me"' : ''}><span class="lbName">${r.name}</span>` +
    `<span class="lbTime">${r.time}${r.win ? ' 🇳🇴' : ''}</span><span class="lbScore">${r.score}</span></li>`
  ).join('');
  const el = document.getElementById('lbStart');
  if (el) el.innerHTML = html;
}

// A screen can expose multiple PREVIEW VARIANTS instead of one generic fill —
// currently only the result screen, since it renders very differently for
// Row Race vs Reisen (see the two fillers above). Falls back to a no-op fill
// (just navigate, no data) for every other screen.
const VARIANTS = {
  resultScreen: [
    { label: 'Result — Race: claim place', fill: fillResultRaceClaimTestData },
    { label: 'Result — Race: place claimed', fill: fillResultRaceClaimedTestData },
    { label: 'Result — Reisen', fill: fillResultVoyageTestData },
  ],
  voyageScreen: [
    { label: 'Voyage — Stage card', fill: fillVoyageStageCardTestData },
    { label: 'Voyage — Map (se reisen)', fill: fillVoyageMapTestData },
  ],
  stageInterludeScreen: [
    { label: 'Stage Interlude', fill: fillInterludeTestData },
  ],
  lbScreen: [
    { label: 'Leaderboard', fill: fillLeaderboardTestData },
  ],
};
function galleryRows() {
  const rows = [];
  for (const s of SCREENS) {
    const variants = VARIANTS[s.id];
    if (variants) for (const v of variants) rows.push({ id: s.id, label: v.label, fill: v.fill });
    else rows.push({ id: s.id, label: s.label, fill: () => {} });
  }
  return rows;
}

// ================= preview jump tracking =================
// Lets a second "psw" (or Esc) close whatever screen the menu jumped to,
// restoring whichever screen was showing right before the jump — so you can
// hop into a preview and back out without reloading.
let previewScreenId = null; // screen we jumped to, or null if not previewing
let previewReturnId = null; // screen that was visible right before the jump

function jumpToScreen(id, fill) {
  const current = document.querySelector('.screen:not(.hidden)');
  previewReturnId = current ? current.id : null;
  showScreen(id);
  fill();
  previewScreenId = id;
}

function closePreview() {
  if (!previewScreenId) return false;
  if (previewReturnId) showScreen(previewReturnId);
  previewScreenId = null;
  previewReturnId = null;
  return true;
}

// ================= floating "psw" menu =================
let menuEl = null;

function closeMenu() {
  if (!menuEl) return;
  document.removeEventListener('keydown', onMenuKey, true);
  document.removeEventListener('pointerdown', onOutside, true);
  menuEl.remove();
  menuEl = null;
}

function onMenuKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
}
function onOutside(e) {
  if (menuEl && !menuEl.contains(e.target)) closeMenu();
}

function openMenu() {
  if (menuEl) return;
  menuEl = document.createElement('div');
  menuEl.id = 'devScreenGallery';
  menuEl.setAttribute('role', 'dialog');
  menuEl.setAttribute('aria-label', 'Dev screen gallery');
  menuEl.style.cssText = [
    'position:fixed', 'top:16px', 'right:16px', 'z-index:99999',
    'width:250px', 'max-height:calc(100vh - 32px)', 'overflow:auto',
    'padding:12px', 'box-sizing:border-box',
    'background:rgba(10,18,32,.94)', 'border:1px solid rgba(140,190,255,.35)',
    'border-radius:12px', 'box-shadow:0 12px 40px rgba(0,0,0,.55)',
    'backdrop-filter:blur(6px)',
  ].join(';');

  // header row with a close button
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:0 0 10px;';
  const title = document.createElement('div');
  title.textContent = '🛠 Screen Gallery';
  title.style.cssText = 'font:800 13px/1 system-ui,sans-serif;color:#8fd0ff;letter-spacing:.5px;';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.style.cssText = 'border:0;background:transparent;color:#9fb3d0;font-size:15px;cursor:pointer;padding:2px 4px;line-height:1;';
  closeBtn.addEventListener('click', closeMenu);
  head.append(title, closeBtn);
  menuEl.appendChild(head);

  // one row per registered screen (or per preview variant — see galleryRows())
  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
  for (const r of galleryRows()) {
    list.appendChild(screenRow(r.label, () => { jumpToScreen(r.id, r.fill); closeMenu(); }));
  }
  menuEl.appendChild(list);

  // isolated 3D ship model viewer — not a .screen at all (it's a live orbit
  // camera over the real scene with everything else hidden), so it's a plain
  // action row rather than going through jumpToScreen()/galleryRows().
  const shipViewerSep = document.createElement('div');
  shipViewerSep.style.cssText = 'height:1px;background:rgba(255,255,255,.14);margin:6px 0;';
  menuEl.appendChild(shipViewerSep);
  const shipViewerRow = screenRow('Viking Ship Model', () => {
    if (window.__game && window.__game.openShipViewer) window.__game.openShipViewer();
    closeMenu();
  });
  menuEl.appendChild(shipViewerRow);

  // full-page gallery link
  const sep = document.createElement('div');
  sep.style.cssText = 'height:1px;background:rgba(255,255,255,.14);margin:10px 0;';
  menuEl.appendChild(sep);
  const galleryLink = screenRow('Open /__screens ↗', null, GALLERY_PATH);
  galleryLink.style.borderColor = 'rgba(140,190,255,.45)';
  galleryLink.style.color = '#8fd0ff';
  menuEl.appendChild(galleryLink);

  const hint = document.createElement('div');
  hint.textContent = 'Esc or click outside to close — type "psw" again to exit a preview';
  hint.style.cssText = 'margin-top:8px;font:500 10px/1.3 system-ui,sans-serif;color:#7185a3;text-align:center;';
  menuEl.appendChild(hint);

  document.body.appendChild(menuEl);
  // defer the outside-click / Esc listeners so the very event that opened the
  // menu can't immediately close it
  setTimeout(() => {
    if (!menuEl) return;
    document.addEventListener('keydown', onMenuKey, true);
    document.addEventListener('pointerdown', onOutside, true);
  }, 0);
}

// ================= /__screens full-page gallery =================
function renderGalleryPage() {
  const page = document.createElement('div');
  page.id = 'devScreenGalleryPage';
  page.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999', 'overflow:auto',
    'padding:32px', 'box-sizing:border-box',
    'background:radial-gradient(ellipse at 50% 0%, #12233f 0%, #060b16 70%)',
    'font-family:system-ui,sans-serif', 'color:#eaf2ff',
  ].join(';');

  const h = document.createElement('h1');
  h.textContent = '🛠 Screen Gallery';
  h.style.cssText = 'margin:0 0 4px;font-size:22px;color:#8fd0ff;letter-spacing:.5px;';
  const sub = document.createElement('p');
  sub.textContent = 'Dev-only. Click a screen to preview it over the live app.';
  sub.style.cssText = 'margin:0 0 24px;font-size:13px;color:#8aa0c0;';
  page.append(h, sub);

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;max-width:900px;';
  for (const r of galleryRows()) {
    grid.appendChild(screenRow(r.label, () => { page.remove(); showScreen(r.id); r.fill(); }));
  }
  page.appendChild(grid);

  const back = screenRow('← Back to app', () => { window.location.href = '/'; });
  back.style.cssText += ';margin-top:24px;max-width:200px;';
  page.appendChild(back);

  document.body.appendChild(page);
}

// ================= sequence detector =================
let typed = '';
function onGlobalKey(e) {
  if (isTypingTarget(e.target)) { typed = ''; return; }
  // Esc also backs out of an active preview (matches the menu's own Esc-to-close).
  if (e.key === 'Escape' && previewScreenId) { e.preventDefault(); e.stopPropagation(); closePreview(); return; }
  if (e.key == null || e.key.length !== 1) return; // ignore Shift/arrows/Enter/etc.
  typed = (typed + e.key.toLowerCase()).slice(-SEQ.length);
  if (typed === SEQ) {
    typed = '';
    // Typing "psw" while previewing a jumped-to screen closes it and restores
    // whatever was showing before, instead of reopening the picker menu.
    if (!closePreview()) openMenu();
  }
}

export function initDevScreens() {
  window.addEventListener('keydown', onGlobalKey);
  // /__screens loads index.html under Vite's dev SPA fallback; the game boots
  // underneath and this opaque gallery covers it.
  if (location.pathname.replace(/\/+$/, '') === GALLERY_PATH) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderGalleryPage, { once: true });
    } else {
      renderGalleryPage();
    }
  }
}
