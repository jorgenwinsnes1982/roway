// GET /.netlify/functions/get-voyage
// Returns the FULL stored REISEN combined-time leaderboard (sorted ascending —
// lowest total wins), read from the `voyage-scores` store's `list` key
// (written by submit-voyage.js). Mirrors get-scores.js's shape/error-handling
// conventions. No nonce is issued here — unlike KAPPRO, a REISEN submission's
// tokens each carry their own nonce from issue-stage-token, obtained at the
// moment a stage finishes, not at leaderboard-read time.
import { getStore } from '@netlify/blobs';

export default async () => {
  try {
    const board = getStore('voyage-scores');
    const list = (await board.get('list', { type: 'json' })) || [];
    const stageBoards = (await board.get('stageBoards', { type: 'json' })) || {};
    list.sort((a, b) => a.totalMs - b.totalMs);
    // the FULL stored board (storage itself is capped at 100 by
    // submit-voyage.js) — the client renders it as a scrollable list with
    // the player's own row highlighted, so no server-side top-N trim here
    return json(200, { scores: list, stageBoards });
  } catch {
    // store unavailable (e.g. Blobs not provisioned) — let the client fall back
    return json(200, { scores: [], stageBoards: {}, error: 'store-unavailable' });
  }
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
