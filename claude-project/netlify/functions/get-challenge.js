// GET /.netlify/functions/get-challenge?id=<8-char id>
// Fetches one uploaded challenge run (alias + time + track) by id, for the
// receiving player's "so-and-so challenges you" screen. No listing/enumeration
// of stored ids — only an exact, validated id can be read.
// Netlify v2 function — the ESM default-export form gets the Blobs sandbox
// auto-injected under `netlify dev` (classic exports.handler does not).
import { getStore } from '@netlify/blobs';

const ID_RE = /^[A-Za-z0-9]{8}$/;

export default async (req) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!ID_RE.test(id)) return json(400, { error: 'bad-id' });

  try {
    const challenges = getStore('challenges');
    const entry = await challenges.get(id, { type: 'json' });
    if (!entry) return json(404, { error: 'not-found' });
    return json(200, entry);
  } catch (e) {
    return json(404, { error: 'not-found' });
  }
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
