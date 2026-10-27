# Host the website and AI relay

SharedBoard has two hosted parts: the browser app at **https://sharedboard.app** and the Cloudflare relay at **https://connect.sharedboard.app**. Users work from the website and connect their existing AI through its generated remote MCP URL. No end-user application installation is part of this flow.

Drawings, images, planning details, board history, and actual mini-chat content remain in IndexedDB in each visitor’s browser profile. The relay handles connection authorization, request IDs and delivery metadata, and live board/tool traffic; selected content passes through Cloudflare when the connected AI reads or writes it. SharedBoard does not host a model. Normal hosting requests still reach Cloudflare, and this is not a claim of zero access logs.

## Build the browser app

Use Node **24.22.1** from `.node-version` and pnpm **11.25.0**:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build:web
pnpm preview:web
```

The browser build sets `VITE_STORAGE_MODE=browser` and writes `dist-web/`. The preview normally serves `http://127.0.0.1:4173/`. A preview origin has separate browser storage and must use an explicitly permitted relay configuration for integration tests.

The frontend build contains app assets, fonts, release metadata, and license notices. Never include user `data/`, credentials, captured requests, `.env` files, or development/runtime directories in it. Deploy the relay separately with its own explicit Worker configuration; do not copy private server state into static assets.

## Cloudflare Pages frontend

1. Connect the repository to a **Pages Git-integrated project**, with the repository root as the project root and framework preset **None**.
2. Set the build command to **`pnpm test && pnpm run build:web`** and the output directory to **`dist-web`**.
3. Set **`NODE_VERSION=24.22.1`** and **`PNPM_VERSION=11.25.0`** for production and preview builds.
4. Use `main` as the intended production branch. Pushes build and deploy the website; review preview rules separately.
5. Attach **sharedboard.app** through the project’s custom-domain settings and follow Cloudflare’s DNS instructions.

