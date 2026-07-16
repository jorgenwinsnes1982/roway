// ================= Raster button system =================
// Buttons keep their original IDs/classes/textContent behavior. This enhancer
// only wraps them in a reusable three-slice raster skin:
// left cap + stretchable middle + right cap.
function isBlue(btn) {
  return (
    btn.classList.contains('ctaSecondary') ||
    btn.classList.contains('ctaGhost') ||
    btn.classList.contains('linkBtn') ||
    btn.classList.contains('lbTab')
  );
}

function isCompact(btn) {
  return (
    btn.classList.contains('ctaGhost') ||
    btn.classList.contains('linkBtn') ||
    btn.classList.contains('lbTab')
  );
}

// #saveScoreBtn deliberately NOT enhanced: the result screen's Claim CTA is a
// clean flat button (see #saveScoreBtn CSS) — the raster caps read as too
// heavy next to the simplified name input above it.
export function enhanceRuneButtons(root = document) {
  const buttons = root.querySelectorAll(
    'button.cta, button.ctaSecondary, button.ctaGhost, button.linkBtn, button.lbTab'
  );
  buttons.forEach((btn) => {
    if (btn.parentNode && btn.parentNode.classList && btn.parentNode.classList.contains('raster-btn')) return; // already wrapped

    const wrap = document.createElement('span');
    wrap.className = `raster-btn raster-btn--${isBlue(btn) ? 'blue' : 'red'}`;
    if (isCompact(btn)) wrap.classList.add('raster-btn--compact');

    // a button hidden via inline style (e.g. display:none) needs the WHOLE
    // raster skin hidden, not just the inner button.
    const syncHiddenState = () => { wrap.style.display = btn.style.display === 'none' ? 'none' : ''; };
    syncHiddenState();
    new MutationObserver(syncHiddenState).observe(btn, { attributes: true, attributeFilter: ['style'] });

    btn.parentNode.insertBefore(wrap, btn);
    btn.classList.add('raster-btn__label');

    for (const part of ['left', 'mid', 'right']) {
      const piece = document.createElement('i');
      piece.className = `raster-btn__piece raster-btn__piece--${part}`;
      wrap.appendChild(piece);
    }

    wrap.appendChild(btn);
  });
}
