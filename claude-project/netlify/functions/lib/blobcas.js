// Shared optimistic-concurrency helpers for the Netlify Blobs stores.
//
// WHY: every leaderboard/rate write used to be a plain read-modify-write.
// Load-testing (50 concurrent valid submits against netlify dev) measured
// 62.5% SILENT DATA LOSS on the leaderboard list ("last writer wins" — the
// server replied 200 "saved" but the entry vanished) and 24-of-50 slipping
// past the 5/min rate limit (lost updates on the counter). Blobs has no
// transactions, but it DOES have conditional writes: setJSON(key, value,
// { onlyIfMatch: etag }) fails with { modified: false } when someone else
// wrote in between — which turns read-modify-write into a safe retry loop.
//
// Lives in lib/ (a subdirectory is NOT deployed as an endpoint — only files
// directly under netlify/functions/ become functions).

// Retry a read-mutate-conditional-write cycle until it lands or attempts run
// out. `mutate(current)` receives the parsed JSON (or null when the key does
// not exist yet) and returns the next value. Because a lost race means
// re-running mutate against FRESH data, mutate must be pure apart from
// closing over "result" variables (rank, trimmed list, ...) the caller wants
// out of the winning attempt. Returns true when the write landed.
export async function casUpdate(store, key, mutate, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    const cur = await store.getWithMetadata(key, { type: 'json' });
    const next = mutate(cur ? cur.data : null);
    const res = cur && cur.etag
      ? await store.setJSON(key, next, { onlyIfMatch: cur.etag })
      : await store.setJSON(key, next, { onlyIfNew: true });
    // Older blob servers without conditional-write support return undefined —
    // treat only an explicit refusal as a conflict so they keep working
    // (degrading to the old last-writer-wins rather than failing every write).
    if (!res || res.modified !== false) return true;
    await new Promise((r) => setTimeout(r, 25 + Math.random() * 50 * (i + 1)));
  }
  return false;
}

// Per-IP fixed-window rate limit on top of casUpdate. Returns true when the
// request is ALLOWED. Contention on the per-IP key can only come from that
// same IP bursting, so exhausting the CAS retries fails CLOSED (denied) —
// a genuine single player at ~1 request/min never contends with themselves.
export async function rateLimitAllow(rateStore, key, now, windowMs, max) {
  let allowed = false;
  const landed = await casUpdate(rateStore, key, (cur) => {
    let rl = cur || { count: 0, start: now };
    if (now - rl.start > windowMs) rl = { count: 0, start: now };
    rl.count++;
    allowed = rl.count <= max;
    return rl;
  }, 4);
  return landed && allowed;
}
