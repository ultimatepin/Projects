# Local account integration

These modules implement host-local username/password accounts and account-bound deck storage. They do not sync data to a cloud service.

## Server wiring

Mount the router before the static-file and catch-all 404 handlers:

```js
import { createLocalAccountRouter } from "./auth/accountRouter.js";
import { LocalAccountStore } from "./storage/localAccountStore.js";
import { AccountDeckStore } from "./storage/accountDeckStore.js";

const accountStore = new LocalAccountStore();
const deckStore = new AccountDeckStore();

app.use(
  "/api/account",
  createLocalAccountRouter({ accountStore, deckStore }),
);
```

No npm dependency is required. Passwords use Node's built-in asynchronous `crypto.scrypt` with a unique 16-byte salt and the OWASP baseline parameters `N=2^17, r=8, p=1`. The derived 64-byte hash—not the password—is stored. Benchmark the release device before increasing the work factor; do not lower it without a documented threat/performance decision.

In Electron, set the data directory before importing `server/index.js` so updates do not overwrite user data:

```js
process.env.RIFT_ACCOUNT_DATA_DIR = path.join(app.getPath("userData"), "accounts");
```

Standalone server runs default to `~/.rift-local/accounts`. JSON writes use a same-directory temporary file, file sync, and atomic rename. Run one server process against a data directory; the Electron single-instance lock already provides that constraint.

Sessions are signed, 256-bit opaque tokens held in memory. The cookie is `HttpOnly; SameSite=Strict; Path=/api/account` and expires after 12 hours. A restart signs everyone out by design; no reusable session credential is written to disk.

## Client flow

All requests use the same app origin and `credentials: "include"`:

1. `GET /api/account/session` returns `{ signedIn, user, csrfToken }` and establishes the HttpOnly CSRF cookie.
2. Keep `csrfToken` in memory. Send it as `X-Rift-CSRF` on every mutation.
3. `POST /api/account/register` with JSON `{ username, password }` creates and signs into an account.
4. `POST /api/account/login` with JSON `{ username, password }` signs in.
5. `POST /api/account/logout` with `{}` revokes the current session.
6. `GET /api/account/decks` returns `{ decks, revision, updatedAt }`.
7. `PUT /api/account/decks` with `{ decks, revision }` atomically replaces the collection.
8. `PUT /api/account/decks/:deckId` with `{ deck, revision }` upserts one deck.
9. `DELETE /api/account/decks/:deckId` with `{ revision }` deletes one deck.

Every deck mutation requires the last loaded revision. A stale revision receives HTTP 409 `REVISION_CONFLICT`; reload before retrying instead of overwriting another edit.

## Security boundary

Account routes reject ordinary HTTP requests from LAN addresses. Sending a password or session cookie over unencrypted Wi-Fi would expose it to network observers. The installed host window works over loopback HTTP; remote account access requires a real HTTPS server and cookies then receive `Secure` automatically. If HTTPS terminates at a reverse proxy, configure Express `trust proxy` only for that specific trusted proxy so `request.secure` cannot be spoofed.

The router also requires a matching `Origin`, a double-submit CSRF token, JSON content types, and rate limits login/registration attempts. Do not add wildcard CORS or expose `X-Rift-CSRF` to untrusted origins. Usernames are NFKC-normalized and case-insensitively unique; immutable random user IDs—not usernames—key deck files.

Local OS users who can read the app-data directory can attempt offline password guessing. Keep normal OS account protections enabled and use a long, unique password. Deck JSON is not encrypted because the running local app must read it.

Run focused tests with:

```powershell
node --test server/auth/localAuth.test.mjs
```
