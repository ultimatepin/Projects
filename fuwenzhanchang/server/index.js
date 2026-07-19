import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import { Server as SocketIOServer } from "socket.io";
import { createLocalAccountRouter } from "./auth/accountRouter.js";
import {
  applyOfficialAction,
  createOfficialGame,
  OFFICIAL_CORE_RULES_VERSION,
  serialiseOfficialGame,
  validateDeckDefinition,
} from "./officialGame.js";
import { AccountDeckStore } from "./storage/accountDeckStore.js";
import { LocalAccountStore } from "./storage/localAccountStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const productionDist = process.env.RIFT_DIST_DIR
  ? path.resolve(process.env.RIFT_DIST_DIR)
  : path.join(projectRoot, "dist");

const PORT = readPositiveInteger(process.env.PORT, 3001);
const HOST = process.env.HOST || "0.0.0.0";
const RECONNECT_GRACE_MS = readPositiveInteger(
  process.env.RECONNECT_GRACE_MS,
  2 * 60 * 1000,
);
const EMPTY_ROOM_TTL_MS = readPositiveInteger(
  process.env.EMPTY_ROOM_TTL_MS,
  30 * 60 * 1000,
);
const MAX_LOG_ENTRIES = 100;
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const serverId = crypto.randomUUID();
const NOOP_ACK = () => {};
const cardsById = loadCardCatalog();
const CASUAL_EXACT_PRECON_FINGERPRINTS = new Set([
  // Unchanged Origins Jinx Champion Deck; Riot's Casual precon ban exception.
  "8be87d1c70a50277670c91269b6e80abe1de88858da1479783be6b1ba110f691",
]);

/** @type {Map<string, ReturnType<typeof createRoomRecord>>} */
const rooms = new Map();

const app = express();
app.disable("x-powered-by");
app.use((request, response, next) => {
  const configuredOrigins = process.env.CORS_ORIGIN
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const requestOrigin = request.headers.origin;
  if (
    (configuredOrigins?.length && configuredOrigins.includes(requestOrigin))
    || (!configuredOrigins?.length && isAllowedLanOrigin(requestOrigin))
  ) {
    response.setHeader("Access-Control-Allow-Origin", requestOrigin || "*");
  }
  response.setHeader("Vary", "Origin");
  response.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Rift-CSRF");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }
  next();
});

app.use(
  "/api/account",
  createLocalAccountRouter({
    accountStore: new LocalAccountStore(),
    deckStore: new AccountDeckStore(),
  }),
);
app.use(express.json({ limit: "64kb" }));

app.get("/api/health", (_request, response) => {
  let connectedPlayers = 0;
  for (const room of rooms.values()) {
    connectedPlayers += [...room.players.values()].filter(
      (player) => player.connected,
    ).length;
  }

  response.json({
    ok: true,
    service: "riftbound-lan-server",
    rooms: rooms.size,
    connectedPlayers,
    cardCount: cardsById.size,
    coreRulesVersion: OFFICIAL_CORE_RULES_VERSION,
    uptimeSeconds: Math.floor(process.uptime()),
    now: new Date().toISOString(),
  });
});

app.get("/api/network-info", (request, response) => {
  const listeningPort = Number(httpServer.address()?.port) || PORT;
  const requestedClientPort = Number(request.query.clientPort);
  const clientPort = Number.isInteger(requestedClientPort) && requestedClientPort > 0 && requestedClientPort < 65536
    ? requestedClientPort
    : listeningPort;
  response.json({
    ok: true,
    serverId,
    port: listeningPort,
    urls: getLanAddresses().map((address) => `http://${address}:${clientPort}`),
  });
});

app.get("/api/rooms/:code", (request, response) => {
  const code = String(request.params.code || "").trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) {
    response.status(404).json({
      ok: false,
      error: "Room not found on this host. Open the host's full invite link, or ask the host to create a new room.",
      serverId,
    });
    return;
  }
  response.json({
    ok: true,
    serverId,
    code,
    status: room.status,
    seats: room.players.size,
    full: room.players.size >= 2,
  });
});

if (fs.existsSync(productionDist)) {
  app.use(express.static(productionDist, { index: false }));
  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/")) {
      next();
      return;
    }
    response.sendFile(path.join(productionDist, "index.html"));
  });
}

