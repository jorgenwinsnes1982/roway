// ================= Voyage map (Fase 3) =================
// Procedural SVG — no asset files. A stylised North Atlantic: Norway (right),
// Iceland/Greenland (middle), USA (left). Outbound route (high arc) and the
// homeward route (low arc) are separate quadratic curves so they never
// overlap; the ship marker is placed by sampling whichever curve is "active"
// at the current voyage total, with the exact same maths used to draw it.
import { VOYAGE_OUT_M, VOYAGE_HOME_M, TOTAL_VOYAGE_M, MILESTONES, VOYAGE_STAGES } from './voyage.js';

export const MAP_VIEWBOX = { w: 700, h: 300 };

const NORWAY = { x: 620, y: 175 };
const USA = { x: 90, y: 175 };
const OUT_CTRL = { x: 355, y: 40 };
const HOME_CTRL = { x: 355, y: 270 };

function quadPoint(p0, p1, p2, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
  };
}

// `out` = true → Norway to USA (outbound); false → USA to Norway (homeward)
export function routePoint(t, out) {
  const tc = Math.max(0, Math.min(1, t));
  return out ? quadPoint(NORWAY, OUT_CTRL, USA, tc) : quadPoint(USA, HOME_CTRL, NORWAY, tc);
}

// same out/home split as shipPosition(), but for an arbitrary meter value —
// lets the Fase 3e stage interlude place both the "before" and "after" ship
// position on the same curve used by the full voyage map.
export function pointAtMeters(m) {
  const clamped = Math.min(TOTAL_VOYAGE_M, m);
  return clamped <= VOYAGE_OUT_M
    ? routePoint(clamped / VOYAGE_OUT_M, true)
    : routePoint((clamped - VOYAGE_OUT_M) / VOYAGE_HOME_M, false);
}

// Fase 3e: landmark flavour per stage kind — shared between the course
// builder's landmark choice (world.js) and any UI that names it.
export const LANDMARK_INFO = {
  lighthouse: { emoji: '🗼', name: 'the lighthouse' },
  whale: { emoji: '🐋', name: 'the whale' },
  volcano: { emoji: '🌋', name: 'the volcano' },
  liberty: { emoji: '🗽', name: 'the Statue of Liberty' },
  homefjord: { emoji: '🇳🇴', name: 'the Norwegian home fjord' },
};

// Simplified route for the stage-interlude mini-map (Fase 3e): only the route
// curves + a node per stage boundary (with that stage's landmark) — no
// country blobs, no milestone icons. Those belong to the full voyage screen;
// this is a quick recap, not a copy of it. The ship marker itself is a
// separate absolutely-positioned HTML element (see #interludeShipMarker) so
// it can be CSS-transitioned between the "before" and "after" position.
export function buildStageRouteSVG(totalNow) {
  const nodes = VOYAGE_STAGES.map((s) => {
    const m = Math.min(s.untilM, TOTAL_VOYAGE_M);
    const p = pointAtMeters(m);
    const reached = totalNow >= m;
    const info = LANDMARK_INFO[s.landmark];
    return `<g opacity="${reached ? 1 : 0.45}">
      <circle cx="${p.x}" cy="${p.y}" r="15" fill="rgba(0,20,60,.8)"
        stroke="${reached ? '#ffd25e' : 'rgba(255,255,255,.4)'}" stroke-width="2"
        stroke-dasharray="${reached ? 'none' : '4 3'}"/>
      <text x="${p.x}" y="${p.y + 6}" text-anchor="middle" font-size="16">${info.emoji}</text>
    </g>`;
  }).join('');
  return `<svg viewBox="0 0 ${MAP_VIEWBOX.w} ${MAP_VIEWBOX.h}" xmlns="http://www.w3.org/2000/svg">
    <text x="${NORWAY.x}" y="${NORWAY.y + 45}" text-anchor="middle" font-size="13" fill="#fff" opacity=".85">Norway</text>
    <text x="${USA.x}" y="${USA.y + 45}" text-anchor="middle" font-size="13" fill="#fff" opacity=".85">USA</text>
    <path d="${pathD(true)}" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="2" stroke-dasharray="7 7"/>
    <path d="${pathD(false)}" fill="none" stroke="rgba(255,210,94,.55)" stroke-width="2" stroke-dasharray="7 7"/>
    ${nodes}
  </svg>`;
}

