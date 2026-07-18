// Simplified KV helpers for Cloudflare Workers.
// Cloudflare KV is eventually consistent, so true CAS (compare-and-swap) is not
// available. We use simple read-modify-write with retries; this is acceptable
// for ROWAY's traffic volume.

export async function getJson(store, key) {
  const raw = await store.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function putJson(store, key, value) {
  await store.put(key, JSON.stringify(value));
}

export async function casUpdate(store, key, mutate, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    const cur = await getJson(store, key);
    const next = mutate(cur);
    await putJson(store, key, next);
    // Small delay between retries in case of concurrent writes.
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 25 + Math.random() * 50 * (i + 1)));
    }
  }
  return true;
}

export async function rateLimitAllow(rateStore, key, now, windowMs, max) {
  let allowed = false;
  await casUpdate(rateStore, key, (cur) => {
    let rl = cur || { count: 0, start: now };
    if (now - rl.start > windowMs) rl = { count: 0, start: now };
    rl.count++;
    allowed = rl.count <= max;
    return rl;
  }, 4);
  return allowed;
}
