# SharedBoard.app changelog

## 0.11.1 — Independent native event renewals

### Fixed

- Renew mini-chat and board-review subscriptions concurrently without invalidating the other event.
- Commit subscription changes and accepted delivery receipts atomically, and preserve renewed leases when an older callback returns late.

## 0.11.0 — Automatic ChatGPT Work Cloud collaboration

### Added

- Set up native ChatGPT Work Cloud event tasks once, then receive mini-chat replies and board reviews on the website after the AI setup turn ends.
- Keep the next draft while a native mini-chat answer is pending, with the same protection across browser tabs.

### Fixed

- Verify the approved OpenAI callback using a correctly bound native fetch in Cloudflare Workers.
- Require a complete board reply for every delivered message, including batched event requests, and preserve matching tasks during setup.

## 0.10.7 — Fix native callback delivery on Cloudflare

### Fixed

- Invoke the native callback fetch function without an incorrect receiver so signed verification and event delivery can reach the provider.

## 0.10.6 — Configure the observed OpenAI event callback

### Fixed

- Allow the exact OpenAI callback origin observed during a real native event activation; signed challenge verification and board-scoped authorization remain required.

## 0.10.5 — Diagnose native event activation safely

### Fixed

- Connection diagnostics distinguish native event activation attempts from discovery and report fixed outcomes without storing private callback paths, signing keys or request content.

## 0.10.4 — Keep chat drafts accessible while the AI is busy

### Fixed

- Active live sessions keep the chat bubble and toolbar chat available for drafting between waits; sending still requires an actual listener.

## 0.10.3 — Reliable live-session pause and clearer review status

### Fixed

- Pausing during wait activation settles the exact pending consumer and preserves earlier request claims.
- Keep the mini-chat title stable while the AI is busy and show accepted review requests without directing users away from the board.

## 0.10.2 — Preserve new chat drafts and diagnose transport failures

### Fixed

- Completing an earlier send preserves newer text typed in the mini-chat composer.
- Live waits distinguish relay transport and response failures using private-data-safe diagnostic codes.

## 0.10.1 — Live-session cancellation and connection diagnostics

### Fixed

- Propagate cancelled requests through the hosted relay and report fixed diagnostic codes without exposing private error details.
- Pairing instructions start an explicitly authorized finite live session and explain its time and usage limits.

## 0.10.0 — Experimental live AI collaboration

### Added

- An experimental live session lets a compatible AI wait for mini-chat and board-review requests during an active conversation turn.
- Live session status and Pause controls keep requests tied to the correct board and session.

### Fixed

- Drafts remain available while an AI is busy; sending requires an actual pending wait or verified incoming-event connection.

## 0.9.3 — Retire stale experimental panel links

### Fixed

- Previously opened panels now pause automatically instead of renewing an unverified delivery link; their saved request and receipt history stays intact.

## 0.9.2 — Verify model receipt and report automatic-chat limits

### Fixed

- A real Claude test showed that conversation panels fill a draft without submitting it; keep automatic mini chat and board reviews unavailable until a verified incoming-message route exists.
- Separate panel acknowledgement from an actual model read or reply, including older saved receipt checks.
- Preserve captured request IDs and replies, block cached panels from forwarding or replaying requests, and show accurate connection availability.

## 0.9.1 — Conversation panel lifecycle checks

### Fixed

- Hardened the experimental diagnostic panel against stale views and closing conversation windows.

## 0.9.0 — Confirmed workspace deletion and conversation diagnostics

### Added

- Delete boards or whole projects from the workspace picker, with a named confirmation and affected-board count.
- Added experimental conversation-panel diagnostics to check whether an AI app accepts text and actually starts a response.

### Fixed

- Require an active direct-chat route before sending; preserve drafts and original request IDs when a link expires, with no per-message copy-and-paste fallback.
- Revoke affected board connections before deletion, preserve unrelated work, and prevent deleted tabs from restoring removed boards.

## 0.8.2 — Clarify drawing access and saved replies

### Fixed

- Clarified drawing edit permissions and reconnect instructions for connected AI clients.
- Preserved saved conversations independently of drawing edit permission.

## 0.8.1 — Preserve unconfirmed mini-chat drafts

### Fixed

- Keep pending text, captured context and original request IDs until a queued-delivery receipt or actual reply confirms acceptance, including connection expiry during sending.

## 0.8.0 — Clear client capabilities and verified mini chat

### Added

- Codex and Claude Code lead the connection choices, with distinct mini-chat availability labels and website-led Claude Code setup.

### Fixed

- Added connection checks and preserved saved requests and replies when automatic delivery is unavailable.
- Used separate chat and review expiry deadlines for delivery routing, including safe retries after subscription expiry.

## 0.7.6 — Consistent UI spacing and compact layouts

### Fixed

- Simplified AI provider choices and separated connection help from setup actions, with consistent instruction and field sizing.
- Kept modal headings and close controls visible, wrapped long titles, and stacked narrow-screen action buttons.
- Improved short-window canvas, object navigator, chat setup, and toolbar menus so controls stay clear of nearby elements.

## 0.7.5 — Discover events and clarify connection setup

### Fixed

- AI clients can discover board event types after approval and before pairing; subscribing still requires pairing.
- Connection errors use the selected AI flow, backup guidance uses the correct menu label, and retired helper instructions are removed from earlier changelog entries.

## 0.7.4 — Recover expired connection setup

### Fixed

- Preparing a fresh connection recovers when the previous pending code has expired, while preserving existing access on uncertain network failures.

## 0.7.3 — Reliable message and review delivery checks

