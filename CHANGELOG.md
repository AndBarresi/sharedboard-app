# SharedBoard.app changelog

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
- Supported Work Cloud clients can subscribe to board events after their callback is verified; other clients use Copy to AI.

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

- Board switching keeps grants and in-flight requests pinned to the original board; helper instructions target the correct board directory.
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

