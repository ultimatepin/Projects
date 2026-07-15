import crypto from "node:crypto";

export class MemoryRateLimiter {
  #buckets = new Map();
  #secret = crypto.randomBytes(32);
  #maxBuckets;

  constructor({ maxBuckets = 10_000 } = {}) {
    this.#maxBuckets = maxBuckets;
  }

  consume(rawKey, { limit, windowMs }, now = Date.now()) {
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1_000) {
      throw new TypeError("Invalid rate-limit policy.");
    }
    this.prune(now);
    const key = this.#key(rawKey);
    let bucket = this.#buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.#buckets.set(key, bucket);
    }
    bucket.count += 1;
    return {
      allowed: bucket.count <= limit,
      remaining: Math.max(0, limit - bucket.count),
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
    };
  }

  reset(rawKey) {
    this.#buckets.delete(this.#key(rawKey));
  }

  prune(now = Date.now()) {
    for (const [key, bucket] of this.#buckets) {
      if (bucket.resetAt <= now) this.#buckets.delete(key);
    }
    while (this.#buckets.size > this.#maxBuckets) {
      this.#buckets.delete(this.#buckets.keys().next().value);
    }
  }

  #key(rawKey) {
    return crypto.createHmac("sha256", this.#secret).update(String(rawKey), "utf8").digest("base64url");
  }
}
