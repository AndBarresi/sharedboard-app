# SharedBoard.app

Created by **[Andrew Barresi](https://github.com/AndBarresi)**. Project code is licensed under the [MIT License](LICENSE); third-party components retain their own licenses. [Authorship and credits](AUTHORS.md).

A persistent planning canvas for screens, ideas and app architecture. The 0.x series is a testing beta with two builds: a browser-storage website and a portable local app. The website saves each visitor's own drawing and project details in IndexedDB; AI linkage is visible WIP there. The portable local app retains its existing Codex and local MCP connections. No model is hosted by SharedBoard.app.

## Browser-storage website

The Cloudflare Pages build opens in the browser without installing or starting a local server. Drawings, image references, notes, work cards, named areas, reusable blocks, projects, checkpoints and recovery saves stay in that browser profile on that device. Other visitors receive their own empty workspace. Saved data survives ordinary reloads and site updates on the same origin. It is not synchronized between browsers or devices, and clearing site data or using a temporary/private profile can remove it.

Use **Export board** regularly to download a `.sharedboard` backup; **Restore board backup** imports it. A backup contains one board's drawing, files and planning details, rather than the whole project catalog or checkpoint history. The Storage details dialog can request persistent browser storage, subject to browser approval; exports remain the way to keep an independent copy. Data on a local preview or `pages.dev` is separate from data on `sharedboard.app` and can be moved by export/import.

Run `pnpm build:web` to produce the static `dist-web/` deployment, `pnpm preview:web` to check it on a separate loopback port, and `pnpm package:web` for a static upload ZIP. See [HOSTING.md](HOSTING.md) for GitHub-linked Cloudflare deployments, build settings and domain setup. Only static app assets are deployed. The local `data/` directory, saved drawings, grants and machine-specific settings are excluded from the source handoff and public website.

## Portable Windows testing build

Extract the entire release ZIP into a writable folder and double-click **Start SharedBoard.app.cmd**. The package includes Node, runtime dependencies, drawing assets and local start/stop controls. It creates a fresh `data/` folder beside the launchers, chooses an available loopback port and opens the browser. No Node/npm/pnpm installation, admin access, public tunnel or SharedBoard.app hosting account is required. Wait for **Saved on this computer**, then use **Stop SharedBoard.app.cmd** when finished.

Use the included **START-HERE.txt** for Codex and local MCP linking steps. Codex supports automatic queue-based messages where available; Claude Code, Cursor and other local MCP clients use **Copy to AI** and the board reply tool. An existing ChatGPT or Claude web chat does not get a live connection in this local-only build. Keep the extraction in place after pairing because AI settings reference its exact paths. Send testers the original ZIP; do not share your populated data folder.

To build a fresh archive from source, run `pnpm build` and `pnpm package:windows` on Windows. The builder downloads the pinned official Node archive if needed, verifies its checksum, copies an explicit app allowlist and the minimal backend dependency closure, includes component notices, and generates content/ZIP hashes. Runtime version and checksum are in `packaging/runtime.json`. Personal data, logs, grants and development dependencies are excluded. Distribution is a portable ZIP rather than an installer or signed executable.

## Projects, context and recovery

**Projects & boards** creates separate spaces for different apps and different parts of an app. Each board has its own drawing, notes, reusable blocks, checkpoints, automatic recovery, messages and AI connection. New boards start disconnected. Opening a board saves the current drawing first. The original board stays at `/`; additional boards have stable `/boards/<id>/` addresses on the same local app.

The top bar always offers this board's AI connection. Choose **Read only**, **Propose changes · approval required**, or **Edit when requested** when pairing. Proposal access is enforced by the board: it permits staged drawing proposals and rejects direct add/edit calls. Acceptance stays on the page. This permission controls the board, not an assistant's separate filesystem tools.

Before sending a new mini-chat message, choose **Whole board**, **Current selection**, or a **Named area**, then **Preview attachment**. Inspect the exact rendered image and included notes. Drawing, selection or planning changes make the preview stale; refresh it before sending. Already-sent requests and uncertain retries keep their original snapshot and request ID. An empty named area stays empty rather than expanding to the whole board.

Mini-chat replies support readable formatting, tables, links, literal code blocks and copy actions. Raw HTML stays text and remote Markdown images are not loaded. Resize or expand the chat; drafts, intent, unread state and pending requests remain scoped to their board. Original-board drafts migrate once. Very large unsent attachments may not fit browser storage; the UI preserves the text and request ID and asks you to check delivery before starting a fresh request.

**Objects & minimap** searches shapes, groups and references. Give an object a friendly outline name, jump to it, hide/show, lock/unlock, or move it in front/behind. Group and bound-label relationships are preserved. Hiding changes canvas visibility; it does not remove the object from saved drawing data. The minimap shows an approximate viewport and clickable objects.

**History → Automatic recovery** keeps the latest 12 recovery saves separately from named checkpoints. Ordinary saves are throttled to five minutes and identical content is deduplicated. Significant AI changes and imports get safety captures. Preview before restoring; restoring saves current work first. These saves include the drawing, notes, references and reusable blocks, and are kept on this computer.

## Plan a real change

- Open **Reusable blocks** to insert an editable mobile screen, desktop screen, form, user journey or architecture diagram. Save your own selection to the local block library.
- Use **Areas & search** or **Ctrl+K** to name a selection, bookmark a view, find drawing text, or navigate a screenshot reference. Areas belong to the current board.
- Select objects and use **Attach note** to add context, a requirement, or a work card. Notes have canvas markers and links back to their objects. Resolved notes stay available. Work cards include a result / review field; they do not automatically run code or claim work was verified.
- **Add a screenshot reference** saves a pinned image. Draw over it, and use the reference list to unlock it. Ordinary paste and the Image tool remain available.
- In **AI changes**, **Check AI understanding** sends a discussion request with the drawing and attached requirements. The connected assistant must actually respond; this is not a second built-in model.
- An AI can use **propose_changes** to stage drawing edits. A before/after comparison lets you accept or dismiss a proposal. The live drawing stays unchanged until acceptance. Overlapping edits reject the entire proposal; unrelated edits are preserved. Direct edits still work when requested.
- **Undo this AI change** reverses a recorded action only while its objects have not received later edits. Editor text measurements do not falsely block undo.
- **Checkpoints & history** saves named copies of the drawing, references and project details. Preview before restoring. A restore creates an automatic recovery save first, and checks for changes since preview. Up to 40 checkpoints are retained; remove an old one to make room.
- The selection toolbar offers notes, named areas, grouping, alignment, duplication and selection details. The board menu includes an alignment grid and all planning panels, including in fullscreen.

**Export board** downloads a `.sharedboard` backup with the current drawing, image files, areas, notes, work cards and reusable blocks. **Restore board backup** previews it and saves recovery before replacement. Each backup contains one board. Connections, private grants, chat, review requests, other boards and checkpoint history are not included. Older `.sharedboard` files remain supported. **Export drawing (.excalidraw)** remains available for interoperability and contains drawing data only.

## Versions and changelog

The footer opens **What’s new**, and the same release notes are saved in [CHANGELOG.md](CHANGELOG.md). `releases.json` is the source for the interface and MCP version. New capabilities increase the minor version (`0.2.0`); fixes increase the patch (`0.2.1`). The first public release will be `1.0.0` after acceptance testing and packaging.

After completing a logical batch of changes, record it, then build:

```text
pnpm change minor "Change title" --added "What changed" --fixed "What was fixed"
pnpm test
pnpm build
```

Use `patch` for fixes. The build checks a source fingerprint, package version and generated changelog, and fails when they no longer match. Do not restamp an old release after changing source; create the next entry. This workflow versions app changes, independently of the drawing's saved revision.

## Connect your existing AI

In the portable local app, use **Connect an AI** in the sidebar or the drawing toolbar's board menu and choose your desktop coding assistant. **Manage connection** shows separate checks for board access, message delivery and a reply, plus a disconnect action that preserves the drawing. In the hosted browser build, all connection choices remain visible WIP until browser linkage is implemented.

ChatGPT and Claude web connection choices are visible, disabled and marked **WIP**. Their startup and approval endpoints are also blocked, so bypassing the UI cannot start a tunnel. The earlier temporary web bridge remains in source for isolated development tests; it is unavailable in the distributed local beta. Stable web onboarding is a planned addition.

Codex supports automatic message handoff through its installed CLI and generated chat instructions. Claude Code, Cursor and other local MCP clients still use the generated MCP configuration and an explicit **Copy to AI** handoff. No model is run by SharedBoard.app and no replacement AI chat is created. See [connection setup and tested support](CONNECTIONS.md).

## Canvas-only view and SharedBoard.app controls

The drawing toolbar is now SharedBoard.app's own interface: tools, style palette, undo / redo, board menu, review, chat, and full screen. Use the expand icon to hide the sidebar, header and footer. Escape or the collapse icon returns to the workspace. Where the browser allows it this also requests native fullscreen; embedded browsers can keep the same canvas-only layout inside their panel. Chat is available from the toolbar on demand. Excalidraw still supplies the editor engine, text editing and keyboard shortcuts. The menu provides zoom, fit, export and import; importing adds to the current drawing.

## Board mini chat

The floating **Talk it through** bubble opens a persistent conversation panel connected to the chosen AI. The panel contains messages originating on this board and replies the agent posts back with its board tool; it does not mirror the whole external transcript or stream internal reasoning. Codex queues directly into the chosen conversation. Other configured local MCP clients use Copy to AI and the same board reply tools. ChatGPT / Claude web linkage is locked as WIP. No extra model API key or second model session is used.

Choose **Discuss** to ask for inspection / explanation, or **Request work** to authorize the specific work described in your message. The message includes a saved snapshot of the board or selection. The agent must read it, perform only the requested work, and post its answer with `node server/agent-cli.mjs reply <json-file>` containing `{ "id": "<message-id>", "text": "<answer>" }`. It can read with `chat <message-id>` and list with `chats`; equivalent MCP tools are included. A message can wait until the current Codex turn finishes. Delivery, reading and reply states are distinct. Reconnecting reloads persisted messages. A failed or uncertain delivery is visible and can be retried; successful deliveries are not resent automatically.

`data/agent-target.json` is managed by the connection flow. It is not a published default; private target details, pairing state and agent grants in the data folder must be excluded from distribution. Stable hosting, directory installation and testing inside actual ChatGPT / Claude accounts remain publishing work.

## Open it

On this computer, double-click **Start Board.cmd**, or open **http://127.0.0.1:4317/** if the app is already running. The launcher starts a hidden local server. **Stop Board.cmd** stops that server; close or save any active drawing first.

The original board is saved automatically in `data/board.json` with its previous file in `data/board.json.bak`. Planning details live in `data/planning.json`; checkpoint snapshots live in `data/checkpoints`. `data/workspaces.json` indexes projects and boards; additional boards have independent stores under `data/boards/<id>`. Export a board backup for portability, or preserve the whole data folder to move all boards and local settings. Clearing browser storage does not remove server-saved data.

## Ask the agent to look

Click **Ask AI to look** in the top bar. With objects selected, it requests a review of those objects and their bound labels. With nothing selected, it requests the whole board. The app finishes saving first and captures that exact revision, so further drawing does not change the request.

On this machine, the button queues a message to our existing Codex chat using the installed CLI's `codex queue` command. An active task may finish before the queued request is handled. The board shows **Waiting for AI** after Codex accepts delivery, **AI is reviewing** after the agent reads the snapshot, and **AI reviewed your board** after the agent acknowledges completion. The response appears in chat, and a concise summary is available on the board.

The button asks the agent to inspect and explain. It does not authorize changing shapes or generating code. Ask for those actions separately. Delivery failures stay visible with a retry button. Repeated requests for the same saved revision and selection are deduplicated while pending.

This connection is configured locally in ignored `data/agent-target.json` with `threadId` and an absolute `codexPath`. It uses the currently installed Codex CLI, without modifying global settings. A different machine needs its own target configuration and a CLI version that supports `queue`. The CLI interface is an integration dependency; each host must be tested before claiming notification delivery.

Agent commands:

```text
node server/agent-cli.mjs reviews
node server/agent-cli.mjs review <request-id>
node server/agent-cli.mjs complete_review path/to/acknowledgement.json
```

An acknowledgement file contains `{"id":"request-id","summary":"What was reviewed"}`. Requests persist in `data/review-requests.json`, separate from the drawing. These snapshots are private project data and must not be published.

## Our first test

1. Draw a rectangle, add text, or use **Add a practice sketch** (the **+ Sketch** button in a narrow window).
2. Wait for **Saved on this computer**.
3. Tell the agent in chat what to change. Selecting an object helps identify it.
4. Watch the agent's change appear on the same canvas without refreshing.
5. Change it yourself, then ask the agent to read your change.
6. Reopen the page to verify persistence.

Different objects can be edited concurrently. If the same object changes on both sides, the browser preserves its local drawing and asks whether to keep your edits or use the saved version. Export is available before choosing. This is an early conflict-handling mechanism, not a fully developed multi-person collaboration system.

## Agent access available immediately

The local command-line helper uses the same API as the MCP server, so an agent with terminal access can use it in the current session without installing a new connector.

From this project directory:

```text
node server/agent-cli.mjs read
node server/agent-cli.mjs read_full
node server/agent-cli.mjs add path/to/addition.json
node server/agent-cli.mjs edit path/to/edit.json
```

Example addition file:

```json
{
  "elements": [
    { "type": "rectangle", "x": 100, "y": 100, "width": 260, "height": 140, "text": "Our shared idea", "backgroundColor": "#e0f0dc" }
  ],
  "summary": "Agent added a shared idea"
}
```

Example edit file (replace the ID and version using the latest `read`):

```json
{
  "edits": [
    { "id": "object-id-from-read", "expectedVersion": 3, "changes": { "x": 240, "backgroundColor": "#fff0cd" } }
  ],
  "summary": "Agent moved and recolored the box"
}
```

The summary read returns each object's `editVersion`, named areas, notes and requirements. A full read returns `elementVersions`. Moving/deleting a container also moves/deletes its bound text. Change the label object to change a box's text. Lines and arrows can be created, but the simplified agent tool does not yet expose bound arrow endpoints. The editor itself supports bound arrows, freehand drawing, images, text, and other native Excalidraw features.

`view_board` returns a PNG rendered by the open browser, with its revision and a stale flag. Review and mini-chat reads attach the image captured at send time plus immutable planning context. These images supply vision input; they do not establish that a particular model has interpreted a sketch correctly. The CLI can save the latest image with `snapshot path/to/board.png`; captured chat/review images are saved under private `data/captures` and returned as paths. A stale preview is explicitly marked. No browser means no new rendered preview.

Stage a proposal with `node server/agent-cli.mjs propose path/to/proposal.json`. Its payload has `title`, `summary`, and `elements` and/or `edits` with the same formats as add/edit. Only the page can accept it; no agent acceptance tool is exposed.

## MCP connection

The prototype includes a tested stdio MCP server exposing `read_board`, `add_elements`, and `edit_elements`. Start the app first, then configure the host to launch:

```text
node /absolute/path/to/shared-board/server/mcp.mjs
```

For Codex, add this to the appropriate MCP configuration, replacing the paths with real absolute paths (use forward slashes in TOML):

```toml
[mcp_servers.shared_board]
command = "C:/absolute/path/to/node.exe"
args = ["C:/absolute/path/to/shared-board/server/mcp.mjs"]
```

Reconnect or restart the host as required to discover the new tools. The prototype does not modify your global Codex settings. The current chat can use the local helper immediately. `data/.connection.json` and `data/.token` are private runtime files; do not publish or paste them into chat.

## Development setup

Requires Node.js 22.12+ and pnpm 11.25.0. Dependencies and a production build are already present on the original development machine.

```text
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm start
```

Use `pnpm dev` for a development server with live frontend updates. Bindings are loopback-only. The app validates host/origin and uses a local token for the editing API. It has no external AI service, model subscription, cloud storage, account system, or LAN sharing.

The frontend's fonts are served locally. A browser may still make external requests when you explicitly use Excalidraw's library links or external embeds.

## Project status and next step

The next milestones are hands-on feedback on the expanded workflow, connection ease-of-use tests in actual ChatGPT / Claude accounts and friends' other supported clients, then first-release packaging. Live voice, hosted multi-user collaboration, typed architecture relationships and automatic code-result verification are not implemented. Model interpretation accuracy still needs real drawing tests; structured geometry and a rendered PNG are inputs to those tests.

Board services stay isolated inside the local app process. Browser requests use each board's stable path and private token. Local MCP setup pins WHITEBOARD_DATA_DIR to one board; helper instructions use `--data-dir` for that same directory. Switching the browser board never retargets an existing grant or an in-flight request. The app closes child board listeners when it stops.

For distribution, keep application source and the dependency lockfile, and exclude `node_modules`, `data`, logs, and local runtime directories. Rebuild on the target machine. Excalidraw is MIT-licensed; retain its notices and review third-party license requirements before any release. No license for our new application code has been selected yet.

## References

- [Excalidraw editor and source](https://github.com/excalidraw/excalidraw)
- [Excalidraw MIT license](https://github.com/excalidraw/excalidraw/blob/master/LICENSE)
- [Excalidraw integration API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api)
- [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/)