References: [Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/), [build image settings](https://developers.cloudflare.com/pages/configuration/build-image/), [custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/).

## Cloudflare relay

Deploy the relay’s Worker with the committed Wrangler configuration and its required bindings. Configure **connect.sharedboard.app** as its public address and **https://sharedboard.app** as the authorized browser origin. Development/test origins must be explicitly scoped, not enabled through a permissive production wildcard.

Store deployment credentials and any service secrets in Cloudflare’s secret facilities, not in browser environment variables, published JavaScript, or repository files. Deployment access belongs to the project owner; people using SharedBoard do not need Cloudflare or GitHub accounts.

The committed configuration is `cloudflare/wrangler.jsonc`. Deploy it with:

```sh
pnpm relay:deploy
```

Its Durable Object bindings are **`BOARD_RELAY` → `BoardRelay`** for scoped live board sessions and **`RELAY_AUTH` → `RelayAuth`** for authorization metadata. Wrangler applies the configured migrations. `APP_ORIGIN` and `RELAY_ORIGIN` identify the exact frontend and relay origins; keep production values scoped to the two public addresses above. `EVENT_CALLBACK_ORIGINS` starts empty, so automatic event callbacks require explicit operator-approved provider origins rather than arbitrary callback URLs.

The relay provides the hosted MCP endpoint, short-lived board pairing, scoped authorization, live browser transport, and revocation. Users ask their assistant in its existing conversation to read the board or make authorized changes. Actual captures and replies stay in browser storage; tool calls carry them through the relay as needed. Read-only board grants still permit inspection and replies.

The experimental **Live collaboration** route uses the plain model-visible **`wait_for_board_request`** tool. After pairing, the website offers **Start live collaboration · experimental** and **Copy start instructions** for the existing AI conversation. This is one setup action per start or resume, with no per-message copying, commands, helper installation, or hosted replacement model. First calls omit `sessionId`; subsequent waits reuse the exact returned ID. A wait defaults to **40 seconds**, is capped at **45 seconds**, and the session has a **20-minute hard deadline**. The browser remains authoritative for every message capture and reply; cloud state holds routing IDs and claim metadata.

Live delivery is available only while the backend observes an actual unexpired wait for that same session. New sends stay unavailable during processing, pause, expiry, cancellation, or a lost wait; preserve drafts. The website's **Pause live collaboration** control releases a pending wait and stops new delivery. An ended model turn cannot be awakened through this technique. Do not automatically restart a stopped/expired session or replay an uncertain request into a later one. Real provider acceptance of the repeating wait/read/reply loop is still outstanding; transport and storage tests alone do not verify a working client account.

Empty timeouts require further model continuations and can consume the user's subscription allowance and context. Pending HTTP waits also keep Durable Objects active, so they do not have the same hibernation savings as idle browser WebSockets. Monitor live-session duration, requests, cancellation cleanup, and aggregate costs as part of the test rollout. See [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) and [billing](https://developers.cloudflare.com/durable-objects/platform/pricing/). Keep bounded waits and honor the caller's abort signal; do not hold a storage transaction or concurrency lock across the wait.

Native incoming events are a separate route. With **`EVENT_CALLBACK_ORIGINS` empty**, the committed deployment has no configured, verified native production event path. Both the older and fresh ChatGPT Work Cloud conversations tested on this account lacked an exposed event-subscription interface. That observation does not establish support for every account or host. Only add explicit approved callback origins after reviewing and testing the intended provider. Unsupported or inactive connections must keep new sends unavailable without a manual copy fallback, while retaining saved requests and replies.

The experimental **`open_sharedboard_chat`** MCP Apps panel is diagnostic WIP, not an automatic message route and not part of the live waiting-tool flow. A native Claude test on **2026-10-27** rendered it, but **`ui/message`** only filled the composer and still required the user to press Send. Do not treat **`hostCapabilities.message.text`** or a successful RPC response as proof that the model ran or replied. See the [composer-behavior explanation in Anthropic's MCP issue tracker](https://github.com/anthropics/claude-ai-mcp/issues/33#issuecomment-3817124671) and [SharedBoard’s connection behavior](BRIDGE.md).

For development, `pnpm relay:dev` starts Wrangler on port **8787**. Its production origin defaults are still strict: a local integration requires development-only `APP_ORIGIN` and `RELAY_ORIGIN` values matching the exact preview/relay origins, plus the frontend pointing to that test relay. Do not weaken the production allowlist to make a local preview work. Verify the deployed relay before the frontend advertises a working connection; a successful static build does not prove the relay, authorization, or an AI account works.

## Browser storage and the permanent origin

IndexedDB is scoped to the full origin. **sharedboard.app, www.sharedboard.app, pages.dev, branch previews, and a local preview all have different storage.** Another browser/profile/device also starts independently. Do not redirect an old address before users can export work that exists only at that origin.

Keep one canonical production origin. To move work, export each important board on the old origin, open the new origin, and restore its `.sharedboard` backup. A backup contains one board, not every project, other board, or checkpoint.

## Security and routing

The frontend’s generated headers protect MIME handling, referrers, framing, permissions, and content sources. Its content policy must permit the designated HTTPS/WebSocket relay, with no loopback companion requirement. Fonts and drawing assets stay self-contained.

`/boards/*` must load the canonical root with a `200` rewrite. A top-level `404.html` keeps unrelated missing URLs from masquerading as application routes. User backup exports remain part of the board; application installer routes are not part of the supported product.

## Release acceptance

Use isolated browser profiles/databases and synthetic drawings, not the developer’s or a tester’s real board.

- Create a board, draw, add a note/reference, wait for saved state, reload, and reopen a direct board URL.
- Confirm a separate profile begins independently; export/import a test backup and preserve current work on rejected imports.
- Pair a real supported AI client through the website, approve the chosen board permission, and read/confirm its revision from the existing conversation.
- Test read-only inspection and replies separately from requested-edit drawing changes in the existing conversation. Keep the browser board open and confirm live changes and exact revisions.
- For Live collaboration, confirm the intended conversation discovers `wait_for_board_request`; refresh its connector/tool catalog if it is stale. Start once with the website's generated instructions. Observe an actual pending wait before enabling Send, let an empty timeout complete, and verify the same AI run re-enters the wait with its exact session ID.
- Send at least two separate mini-chat requests and an **Ask AI to look** review from the board without per-message copying, a second Send in the AI app, or hidden automation that clicks that Send. Confirm real capture reads and actual replies/review completion. Keep SharedBoard foreground with the AI app behind it for more than five minutes and repeat. A queued ID, composer draft, or panel response is not success.
- Test processing gaps, website pause, the 20-minute hard deadline, caller abort, host stop, and reconnect. Verify that Send is unavailable without an actual wait, drafts remain, terminal sessions do not restart automatically, and captured IDs never move into a replacement session. Measure subscription usage and host tool/turn limits during an idle session. **Real provider loop acceptance remains outstanding until these actual-client tests pass.**
- Test any native event route separately after operator configuration. No configured callback allowlist or successful protocol fixture alone establishes a working provider subscription.
- Check unsupported hosts, absent/expired subscriptions, offline boards, and uncertain delivery. New sends must stop without copied-message fallbacks or automatic duplicate sends. Do not advertise the diagnostic panel as an automatic path.
- Verify expiry, wrong-board isolation, revocation, reconnect, uncertain retry handling, and newer human-edit preservation.
- Cancel a board/project deletion and confirm nothing changes. Confirm deletion in a synthetic workspace, check the affected board count, target-grant revocation and snapshot/draft cleanup, and preserve unrelated boards. Delete the final board and check the blank fallback and stopped saves in another deleted-board tab. Export wanted backups before permanent deletion.
- Check the website on Windows and Mac browsers without a SharedBoard installation.

Static checks and protocol fixtures prepare for these acceptance tests; they do not replace them. See [Connections](CONNECTIONS.md), [Connection behavior](BRIDGE.md), and [Development](docs/LOCAL-DEVELOPMENT.md).
