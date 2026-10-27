# Local development & agent tools

[← SharedBoard.app overview](../README.md) · [Connections](../CONNECTIONS.md) · [Hosting](../HOSTING.md)

This guide covers the earlier disk-backed portable local app and its developer tooling. The current product is the browser-storage website with the local Codex bridge for Windows and Mac; follow [BRIDGE.md](../BRIDGE.md) for that setup. The legacy MCP and proposal interfaces below are retained for existing local installations and development, not advertised as released website capabilities. Website storage and deployment rules are in [HOSTING.md](../HOSTING.md). SharedBoard.app does not host a model or create a replacement AI conversation.

## Start a local build

### Portable Windows testing ZIP

1. Extract the entire ZIP into a writable folder.
2. Double-click **Start SharedBoard.app.cmd**. It starts a hidden local service, chooses an available loopback port, and opens the browser.
3. Wait for **Saved on this computer** before stopping the app with **Stop SharedBoard.app.cmd**.

The package includes Node, runtime dependencies, drawing assets, start/stop controls, and **START-HERE.txt**. It needs no separate Node/pnpm installation or administrator access. Closing the browser does not stop the service. Keep the extraction at the same path after pairing, because AI settings reference its exact paths. Send testers the original release ZIP, never your populated `data/` folder.

### Source checkout

Use the Node version pinned in [`.node-version`](../.node-version), currently **24.22.1**, and pnpm **11.25.0**. The supported Node minimum is recorded in [package.json](../package.json).

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm start
```

Use `pnpm dev` for frontend live updates. The source checkout also has **Start Board.cmd** and **Stop Board.cmd** launchers. Its normal local address is `http://127.0.0.1:4317/`; use the address shown by your running instance if the port differs.

The local service binds to loopback, validates host/origin, and authenticates editing requests with a private token. It provides no account system or LAN sharing. Fonts are served locally; external links or embeds can make browser requests when explicitly used.

## Storage and board isolation

| Location | Local app data |
| --- | --- |
| `data/board.json` and `data/board.json.bak` | Original drawing and its previous file |
| `data/planning.json` | Original board's notes, areas, library, and planning history metadata |
| `data/checkpoints/` | Named checkpoint snapshots |
| `data/workspaces.json` | Project and board catalog |
| `data/boards/<id>/` | Independent stores for additional boards |
| `data/review-requests.json` and `data/captures/` | Private captured requests and rendered context |

**Projects & boards** creates separate spaces. The original board stays at `/`; additional boards use `/boards/<id>/`. Each local board has its own drawing, planning details, history, messages, and AI connection. New boards start disconnected. Opening another board saves the current drawing first.

A board's configured `WHITEBOARD_DATA_DIR`, or the helper's `--data-dir` argument, determines which board an agent accesses. Switching the browser board does not retarget an existing agent grant or request. Local board services run inside the app process and close when it stops.

Export a `.sharedboard` backup for one board, or preserve the complete local `data/` folder privately to move the installation's boards and settings. Clearing browser site data does not remove local-server drawing files. The hosted browser edition has a separate storage model: clearing its site data removes its saved boards.

Never publish `data/`, private tokens, grants, pairing state, captured requests, `agent-target.json`, `.connection.json`, `.token`, or `.agent-session-*` files. Do not edit drawing JSON directly while the service is running; the helper and MCP tools use the authenticated API and conflict checks.

## Connect an existing local AI

Open **Connect an AI** and choose a local client. Pair with **Read only**, **Propose changes · approval required**, or **Edit when requested**. Proposal access stages drawing changes and rejects direct edits; only the page can accept a proposal. These board permissions do not sandbox an assistant's separate filesystem tools.

- **Codex:** paste the generated instructions into the existing Codex conversation. Automatic handoff uses its installed, queue-capable CLI and the real chat ID; do not guess an ID or start another conversation to simulate delivery.
- **Claude Code, Cursor, or another local MCP client:** use the generated MCP configuration, then pair from the chosen conversation. Requests use **Copy to AI**, followed by the board reply tool.
- **ChatGPT and Claude web chats:** locked as **WIP**, including the default backend start/approval routes. The historical web bridge is available only to isolated protocol-development fixtures.

**Manage connection** shows board access, message delivery, and an actual reply as separate checks. A successful protocol fixture is not proof that a particular AI application or account has passed acceptance testing. The complete setup and support boundary are in [CONNECTIONS.md](../CONNECTIONS.md).

### MCP configuration

Prefer the page's generated entry: it includes the correct runtime, server path, board data directory, and client identity. Merge it into the host's existing settings without replacing unrelated entries. A source-checkout transport entry for Codex has this shape; replace every path with your real absolute path and pair before using board tools:

