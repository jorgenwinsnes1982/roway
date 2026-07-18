// GET /api/challenge?id=<8-char id>
// Fetches one uploaded challenge run by id.
import { getJson } from './lib/kv.js';

const ID_RE = /^[A-Za-z0-9]{8}$/;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export default async function getChallenge(req, env) {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!ID_RE.test(id)) return json(400, { error: 'bad-id' });

  try {
    const entry = await getJson(env.challenges, id);
    if (!entry) return json(404, { error: 'not-found' });
    return json(200, entry);
  } catch (e) {
    return json(404, { error: 'not-found' });
  }
}
