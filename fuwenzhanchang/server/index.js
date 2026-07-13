import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import { Server as SocketIOServer } from "socket.io";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const productionDist = path.join(projectRoot, "dist");

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
const MAX_DECK_SIZE = readPositiveInteger(process.env.MAX_DECK_SIZE, 200);
const MAX_LOG_ENTRIES = 100;
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ZONES = new Set(["deck", "hand", "board", "discard", "banished"]);

/** @type {Map<string, ReturnType<typeof createRoomRecord>>} */
const rooms = new Map();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use((request, response, next) => {
  const configuredOrigins = process.env.CORS_ORIGIN
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const requestOrigin = request.headers.origin;
  if (!configuredOrigins?.length || configuredOrigins.includes(requestOrigin)) {
    response.setHeader("Access-Control-Allow-Origin", requestOrigin || "*");
  }
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }
  next();
});

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
    uptimeSeconds: Math.floor(process.uptime()),
    now: new Date().toISOString(),
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
      if (ready && player.deckList.length === 0) {
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
    players: new Map(),
    counters: {},
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
    score: 0,
    counters: {},
    deckList: [],
    zones: emptyZones(),
  };
}

function emptyZones() {
  return { deck: [], hand: [], board: [], discard: [], banished: [] };
}

function createCardInstances(deckList, playerId) {
  return deckList.map((cardId) => ({
    instanceId: crypto.randomUUID(),
    cardId,
    ownerPlayerId: playerId,
    faceDown: false,
    counters: {},
    exhausted: false,
  }));
}

function setPlayerDeck(player, rawDeck) {
  if (!Array.isArray(rawDeck)) {
    throw protocolError("INVALID_DECK", "The deck must be an array of card IDs.");
  }
  if (rawDeck.length > MAX_DECK_SIZE) {
    throw protocolError(
      "INVALID_DECK",
      `A deck cannot contain more than ${MAX_DECK_SIZE} cards.`,
    );
  }
  player.deckList = rawDeck.map((entry) => {
    const cardId = typeof entry === "string" ? entry : entry?.cardId ?? entry?.id;
    if (typeof cardId !== "string" || !cardId.trim() || cardId.length > 120) {
      throw protocolError("INVALID_DECK", "Every deck entry needs a valid card ID.");
    }
    return cardId.trim();
  });
  player.zones = emptyZones();
}

function startGame(room) {
  if (room.status !== "lobby") {
    throw protocolError("GAME_IN_PROGRESS", "The game has already started.");
  }
  const players = [...room.players.values()].sort((a, b) => a.seat - b.seat);
  if (players.length !== 2) {
    throw protocolError("TWO_PLAYERS_REQUIRED", "Two players are required.");
  }
  if (players.some((player) => !player.ready || player.deckList.length === 0)) {
    throw protocolError("PLAYERS_NOT_READY", "Both players must be ready with decks.");
  }

  for (const player of players) {
    player.zones = emptyZones();
    player.zones.deck = shuffle(createCardInstances(player.deckList, player.id));
    player.score = 0;
    player.counters = {};
  }
  room.status = "playing";
  room.turnPlayerId = players[0].id;
  room.winnerPlayerId = null;
  room.counters = {};
  room.log = [];
  room.processedActionIds.clear();
  room.processedActionQueue = [];
  touchRoom(room, `${players[0].name} takes the first turn.`);
}

function resetGame(room) {
  room.status = "lobby";
  room.turnPlayerId = null;
  room.winnerPlayerId = null;
  room.counters = {};
  room.log = [];
  room.processedActionIds.clear();
  room.processedActionQueue = [];
  for (const player of room.players.values()) {
    player.ready = false;
    player.score = 0;
    player.counters = {};
    player.zones = emptyZones();
  }
}

