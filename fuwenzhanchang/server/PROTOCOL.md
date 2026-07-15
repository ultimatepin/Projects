# Rift Local v1.3 protocol

The host server owns room, hidden-card, and official Duel state. Socket mutations
accept an acknowledgement callback. Success is `{ ok: true, ... }`; failure is
`{ ok: false, error: { code, message } }`. When no acknowledgement callback was
provided, a failure is emitted as `server:error` instead.

## Deck definition

Room events accept a structured deck, not a flat card-ID array. The canonical
gameplay shape is:

```js
{
  legendId: "card-id",
  chosenChampionId: "card-id", // `championId` is also accepted
  mainDeck: [/* exactly 40 IDs */], // `cards` count map is also accepted
  runeDeck: [/* exactly 12 IDs */], // `runes` count map is also accepted
  battlefields: [/* exactly 3 IDs */] // array or count map
}
```

Lists may be arrays of IDs/card objects or `{ [cardId]: quantity }` maps. The
server validates catalog IDs, card types, the chosen Champion's presence in the
Main Deck, the three-copy limit by card name, unique Battlefield names, and
banned cards. Domain identity, Champion tags, and Signature restrictions are
enforced when the catalog contains the necessary structured metadata; any
uncheckable items appear in `game.players[].metadataLimitations`. The one casual
preconstructed-deck exception is accepted only when its exact allowlisted
fingerprint matches; a client flag cannot exempt an arbitrary deck.

Saved account decks use the builder-compatible form below, which the gameplay
validator accepts through the aliases above:

```js
{
  id, name, legendId, championId,
  cards: { [cardId]: quantity },
  runes: { [cardId]: quantity },
  battlefields: { [cardId]: quantity },
  createdAt, updatedAt
}
```

## Room and lobby socket events

### `room:create`

Input: `{ playerName, deck? }`. Creates a six-character code and seat 1.

### `room:join`

Input: `{ roomCode, playerName, deck? }`. Joins the remaining seat. Joining is
allowed only while the room is in `lobby`; a room holds at most two players.

Both acknowledgements return:

```js
{
  ok: true,
  roomCode,
  playerId,
  reconnectToken,
  state
}
```

Persist the three session values locally. `reconnectToken` is a secret and must
never be shared with the opponent.

### `room:reconnect`

Input: `{ roomCode, playerId, reconnectToken }`. Reclaims the seat and returns
the same session response with fresh viewer-specific state. Reclaiming a seat
disconnects any older socket using it. A disconnected active player has two
minutes by default (`RECONNECT_GRACE_MS`) before conceding by forfeit. Lobby
seats are retained for the empty-room TTL, 30 minutes by default
(`EMPTY_ROOM_TTL_MS`).

### `room:leave`

Input: `{}`. Leaving during play is an immediate concession. Outside play the
seat is removed; if the host leaves, the remaining player becomes host.

### Lobby events

- `game:set-deck`: `{ deck }` (the alias `{ cards: deck }` is accepted). Valid
  only in the lobby; changing a deck clears that player's ready state.
- `game:ready`: `{ ready?: boolean }`. Becoming ready requires a valid deck.
- `game:start`: `{}`. Host only; requires two ready players. The server creates
  and shuffles the official game, chooses the first player randomly, draws four
  cards each, and begins opening mulligans.
- `game:reset`: `{}`. Host only; returns to the lobby, retains validated decks,
  clears ready states, and removes the previous game.

`room.status` is `lobby | playing | finished`. It becomes `playing` at
`game:start`; during opening setup, the nested `room.game.status` is still
`mulligan`.

## Official game actions

Emit `game:action` with `{ type, payload?, actionId? }`. `actionId` is an
optional client-generated idempotency key (maximum 100 characters). Repeating a
processed key for the same player acknowledges `{ duplicate: true }` without
applying the action twice.

| Type | Payload |
| --- | --- |
| `MULLIGAN` / `SUBMIT_MULLIGAN` | `{ instanceIds: [] }`; choose zero to two distinct cards from the viewer's opening hand. |
| `USE_RUNE` | `{ instanceId, mode: "energy" | "power" }`; `runeId` aliases `instanceId`. |
| `PLAY_CARD` | `{ instanceId, from?: "champion", destination?: "base" | battlefieldId, spend?: { energy?, powerByDomain? }, permission?: "card-text" }`. The default source is hand and destination is base. |
| `STANDARD_MOVE` | `{ unitIds: string[], destination: "base" | battlefieldId, permission?: "ganking" }`; a single `instanceId`/`unitId` is also accepted. |
| `PASS_FOCUS` | `{}`; only the player holding Focus during a showdown. |
| `ASSIGN_COMBAT_DAMAGE` | `{ allocations: [{ instanceId, amount }] }`; `targetId` aliases `instanceId`. Attacker assigns first, then defender. |
| `APPLY_EFFECT` / `APPLY_MANUAL_EFFECT` | `{ description?, operations: [...] }`; resolves printed card text through the constrained operations below. |
| `END_MAIN` / `END_TURN` | `{}`; active player only, after showdown/combat is resolved. |
| `CONCEDE` | `{}`; immediately finishes the game for the opponent. |

Manual effects contain 1–24 operations. Allowed operation shapes are:

