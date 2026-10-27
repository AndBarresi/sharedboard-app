# SharedBoard.app hosted connector

The website stays on Cloudflare Pages. This Worker adds the stable remote MCP endpoint **`https://connect.sharedboard.app/mcp`**, OAuth authorization, and a live WebSocket relay to the browser. Users do not install a companion application. SharedBoard does not host a model or start a replacement AI conversation.

The browser's IndexedDB database remains authoritative for drawings, images, notes, checkpoints, captured requests, and mini-chat replies. A connector call fails clearly while its board tab is closed or unavailable; there is no server-side drawing fallback.

## Connection flow

1. On the website, choose an AI client and read-only or read-and-edit drawing access. Preparing the connection creates an opaque board session and an expiring pairing code.
2. Add the remote MCP URL in the AI client's connection settings. The client discovers the OAuth metadata and registers its exact callback through Dynamic Client Registration.
3. OAuth opens SharedBoard.app. The user chooses the intended browser board, checks the requesting client and callback origin, and explicitly approves or denies access. The server enforces PKCE S256, a one-time authorization code, the connector resource audience, and the drawing permission chosen in the browser.
4. Paste the prepared instructions into the existing AI conversation. Its `connect_board` tool consumes the pairing code; `read_board` and `confirm_connection` then verify actual browser access.
5. Use the board's connection test to verify a real mini-chat read and returned reply. OAuth approval alone is not evidence of a completed drawing or chat test.

OAuth grants identify an authorized **AI client and board**, not a verified provider conversation ID. The pairing instructions keep the user's workflow in their intended conversation, but the connector must not claim cryptographic conversation isolation that the provider does not expose.

The server advertises Dynamic Client Registration. Client-ID metadata documents are not advertised. Registered HTTPS callbacks and native `http://localhost`, `http://127.0.0.1`, or `http://[::1]` callbacks are accepted only with exact URI matching and PKCE. It does not fetch arbitrary registration URLs or use login cookies.

## Mini-chat delivery

All clients can read a saved board request and post an explicit reply through MCP tools. When automatic delivery is unavailable, the website prepares **Copy to AI** instructions containing the exact request ID and tool names. They do not depend on a local CLI.

MCP 2 event-capable hosts can subscribe to `sharedboard.message.created` and `sharedboard.review.requested`. Automatic delivery becomes available only after the provider's callback has passed a signed verification challenge. `EVENT_CALLBACK_ORIGINS` defaults to an empty allowlist, so unapproved callbacks fail closed. An operator must verify the provider's actual documented callback origin before adding its exact HTTPS origin. Wildcards, arbitrary model-provided origins, and redirect following are not permitted. A successful callback confirms delivery acceptance; only the assistant's actual reply confirms completion.

## Cloud resources and privacy

`BoardRelay` is a SQLite-backed Durable Object per opaque connection. `RelayAuth` stores shared OAuth metadata. Durable state is limited to routing IDs, chosen permissions, credential hashes, OAuth request/client/token metadata, approved callback credentials, expiry times, and bounded delivery receipts. Board titles, drawing bodies, screenshots, message text, and replies are not stored in Durable Objects. They pass transiently through the relay when the user authorizes their AI to use them. This is not an end-to-end encryption claim; the relay and the selected model provider process the data being forwarded.

The browser owns its bearer credential in private IndexedDB metadata. It is omitted from project exports. Browser APIs and the WebSocket upgrade require the exact `APP_ORIGIN`; the WebSocket authenticates in its first frame, so credentials are never placed in its URL. Only one authenticated browser tab owns command execution at a time.

WebSocket hibernation uses `acceptWebSocket`, serialized ownership attachments, and automatic plain `ping`/`pong` replies. Idle connections do not require an interval running inside the Durable Object. Pending tool calls have short deadlines. Writes retain stable IDs across retries; the browser's existing atomic persistence and optimistic edit-version checks provide idempotency and conflict detection. A lost response never authorizes a blind edit against an older disk database.

Unactivated sessions expire after ten minutes; activation extends their maximum lifetime to ninety days. Access tokens last one hour, refresh tokens rotate with a thirty-day lifetime, and revocation invalidates the token family and matching event subscriptions. Disconnecting on the board revokes access while preserving its drawing and chat history. Anonymous registration and session creation have per-IP and global limits; expired metadata is cleaned by alarms.

## Deploy

The production configuration is `cloudflare/wrangler.jsonc`:

- Worker: `sharedboard-relay`.
- Custom domain: `connect.sharedboard.app`.
- Bindings: `BOARD_RELAY` and `RELAY_AUTH`, both introduced by the `relay-v1` SQLite migration.
- Public configuration: `RELAY_ORIGIN`, `APP_ORIGIN`, and the operator-approved `EVENT_CALLBACK_ORIGINS`.
- Request logging is disabled by default; never add payload or bearer-token logging.

Use the repository's pinned Node and pnpm versions, then:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm exec wrangler deploy --config cloudflare/wrangler.jsonc --dry-run
pnpm relay:deploy
```

Wrangler must be authenticated to the account that owns the domain and has the necessary Workers/Durable Objects/custom-domain permissions. No model API key is needed. Keep Cloudflare deployment credentials in the operator's normal secure credential store or protected CI secrets, never in source control.

The frontend remains a separate Pages deployment. Its CSP allows HTTPS and WSS connections only to this connector origin. Updating the Worker does not deploy the Pages bundle, and updating Pages does not deploy the Worker. Release and verify both when their protocol changes together.

For an explicitly isolated local relay, override both origins rather than weakening production checks:

```sh
pnpm exec wrangler dev --config cloudflare/wrangler.jsonc --port 8787 --var RELAY_ORIGIN:http://127.0.0.1:8787 --var APP_ORIGIN:http://127.0.0.1:4317
```

The browser transport's test/development dependency injection accepts an explicit loopback base URL. An arbitrary hosted hostname is rejected. Normal production builds use the fixed HTTPS connector.

## Verification

`test/relay-worker.test.mjs` runs the real bundled Worker in workerd with SQLite Durable Objects, a real SDK MCP client, the browser transport, and isolated IndexedDB. It verifies OAuth and code activation, reads and writes, version conflicts, forced WebSocket hibernation and wakeup, captured mini-chat requests and explicit replies, reload persistence, reconnection, and revocation. No personal board or AI account is used by this fixture.

The authorization/session/event tests additionally cover callback/audience/PKCE restrictions, scope reduction, refresh rotation, token-family revocation, ownership, bounded retries, signed callback verification, and the absence of drawing payloads in durable metadata. Provider-account acceptance remains a separate live test; fixture success must not be presented as proof that an arbitrary ChatGPT, Claude, or Codex account has been connected.

Created by [Andrew Barresi](https://github.com/AndBarresi). [MIT license](../LICENSE).
