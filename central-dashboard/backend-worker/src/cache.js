/**
 * Server-side caching for the analytics API. NO database (no D1/R2) -
 * uses the Worker global Cache API (caches.default) with a max-age TTL.
 * Falls back to per-isolate in-memory memo if the Cache API is unavailable
 * (jem ke `wrangler dev` local ma).
 */

// in-memory fallback: key -> { value, expires }
const memo = new Map();

function ttlSeconds(env) {
  const t = parseInt(env.CACHE_TTL || "120", 10);
  return Number.isFinite(t) && t > 0 ? t : 120;
}

/**
 * getOrCompute(key, env, computeFn)
 *  key       - stable cache key (jem ke full request URL + query)
 *  computeFn - async () => JSON-serializable value; chalayshe Sudhu cache miss par
 */
export async function getOrCompute(key, env, computeFn) {
  const ttl = ttlSeconds(env);

  // 1) try Cache API
  try {
    const cache = caches.default;
    const req = new Request(`https://cache.local/${encodeURIComponent(key)}`);
    const hit = await cache.match(req);
    if (hit) {
      const etag = hit.headers.get("x-cached-expires");
      if (etag && Number(etag) > Date.now()) return hit.json();
    }
    const value = await computeFn();
    const resp = new Response(JSON.stringify(value), {
      headers: {
        "content-type": "application/json",
        "cache-control": `public, max-age=${ttl}`,
        "x-cached-expires": String(Date.now() + ttl * 1000),
      },
    });
    await cache.put(req, resp);
    return value;
  } catch {
    // Cache API nathi (local dev) -> 2) in-memory memo
  }

  const now = Date.now();
  const m = memo.get(key);
  if (m && m.expires > now) return m.value;
  const value = await computeFn();
  memo.set(key, { value, expires: now + ttl * 1000 });
  return value;
}