- `{ type: "DRAW", playerId?, count? }`
- `{ type: "DISCARD" | "RECYCLE" | "BANISH" | "KILL" | "RECALL", instanceId }`
- `{ type: "MOVE", instanceId, destination: "base" | battlefieldId }`
- `{ type: "DAMAGE", instanceId, amount }`
- `{ type: "HEAL", instanceId, amount?: number | "all" }`
- `{ type: "READY" | "EXHAUST", instanceId }`
- `{ type: "BUFF", instanceId, value?: boolean }`
- `{ type: "CHANNEL", playerId?, count?, exhausted?: boolean }`
- `{ type: "GAIN_POINT" | "GAIN_POINTS", playerId?, count? | amount? }`
- `{ type: "GAIN_XP" | "SPEND_XP", playerId?, count? | amount? }`; the amount
  defaults to 1 and is limited to 1–999. XP is public, and an unaffordable
  spend rejects the complete action.
- `{ type: "CREATE_TOKEN", cardId, playerId?, destination?: "base" |
  battlefieldId, exhausted?: boolean, count? }`; only catalog-backed official
  Unit/Gear token records are accepted, Gear tokens must enter base, and count
  defaults to 1 with a 1–20 bound.

The reducer automates setup, mulligan, turn phases, Channel/Draw/Awaken,
movement, Focus/showdowns, combat assignment, control, Hold/Conquer scoring,
Burnout, cleanup, and concessions. Printed card effects are player-declared via
the constrained manual-operation whitelist rather than interpreted from rules
text. Resource costs are likewise declared in `PLAY_CARD.spend` and checked
against the current Rune Pool.

The victory score is 8. Hold can supply the final point; a final point from
Conquer requires the player to have scored every Battlefield that turn,
otherwise that Conquer draws a card instead. Burnout awards the opponent a
point, and the official reducer determines all finished-game results.

## Viewer-specific state

After every mutation the server emits:

```js
{
  reason,
  state: {
    code,
    status,
    version,
    hostPlayerId,
    turnPlayerId,
    winnerPlayerId,
    players: [{ id, name, seat, connected, ready, deckSize, deckReady }],
    log,
    game
  }
}
```

`state.game` is `null` in the lobby. During a Duel it contains:

```js
{
  id,
  rules: { coreVersion, profile, victoryScore, automation },
  status, // "mulligan" | "playing" | "finished"
  winnerPlayerId,
  result,
  firstPlayerId,
  secondPlayerId,
  turn: { number, activePlayerId, phase, state, priorityPlayerId, focusPlayerId },
  pendingDecision,
  showdown,
  combat,
  battlefields,
  players,
  history
}
```

Each game player exposes public score, XP, turn/mulligan state, Rune Pool, and
zones `legend`, `champion`, `mainDeck`, `runeDeck`, `hand`, `base`, `runes`,
`trash`, and `banishment`. Cards expose `instanceId`, visible `cardId`, owner,
controller, exhausted/face-down state, damage, buff, and counters.

Serialization is personalized per socket:

- Main/Rune Deck identities and order are never sent, only counts.
- The viewer receives their own hand identities; the opponent receives only a
  hand count.
- A face-down Battlefield card hides `cardId` from everyone except its
  controller.
- A pending decision exposes its full details only to the deciding player;
  others receive only its player and kind.
- Public zones, Battlefield state, combat totals/assignments, and history are
  visible to both players.

Other server events are `session:replaced` and, for an unacknowledged failed
operation, `server:error: { code, message }`.

## Room discovery and HTTP

- `GET /api/health`: process/room status, catalog count, and rules version.
- `GET /api/network-info?clientPort=`: `serverId`, listening port, and host LAN
  URLs.
- `GET /api/rooms/:code`: room presence/status on this particular server.

Rooms exist only in the memory of the server that created them; a code alone is
not network discovery. Device two must open the host's full invite URL, such as
`http://192.168.1.10:3001/?join=ABC123`, rather than enter the code into its own
`localhost` app. `serverId` and `/api/rooms/:code` can diagnose a wrong host.

The server defaults to `HOST=0.0.0.0`, `PORT=3001`. `CORS_ORIGIN` may contain a
comma-separated allowlist; otherwise socket/HTTP origins are limited to
loopback and private IPv4 ranges. The built frontend is served with SPA fallback
when `dist/index.html` exists.

## Local account HTTP API

Accounts and saved decks belong to this host; they are not cloud-synchronized.
Passwords are stored as salted scrypt hashes, never plaintext. Authentication
uses a signed opaque `HttpOnly; SameSite=Strict` cookie held in server memory,
so restarting the host signs users out.

Start with `GET /api/account/session`. It returns:

```js
{ ok: true, signedIn, user: { id, username, createdAt } | null, csrfToken }
```

The server also sets an HttpOnly CSRF cookie. Every mutation requires an
`application/json` body, a trusted matching `Origin`, credentials/cookies, and
`X-Rift-CSRF: <csrfToken>` matching that cookie.

| Endpoint | JSON body / response |
| --- | --- |
| `POST /api/account/register` | `{ username, password }`; creates a case-insensitively unique local user and signs in. |
| `POST /api/account/login` | `{ username, password }`; signs in and returns `{ ok, user }`. |
| `POST /api/account/logout` | `{}`; revokes the current session. |
| `GET /api/account/decks` | Requires a session; returns `{ ok, decks, revision, updatedAt }`. |
| `PUT /api/account/decks` | `{ decks, revision }`; atomically replaces the user's collection. |
| `PUT /api/account/decks/:deckId` | `{ deck, revision }`; inserts or replaces one matching ID. |
| `DELETE /api/account/decks/:deckId` | `{ revision }`; deletes one deck. |

Deck mutations use optimistic revisions. A stale revision returns HTTP 409 with
`REVISION_CONFLICT`; reload before retrying. Authentication/registration is
rate-limited and may return 429 with `Retry-After`.

Account routes reject unencrypted LAN access (`HTTPS_REQUIRED`). Loopback HTTP
is allowed for the installed host window; remote devices require real HTTPS.
This restriction is separate from gameplay, which remains available over the
private LAN.
