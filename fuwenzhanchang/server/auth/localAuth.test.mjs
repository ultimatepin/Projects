import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import express from "express";

import { createLocalAccountRouter } from "./accountRouter.js";
import { LocalSessionStore } from "./localSessions.js";
import { AccountDeckStore } from "../storage/accountDeckStore.js";
import { LocalAccountStore } from "../storage/localAccountStore.js";

const FAST_TEST_SCRYPT = {
  cost: 1_024,
  blockSize: 8,
  parallelization: 1,
  maxmem: 16 * 1024 * 1024,
};

test("local credentials are case-insensitive and never stored in plaintext", async (context) => {
  const directory = await temporaryDirectory(context);
  const store = new LocalAccountStore({ directory, scrypt: FAST_TEST_SCRYPT });
  const user = await store.register("PlayerOne", "correct horse battery staple");

  assert.equal((await store.authenticate("playerone", "correct horse battery staple")).id, user.id);
  await assert.rejects(
    store.authenticate("PlayerOne", "wrong password"),
    (error) => error.code === "INVALID_CREDENTIALS" && error.status === 401,
  );
  await assert.rejects(
    store.register("PLAYERONE", "another secure local password"),
    (error) => error.code === "USERNAME_TAKEN" && error.status === 409,
  );

  const saved = await fs.readFile(path.join(directory, "users.json"), "utf8");
  assert.doesNotMatch(saved, /correct horse battery staple/);
  assert.match(saved, /"algorithm":"scrypt"/);
  assert.match(saved, /"salt":"[A-Za-z0-9_-]+"/);
});

test("deck writes are per-user, validated, atomic, and revision guarded", async (context) => {
  const directory = await temporaryDirectory(context);
  const store = new AccountDeckStore({ directory });
  const userId = "74c36700-721c-4d9c-a76a-a1e1be7c22a8";
  const deck = sampleDeck("deck-one");

  assert.deepEqual((await store.getDecks(userId)).decks, []);
  const saved = await store.replaceDecks(userId, [deck], 0);
  assert.equal(saved.revision, 1);
  assert.equal(saved.decks[0].name, "Test deck");

  const writes = await Promise.allSettled([
    store.upsertDeck(userId, { ...deck, name: "Writer A" }, 1),
    store.upsertDeck(userId, { ...deck, name: "Writer B" }, 1),
  ]);
  assert.equal(writes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(
    writes.filter((result) => result.status === "rejected")[0].reason.code,
    "REVISION_CONFLICT",
  );
  await assert.rejects(
    store.replaceDecks(
      userId,
      [{ ...deck, cards: Object.fromEntries([["__proto__", 1]]) }],
      2,
    ),
    (error) => error.code === "INVALID_DECK",
  );

  const files = await fs.readdir(path.join(directory, "decks"));
  assert.equal(files.length, 1);
  assert.match(files[0], /^[a-f0-9]{64}\.json$/);
  assert.equal(files.some((file) => file.endsWith(".tmp")), false);
});

test("signed sessions reject tampering", () => {
  const sessions = new LocalSessionStore({
    ttlMs: 60_000,
    secret: Buffer.alloc(32, 7),
  });
  const created = sessions.create({
    id: "74c36700-721c-4d9c-a76a-a1e1be7c22a8",
    username: "PlayerOne",
    createdAt: 1,
  });
  assert.equal(sessions.get(created.token).user.username, "PlayerOne");
  assert.equal(sessions.get(`${created.token.slice(0, -1)}x`), null);
  sessions.revoke(created.token);
  assert.equal(sessions.get(created.token), null);
  sessions.close();
});

test("account API requires CSRF and protects deck routes with the local session", async (context) => {
  const directory = await temporaryDirectory(context);
  const accountStore = new LocalAccountStore({ directory, scrypt: FAST_TEST_SCRYPT });
  const deckStore = new AccountDeckStore({ directory });
  const sessions = new LocalSessionStore({ ttlMs: 60_000, secret: Buffer.alloc(32, 3) });
  context.after(() => sessions.close());

  const app = express();
  app.use("/api/account", createLocalAccountRouter({ accountStore, deckStore, sessions }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const initial = await fetch(`${base}/api/account/session`);
  const initialBody = await initial.json();
  const csrfCookie = cookiePair(initial.headers.get("set-cookie"));
  assert.equal(initialBody.signedIn, false);

  const blocked = await fetch(`${base}/api/account/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ username: "ApiUser", password: "a secure api password" }),
  });
  assert.equal(blocked.status, 403);

  const registered = await fetch(`${base}/api/account/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      Cookie: csrfCookie,
      "X-Rift-CSRF": initialBody.csrfToken,
    },
    body: JSON.stringify({ username: "ApiUser", password: "a secure api password" }),
  });
  assert.equal(registered.status, 201);
  const sessionCookie = cookiePair(registered.headers.get("set-cookie"));
  const cookies = `${csrfCookie}; ${sessionCookie}`;

  const saved = await fetch(`${base}/api/account/decks`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      Cookie: cookies,
      "X-Rift-CSRF": initialBody.csrfToken,
    },
    body: JSON.stringify({ revision: 0, decks: [sampleDeck("api-deck")] }),
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).revision, 1);

  const loaded = await fetch(`${base}/api/account/decks`, { headers: { Cookie: cookies } });
  assert.equal(loaded.status, 200);
  assert.equal((await loaded.json()).decks[0].id, "api-deck");

  const largeDecks = Array.from({ length: 60 }, (_, deckIndex) => ({
    ...sampleDeck(`large-${deckIndex}`),
    cards: Object.fromEntries(Array.from({ length: 12 }, (_, cardIndex) => [
      `large-${deckIndex}-${cardIndex}-${"x".repeat(80)}`,
      1,
    ])),
  }));
  const largeBody = JSON.stringify({ revision: 1, decks: largeDecks });
  assert.ok(Buffer.byteLength(largeBody) > 64 * 1024);
  const largeSave = await fetch(`${base}/api/account/decks`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      Cookie: cookies,
      "X-Rift-CSRF": initialBody.csrfToken,
    },
    body: largeBody,
  });
  assert.equal(largeSave.status, 200);
  assert.equal((await largeSave.json()).revision, 2);

  const logout = await fetch(`${base}/api/account/logout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      Cookie: cookies,
      "X-Rift-CSRF": initialBody.csrfToken,
    },
    body: "{}",
  });
  assert.equal(logout.status, 200);
  const denied = await fetch(`${base}/api/account/decks`, { headers: { Cookie: cookies } });
  assert.equal(denied.status, 401);
});

function sampleDeck(id) {
  return {
    id,
    name: "Test deck",
    legendId: "ogn-001-298",
    championId: "ogn-002-298",
    cards: { "ogn-002-298": 3 },
    runes: { "ogn-007-298": 12 },
    battlefields: { "ogn-008-298": 1 },
    createdAt: 1,
    updatedAt: 1,
  };
}

async function temporaryDirectory(context) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rift-auth-test-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function cookiePair(setCookie) {
  return String(setCookie).split(";", 1)[0];
}