function pathD(out) {
  const p0 = out ? NORWAY : USA;
  const p1 = out ? OUT_CTRL : HOME_CTRL;
  const p2 = out ? USA : NORWAY;
  return `M ${p0.x} ${p0.y} Q ${p1.x} ${p1.y} ${p2.x} ${p2.y}`;
}

function milestoneT(m) {
  return m.m <= VOYAGE_OUT_M ? { t: m.m / VOYAGE_OUT_M, out: true } : { t: (m.m - VOYAGE_OUT_M) / VOYAGE_HOME_M, out: false };
}

export function shipPosition(voyage) {
  if (voyage.total <= VOYAGE_OUT_M) return routePoint(voyage.total / VOYAGE_OUT_M, true);
  return routePoint((voyage.total - VOYAGE_OUT_M) / VOYAGE_HOME_M, false);
}

// status line under the map — "You've rowed X m — Y m to <next milestone>!"
export function voyageStatusText(voyage) {
  const total = Math.round(voyage.total);
  const fmt = (n) => n.toLocaleString('en-US');
  const next = MILESTONES.find((m) => voyage.total < m.m);
  if (!next) return `You've rowed ${fmt(total)} m — the whole Atlantic Voyage is complete! 🏆`;
  const remaining = Math.round(next.m - voyage.total);
  return `You've rowed ${fmt(total)} m — ${fmt(remaining)} m to ${next.name}! ${next.emoji}`;
}

export function buildVoyageMapSVG(voyage) {
  const ship = shipPosition(voyage);
  const trophyHome = voyage.trophy; // once fetched, the trophy icon rides with the ship

  const milestoneIcons = MILESTONES.map((m) => {
    const { t, out } = milestoneT(m);
    const p = routePoint(t, out);
    const reached = voyage.total >= m.m;
    return `<g opacity="${reached ? 1 : 0.4}">
      <circle cx="${p.x}" cy="${p.y}" r="14" fill="rgba(0,20,60,.75)" stroke="${reached ? '#ffd25e' : 'rgba(255,255,255,.4)'}" stroke-width="2"/>
      <text x="${p.x}" y="${p.y + 5}" text-anchor="middle" font-size="15">${m.emoji}</text>
    </g>`;
  }).join('');

  return `<svg viewBox="0 0 700 300" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="${NORWAY.x}" cy="215" rx="72" ry="88" fill="#2f4d7a"/>
    <ellipse cx="350" cy="95" rx="58" ry="34" fill="#3a5a86"/>
    <ellipse cx="${USA.x}" cy="215" rx="82" ry="92" fill="#2f4d7a"/>
    <text x="${NORWAY.x}" y="220" text-anchor="middle" font-size="14" fill="#fff" font-weight="700">Norway</text>
    <text x="350" y="98" text-anchor="middle" font-size="12" fill="#fff" opacity=".85">Iceland / Greenland</text>
    <text x="${USA.x}" y="220" text-anchor="middle" font-size="14" fill="#fff" font-weight="700">USA</text>
    <path d="${pathD(true)}" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="2" stroke-dasharray="7 7"/>
    <path d="${pathD(false)}" fill="none" stroke="rgba(255,210,94,.55)" stroke-width="2" stroke-dasharray="7 7"/>
    ${milestoneIcons}
    ${trophyHome ? '' : `<text x="${USA.x}" y="160" text-anchor="middle" font-size="22">🏆</text>`}
    <text x="${ship.x}" y="${ship.y + 8}" text-anchor="middle" font-size="28">⛵${trophyHome ? '🏆' : ''}</text>
  </svg>`;
}
