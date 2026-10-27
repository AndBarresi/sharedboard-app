# SharedBoard.app changelog

## 0.6.1 — Native Mac launcher compatibility and compact workspace polish

### Fixed

- Build the Mac companion with a native launcher targeting macOS 13.5, and validate platform paths and preserved download metadata accurately.
- Use the space freed by consolidated controls to keep the board title readable in compact windows.

## 0.6.0 — Windows and Mac bridge setup from the website

### Added

- SharedBoard Bridge downloads and guided setup for Windows, Apple Silicon Macs and Intel Macs, including on-page installation help and a real reply test.
- Copy-to-Codex handoff when automatic delivery is unavailable, with captured requests and real replies kept in the browser board.

### Fixed

- Consolidated workspace controls and moved browser storage details into the board menu, with fullscreen and compact-screen access preserved.
- Removed obsolete feature claims and the version-numbering introduction from the changelog.
- Validated backup previews before rendering, protected file selection order, and corrected review context and delivery states.

## 0.5.1 — Verify Windows bridge installation across environments

### Fixed

- Validate Windows installer paths using their canonical filesystem identity so shortened profile paths pass the release checks.

## 0.5.0 — Connect the hosted board to your local Codex chat

### Added

- Windows SharedBoard Bridge and guided webpage setup for pairing an existing Codex conversation without editing configuration files.
- Two-way browser mini chat, exact-revision board tools, rendered context, read/edit permissions, and browser-saved AI history with safe undo.
- Bundled-runtime bridge installer, Open bridge link, and versioned GitHub downloads.

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

- Use SharedBoard.app throughout the interface, AI tools, launchers, documentation, release metadata and portable ZIP filenames.

## 0.3.4 — Preserve labeled shapes during AI text edits

### Fixed

- Apply shape text changes to their visible bound labels while preserving the requested frame dimensions.
- Reject stale shape edits after a person changes its label, preserve compound label edits and keep AI undo available after browser text wrapping.

## 0.3.3 — Complete portable package validation

### Fixed

- Complete exact-version third-party notice coverage for bundled drawing components and fonts.
- Reject linked first-party files before packaging and verify runtime, asset, notice and content hashes.

## 0.3.2 — SharedBoard.app local testing package

### Added

- Portable Windows x64 ZIP with a verified bundled Node runtime, double-click launch/stop controls and tester setup guide.

### Fixed

- Rename the application to SharedBoard.app while preserving existing boards, tool IDs and backup compatibility.
- Keep ChatGPT and Claude web connectors visible but locked as WIP in both the interface and backend.
- Isolate each extracted copy and exclude personal boards, chats, credentials and developer dependencies from distribution.

## 0.3.0 — Separate projects and clearer AI collaboration

### Added

- Separate projects and boards with stable local addresses and independent drawings, planning, messages, history and AI connections.
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

- A persistent local canvas with shared human and AI editing, conflict detection and drawing import/export.
- Sharedboard drawing controls, fullscreen, board reviews and a floating mini chat.
- Guided pairing with an existing local AI conversation.

