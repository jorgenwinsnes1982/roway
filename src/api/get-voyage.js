// GET /api/voyage
// Returns the FULL stored REISEN combined-time leaderboard.
import { getJson } from './lib/kv.js';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export default async function getVoyage(req, env) {
  try {
    const list = (await getJson(env.voyageScores, 'list')) || [];
    const stageBoards = (await getJson(env.voyageScores, 'stageBoards')) || {};
    list.sort((a, b) => a.totalMs - b.totalMs);
    return json(200, { scores: list, stageBoards });
  } catch {
    return json(200, { scores: [], stageBoards: {}, error: 'store-unavailable' });
  }
}
