# Riftbound LAN socket protocol

The server owns all live room state. Socket events that change state accept an
optional acknowledgement callback. Successful acknowledgements contain
`{ ok: true, ... }`; failures contain
`{ ok: false, error: { code, message } }` and also emit `server:error`.

## Session events

### `room:create`

Input: `{ playerName, deck?: string[] }`

Creates a six-character room code and seat 1. The acknowledgement includes:

```js
{
  ok: true,
  roomCode,
  playerId,
  reconnectToken,
  state
}
```

Persist `roomCode`, `playerId`, and `reconnectToken` locally. The reconnect
token is a secret and must never be shown to another player.

### `room:join`

Input: `{ roomCode, playerName, deck?: string[] }`

Joins seat 2. Returns the same session shape as `room:create`.

### `room:reconnect`

Input: `{ roomCode, playerId, reconnectToken }`

Reclaims a disconnected seat and returns a fresh viewer-specific `state`.
Disconnected players have two minutes by default to reconnect. A disconnect
during a game becomes a forfeit when that grace period expires. Environment
variable `RECONNECT_GRACE_MS` changes the period.

### `room:leave`

Input: `{}`. Leaving an active game is an immediate forfeit.

## Lobby events

- `game:set-deck`: `{ deck: string[] }` (also accepts `cards`). The maximum
  accepted size defaults to 200 and is configurable with `MAX_DECK_SIZE`.
- `game:ready`: `{ ready: boolean }`.
- `game:start`: `{}`. Host only; requires two ready players with non-empty
  decks. Decks are shuffled on the server. Seat 1 starts.
- `game:reset`: `{}`. Host only; returns any game to the lobby and keeps both
  players' selected deck lists.

## Game actions

Emit `game:action` with `{ type, payload, actionId? }`. `actionId` is an
optional client-generated idempotency key, useful when retrying after a lost
acknowledgement.

| Type | Payload | Meaning |
| --- | --- | --- |
| `DRAW` | `{ count?: number }` | Move 1-20 cards from the acting player's deck to hand. |
| `MOVE_CARD` | `{ instanceId, from, to, position?, faceDown? }` | Move an owned card between `deck`, `hand`, `board`, `discard`, and `banished`. `position` can be `top`, `bottom`, or an array index. |
| `SHUFFLE_ZONE` | `{ zone?: "deck" }` | Securely shuffle one of the acting player's zones. |
| `SET_SCORE` | `{ score }` | Set the acting player's public score. |
| `ADJUST_SCORE` | `{ delta }` | Add to the acting player's public score. |
| `SET_COUNTER` | `{ key, value, scope?: "player" | "game" }` | Set a public player or game counter. |
| `SET_CARD_COUNTER` | `{ instanceId, key, value }` | Set a counter on an owned card. |
| `SET_CARD_STATE` | `{ instanceId, exhausted?, faceDown? }` | Update generic card state. |
| `END_TURN` | `{}` | Give the turn to the opponent; only the active player may do this. |
| `SET_TURN` | `{ playerId }` | Host-only correction of the current player. |
| `CONCEDE` | `{}` | Finish the game with the opponent as winner. |

This layer intentionally models generic tabletop state instead of attempting
to enforce the full Riftbound rules. The clients agree on legal plays, while
the server protects hidden card identities, turn ownership, and room state.

## Server-pushed events

### `room:state`

Sent after every room mutation:

```js
{
  reason: "game:action",
  state: {
    code,
    status, // "lobby" | "playing" | "finished"
    version,
    hostPlayerId,
    turnPlayerId,
    winnerPlayerId,
    counters,
    players,
    log
  }
}
```

State is personalized for its recipient. A player receives the cards in their
own hand. Their opponent only receives the hand count. Face-down board cards
also hide `cardId` from the opponent. Deck order and identities are never sent.

The server may also emit:

- `server:error`: `{ code, message }` for a failed operation.
- `session:replaced`: another socket reclaimed this player session; the old
  socket is then disconnected.

## HTTP and hosting

- `GET /api/health` returns service status and connected room/player counts.
- If `dist/index.html` exists, the server serves the built frontend and applies
  an SPA fallback for non-API GET requests.
- `HOST` defaults to `0.0.0.0` and `PORT` defaults to `3001`, so another device
  on the same Wi-Fi can open `http://<host-lan-ip>:3001`.
- `CORS_ORIGIN` may be a comma-separated allowlist. With no value, LAN origins
  are allowed so Vite development clients can connect from other devices.