app.use((request, response) => {
  response.status(404).json({ ok: false, error: "Not found" });
});

const httpServer = http.createServer(app);
const configuredSocketOrigins = process.env.CORS_ORIGIN
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: configuredSocketOrigins?.length ? configuredSocketOrigins : true,
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 256_000,
  pingInterval: 10_000,
  pingTimeout: 20_000,
  allowRequest: (request, callback) => callback(null, isAllowedLanOrigin(request.headers.origin)),
});

io.on("connection", (socket) => {
  socket.on("room:create", (rawPayload, rawAck) => {
    const ack = normaliseAck(rawAck);
    try {
      ensureSocketHasNoRoom(socket);
      const payload = asObject(rawPayload);
      const room = createRoomRecord(createUniqueRoomCode());
      const player = createPlayer(sanitisePlayerName(payload.playerName), 1);
      if (payload.deck !== undefined) {
        setPlayerDeck(player, payload.deck);
      }
      room.players.set(player.id, player);
      room.hostPlayerId = player.id;
      rooms.set(room.code, room);
      attachPlayerToSocket(room, player, socket);

      touchRoom(room, `${player.name} created the room.`);
      ack(sessionResponse(room, player));
      broadcastState(room, "room:created");
    } catch (error) {
      sendOperationError(socket, ack, error);
    }
  });

  socket.on("room:join", (rawPayload, rawAck) => {
    const ack = normaliseAck(rawAck);
    try {
      ensureSocketHasNoRoom(socket);
      const payload = asObject(rawPayload);
      const room = getRoom(payload.roomCode);
      if (room.status !== "lobby") {
        throw protocolError("GAME_IN_PROGRESS", "This game has already started.");
      }
      if (room.players.size >= 2) {
        throw protocolError("ROOM_FULL", "This room already has two players.");
      }

      const occupiedSeats = new Set(
        [...room.players.values()].map((player) => player.seat),
      );
      const seat = occupiedSeats.has(1) ? 2 : 1;
      const player = createPlayer(sanitisePlayerName(payload.playerName), seat);
      if (payload.deck !== undefined) {
        setPlayerDeck(player, payload.deck);
      }
      room.players.set(player.id, player);
      attachPlayerToSocket(room, player, socket);

      touchRoom(room, `${player.name} joined the room.`);
      ack(sessionResponse(room, player));
      broadcastState(room, "room:joined");
    } catch (error) {
      sendOperationError(socket, ack, error);
    }
  });

  socket.on("room:reconnect", (rawPayload, rawAck) => {
    const ack = normaliseAck(rawAck);
    try {
      ensureSocketHasNoRoom(socket);
      const payload = asObject(rawPayload);
      const room = getRoom(payload.roomCode);
      const player = room.players.get(String(payload.playerId || ""));
      if (
        !player ||
        typeof payload.reconnectToken !== "string" ||
        !tokensMatch(player.reconnectToken, payload.reconnectToken)
      ) {
        throw protocolError(
          "INVALID_SESSION",
          "The saved player session is not valid.",
        );
      }

      if (player.socketId && player.socketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(player.socketId);
        oldSocket?.emit("session:replaced");
        oldSocket?.disconnect(true);
      }
      attachPlayerToSocket(room, player, socket);
      touchRoom(room, `${player.name} reconnected.`);
      ack(sessionResponse(room, player));
      broadcastState(room, "room:reconnected");
    } catch (error) {
      sendOperationError(socket, ack, error);
    }
  });

  socket.on("room:leave", (_rawPayload, rawAck) => {
    const ack = normaliseAck(rawAck);
    try {
      const { room, player } = getSocketSession(socket);
      leaveRoom(room, player, socket);
      ack({ ok: true });
    } catch (error) {
      sendOperationError(socket, ack, error);
    }
  });

  socket.on("game:set-deck", (rawPayload, rawAck) => {
    const ack = normaliseAck(rawAck);
    try {
      const { room, player } = getSocketSession(socket);
      if (room.status !== "lobby") {
        throw protocolError(
          "GAME_IN_PROGRESS",
          "A deck can only be changed in the lobby.",
        );
      }
      const payload = asObject(rawPayload);
      setPlayerDeck(player, payload.deck ?? payload.cards);
      player.ready = false;
      touchRoom(room, `${player.name} selected a deck.`);
      ack({ ok: true, version: room.version });
      broadcastState(room, "game:deck-set");
    } catch (error) {
      sendOperationError(socket, ack, error);
    }
  });

  socket.on("game:ready", (rawPayload, rawAck) => {
    const ack = normaliseAck(rawAck);
    try {
      const { room, player } = getSocketSession(socket);
      if (room.status !== "lobby") {
        throw protocolError("GAME_IN_PROGRESS", "The game has already started.");
      }
      const payload = asObject(rawPayload);
      const ready = payload.ready === undefined ? true : Boolean(payload.ready);
      if (ready && !player.deckDefinition) {
        throw protocolError("DECK_REQUIRED", "Choose a deck before becoming ready.");
      }
      player.ready = ready;
      touchRoom(room, `${player.name} is ${ready ? "ready" : "not ready"}.`);
      ack({ ok: true, version: room.version });
      broadcastState(room, "game:ready-changed");
    } catch (error) {
      sendOperationError(socket, ack, error);
    }
  });

  socket.on("game:start", (_rawPayload, rawAck) => {
    const ack = normaliseAck(rawAck);
    try {
      const { room, player } = getSocketSession(socket);
      if (room.hostPlayerId !== player.id) {
        throw protocolError("HOST_ONLY", "Only the room host can start the game.");
      }
      startGame(room);
      ack({ ok: true, version: room.version });
      broadcastState(room, "game:started");
    } catch (error) {
      sendOperationError(socket, ack, error);
    }
  });

  socket.on("game:action", (rawPayload, rawAck) => {
    const ack = normaliseAck(rawAck);
    try {
      const { room, player } = getSocketSession(socket);
      if (room.status !== "playing") {
        throw protocolError("GAME_NOT_ACTIVE", "The game is not active.");
      }
      const payload = asObject(rawPayload);
      const actionId = sanitiseActionId(payload.actionId);
      if (actionId && room.processedActionIds.has(`${player.id}:${actionId}`)) {
        ack({ ok: true, duplicate: true, version: room.version });
        return;
      }

      const summary = applyGameAction(room, player, payload);
      if (actionId) {
        rememberActionId(room, `${player.id}:${actionId}`);
      }
      touchRoom(room, summary);
      ack({ ok: true, version: room.version });
      broadcastState(room, "game:action");
    } catch (error) {
      sendOperationError(socket, ack, error);
    }
  });

  socket.on("game:reset", (_rawPayload, rawAck) => {
    const ack = normaliseAck(rawAck);
    try {
      const { room, player } = getSocketSession(socket);
      if (room.hostPlayerId !== player.id) {
        throw protocolError("HOST_ONLY", "Only the room host can reset the game.");
      }
      resetGame(room);
      touchRoom(room, `${player.name} reset the game.`);
      ack({ ok: true, version: room.version });
      broadcastState(room, "game:reset");
    } catch (error) {
      sendOperationError(socket, ack, error);
    }
  });

  socket.on("disconnect", () => {
    const roomCode = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (!roomCode || !playerId) return;

    const room = rooms.get(roomCode);
    const player = room?.players.get(playerId);
    if (!room || !player || player.socketId !== socket.id) return;

    markPlayerDisconnected(room, player);
  });
});

