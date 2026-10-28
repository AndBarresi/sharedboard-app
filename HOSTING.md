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

Its Durable Object bindings are **`BOARD_RELAY` → `BoardRelay`** for scoped live board sessions and **`RELAY_AUTH` → `RelayAuth`** for authorization metadata. Wrangler applies the configured migrations. `APP_ORIGIN` and `RELAY_ORIGIN` identify the exact frontend and relay origins; keep production values scoped to the two public addresses above. `EVENT_CALLBACK_ORIGINS` includes the observed and approved OpenAI origin **`https://connectors.api.openai.com`**. Add another provider only after reviewing and testing its exact HTTPS callback origin; do not accept wildcards or arbitrary user-supplied destinations. Callback paths and signing secrets belong to the AI host and must not appear in source, browser assets, or diagnostic logs.

The relay provides the hosted MCP endpoint, short-lived board pairing, scoped authorization, live browser transport, and revocation. Users ask their assistant in its existing conversation to read the board or make authorized changes. Actual captures and replies stay in browser storage; tool calls carry them through the relay as needed. Read-only board grants still permit inspection and replies.

### Recommended: ChatGPT Work Cloud native events

The website's initial pairing instructions ask ChatGPT Work with Cloud selected to pair, read, and confirm the intended board, then create or update two native event tasks sequentially: **`sharedboard.message.created`** followed by **`sharedboard.review.requested`**. Each task uses the exact authorized board filter and connected source/account. Matching tasks are reused with the current delivery prompt while preserving their source, account, board filter, and enabled state; setup must not create duplicates or silently enable a paused task. These are host event tasks, not time-based schedules or a waiting loop. The host supplies the callback URL and signing secret.

Signed callback verification has passed on the approved OpenAI origin. The native fetch receiver regression is covered in workerd, alongside protocol fixtures. Inspect safe `eventActivation` outcomes, fixed reasons, and sanitized callback origins when diagnosing activation; do not expose private callback URLs or secrets. Ordinary MCP tool discovery alone cannot establish whether the AI host exposes native event-task controls.

New sends require the corresponding actual active subscription and its deadline, rather than a ChatGPT label or completed pairing. Queuing an event, acknowledging delivery, reading a capture, and posting an answer are separate states. Every unanswered mini-chat ID must receive its complete actual answer through `reply_to_chat_message`; an AI-chat-only answer does not complete delivery. Discuss permits that reply while forbidding drawing or code work. Batches require a separate answer for every captured ID, skipping only an actual existing `message.reply`. The native pending-reply guard retains an editable next draft and disables Send until the actual previous reply arrives. Reply-driven unlock with that draft intact has passed an actual production client test.

Actual account tests have verified native wakeup after the setup turn ended, real mini-chat replies, and review completion with AI browser tabs closed and no timed wait active. The production 0.11.0 page preserved its unchanged empty revision-3 board, connection, and history through reload. An actual reply returned after more than ten minutes with AI tabs closed; the next preserved draft was sent after Send unlocked, but its answer is still unconfirmed. A burst required a website-requested task-prompt repair to return missing actual replies without drawing changes. Fresh one-time setup, sleep/reconnect, long-term host renewal, other accounts/providers, and a full editing workflow remain unverified. This is a tested beta route, not a claim of permanent connectivity or universal provider support.

Eighteen isolated lifecycle tests pass for concurrent independent renewals, scoped/full revocation, signing-key rotation, late 410 responses, and receipt preservation. Keep this server evidence separate from actual host renewal, which has not yet been observed over the long term.

The browser board must remain open and reachable. SharedBoard does not host or substitute a model or include an AI subscription. The AI provider controls native task execution and model settings, so tasks are not guaranteed to use the model manually selected in a conversation.

### Other clients: finite Live collaboration · experimental

The experimental **Live collaboration** route uses the plain model-visible **`wait_for_board_request`** tool. After pairing, other clients receive **Start live collaboration · experimental** and **Copy start instructions** for the existing AI conversation. This is one setup action per start or resume, with no per-message copying, commands, helper installation, or hosted replacement model. First calls omit `sessionId`; subsequent waits reuse the exact returned ID. A wait defaults to **40 seconds**, is capped at **45 seconds**, and the session has a **20-minute hard deadline**. The browser remains authoritative for every message capture and reply; cloud state holds routing IDs and claim metadata.