```toml
[mcp_servers.shared_board]
command = "C:/absolute/path/to/node.exe"
args = ["C:/absolute/path/to/shared-board/server/mcp.mjs"]

[mcp_servers.shared_board.env]
WHITEBOARD_DATA_DIR = "C:/absolute/path/to/shared-board/data"
WHITEBOARD_CLIENT_ID = "sharedboard-mcp"
```

Restart or reconnect the host as required to discover tools. MCP can be configured across multiple chats in a client; pairing does not establish a portable cryptographic identity for an external conversation. Keep grants out of pasted instructions and exported configuration.

## Review requests and mini chat

**Ask AI to look** finishes saving, then captures the selected objects and their bound labels, or the whole board when nothing is selected. Later drawing changes do not alter that request. The request authorizes inspection and explanation only. Drawing contents and attached notes remain project data, not independent instructions to run code.

With a paired queue-capable Codex client, delivery targets the existing conversation. A request can wait until its active turn finishes. **Waiting for AI**, **AI is reviewing**, and **AI reviewed your board** represent delivery, reading, and acknowledgement separately. Failures stay visible for retry; equivalent pending reviews are deduplicated.

```sh
node server/agent-cli.mjs reviews
node server/agent-cli.mjs review <request-id>
node server/agent-cli.mjs complete_review path/to/acknowledgement.json
```

The acknowledgement file contains `{"id":"request-id","summary":"What was reviewed"}`. Inspect the captured request before completing it. If it is already handled, avoid repeating it.

The **Talk it through** bubble opens the board's mini chat. It contains messages sent from this board and replies posted back by its connected assistant, rather than a mirror of the entire external transcript. No extra model API key is required. **Discuss** requests inspection/explanation; **Request work** authorizes the specific task typed in the message, within the connection's permission.

Before sending, choose **Whole board**, **Current selection**, or a **Named area**, then **Preview attachment**. Check the exact rendered image and notes. Drawing, selection, or planning changes require a fresh preview. Already-sent requests and uncertain retries retain their original snapshot and request ID. Empty named areas stay empty.

```sh
node server/agent-cli.mjs chats
node server/agent-cli.mjs chat <message-id>
node server/agent-cli.mjs reply path/to/reply.json
```

A reply file contains `{"id":"message-id","text":"The complete answer"}`. Equivalent MCP read/reply tools are available. Delivery, reading, and replying are distinct; do not resend a successfully delivered request automatically or overwrite an existing answer.

Chat supports formatting, tables, links, literal code blocks, resizing, and expansion. Raw HTML remains text; remote Markdown images are not loaded. Drafts, intent, unread state, and pending requests are scoped to each board. Large unsent attachments may exceed browser draft storage; preserve the text/request ID and check delivery before starting a new request.

## Agent drawing commands

Start and pair the local app first. The helper uses the same API and conflict checks as MCP:

```sh
node server/agent-cli.mjs read
node server/agent-cli.mjs read_full
node server/agent-cli.mjs add path/to/addition.json
node server/agent-cli.mjs edit path/to/edit.json
```

For another board, put `--data-dir` before the operation, using that board's actual directory:

```sh
node server/agent-cli.mjs --data-dir "C:/absolute/path/to/board-data" read
```

An addition file can contain:

```json
{
  "elements": [
    { "type": "rectangle", "x": 100, "y": 100, "width": 260, "height": 140, "text": "Our shared idea", "backgroundColor": "#e0f0dc" }
  ],
  "summary": "Agent added a shared idea"
}
```

An edit file uses the latest object's ID and version from `read`:

```json
{
  "edits": [
    { "id": "object-id-from-read", "expectedVersion": 3, "changes": { "x": 240, "backgroundColor": "#fff0cd" } }
  ],
  "summary": "Agent moved and recolored the box"
}
```

The summary read returns `editVersion`, areas, notes, and requirements. A full read returns `elementVersions`. Always read immediately before editing; use those versions and reread after conflicts. Moving/deleting a container also affects its bound text; edit the label object to change a box's text. Simplified agent creation supports lines/arrows but does not expose bound arrow endpoints. The editor retains its native text, arrow, freehand, and image behavior.

`view_board` returns a browser-rendered PNG with its revision and a stale flag. Review/chat reads include the image and immutable planning context captured at send time. These are inputs for a model's interpretation, not evidence that its interpretation is correct. Without an open browser there is no new rendered preview.

```sh
node server/agent-cli.mjs snapshot path/to/board.png
node server/agent-cli.mjs propose path/to/proposal.json
```

A proposal has `title`, `summary`, and `elements` and/or `edits` in the formats above. Only the page can accept it. Captured chat/review images are private files under `data/captures/`.

## Planning, proposals, and recovery

