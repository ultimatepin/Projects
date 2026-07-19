import crypto from "node:crypto";

const TOKEN_BYTES = 32;
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

export class LocalSessionStore {
  #secret;
  #sessions = new Map();
  #ttlMs;
  #maxSessions;
  #sweeper;

  constructor({ ttlMs = DEFAULT_TTL_MS, maxSessions = 512, secret } = {}) {
    if (!Number.isInteger(ttlMs) || ttlMs < 60_000) {
      throw new TypeError("Session ttlMs must be at least one minute.");
    }
    if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 10_000) {
      throw new TypeError("maxSessions must be an integer from 1 to 10000.");
    }
    this.#secret = secret ? normaliseSecret(secret) : crypto.randomBytes(32);
    this.#ttlMs = ttlMs;
    this.#maxSessions = maxSessions;
    this.#sweeper = setInterval(() => this.prune(), Math.min(60_000, ttlMs));
    this.#sweeper.unref?.();
  }

  create(user) {
    this.prune();
    while (this.#sessions.size >= this.#maxSessions) {
      const oldestKey = this.#sessions.keys().next().value;
      this.#sessions.delete(oldestKey);
    }
    const id = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    const token = `${id}.${sign(id, this.#secret)}`;
    const now = Date.now();
    this.#sessions.set(tokenKey(id), {
      user: Object.freeze({ id: user.id, username: user.username, createdAt: user.createdAt }),
      createdAt: now,
      expiresAt: now + this.#ttlMs,
    });
    return { token, expiresAt: now + this.#ttlMs };
  }

  get(rawToken) {
    const id = verifyAndExtractId(rawToken, this.#secret);
    if (!id) return null;
    const key = tokenKey(id);
    const session = this.#sessions.get(key);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.#sessions.delete(key);
      return null;
    }
    return session;
  }

  revoke(rawToken) {
    const id = verifyAndExtractId(rawToken, this.#secret);
    return id ? this.#sessions.delete(tokenKey(id)) : false;
  }

  revokeUser(userId) {
    let revoked = 0;
    for (const [key, session] of this.#sessions) {
      if (session.user.id === userId) {
        this.#sessions.delete(key);
        revoked += 1;
      }
    }
    return revoked;
  }

  prune(now = Date.now()) {
    for (const [key, session] of this.#sessions) {
      if (session.expiresAt <= now) this.#sessions.delete(key);
    }
  }

  close() {
    clearInterval(this.#sweeper);
    this.#sessions.clear();
  }
}

function sign(id, secret) {
  return crypto.createHmac("sha256", secret).update(id, "utf8").digest("base64url");
}

function verifyAndExtractId(rawToken, secret) {
  if (typeof rawToken !== "string" || rawToken.length > 256) return null;
  const [id, signature, extra] = rawToken.split(".");
  if (extra !== undefined || !id || !signature || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const expected = Buffer.from(sign(id, secret), "base64url");
  let actual;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected) ? id : null;
}

function tokenKey(id) {
  return crypto.createHash("sha256").update(id, "utf8").digest("base64url");
}

function normaliseSecret(secret) {
  const value = Buffer.isBuffer(secret) ? Buffer.from(secret) : Buffer.from(String(secret), "utf8");
  if (value.length < 32) throw new TypeError("Session signing secret must contain at least 32 bytes.");
  return value;
}