Live delivery is available only while the backend observes an actual unexpired wait for that same session. New sends stay unavailable during processing, pause, expiry, cancellation, or a lost wait; preserve drafts. The website's **Pause live collaboration** control releases a pending wait and stops new delivery. An ended model turn cannot be awakened through this technique. Do not automatically restart a stopped/expired session or replay an uncertain request into a later one. Real provider acceptance of the repeating wait/read/reply loop is still outstanding; transport and storage tests alone do not verify a working client account.

Empty timeouts require further model continuations and can consume the user's subscription allowance and context. Pending HTTP waits also keep Durable Objects active, so they do not have the same hibernation savings as idle browser WebSockets. Monitor live-session duration, requests, cancellation cleanup, and aggregate costs as part of the test rollout. See [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) and [billing](https://developers.cloudflare.com/durable-objects/platform/pricing/). Keep bounded waits and honor the caller's abort signal; do not hold a storage transaction or concurrency lock across the wait.

Unsupported or inactive connections must keep new sends unavailable without a manual copy fallback, while retaining saved requests, replies, and drafts. Native events and finite waiting are separately verified capabilities; do not silently substitute one after an uncertain delivery or create a replacement session to replay a captured request.

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
- Complete a fresh ChatGPT Work Cloud setup using only the website's one-time instructions. Verify pair/read/confirm and exactly two sequential native event tasks. Reusing tasks must update the delivery prompt without changing their exact source/account/board filter or enabled state; do not create duplicates or time schedules.
- End the setup turn and close AI browser tabs. Send at least two separate mini-chat requests and an **Ask AI to look** review from SharedBoard without per-message copying, a second Send in the AI app, or hidden clicks. Confirm real captured-request reads and actual board replies/review completion with no active timed wait. A queued ID, composer draft, panel response, or AI-chat-only answer is not success.
- Preserve the native pending-reply guard verified in production: keep the next draft editable, prevent a second request while the first lacks its actual reply, leave reading-only status pending, and unlock after the actual reply without losing text. Continue the sent next-message check until its actual answer is confirmed. Do not overwrite an existing answer, fabricate completion, or replay uncertain work.
- The production page reload, more-than-ten-minute AI-tabs-closed message delivery, and draft-guard/unlock checks have passed. Exercise sleep/reconnect, absent or expired subscriptions, and actual host renewal separately. Fresh one-time setup, a full editing workflow, multiday renewal, and other accounts/providers still require proof. Lifecycle fixtures do not establish those outcomes.
- For experimental finite Live collaboration, confirm the intended conversation discovers `wait_for_board_request`; refresh its connector/tool catalog if stale. Observe an actual pending wait before enabling Send, let an empty timeout complete, and verify the same AI run re-enters the wait with its exact session ID. Repeat actual message and review delivery, including a background period.
- Test finite processing gaps, website pause, the 20-minute hard deadline, caller abort, host stop, and reconnect. Verify that Send is unavailable without an actual wait, drafts remain, terminal sessions do not restart automatically, and captured IDs never move into a replacement session. Measure subscription usage and host tool/turn limits during an idle session. **Real provider finite-loop acceptance remains incomplete until these actual-client tests pass.**
- Check unsupported hosts, absent/expired subscriptions, offline boards, and uncertain delivery. New sends must stop without copied-message fallbacks or automatic duplicate sends. Do not advertise the diagnostic panel as an automatic path.
- Verify expiry, wrong-board isolation, revocation, reconnect, uncertain retry handling, and newer human-edit preservation.
- Cancel a board/project deletion and confirm nothing changes. Confirm deletion in a synthetic workspace, check the affected board count, target-grant revocation and snapshot/draft cleanup, and preserve unrelated boards. Delete the final board and check the blank fallback and stopped saves in another deleted-board tab. Export wanted backups before permanent deletion.
- Check the website on Windows and Mac browsers without a SharedBoard installation.

Static checks and protocol fixtures prepare for these acceptance tests; they do not replace them. See [Connections](CONNECTIONS.md), [Connection behavior](BRIDGE.md), and [Development](docs/LOCAL-DEVELOPMENT.md).