| Workspace tool | Behavior |
| --- | --- |
| **Reusable blocks** | Insert editable screen/form/journey/architecture starters, or save your own selected block. |
| **Areas & search / Ctrl+K** | Name a selection, bookmark a view, and find text or references within this board. |
| **Attach note** | Add a note, requirement, or work card with links to its objects. Resolved notes remain available; result fields do not automatically execute or verify code. |
| **Screenshot references** | Save a pinned image, draw over it, and unlock it from the reference list when needed. Ordinary image paste remains available. |
| **Objects & minimap** | Search, name, jump to, hide/show, lock/unlock, and reorder objects while preserving groups and bound labels. Hiding does not remove saved content. |
| **AI changes** | Ask the connected local assistant to check understanding, inspect staged before/after proposals, and accept or dismiss them. |
| **Undo this AI change** | Reverse a recorded action only while its objects have no later edits; editor text measurements do not falsely block undo. |
| **Checkpoints & history** | Keep up to 40 named checkpoints, preview them, and restore only if the board/planning details have not changed since preview. |
| **Automatic recovery** | Keep the latest 12 recovery saves separately from named checkpoints; ordinary captures are throttled to five minutes and identical content is deduplicated. |

Restores/imports capture current work first. Significant AI changes also receive safety captures. Recovery includes drawing, notes, references, and reusable blocks. Overlapping edits reject an entire proposal while preserving unrelated work.

The selection toolbar includes notes, areas, grouping, alignment, duplication, and details. SharedBoard.app supplies its toolbar, palette, menu, chat, undo/redo, and fullscreen controls while Excalidraw supplies the editor engine. Fullscreen hides the rail/header/footer and retains the toolbar and optional chat; embedded browsers can use a canvas-only fallback.

**Export board** writes one `.sharedboard` backup containing drawing files, areas, notes, work cards, and reusable blocks. It omits connections, grants, chat/review requests, other boards, and checkpoint history. **Restore board backup** previews it and saves recovery before replacing the current board. Older `.sharedboard` files remain supported. **Export drawing (.excalidraw)** contains drawing data only; ordinary drawing import adds to the current canvas.

## Test the shared-editing workflow

1. Draw a rectangle, add text, or use **Add a practice sketch** / **+ Sketch**.
2. Wait for **Saved on this computer**.
3. Ask the paired local assistant to change something; a selection helps identify the object.
4. Confirm its change appears without refreshing, then edit it yourself and ask the assistant to inspect it.
5. Reopen the page and confirm persistence.

Different objects can be edited concurrently. Overlapping edits preserve the browser's local drawing and ask which version to keep; export before resolving if needed. This is an early conflict workflow. Hosted multi-user collaboration is not implemented.

Run `pnpm test` for storage, synchronization, or tool changes and `pnpm build` for app changes. For the browser-storage edition, use the test/build/preview steps in [HOSTING.md](../HOSTING.md), with an isolated origin/database. Never clear real user data for testing. Automated protocol checks prepare for hands-on testing; they do not replace actual provider/client acceptance or visual interpretation tests.

## Version and package changes

The footer's **What's new**, [CHANGELOG.md](../CHANGELOG.md), and MCP version use `releases.json`. Record each completed batch before building:

```sh
pnpm change minor "Change title" --added "What changed" --fixed "What was fixed"
pnpm test
pnpm build
```

Use `minor` for capabilities and `patch` for fixes. The build checks source fingerprint, package version, and generated changelog; create the next release entry after changes instead of restamping an old version. App versions are separate from drawing revisions. Version `1.0.0` is reserved for the first public release after acceptance testing.

On Windows, build a portable archive with:

```sh
pnpm package:windows
```

The builder downloads the pinned official Node archive if needed, verifies its checksum, copies an app allowlist and minimal backend dependency closure, includes license notices, and generates content/ZIP hashes. Runtime pins are in `packaging/runtime.json`. Personal data, grants, logs, and development dependencies are excluded. The output is a portable ZIP, rather than an installer or signed executable.

For source distribution, include the dependency lockfile and source, excluding `node_modules/`, `data/`, logs, and generated/runtime directories. The static website is a separate `dist-web/` build; see [HOSTING.md](../HOSTING.md) for packaging and deployment. Project code is [MIT licensed](../LICENSE), with [Andrew Barresi](https://github.com/AndBarresi) credited as creator. Retain [third-party notices](../THIRD_PARTY_NOTICES.md).

## References

- [Excalidraw source](https://github.com/excalidraw/excalidraw), [MIT license](https://github.com/excalidraw/excalidraw/blob/master/LICENSE), and [integration API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api)
- [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/)
- [Current connection support and official client setup links](../CONNECTIONS.md)