### Fixed

- Handled chat and review event subscriptions independently, preserving safe retries when one subscription expires.
- Verified message receipt only after the AI successfully reads its captured request, separately from its eventual reply.

## 0.7.2 — Consistent deployment sources

### Fixed

- Normalized release sources for matching Windows development and Cloudflare builds, and corrected the version-recording command.

## 0.7.1 — Clearer browser connection setup

### Fixed

- Added provider-specific setup steps inside the website and kept copied pairing instructions active when closing setup.

## 0.7.0 — Website-only AI connections

### Added

- Connect an existing AI client through the hosted Cloudflare relay, without downloading a SharedBoard helper.
- Approve board-scoped read or edit access in the browser and keep drawings, images, notes, history and chat saved locally.
- Remote MCP tools read and edit the live board, review captured context, and return actual replies to the mini chat.

### Fixed

- Retired native installers, launcher downloads and their release workflow, and rewrote historical notes for removed features.
- Preserved existing browser work while separating and retiring local bridge credentials.

## 0.6.2 — Keep planning navigation in one place

### Fixed

- Use the sidebar as the single planning navigation on desktop, while keeping panel tabs when compact or fullscreen layouts hide the sidebar.

## 0.6.1 — Compact workspace polish

### Fixed

- Use the space freed by consolidated controls to keep the board title readable in compact windows.

## 0.6.0 — Clearer planning and conversation controls

### Added

- Explicit handoff of saved board requests, with captured context and actual replies kept with the board.

### Fixed

- Consolidated workspace controls and moved browser storage details into the board menu, with fullscreen and compact-screen access preserved.
- Removed obsolete feature claims and the version-numbering introduction from the changelog.
- Validated backup previews before rendering, protected file selection order, and corrected review context and delivery states.

## 0.5.0 — Board context and AI collaboration

### Added

- Two-way browser mini chat, exact-revision board tools, rendered context, read/edit permissions, and browser-saved AI history with safe undo.

### Fixed

- Reliable delivery receipts, durable retry IDs, cross-tab ownership and deadlines preserve browser data through disconnections and uncertain responses.

## 0.4.1 — Reliable board bookmarks on Cloudflare

### Fixed

- Use the canonical root for saved-board URL rewrites so Cloudflare accepts direct board links.

## 0.4.0 — Browser beta and public source publishing

### Added

- Browser-storage edition for static hosting: drawings, images, projects, notes, blocks, checkpoints and recovery in IndexedDB.
- Cloudflare Pages build and GitHub deployment workflow, with self-contained assets, backups and browser storage controls.
- Creator attribution for Andrew Barresi and public source distribution under the MIT license.

### Fixed

- Removed publish dates from the changelog and protected browser imports and cross-tab startup updates.

## 0.3.5 — SharedBoard.app branding

### Fixed

- Use SharedBoard.app throughout the interface, AI tools, documentation and release metadata.

## 0.3.4 — Preserve labeled shapes during AI text edits

### Fixed

- Apply shape text changes to their visible bound labels while preserving the requested frame dimensions.
- Reject stale shape edits after a person changes its label, preserve compound label edits and keep AI undo available after browser text wrapping.

## 0.3.3 — Dependency and build validation

### Fixed

- Complete exact-version third-party notice coverage for bundled drawing components and fonts.
- Reject linked first-party files before building and verify assets, dependency notices and build content hashes.

## 0.3.0 — Separate projects and clearer AI collaboration

### Added

- Separate projects and boards with stable board addresses and independent drawings, planning, messages, history and AI connections.
- Explicit mini-chat attachment previews for the board, a selection or a named area, with captured images and requirements.
- An object outline and clickable minimap with naming, search, visibility, locking and layer controls.
- Rolling automatic recovery saves before significant changes, with preview and restore separate from named checkpoints.
- Formatted chat replies, tables, safe links, copyable code blocks, resizable chat and board-specific drafts.
- A compact workspace sidebar, visible AI connection status and expanded chat that remains readable in short windows.

### Fixed

- Board switching keeps grants and in-flight requests pinned to the original board.
- Context previews and pending-review deduplication respect planning changes and empty named areas.
- Renaming an unopened board persists correctly, and app shutdown also closes boards still starting.
- Restore safety saves use automatic history without consuming named checkpoint slots.

## 0.2.1 — Reliable starting actions

### Fixed

- Empty-canvas buttons receive clicks above the editor input layer.

## 0.2.0 — A workspace for real app planning

### Added

- Named areas, project naming, board text search and a collapsible planning navigator.
- Anchored notes, requirements and work cards with canvas markers and jump-to-context actions.
- Pinned screenshot references, five editable planning templates and a personal reusable block library.
- Named checkpoints with previews and recovery saves, plus portable .sharedboard project backups.
- Rendered board images and captured visual context for AI tools, alongside immutable notes and requirements.
- Contextual selection controls, grouping, alignment, duplication, locking, an alignment grid and a guided empty canvas.

### Fixed

- AI text edits stay centered in their existing cards; editor text measurements no longer falsely block AI undo.
- Drawing imports retain groups and remap frame references. Rejected stale chat sends can capture the current board on retry.

## 0.1.1 — A versioned workspace

### Added

- A version badge and an in-app changelog accessible from the footer.
- A release workflow that keeps the application version and changelog together.

## 0.1.0 — Shared editing foundation

### Added

- A persistent canvas with shared human and AI editing, conflict detection and drawing import/export.
- Sharedboard drawing controls, fullscreen, board reviews and a floating mini chat.
- Guided pairing with an existing AI conversation.

