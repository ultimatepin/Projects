import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

import { readJsonFile, writeJsonFileAtomic } from "./atomicJson.js";

const SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DECKS = 100;
const MAX_ZONE_ENTRIES = 250;
const MAX_ZONE_TOTAL = 500;

export class DeckStoreError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "DeckStoreError";
    this.code = code;
    this.status = status;
  }
}

/** Deck persistence keyed only by an immutable, authenticated LocalAccountStore ID. */
export class AccountDeckStore {
  #directory;
  #queues = new Map();

  constructor({
    directory = process.env.RIFT_ACCOUNT_DATA_DIR
      || path.join(os.homedir(), ".rift-local", "accounts"),
  } = {}) {
    if (typeof directory !== "string" || !directory.trim()) {
      throw new TypeError("AccountDeckStore requires a data directory.");
    }
    this.#directory = path.join(path.resolve(directory), "decks");
  }

  async getDecks(authenticatedUserId) {
    const userId = normaliseUserId(authenticatedUserId);
    return this.#withUserLock(userId, async () => publicRecord(await this.#read(userId)));
  }

  async replaceDecks(authenticatedUserId, rawDecks, expectedRevision) {
    const userId = normaliseUserId(authenticatedUserId);
    const decks = normaliseDecks(rawDecks);
    const revision = normaliseRevision(expectedRevision);
    return this.#withUserLock(userId, async () => {
      const current = await this.#read(userId);
      assertRevision(current.revision, revision);
      const next = createRecord(userId, current.revision + 1, decks);
      await this.#write(userId, next);
      return publicRecord(next);
    });
  }

  async upsertDeck(authenticatedUserId, rawDeck, expectedRevision) {
    const userId = normaliseUserId(authenticatedUserId);
    const deck = normaliseDeck(rawDeck);
    const revision = normaliseRevision(expectedRevision);
    return this.#withUserLock(userId, async () => {
      const current = await this.#read(userId);
      assertRevision(current.revision, revision);
      const decks = current.decks.slice();
      const index = decks.findIndex((item) => item.id === deck.id);
      if (index >= 0) decks[index] = deck;
      else decks.push(deck);
      if (decks.length > MAX_DECKS) throw tooManyDecks();
      const next = createRecord(userId, current.revision + 1, decks);
      await this.#write(userId, next);
      return publicRecord(next);
    });
  }

  async deleteDeck(authenticatedUserId, rawDeckId, expectedRevision) {
    const userId = normaliseUserId(authenticatedUserId);
    const deckId = normaliseIdentifier(rawDeckId, "deck ID");
    const revision = normaliseRevision(expectedRevision);
    return this.#withUserLock(userId, async () => {
      const current = await this.#read(userId);
      assertRevision(current.revision, revision);
      const decks = current.decks.filter((deck) => deck.id !== deckId);
      if (decks.length === current.decks.length) {
        throw new DeckStoreError("DECK_NOT_FOUND", "Deck not found.", 404);
      }
      const next = createRecord(userId, current.revision + 1, decks);
      await this.#write(userId, next);
      return publicRecord(next);
    });
  }

  async #withUserLock(userId, operation) {
    const key = userKey(userId);
    const previous = this.#queues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.#queues.set(key, current);
    try {
      return await current;
    } finally {
      if (this.#queues.get(key) === current) this.#queues.delete(key);
    }
  }

  async #read(userId) {
    const key = userKey(userId);
    let raw;
    try {
      raw = await readJsonFile(this.#filePath(key), { maxBytes: MAX_FILE_BYTES });
    } catch (error) {
      throw storageError("DECK_READ_FAILED", "Could not read saved decks.", error);
    }
    if (raw === null) return createRecord(userId, 0, []);
    return normaliseStoredRecord(raw, key);
  }

  async #write(userId, record) {
    try {
      await writeJsonFileAtomic(this.#filePath(userKey(userId)), record, {
        maxBytes: MAX_FILE_BYTES,
      });
    } catch (error) {
      throw storageError("DECK_WRITE_FAILED", "Could not save decks.", error);
    }
  }

  #filePath(key) {
    return path.join(this.#directory, `${key}.json`);
  }
}

export function normaliseDeck(rawDeck, label = "deck") {
  if (!isPlainObject(rawDeck)) {
    throw new DeckStoreError("INVALID_DECK", `${label} must be an object.`);
  }
  const now = Date.now();
  return {
    id: normaliseIdentifier(rawDeck.id, `${label} ID`),
    name: normaliseName(rawDeck.name, label),
    legendId: normaliseNullableIdentifier(rawDeck.legendId, `${label} legend ID`),
    championId: normaliseNullableIdentifier(rawDeck.championId, `${label} champion ID`),
    battlefields: normaliseCountMap(rawDeck.battlefields, `${label} battlefields`),
    runes: normaliseCountMap(rawDeck.runes, `${label} runes`),
    cards: normaliseCountMap(rawDeck.cards, `${label} cards`),
    createdAt: normaliseTimestamp(rawDeck.createdAt, now, `${label} createdAt`),
    updatedAt: normaliseTimestamp(rawDeck.updatedAt, now, `${label} updatedAt`),
  };
}

