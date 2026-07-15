// Central registry of the app's full-screen "screens" — the `.screen` overlays
// declared in index.html. There is no router in this app; screens are shown by
// toggling the `.hidden` class. This module is the single source of truth for
// "which screens exist" so tools (currently the dev-only Screen Gallery) don't
// have to hard-code the list. Pure DOM — no coupling to game state, so importing
// it never affects normal gameplay.

export const SCREENS = [
  { id: 'startScreen',          label: 'Start / Splash' },
  { id: 'howtoScreen',          label: 'How to Play' },
  { id: 'voyageScreen',         label: 'Voyage Map' },
  { id: 'stageInterludeScreen', label: 'Stage Interlude' },
  { id: 'missionsScreen',       label: 'Missions' },
  { id: 'challengeScreen',      label: 'Challenge' },
  { id: 'lbScreen',             label: 'Leaderboard' },
  { id: 'resultScreen',         label: 'Result' },
  { id: 'settingsScreen',       label: 'Settings' },
  { id: 'confirmScreen',        label: 'Restart / Confirm' },
];

// True if `id` is a registered .screen element currently in the DOM.
export function screenExists(id) {
  const el = document.getElementById(id);
  return !!el && el.classList.contains('screen');
}

// Show exactly one screen: hide every `.screen`, then reveal the target — the
// same `.hidden` convention normal navigation uses, so it looks identical.
// Returns true if the id resolved to a real screen.
export function showScreen(id) {
  if (!screenExists(id)) return false;
  for (const el of document.querySelectorAll('.screen')) el.classList.add('hidden');
  document.getElementById(id).classList.remove('hidden');
  return true;
}
