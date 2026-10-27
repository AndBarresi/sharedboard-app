# SharedBoard.app changelog

Version 0.x is the development series. Minor versions add capabilities; patch versions fix or polish existing behavior. Version 1.0 will mark the first public release.

## 0.4.0 — Browser beta and public source publishing

### Added

- Browser-storage edition for static hosting: drawings, images, projects, notes, blocks, checkpoints and recovery in IndexedDB.
- Cloudflare Pages build and GitHub deployment workflow, with self-contained assets, backups and browser storage controls.
- Creator attribution for Andrew Barresi and public source distribution under the MIT license.

### Fixed

- AI connections remain clearly marked WIP in the hosted edition while local connections continue in the portable app.
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

## 0.3.1 — More reliable web connection startup

### Fixed

- Allow extra startup time for new connector addresses to resolve and show DNS wait progress.
- Report specific DNS, TLS, HTTP and metadata verification failures instead of blaming the network.
- Cancel in-flight connection checks promptly and close temporary routes after failed verification.

## 0.3.0 — Separate projects and clearer AI collaboration

### Added

- Separate projects and boards with stable local addresses and independent drawings, planning, messages, history and AI connections.
- Explicit mini-chat attachment previews for the board, a selection or a named area, with captured images and requirements.
- An object outline and clickable minimap with naming, search, visibility, locking and layer controls.
- A proposals-only AI permission enforced for local helpers and the web connector.
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
- The AI understanding check copies the handoff for connections that require manual delivery.

## 0.2.0 — A workspace for real app planning

### Added

- Named areas, project naming, board text search and a collapsible planning navigator.
- Anchored notes, requirements and work cards with canvas markers and jump-to-context actions.
- Pinned screenshot references, five editable planning templates and a personal reusable block library.
- Reviewable AI drawing proposals with before/after previews, conflict checks and protected AI undo.
- Named checkpoints with previews and recovery saves, plus portable .sharedboard project backups.
- Rendered board images and captured visual context for AI tools, alongside immutable notes and requirements.
- Contextual selection controls, grouping, alignment, duplication, locking, an alignment grid and a guided empty canvas.

### Fixed

- AI text edits stay centered in their existing cards; editor text measurements no longer falsely block AI undo.
- Drawing imports retain groups and remap frame references. Rejected stale chat sends can capture the current board on retry.

## 0.1.1 — A versioned workspace

### Added

- A version badge and an in-app changelog accessible from the footer.
- A release workflow that keeps the application, MCP tools and changelog versions together.

## 0.1.0 — Shared editing foundation

### Added

- A persistent local canvas with shared human and AI editing, conflict detection and drawing import/export.
- Sharedboard drawing controls, fullscreen, board reviews and a floating mini chat.
- Guided AI pairing and a temporary ChatGPT / Claude connector for account testing.