function createRoomRecord(code) {
  return {
    code,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "lobby",
    version: 0,
    hostPlayerId: null,
    turnPlayerId: null,
    winnerPlayerId: null,
    game: null,
    players: new Map(),
    log: [],
    processedActionIds: new Set(),
    processedActionQueue: [],
  };
}

function createPlayer(name, seat) {
  return {
    id: crypto.randomUUID(),
    reconnectToken: crypto.randomBytes(32).toString("base64url"),
    name,
    seat,
    connected: false,
    socketId: null,
    disconnectedAt: null,
    disconnectTimer: null,
    ready: false,
    deckDefinition: null,
    allowExactPrecon: false,
  };
}

function setPlayerDeck(player, rawDeck) {
  const source = asObject(rawDeck);
  if (source === rawDeck && Object.keys(source).length === 0) {
    throw protocolError(
      "INVALID_DECK",
      "Choose a complete deck with a Legend, 40 Main Deck cards, 12 Runes, and 3 Battlefields.",
    );
  }
  const allowExactPrecon = source.casualPreconException === true
    && CASUAL_EXACT_PRECON_FINGERPRINTS.has(deckDefinitionFingerprint(source));
  player.deckDefinition = validateDeckDefinition(
    { ...source, isExactPrecon: allowExactPrecon },
    cardsById,
    { allowExactPrecon },
  );
  player.allowExactPrecon = Boolean(
    allowExactPrecon && player.deckDefinition.exactPreconDeclared,
  );
}