function applyGameAction(room, player, rawAction) {
  const action = String(rawAction.type || "").trim().toUpperCase();
  const payload = asObject(rawAction.payload);

  switch (action) {
    case "DRAW": {
      const count = clampInteger(payload.count ?? 1, 1, 20, "draw count");
      const available = Math.min(count, player.zones.deck.length);
      for (let index = 0; index < available; index += 1) {
        player.zones.hand.push(player.zones.deck.pop());
      }
      return `${player.name} drew ${available} card${available === 1 ? "" : "s"}.`;
    }

    case "MOVE_CARD": {
      const from = requireZone(payload.from);
      const to = requireZone(payload.to);
      const instanceId = String(payload.instanceId || "");
      const sourceIndex = player.zones[from].findIndex(
        (card) => card.instanceId === instanceId,
      );
      if (sourceIndex < 0) {
        throw protocolError("CARD_NOT_FOUND", `That card is not in ${from}.`);
      }
      const [card] = player.zones[from].splice(sourceIndex, 1);
      if (payload.faceDown !== undefined) card.faceDown = Boolean(payload.faceDown);
      insertCard(player.zones[to], card, payload.position);
      return `${player.name} moved a card from ${from} to ${to}.`;
    }

    case "SHUFFLE_ZONE": {
      const zone = requireZone(payload.zone ?? "deck");
      player.zones[zone] = shuffle(player.zones[zone]);
      return `${player.name} shuffled their ${zone}.`;
    }

    case "SET_SCORE": {
      player.score = clampInteger(payload.score, -999, 9999, "score");
      return `${player.name} set their score to ${player.score}.`;
    }

    case "ADJUST_SCORE": {
      const delta = clampInteger(payload.delta, -999, 999, "score adjustment");
      player.score = Math.max(-999, Math.min(9999, player.score + delta));
      return `${player.name} changed their score by ${delta}.`;
    }

    case "SET_COUNTER": {
      const key = sanitiseCounterKey(payload.key);
      const value = clampInteger(payload.value, -9999, 9999, "counter value");
      if (payload.scope === "game") {
        room.counters[key] = value;
      } else {
        player.counters[key] = value;
      }
      return `${player.name} set ${key} to ${value}.`;
    }

    case "SET_CARD_COUNTER": {
      const card = findOwnedCard(player, payload.instanceId);
      const key = sanitiseCounterKey(payload.key);
      card.counters[key] = clampInteger(
        payload.value,
        -9999,
        9999,
        "card counter value",
      );
      return `${player.name} updated a card counter.`;
    }

    case "SET_CARD_STATE": {
      const card = findOwnedCard(player, payload.instanceId);
      if (payload.exhausted !== undefined) card.exhausted = Boolean(payload.exhausted);
      if (payload.faceDown !== undefined) card.faceDown = Boolean(payload.faceDown);
      return `${player.name} updated a card.`;
    }

    case "END_TURN": {
      if (room.turnPlayerId !== player.id) {
        throw protocolError("NOT_YOUR_TURN", "It is not your turn.");
      }
      const opponent = [...room.players.values()].find(
        (candidate) => candidate.id !== player.id,
      );
      if (!opponent) throw protocolError("OPPONENT_MISSING", "No opponent is present.");
      room.turnPlayerId = opponent.id;
      return `${player.name} ended their turn.`;
    }

    case "SET_TURN": {
      if (room.hostPlayerId !== player.id) {
        throw protocolError("HOST_ONLY", "Only the host can correct the active turn.");
      }
      const target = room.players.get(String(payload.playerId || ""));
      if (!target) throw protocolError("PLAYER_NOT_FOUND", "Player not found.");
      room.turnPlayerId = target.id;
      return `${player.name} set the active turn to ${target.name}.`;
    }

    case "CONCEDE": {
      const opponent = [...room.players.values()].find(
        (candidate) => candidate.id !== player.id,
      );
      room.status = "finished";
      room.turnPlayerId = null;
      room.winnerPlayerId = opponent?.id ?? null;
      return `${player.name} conceded the game.`;
    }

    default:
      throw protocolError("UNKNOWN_ACTION", `Unknown game action: ${action || "(empty)"}.`);
  }
}

function findOwnedCard(player, rawInstanceId) {
  const instanceId = String(rawInstanceId || "");
  for (const cards of Object.values(player.zones)) {
    const card = cards.find((candidate) => candidate.instanceId === instanceId);
    if (card) return card;
  }
  throw protocolError("CARD_NOT_FOUND", "Card not found.");
}

