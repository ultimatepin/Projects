import crypto from "node:crypto";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";

import { readJsonFile, writeJsonFileAtomic } from "./atomicJson.js";

const scryptAsync = promisify(crypto.scrypt);
const SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_USERS = 100;
const MIN_PASSWORD_BYTES = 12;
const MAX_PASSWORD_BYTES = 1_024;
const HASH_BYTES = 64;
const SALT_BYTES = 16;
const DEFAULT_SCRYPT = Object.freeze({
  cost: 2 ** 17,
  blockSize: 8,
  parallelization: 1,
  maxmem: 256 * 1024 * 1024,
});

export class AccountError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AccountError";
    this.code = code;
    this.status = status;
  }
}

export class LocalAccountStore {
  #filePath;
  #scrypt;
  #queue = Promise.resolve();
  #dummySalt = crypto.randomBytes(SALT_BYTES);

  constructor({
    directory = process.env.RIFT_ACCOUNT_DATA_DIR
      || path.join(os.homedir(), ".rift-local", "accounts"),
    scrypt = DEFAULT_SCRYPT,
  } = {}) {
    if (typeof directory !== "string" || !directory.trim()) {
      throw new TypeError("LocalAccountStore requires a data directory.");
    }
    this.#filePath = path.join(path.resolve(directory), "users.json");
    this.#scrypt = normaliseScryptOptions(scrypt);
  }

  get filePath() {
    return this.#filePath;
  }

  async register(rawUsername, rawPassword) {
    const username = normaliseUsername(rawUsername);
    const canonicalUsername = canonicaliseUsername(username);
    const password = normaliseNewPassword(rawPassword);
    const passwordHash = await deriveNewPasswordHash(password, this.#scrypt);

    return this.#serialise(async () => {
      const database = await this.#readDatabase();
      if (database.users.some((user) => user.canonicalUsername === canonicalUsername)) {
        throw new AccountError("USERNAME_TAKEN", "That username is already in use.", 409);
      }
      if (database.users.length >= MAX_USERS) {
        throw new AccountError("USER_LIMIT_REACHED", "This host cannot create more accounts.", 409);
      }
      const now = Date.now();
      const user = {
        id: crypto.randomUUID(),
        username,
        canonicalUsername,
        passwordHash,
        createdAt: now,
        updatedAt: now,
      };
      database.users.push(user);
      database.updatedAt = now;
      await this.#writeDatabase(database);
      return publicUser(user);
    });
  }

  async authenticate(rawUsername, rawPassword) {
    let canonicalUsername = null;
    try {
      canonicalUsername = canonicaliseUsername(normaliseUsername(rawUsername));
    } catch {
      // Still execute scrypt below so malformed/unknown usernames are less distinct.
    }
    const password = normaliseLoginPassword(rawPassword);
    const database = await this.#serialise(() => this.#readDatabase());
    const user = canonicalUsername
      ? database.users.find((candidate) => candidate.canonicalUsername === canonicalUsername)
      : null;

    const hashRecord = user?.passwordHash || {
      algorithm: "scrypt",
      salt: this.#dummySalt.toString("base64url"),
      hash: Buffer.alloc(HASH_BYTES).toString("base64url"),
      keyLength: HASH_BYTES,
      ...this.#scrypt,
    };
    const valid = await verifyPassword(password, hashRecord);
    if (!user || !valid) {
      throw new AccountError("INVALID_CREDENTIALS", "Invalid username or password.", 401);
    }
    return publicUser(user);
  }

  async getUserById(rawUserId) {
    const userId = normaliseUserId(rawUserId);
    const database = await this.#serialise(() => this.#readDatabase());
    const user = database.users.find((candidate) => candidate.id === userId);
    return user ? publicUser(user) : null;
  }

  async #serialise(operation) {
    const current = this.#queue.catch(() => {}).then(operation);
    this.#queue = current;
    return current;
  }

  async #readDatabase() {
    let raw;
    try {
      raw = await readJsonFile(this.#filePath, { maxBytes: MAX_FILE_BYTES });
    } catch (error) {
      throw storageError("ACCOUNT_READ_FAILED", "Could not read local accounts.", error);
    }
    if (raw === null) return { schemaVersion: SCHEMA_VERSION, updatedAt: Date.now(), users: [] };
    return normaliseDatabase(raw);
  }

  async #writeDatabase(database) {
    try {
      await writeJsonFileAtomic(this.#filePath, database, { maxBytes: MAX_FILE_BYTES });
    } catch (error) {
      throw storageError("ACCOUNT_WRITE_FAILED", "Could not save local accounts.", error);
    }
  }
}

export function normaliseUsername(rawUsername) {
  if (typeof rawUsername !== "string") {
    throw new AccountError("INVALID_USERNAME", "Username must be a string.");
  }
  const username = rawUsername.normalize("NFKC").trim();
  if (
    username.length < 3
    || username.length > 32
    || !/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(username)
  ) {
    throw new AccountError(
      "INVALID_USERNAME",
      "Username must be 3–32 characters and use letters, numbers, ., _ or -.",
    );
  }
  return username;
}

export function canonicaliseUsername(username) {
  return username.normalize("NFKC").toLocaleLowerCase("en-US");
}