function startGame(room) {
  if (room.status !== "lobby") {
    throw protocolError("GAME_IN_PROGRESS", "The game has already started.");
  }
  const players = [...room.players.values()].sort((a, b) => a.seat - b.seat);
  if (players.length !== 2) {
    throw protocolError("TWO_PLAYERS_REQUIRED", "Two players are required.");
  }
  if (players.some((player) => !player.ready || !player.deckDefinition)) {
    throw protocolError("PLAYERS_NOT_READY", "Both players must be ready with decks.");
  }

  room.game = createOfficialGame(
    players.map((player) => ({
      id: player.id,
      name: player.name,
      deck: {
        ...player.deckDefinition,
        isExactPrecon: player.allowExactPrecon,
      },
      allowExactPrecon: player.allowExactPrecon,
    })),
    cardsById,
  );
  room.status = "playing";
  room.turnPlayerId = room.game.turn.activePlayerId;
  room.winnerPlayerId = null;
  room.log = [];
  room.processedActionIds.clear();
  room.processedActionQueue = [];
  touchRoom(
    room,
    `${room.game.players.find((candidate) => candidate.id === room.game.firstPlayerId)?.name || "A player"} was selected to play first. Opening mulligans begin now.`,
  );
}

function resetGame(room) {
  room.status = "lobby";
  room.turnPlayerId = null;
  room.winnerPlayerId = null;
  room.game = null;
  room.log = [];
  room.processedActionIds.clear();
  room.processedActionQueue = [];
  for (const player of room.players.values()) {
    player.ready = false;
  }
}

function syncRoomFromOfficialGame(room) {
  if (!room.game) return;
  const finished = room.game.status === "finished";
  room.status = finished ? "finished" : "playing";
  room.turnPlayerId = finished ? null : room.game.turn.activePlayerId;
  room.winnerPlayerId = room.game.winnerPlayerId;
}

function forfeitOfficialGame(room, player) {
  if (room.game?.status !== "finished") {
    applyOfficialAction(room.game, player.id, { type: "CONCEDE" }, cardsById);
  }
  syncRoomFromOfficialGame(room);
}

function applyGameAction(room, player, rawAction) {
  if (!room.game) throw protocolError("GAME_NOT_ACTIVE", "The official game is missing.");
  const historyLength = room.game.history.length;
  applyOfficialAction(room.game, player.id, rawAction, cardsById);
  syncRoomFromOfficialGame(room);
  return room.game.history.at(-1)?.message
    || (room.game.history.length === historyLength
      ? `${player.name} completed an official game action.`
      : `${player.name} advanced the game.`);
}

function attachPlayerToSocket(room, player, socket) {
  clearTimeout(player.disconnectTimer);
  player.disconnectTimer = null;
  player.socketId = socket.id;
  player.connected = true;
  player.disconnectedAt = null;
  socket.data.roomCode = room.code;
  socket.data.playerId = player.id;
  socket.join(room.code);
}

function markPlayerDisconnected(room, player) {
  player.connected = false;
  player.socketId = null;
  player.disconnectedAt = Date.now();
  touchRoom(room, `${player.name} disconnected.`);
  broadcastState(room, "room:player-disconnected");

  clearTimeout(player.disconnectTimer);
  const disconnectGrace = room.status === "lobby" ? EMPTY_ROOM_TTL_MS : RECONNECT_GRACE_MS;
  player.disconnectTimer = setTimeout(() => {
    if (player.connected || !room.players.has(player.id)) return;
    if (room.status === "lobby") {
      removePlayerFromRoom(room, player);
      broadcastState(room, "room:player-left");
      return;
    }
    if (room.status === "playing") {
      forfeitOfficialGame(room, player);
      touchRoom(room, `${player.name} did not reconnect in time.`);
      broadcastState(room, "game:disconnect-forfeit");
    }
  }, disconnectGrace);
  player.disconnectTimer.unref?.();
}