function insertCard(cards, card, rawPosition) {
  if (rawPosition === "top") cards.push(card);
  else if (rawPosition === "bottom") cards.unshift(card);
  else if (Number.isInteger(rawPosition)) {
    cards.splice(Math.max(0, Math.min(cards.length, rawPosition)), 0, card);
  } else cards.push(card);
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
  player.disconnectTimer = setTimeout(() => {
    if (player.connected || !room.players.has(player.id)) return;
    if (room.status === "lobby") {
      removePlayerFromRoom(room, player);
      broadcastState(room, "room:player-left");
      return;
    }
    if (room.status === "playing") {
      const opponent = [...room.players.values()].find(
        (candidate) => candidate.id !== player.id,
      );
      room.status = "finished";
      room.turnPlayerId = null;
      room.winnerPlayerId = opponent?.id ?? null;
      touchRoom(room, `${player.name} did not reconnect in time.`);
      broadcastState(room, "game:disconnect-forfeit");
    }
  }, RECONNECT_GRACE_MS);
  player.disconnectTimer.unref?.();
}

function leaveRoom(room, player, socket) {
  clearTimeout(player.disconnectTimer);
  player.disconnectTimer = null;
  socket.leave(room.code);
  delete socket.data.roomCode;
  delete socket.data.playerId;

  if (room.status === "playing") {
    const opponent = [...room.players.values()].find(
      (candidate) => candidate.id !== player.id,
    );
    player.connected = false;
    player.socketId = null;
    player.reconnectToken = crypto.randomBytes(32).toString("base64url");
    room.status = "finished";
    room.turnPlayerId = null;
    room.winnerPlayerId = opponent?.id ?? null;
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
    counters: { ...room.counters },
    players: [...room.players.values()]
      .sort((a, b) => a.seat - b.seat)
      .map((player) => serialisePlayer(player, viewerPlayerId)),
    log: room.log.slice(-MAX_LOG_ENTRIES),
  };
}

function serialisePlayer(player, viewerPlayerId) {
  const isViewer = player.id === viewerPlayerId;
  return {
    id: player.id,
    name: player.name,
    seat: player.seat,
    connected: player.connected,
    ready: player.ready,
    score: player.score,
    counters: { ...player.counters },
    deckSize: player.deckList.length,
    zones: {
      deck: { count: player.zones.deck.length },
      hand: {
        count: player.zones.hand.length,
        cards: isViewer
          ? player.zones.hand.map((card) => serialiseCard(card, true))
          : undefined,
      },
      board: {
        count: player.zones.board.length,
        cards: player.zones.board.map((card) =>
          serialiseCard(card, isViewer || !card.faceDown),
        ),
      },
      discard: {
        count: player.zones.discard.length,
        cards: player.zones.discard.map((card) => serialiseCard(card, true)),
      },
      banished: {
        count: player.zones.banished.length,
        cards: player.zones.banished.map((card) => serialiseCard(card, true)),
      },
    },
  };
}

function serialiseCard(card, revealIdentity) {
  return {
    instanceId: card.instanceId,
    cardId: revealIdentity ? card.cardId : null,
    ownerPlayerId: card.ownerPlayerId,
    faceDown: card.faceDown,
    exhausted: card.exhausted,
    counters: { ...card.counters },
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

function sanitiseCounterKey(rawKey) {
  const key = String(rawKey || "").trim().slice(0, 40);
  if (!/^[a-zA-Z0-9 _-]+$/.test(key)) {
    throw protocolError("INVALID_COUNTER", "Counter names may use letters, numbers, spaces, _ and -.");
  }
  return key;
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

function requireZone(rawZone) {
  const zone = String(rawZone || "").toLowerCase();
  if (!ZONES.has(zone)) {
    throw protocolError("INVALID_ZONE", `Unknown card zone: ${zone || "(empty)"}.`);
  }
  return zone;
}

function clampInteger(rawValue, minimum, maximum, label) {
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw protocolError(
      "INVALID_NUMBER",
      `${label} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return value;
}

function shuffle(cards) {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = crypto.randomInt(index + 1);
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
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
  return typeof rawAck === "function" ? rawAck : () => {};
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
  socket.emit("server:error", payload.error);
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

httpServer.listen(PORT, HOST, () => {
  console.log(`Riftbound LAN server listening on port ${PORT}`);
  for (const address of getLanAddresses()) {
    console.log(`  http://${address}:${PORT}`);
  }
});

function getLanAddresses() {
  const addresses = new Set(["localhost"]);
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const network of interfaces || []) {
      if (network.family === "IPv4" && !network.internal) addresses.add(network.address);
    }
  }
  return [...addresses];
}

export { app, httpServer, io };
