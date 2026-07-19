import crypto from "node:crypto";
import express from "express";

import { canonicaliseUsername, normaliseUsername } from "../storage/localAccountStore.js";
import { LocalSessionStore } from "./localSessions.js";
import { MemoryRateLimiter } from "./rateLimiter.js";

const SESSION_COOKIE = "rift_session_v1";
const CSRF_COOKIE = "rift_csrf_v1";
const CSRF_HEADER = "x-rift-csrf";
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const LOGIN_POLICY = Object.freeze({ limit: 10, windowMs: 15 * 60 * 1_000 });
const LOGIN_IP_POLICY = Object.freeze({ limit: 30, windowMs: 15 * 60 * 1_000 });
const REGISTER_POLICY = Object.freeze({ limit: 5, windowMs: 60 * 60 * 1_000 });

export class AccountApiError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AccountApiError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Mount at /api/account before the app's catch-all 404 handler.
 * accountStore must be LocalAccountStore-compatible; deckStore must be
 * AccountDeckStore-compatible.
 */
export function createLocalAccountRouter({
  accountStore,
  deckStore,
  sessions = new LocalSessionStore(),
  rateLimiter = new MemoryRateLimiter(),
  registrationEnabled = true,
  allowedOrigins = [],
} = {}) {
  if (!accountStore || !deckStore) {
    throw new TypeError("createLocalAccountRouter requires accountStore and deckStore.");
  }
  const trustedOrigins = new Set(allowedOrigins.map(normaliseOrigin));
  const router = express.Router();

  router.use((request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("X-Content-Type-Options", "nosniff");
    try {
      assertSafeTransport(request);
      if (isMutation(request.method)) assertTrustedOrigin(request, trustedOrigins);
      request.accountSession = sessions.get(readCookie(request, SESSION_COOKIE)?.value);
      next();
    } catch (error) {
      next(error);
    }
  });
  router.use(express.json({ limit: "2mb" }));

  router.get("/session", (request, response) => {
    const csrfToken = ensureCsrfToken(request, response);
    response.json({
      ok: true,
      signedIn: Boolean(request.accountSession),
      user: request.accountSession?.user || null,
      csrfToken,
    });
  });

  router.post("/register", requireJson, requireCsrf, asyncRoute(async (request, response) => {
    if (!registrationEnabled) {
      throw new AccountApiError("REGISTRATION_DISABLED", "New account registration is disabled.", 403);
    }
    enforceRateLimit(
      rateLimiter,
      `register:${clientAddress(request)}`,
      REGISTER_POLICY,
    );
    const body = asObject(request.body);
    const user = await accountStore.register(body.username, body.password);
    establishSession(request, response, sessions, user);
    response.status(201).json({ ok: true, user });
  }));

  router.post("/login", requireJson, requireCsrf, asyncRoute(async (request, response) => {
    const body = asObject(request.body);
    const address = clientAddress(request);
    const usernameKey = rateLimitUsername(body.username);
    enforceRateLimit(rateLimiter, `login-ip:${address}`, LOGIN_IP_POLICY);
    enforceRateLimit(rateLimiter, `login:${address}:${usernameKey}`, LOGIN_POLICY);
    const user = await accountStore.authenticate(body.username, body.password);
    rateLimiter.reset(`login:${address}:${usernameKey}`);
    establishSession(request, response, sessions, user);
    response.json({ ok: true, user });
  }));

  router.post("/logout", requireJson, requireCsrf, (request, response) => {
    const cookie = readCookie(request, SESSION_COOKIE);
    if (cookie) sessions.revoke(cookie.value);
    clearSessionCookie(request, response);
    response.json({ ok: true });
  });

  router.get("/decks", requireAccountSession, asyncRoute(async (request, response) => {
    const result = await deckStore.getDecks(request.accountSession.user.id);
    response.json({ ok: true, ...result });
  }));

  router.put("/decks", requireJson, requireCsrf, requireAccountSession, asyncRoute(async (
    request,
    response,
  ) => {
    const body = asObject(request.body);
    const result = await deckStore.replaceDecks(
      request.accountSession.user.id,
      body.decks,
      body.revision,
    );
    response.json({ ok: true, ...result });
  }));

  router.put("/decks/:deckId", requireJson, requireCsrf, requireAccountSession, asyncRoute(async (
    request,
    response,
  ) => {
    const body = asObject(request.body);
    const deck = asObject(body.deck);
    if (deck.id !== request.params.deckId) {
      throw new AccountApiError("DECK_ID_MISMATCH", "Deck ID does not match the URL.");
    }
    const result = await deckStore.upsertDeck(
      request.accountSession.user.id,
      deck,
      body.revision,
    );
    response.json({ ok: true, ...result });
  }));

  router.delete("/decks/:deckId", requireJson, requireCsrf, requireAccountSession, asyncRoute(async (
    request,
    response,
  ) => {
    const result = await deckStore.deleteDeck(
      request.accountSession.user.id,
      request.params.deckId,
      asObject(request.body).revision,
    );
    response.json({ ok: true, ...result });
  }));

  router.use((error, _request, response, _next) => {
    if (error?.retryAfterSeconds) {
      response.setHeader("Retry-After", String(error.retryAfterSeconds));
    }
    if (error instanceof SyntaxError && error?.status === 400 && "body" in error) {
      response.status(400).json({
        ok: false,
        error: { code: "INVALID_JSON", message: "The request body is not valid JSON." },
      });
      return;
    }
    const known = Number.isInteger(error?.status) && typeof error?.code === "string";
    if (!known) console.error("Local account API error:", error);
    response.status(known ? error.status : 500).json({
      ok: false,
      error: {
        code: known ? error.code : "ACCOUNT_SERVER_ERROR",
        message: known ? error.message : "The local account service encountered an error.",
      },
    });
  });

  return router;
}