function leaveRoom(room, player, socket) {
  clearTimeout(player.disconnectTimer);
  player.disconnectTimer = null;
  socket.leave(room.code);
  delete socket.data.roomCode;
  delete socket.data.playerId;

  if (room.status === "playing") {
    player.connected = false;
    player.socketId = null;
    player.reconnectToken = crypto.randomBytes(32).toString("base64url");
    forfeitOfficialGame(room, player);
    touchRoom(room, `${player.name} left and forfeited the game.`);
    broadcastState(room, "game:player-forfeit");
    return;
  }

  removePlayerFromRoom(room, player);
  broadcastState(room, "room:player-left");
}

function removePlayerFromRoom(room, player) {
  clearTimeout(player.disconnectTimer);
  room.players.delete(player.id);
  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }
  if (room.hostPlayerId === player.id) {
    room.hostPlayerId = [...room.players.values()].sort(
      (a, b) => a.seat - b.seat,
    )[0].id;
  }
  touchRoom(room, `${player.name} left the room.`);
}

function broadcastState(room, reason) {
  for (const player of room.players.values()) {
    if (!player.socketId) continue;
    io.to(player.socketId).emit("room:state", {
      reason,
      state: serialiseRoom(room, player.id),
    });
  }
}

function serialiseRoom(room, viewerPlayerId) {
  return {
    code: room.code,
    status: room.status,
    version: room.version,
    hostPlayerId: room.hostPlayerId,
    turnPlayerId: room.turnPlayerId,
    winnerPlayerId: room.winnerPlayerId,
    game: room.game ? serialiseOfficialGame(room.game, viewerPlayerId) : null,
    players: [...room.players.values()]
      .sort((a, b) => a.seat - b.seat)
      .map((player) => serialiseLobbyPlayer(player)),
    log: room.log.slice(-MAX_LOG_ENTRIES),
  };
}

function serialiseLobbyPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    seat: player.seat,
    connected: player.connected,
    ready: player.ready,
    deckSize: player.deckDefinition?.mainDeck?.length || 0,
    deckReady: Boolean(player.deckDefinition),
  };
}

function sessionResponse(room, player) {
  return {
    ok: true,
    roomCode: room.code,
    playerId: player.id,
    reconnectToken: player.reconnectToken,
    state: serialiseRoom(room, player.id),
  };
}

function touchRoom(room, message) {
  room.updatedAt = Date.now();
  room.version += 1;
  if (message) {
    room.log.push({ id: crypto.randomUUID(), at: Date.now(), message });
    if (room.log.length > MAX_LOG_ENTRIES) room.log.shift();
  }
}

function createUniqueRoomCode() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    const random = crypto.randomBytes(6);
    for (const byte of random) {
      code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
    }
    if (!rooms.has(code)) return code;
  }
  throw protocolError("ROOM_CODE_UNAVAILABLE", "Could not allocate a room code.");
}

function getRoom(rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) throw protocolError("ROOM_NOT_FOUND", "Room not found.");
  return room;
}

function getSocketSession(socket) {
  const room = rooms.get(socket.data.roomCode);
  const player = room?.players.get(socket.data.playerId);
  if (!room || !player || player.socketId !== socket.id) {
    throw protocolError("NOT_IN_ROOM", "Join or reconnect to a room first.");
  }
  return { room, player };
}

function ensureSocketHasNoRoom(socket) {
  if (socket.data.roomCode) {
    throw protocolError("ALREADY_IN_ROOM", "Leave the current room first.");
  }
}

function sanitisePlayerName(rawName) {
  const name = String(rawName || "Player").trim().replace(/\s+/g, " ").slice(0, 30);
  return name || "Player";
}

function sanitiseActionId(rawActionId) {
  if (rawActionId === undefined || rawActionId === null) return null;
  const actionId = String(rawActionId).trim();
  if (!actionId || actionId.length > 100) {
    throw protocolError("INVALID_ACTION_ID", "The action ID is invalid.");
  }
  return actionId;
}

function rememberActionId(room, key) {
  room.processedActionIds.add(key);
  room.processedActionQueue.push(key);
  if (room.processedActionQueue.length > 500) {
    room.processedActionIds.delete(room.processedActionQueue.shift());
  }
}

