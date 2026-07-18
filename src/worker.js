// Cloudflare Worker entrypoint for ROWAY.
// Serves API routes under /api/* and falls back to Static Assets for everything else.

import getScores from './api/get-scores.js';
import submitScore from './api/submit-score.js';
import createChallenge from './api/create-challenge.js';
import getChallenge from './api/get-challenge.js';
import issueStageToken from './api/issue-stage-token.js';
import submitVoyage from './api/submit-voyage.js';
import getVoyage from './api/get-voyage.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    let response;

    try {
      switch (url.pathname) {
        case '/api/scores':
          if (request.method === 'GET') {
            response = await getScores(request, env);
          } else if (request.method === 'POST') {
            response = await submitScore(request, env);
          } else {
            response = json(405, { error: 'method' });
          }
          break;

        case '/api/challenge':
          if (request.method === 'POST') {
            response = await createChallenge(request, env);
          } else if (request.method === 'GET') {
            response = await getChallenge(request, env);
          } else {
            response = json(405, { error: 'method' });
          }
          break;

        case '/api/voyage/token':
          if (request.method === 'POST') {
            response = await issueStageToken(request, env);
          } else {
            response = json(405, { error: 'method' });
          }
          break;

        case '/api/voyage/submit':
          if (request.method === 'POST') {
            response = await submitVoyage(request, env);
          } else {
            response = json(405, { error: 'method' });
          }
          break;

        case '/api/voyage':
          if (request.method === 'GET') {
            response = await getVoyage(request, env);
          } else {
            response = json(405, { error: 'method' });
          }
          break;

        default:
          // Serve static assets for non-API paths.
          return env.ASSETS.fetch(request);
      }
    } catch (err) {
      console.error('Worker error:', err);
      response = json(500, { error: 'internal' });
    }

    // Attach CORS headers to all API responses.
    Object.entries(CORS_HEADERS).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  },
};