export function userKey(authenticatedUserId) {
  const userId = normaliseUserId(authenticatedUserId);
  return crypto.createHash("sha256").update(`local:${userId}`, "utf8").digest("hex");
}

function normaliseDecks(rawDecks) {
  if (!Array.isArray(rawDecks)) {
    throw new DeckStoreError("INVALID_DECKS", "decks must be an array.");
  }
  if (rawDecks.length > MAX_DECKS) throw tooManyDecks();
  const decks = rawDecks.map((deck, index) => normaliseDeck(deck, `decks[${index}]`));
  const ids = new Set();
  for (const deck of decks) {
    if (ids.has(deck.id)) {
      throw new DeckStoreError("DUPLICATE_DECK_ID", `Duplicate deck ID: ${deck.id}.`);
    }
    ids.add(deck.id);
  }
  return decks;
}

function normaliseCountMap(rawMap, label) {
  if (rawMap === undefined || rawMap === null) return {};
  if (!isPlainObject(rawMap)) {
    throw new DeckStoreError("INVALID_DECK", `${label} must be an object.`);
  }
  const entries = Object.entries(rawMap);
  if (entries.length > MAX_ZONE_ENTRIES) {
    throw new DeckStoreError("INVALID_DECK", `${label} contains too many card IDs.`);
  }
  const result = {};
  let total = 0;
  for (const [rawCardId, count] of entries) {
    const cardId = normaliseIdentifier(rawCardId, `${label} card ID`);
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      throw new DeckStoreError("INVALID_DECK", `${label}.${cardId} has an invalid count.`);
    }
    total += count;
    if (total > MAX_ZONE_TOTAL) {
      throw new DeckStoreError("INVALID_DECK", `${label} contains too many cards.`);
    }
    result[cardId] = count;
  }
  return result;
}

function normaliseStoredRecord(raw, expectedKey) {
  if (
    !isPlainObject(raw)
    || raw.schemaVersion !== SCHEMA_VERSION
    || raw.userKey !== expectedKey
    || !Number.isInteger(raw.revision)
    || raw.revision < 0
  ) {
    throw new DeckStoreError("DECK_FILE_CORRUPT", "Saved deck data is invalid.", 500);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    userKey: expectedKey,
    revision: raw.revision,
    updatedAt: normaliseTimestamp(raw.updatedAt, 0, "deck file updatedAt"),
    decks: normaliseDecks(raw.decks),
  };
}

function createRecord(userId, revision, decks) {
  return {
    schemaVersion: SCHEMA_VERSION,
    userKey: userKey(userId),
    revision,
    updatedAt: Date.now(),
    decks,
  };
}

function publicRecord(record) {
  return {
    revision: record.revision,
    updatedAt: record.updatedAt,
    decks: structuredClone(record.decks),
  };
}

function normaliseUserId(rawUserId) {
  const value = String(rawUserId || "").toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new DeckStoreError("INVALID_USER_ID", "An authenticated user ID is required.", 500);
  }
  return value;
}

function normaliseIdentifier(rawValue, label) {
  if (typeof rawValue !== "string") {
    throw new DeckStoreError("INVALID_DECK", `${label} must be a string.`);
  }
  const value = rawValue.trim();
  if (
    !value
    || value.length > 120
    || hasControlCharacters(value)
    || ["__proto__", "prototype", "constructor"].includes(value)
  ) {
    throw new DeckStoreError("INVALID_DECK", `${label} is invalid.`);
  }
  return value;
}

function normaliseNullableIdentifier(value, label) {
  return value === undefined || value === null || value === ""
    ? null
    : normaliseIdentifier(value, label);
}

function normaliseName(rawName, label) {
  if (typeof rawName !== "string") {
    throw new DeckStoreError("INVALID_DECK", `${label} name must be a string.`);
  }
  const name = rawName.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80 || hasControlCharacters(name)) {
    throw new DeckStoreError("INVALID_DECK", `${label} name is invalid.`);
  }
  return name;
}

function normaliseTimestamp(value, fallback, label) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DeckStoreError("INVALID_DECK", `${label} is invalid.`);
  }
  return value;
}

function normaliseRevision(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new DeckStoreError("REVISION_REQUIRED", "A non-negative revision is required.");
  }
  return value;
}

function assertRevision(actual, expected) {
  if (actual !== expected) {
    throw new DeckStoreError(
      "REVISION_CONFLICT",
      "These decks changed since they were loaded. Reload and try again.",
      409,
    );
  }
}

function tooManyDecks() {
  return new DeckStoreError("TOO_MANY_DECKS", `An account may store at most ${MAX_DECKS} decks.`);
}

function storageError(code, message, cause) {
  if (cause instanceof DeckStoreError) return cause;
  const error = new DeckStoreError(code, message, 500);
  error.cause = cause;
  return error;
}

function hasControlCharacters(value) {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