function tokensMatch(expected, received) {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return (
    expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readPositiveInteger(rawValue, fallback) {
  const parsed = Number(rawValue);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normaliseAck(rawAck) {
  return typeof rawAck === "function" ? rawAck : NOOP_ACK;
}

function protocolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sendOperationError(socket, ack, error) {
  const payload = {
    ok: false,
    error: {
      code: error?.code || "SERVER_ERROR",
      message: error?.code ? error.message : "Unexpected server error.",
    },
  };
  if (!error?.code) console.error(error);
  ack(payload);
  if (ack === NOOP_ACK) socket.emit("server:error", payload.error);
}

const roomSweeper = setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const hasConnectedPlayers = [...room.players.values()].some(
      (player) => player.connected,
    );
    if (!hasConnectedPlayers && now - room.updatedAt > EMPTY_ROOM_TTL_MS) {
      for (const player of room.players.values()) clearTimeout(player.disconnectTimer);
      rooms.delete(room.code);
    }
  }
}, Math.min(60_000, EMPTY_ROOM_TTL_MS));
roomSweeper.unref?.();

async function startLanServer({ port = PORT, host = HOST, quiet = false } = {}) {
  if (!httpServer.listening) {
    await new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      httpServer.once("error", onError);
      httpServer.listen(port, host, () => {
        httpServer.off("error", onError);
        resolve();
      });
    });
  }
  const listeningPort = Number(httpServer.address()?.port) || port;
  const urls = getLanAddresses().map((address) => `http://${address}:${listeningPort}`);
  if (!quiet) {
    console.log(`Riftbound LAN server listening on port ${listeningPort}`);
    for (const url of urls) console.log(`  ${url}`);
  }
  return { port: listeningPort, urls, serverId };
}

async function stopLanServer() {
  clearInterval(roomSweeper);
  for (const room of rooms.values()) {
    for (const player of room.players.values()) clearTimeout(player.disconnectTimer);
  }
  if (!httpServer.listening) return;
  io.emit("server:shutdown", { message: "The local host is shutting down." });
  await new Promise((resolve) => io.close(resolve));
}

function getServerStatus() {
  return {
    serverId,
    rooms: rooms.size,
    activeGames: [...rooms.values()].filter((room) => room.status === "playing").length,
  };
}

function getLanAddresses() {
  const addresses = new Set(["localhost"]);
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const network of interfaces || []) {
      if (network.family === "IPv4" && !network.internal) addresses.add(network.address);
    }
  }
  return [...addresses];
}

function isAllowedLanOrigin(origin) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "[::1]" || hostname === "::1") return true;
    const parts = hostname.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    return parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 169 && parts[1] === 254);
  } catch {
    return false;
  }
}

function loadCardCatalog() {
  const candidates = [
    process.env.RIFT_CARDS_FILE,
    path.join(projectRoot, "public", "cards.json"),
    path.join(productionDist, "cards.json"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const cards = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (!Array.isArray(cards) || !cards.length) continue;
      const catalog = new Map(
        cards
          .filter((card) => card && typeof card.id === "string")
          .map((card) => [card.id, card]),
      );
      if (catalog.size) return catalog;
    } catch (error) {
      console.warn(`Could not load card catalog from ${candidate}:`, error.message);
    }
  }
  throw new Error("Could not load cards.json for official deck and game validation.");
}

function deckDefinitionFingerprint(rawDeck) {
  const source = asObject(rawDeck);
  const expand = (value) => {
    if (Array.isArray(value)) return value.map(String).sort();
    if (!value || typeof value !== "object") return [];
    const cards = [];
    for (const [id, rawCount] of Object.entries(value)) {
      const count = Number(rawCount);
      if (!id || !Number.isInteger(count) || count < 1 || count > 100) return [];
      cards.push(...Array.from({ length: count }, () => id));
    }
    return cards.sort();
  };
  const canonical = {
    legendId: String(source.legendId || ""),
    chosenChampionId: String(source.chosenChampionId ?? source.championId ?? ""),
    mainDeck: expand(source.mainDeck ?? source.cards),
    runeDeck: expand(source.runeDeck ?? source.runes),
    battlefields: expand(source.battlefields ?? source.battlefieldIds),
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();

if (isDirectRun) {
  startLanServer().catch((error) => {
    console.error("Could not start Riftbound LAN server:", error);
    process.exitCode = 1;
  });
}

export { app, getLanAddresses, getServerStatus, httpServer, io, startLanServer, stopLanServer };
