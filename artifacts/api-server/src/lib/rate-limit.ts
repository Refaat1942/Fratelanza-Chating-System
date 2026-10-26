/**
 * Tiny in-memory fixed-window limiter (single API process). Good enough to
 * slow password guessing; not a replacement for a WAF.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function hit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= max;
}

export function clear(key: string): void {
  buckets.delete(key);
}

// Keep the map from growing without bound.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}, 10 * 60_000).unref();
