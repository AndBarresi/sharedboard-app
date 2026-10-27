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

The relay provides the hosted MCP endpoint, short-lived board pairing, scoped authorization, live browser transport, revocation, and an optional host-mounted MCP Apps conversation panel. The **`open_sharedboard_chat`** tool opens that panel in the existing AI conversation. It checks **`hostCapabilities.message.text`** before enabling **Link this chat**. The linked panel forwards queued request IDs through the host’s user-message API while the panel and browser board remain open. Actual captures and replies stay in browser storage; tool calls carry them through the relay as needed. Read-only board grants still permit replies.

The no-copy message flow needs host support and a real client/account acceptance test. Ordinary remote MCP tools in local Codex or Claude Code do not independently wake an idle session. Do not expose a manual copy fallback for new messages when direct delivery is unavailable, and do not advertise all clients as supporting panel messages. Existing saved requests and replies remain readable. MCP Events for ChatGPT Work Cloud are a separate possible delivery route; with **`EVENT_CALLBACK_ORIGINS` empty**, they are not configured or verified as an active deployment feature. Only add explicit approved callback origins after reviewing and testing the intended provider.

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
- Pair a real supported AI client through the website, approve the chosen board permission, read/confirm its revision, and return an actual mini-chat reply.
- Open the connection panel in that same conversation, verify text messaging, click **Link this chat**, send from the board without copying the message, and confirm the assistant posts its actual answer back. Test read-only and requested-edit grants separately.
- Check unsupported hosts, panel closure/pause/expiry, offline boards, and uncertain delivery. New messages must stop without copied-message fallbacks or automatic duplicate sends. Test any separately configured MCP Events route on its own; a delivery acknowledgement is not an AI answer.
- Verify expiry, wrong-board isolation, revocation, reconnect, uncertain retry handling, and newer human-edit preservation.
- Cancel a board/project deletion and confirm nothing changes. Confirm deletion in a synthetic workspace, check the affected board count, target-grant revocation and snapshot/draft cleanup, and preserve unrelated boards. Delete the final board and check the blank fallback and stopped saves in another deleted-board tab. Export wanted backups before permanent deletion.
- Check the website on Windows and Mac browsers without a SharedBoard installation.

Static checks and protocol fixtures prepare for these acceptance tests; they do not replace them. See [Connections](CONNECTIONS.md), [Connection behavior](BRIDGE.md), and [Development](docs/LOCAL-DEVELOPMENT.md).