function normaliseNewPassword(rawPassword) {
  const password = normaliseLoginPassword(rawPassword);
  const length = Buffer.byteLength(password, "utf8");
  if (length < MIN_PASSWORD_BYTES) {
    throw new AccountError(
      "WEAK_PASSWORD",
      `Password must be at least ${MIN_PASSWORD_BYTES} bytes long.`,
    );
  }
  return password;
}

function normaliseLoginPassword(rawPassword) {
  if (typeof rawPassword !== "string") {
    throw new AccountError("INVALID_CREDENTIALS", "Invalid username or password.", 401);
  }
  const length = Buffer.byteLength(rawPassword, "utf8");
  if (length < 1 || length > MAX_PASSWORD_BYTES) {
    throw new AccountError("INVALID_CREDENTIALS", "Invalid username or password.", 401);
  }
  return rawPassword;
}

async function deriveNewPasswordHash(password, options) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, HASH_BYTES, options);
  return {
    algorithm: "scrypt",
    salt: salt.toString("base64url"),
    hash: hash.toString("base64url"),
    keyLength: HASH_BYTES,
    cost: options.cost,
    blockSize: options.blockSize,
    parallelization: options.parallelization,
    maxmem: options.maxmem,
  };
}

async function verifyPassword(password, record) {
  const salt = Buffer.from(record.salt, "base64url");
  const expected = Buffer.from(record.hash, "base64url");
  const actual = await derive(password, salt, record.keyLength, record);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function derive(password, salt, keyLength, options) {
  return scryptAsync(password, salt, keyLength, {
    N: options.cost,
    r: options.blockSize,
    p: options.parallelization,
    maxmem: options.maxmem,
  });
}

function normaliseDatabase(raw) {
  if (!isPlainObject(raw) || raw.schemaVersion !== SCHEMA_VERSION || !Array.isArray(raw.users)) {
    throw new AccountError("ACCOUNT_FILE_CORRUPT", "Local account data is invalid.", 500);
  }
  if (raw.users.length > MAX_USERS) {
    throw new AccountError("ACCOUNT_FILE_CORRUPT", "Local account data has too many users.", 500);
  }
  const ids = new Set();
  const names = new Set();
  const users = raw.users.map((rawUser) => {
    if (!isPlainObject(rawUser)) throw corruptAccountFile();
    const id = normaliseUserId(rawUser.id);
    const username = normaliseUsername(rawUser.username);
    const canonicalUsername = canonicaliseUsername(username);
    if (rawUser.canonicalUsername !== canonicalUsername || ids.has(id) || names.has(canonicalUsername)) {
      throw corruptAccountFile();
    }
    ids.add(id);
    names.add(canonicalUsername);
    return {
      id,
      username,
      canonicalUsername,
      passwordHash: normaliseHashRecord(rawUser.passwordHash),
      createdAt: normaliseTimestamp(rawUser.createdAt),
      updatedAt: normaliseTimestamp(rawUser.updatedAt),
    };
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: normaliseTimestamp(raw.updatedAt),
    users,
  };
}

function normaliseHashRecord(raw) {
  if (!isPlainObject(raw) || raw.algorithm !== "scrypt") throw corruptAccountFile();
  const options = normaliseScryptOptions(raw);
  if (raw.keyLength !== HASH_BYTES) throw corruptAccountFile();
  const salt = decodeBase64url(raw.salt);
  const hash = decodeBase64url(raw.hash);
  if (salt.length < SALT_BYTES || hash.length !== HASH_BYTES) throw corruptAccountFile();
  return {
    algorithm: "scrypt",
    salt: salt.toString("base64url"),
    hash: hash.toString("base64url"),
    keyLength: HASH_BYTES,
    ...options,
  };
}

function normaliseScryptOptions(raw) {
  const options = {
    cost: Number(raw?.cost),
    blockSize: Number(raw?.blockSize),
    parallelization: Number(raw?.parallelization),
    maxmem: Number(raw?.maxmem),
  };
  if (
    !Number.isSafeInteger(options.cost)
    || options.cost < 1_024
    || (options.cost & (options.cost - 1)) !== 0
    || !Number.isInteger(options.blockSize)
    || options.blockSize < 1
    || options.blockSize > 32
    || !Number.isInteger(options.parallelization)
    || options.parallelization < 1
    || options.parallelization > 16
    || !Number.isSafeInteger(options.maxmem)
    || options.maxmem <= 128 * options.cost * options.blockSize
    || options.maxmem > 1024 * 1024 * 1024
  ) {
    throw new TypeError("Invalid scrypt work factors.");
  }
  return Object.freeze(options);
}

function publicUser(user) {
  return Object.freeze({ id: user.id, username: user.username, createdAt: user.createdAt });
}

function normaliseUserId(rawUserId) {
  const value = String(rawUserId || "").toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw corruptAccountFile();
  }
  return value;
}

function normaliseTimestamp(rawTimestamp) {
  if (!Number.isSafeInteger(rawTimestamp) || rawTimestamp < 0) throw corruptAccountFile();
  return rawTimestamp;
}

function decodeBase64url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw corruptAccountFile();
  return Buffer.from(value, "base64url");
}

function corruptAccountFile() {
  return new AccountError("ACCOUNT_FILE_CORRUPT", "Local account data is invalid.", 500);
}

function storageError(code, message, cause) {
  if (cause instanceof AccountError) return cause;
  const error = new AccountError(code, message, 500);
  error.cause = cause;
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