function requireAccountSession(request, _response, next) {
  if (!request.accountSession) {
    next(new AccountApiError("AUTHENTICATION_REQUIRED", "Sign in to access saved decks.", 401));
    return;
  }
  next();
}

function requireJson(request, _response, next) {
  if (!request.is("application/json")) {
    next(new AccountApiError("JSON_REQUIRED", "Use an application/json request body.", 415));
    return;
  }
  next();
}

function requireCsrf(request, _response, next) {
  const cookie = readCookie(request, CSRF_COOKIE)?.value;
  const header = request.get(CSRF_HEADER);
  if (!safeTokenMatch(cookie, header)) {
    next(new AccountApiError("INVALID_CSRF_TOKEN", "Refresh the app and try again.", 403));
    return;
  }
  next();
}

function ensureCsrfToken(request, response) {
  const existing = readCookie(request, CSRF_COOKIE)?.value;
  const token = isCsrfToken(existing) ? existing : crypto.randomBytes(32).toString("base64url");
  if (token !== existing) {
    appendCookie(response, CSRF_COOKIE, token, {
      httpOnly: true,
      maxAge: SESSION_MAX_AGE_SECONDS,
      secure: requestUsesHttps(request),
    });
  }
  return token;
}

function establishSession(request, response, sessions, user) {
  const previous = readCookie(request, SESSION_COOKIE)?.value;
  if (previous) sessions.revoke(previous);
  const { token } = sessions.create(user);
  appendCookie(response, SESSION_COOKIE, token, {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: requestUsesHttps(request),
  });
}

function clearSessionCookie(request, response) {
  appendCookie(response, SESSION_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    secure: requestUsesHttps(request),
  });
}

function appendCookie(response, name, value, { httpOnly, maxAge, secure }) {
  const parts = [
    `${name}=${value}`,
    "Path=/api/account",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
  ];
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  response.append("Set-Cookie", parts.join("; "));
}

function readCookie(request, name) {
  const raw = request.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key === name) return { value: part.slice(separator + 1).trim() };
  }
  return null;
}

function assertSafeTransport(request) {
  if (requestUsesHttps(request)) return;
  const hostname = requestHostname(request);
  if (isLoopbackHostname(hostname) && isLoopbackAddress(request.socket.remoteAddress)) return;
  throw new AccountApiError(
    "HTTPS_REQUIRED",
    "Accounts are disabled over unencrypted LAN connections. Use the host app or HTTPS.",
    403,
  );
}

function assertTrustedOrigin(request, allowedOrigins) {
  const rawOrigin = request.get("origin");
  if (!rawOrigin) {
    throw new AccountApiError("ORIGIN_REQUIRED", "This account request has no trusted origin.", 403);
  }
  const origin = normaliseOrigin(rawOrigin);
  if (allowedOrigins.has(origin)) return;
  const originUrl = new URL(origin);
  if (originUrl.host !== request.get("host")) {
    throw new AccountApiError("UNTRUSTED_ORIGIN", "This account request came from another origin.", 403);
  }
}

function requestUsesHttps(request) {
  return request.secure;
}

function requestHostname(request) {
  try {
    const origin = request.get("origin");
    if (origin) return new URL(origin).hostname;
    return new URL(`http://${request.get("host")}`).hostname;
  } catch {
    return "";
  }
}

function isLoopbackHostname(hostname) {
  const value = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return value === "localhost" || value === "::1" || /^127(?:\.\d{1,3}){3}$/.test(value);
}

function isLoopbackAddress(address) {
  const value = String(address || "").toLowerCase();
  return value === "::1" || value === "127.0.0.1" || value === "::ffff:127.0.0.1";
}

function enforceRateLimit(rateLimiter, key, policy) {
  const result = rateLimiter.consume(key, policy);
  if (result.allowed) return;
  const error = new AccountApiError(
    "RATE_LIMITED",
    `Too many attempts. Try again in ${result.retryAfterSeconds} seconds.`,
    429,
  );
  error.retryAfterSeconds = result.retryAfterSeconds;
  throw error;
}

function rateLimitUsername(rawUsername) {
  try {
    return canonicaliseUsername(normaliseUsername(rawUsername));
  } catch {
    return String(rawUsername || "").normalize("NFKC").toLocaleLowerCase("en-US").slice(0, 64);
  }
}

function clientAddress(request) {
  return request.ip || request.socket.remoteAddress || "unknown";
}

function safeTokenMatch(left, right) {
  if (!isCsrfToken(left) || !isCsrfToken(right)) return false;
  const leftBuffer = Buffer.from(left, "base64url");
  const rightBuffer = Buffer.from(right, "base64url");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isCsrfToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function normaliseOrigin(rawOrigin) {
  const url = new URL(rawOrigin);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AccountApiError("UNTRUSTED_ORIGIN", "Unsupported account request origin.", 403);
  }
  return url.origin;
}

function isMutation(method) {
  return !["GET", "HEAD", "OPTIONS"].includes(method);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}
