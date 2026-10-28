<div align="center">

# SharedBoard.app

### Turn sketches into a clearer plan for your next build.

A persistent whiteboard for app screens, architecture, references, and the context behind them.

**Browser beta · Open source · MIT**

[**Open SharedBoard.app ↗**](https://sharedboard.app) · [Source](https://github.com/AndBarresi/sharedboard-app) · [What's new](CHANGELOG.md)

Created by [**Andrew Barresi**](https://github.com/AndBarresi)

</div>

---

![SharedBoard.app workspace with an editable planning canvas](docs/images/sharedboard-workspace.png)

<p align="center"><sub>A shared place for screen sketches, references, and the details behind your plan.</sub></p>

## A canvas with context

Sketch a screen, map a system, pin a screenshot, and attach the requirements that explain what should happen next. SharedBoard.app builds on the open-source Excalidraw editor with a planning workspace around it.

| Make the plan | Keep it useful |
| --- | --- |
| **Draw freely** | Shapes, text, arrows, images, freehand drawing, and a canvas-only view. |
| **Organize your work** | Separate projects and boards, named areas, object search, a minimap, and confirmed deletion of work you no longer need. |
| **Explain the details** | Attached notes, requirements, work cards, and screenshot references. |
| **Reuse and recover** | Editable starting blocks, your own block library, checkpoints, and automatic recovery. |
| **Bring your existing AI** | Use native ChatGPT Work Cloud events, a managed Codex or Claude Code plugin, or compatible remote MCP tools, with read-only or requested-edit access. |
| **Imagine a finished design** | Refine a selected wireframe using an existing page, frame, or manually chosen objects as the visual reference. |

<details>
<summary><strong>Take a closer look at the planning workspace</strong></summary>

![SharedBoard.app planning tools alongside a board](docs/images/sharedboard-planning.png)

Keep requirements, named areas, and reusable building blocks beside the drawing they describe.

</details>

### Drawing tools and Imagine

The **Shapes** menu groups rectangles, ellipses and diamonds; hold Shift while drawing for a square or circle. The toolbar runs across the top in landscape and down the left in portrait, with drawing tools that scroll independently while utility actions remain available. It also includes the laser pointer and a **More tools** menu for frames, web embeds, shape recognition, bucket fill and lasso selection. **Info & keyboard shortcuts** opens a searchable reference. Press **S** for drawing style, **?** for help, or **Ctrl/Cmd+'** to enable the alignment grid and snapping.

To use **Imagine**, open the tool, drag-select a finished page or component on the canvas, and choose **Use as reference**. Next, drag-select the wireframe you want enhanced and choose **Imagine this selection**. Either step accepts an existing selection. Separate previews show the reference and the target before you submit, with controls to change either selection on the canvas. For example, a finished index page can guide the typography, palette, spacing and components of a rough contact page without an earlier Imagine pass.

Imagine uses the existing connected AI conversation with verified delivery and drawing edit access. It creates an editable canvas design and saves design memory for later passes on the same board. Reference artwork remains in place. Changed targets, references or relevant requirements stop an outdated replacement, while recovery and **AI changes** provide ways to restore the original. Local AI plugins must include the `replace_selection` tool; older running plugin processes need the updated package and a fresh connection before using Imagine. Automated hosted and plugin tests cover this workflow; real provider generation quality still needs live acceptance testing.

## Start on the website

1. Open [**sharedboard.app**](https://sharedboard.app) in a regular browser profile.
2. Draw something, add a reference or note, and wait for the saved indicator.
3. Use **Export board** to keep a `.sharedboard` backup outside the browser.

SharedBoard runs in the browser, without a standalone SharedBoard installer or home-network server. ChatGPT Work Cloud uses a download-free connection. Codex and Claude Code have optional plugins installed inside the AI app; they need Node.js 22 or newer and the client requirements below. Codex has passed actual automatic bootstrap, requested drawing work, and board review in one existing Windows conversation. Claude Code and broader account/platform acceptance still need testing.

> **Your boards stay in your browser.** They are saved on this device in this browser profile, with no cross-device sync. Clearing site data or leaving private browsing can remove them. Export regularly; each backup contains one board's drawing and planning details. Another domain or preview address has separate storage.

## Connect the AI conversation you already use

The recommended automatic connection is **ChatGPT Work with Cloud selected**, using native event-triggered tasks:

1. Choose **Connect an AI → ChatGPT Work Cloud**, select drawing access, and prepare the connection.
2. Add the website's generated MCP URL in ChatGPT and approve access to the intended board.
3. Paste SharedBoard's one-time instructions into the existing Work Cloud conversation. They pair, read, and confirm the board, then create or update the message and review tasks sequentially.
4. Return to SharedBoard. Use **Talk it through** for a question or specific request, and **Ask AI to look** for a captured board review. Actual answers return to the page; individual requests need no copying or Send click in ChatGPT.

Your account must expose native event tasks. A provider label never enables delivery by itself: the website checks the actual subscriptions. Keep the board tab open because it owns the saved drawing and captures. Read-only drawing access allows inspection and replies; requested drawing changes require edit access. Follow [the connection guide](CONNECTIONS.md).

The website-generated post-pair instructions have also passed a real reuse test: the existing conversation read and confirmed the board, then updated its two tasks sequentially without duplicates or drawing changes. This covers an existing account and connection, not first-time OAuth or a new account.

**What has been verified:** native delivery woke an ended AI turn, and mini-chat and review tests completed with AI browser tabs closed and no timed wait active. The production page reloaded with its board, connection, and history preserved. After more than ten minutes with AI tabs closed, another actual reply returned to the website. The next draft stayed editable while Send was disabled, then unlocked with the text intact when the reply arrived.

The preserved draft was then sent and received a second actual automatic reply from the same native Work Cloud chat, with AI tabs still closed. Both native subscriptions have also renewed autonomously, with an actual reply verified after renewal. Navigating away from the board made reads fail explicitly while it was offline; returning in the same browser profile restored the board, connection, history, and unsent draft. Sending that draft returned another actual reply.

Browser transport recovery detects stalled connections and missing pongs, then reuses the saved grant when the page returns online or to the foreground. It does not re-pair or replay uncertain messages. Isolated tests cover retained browser storage and transport races.

**What still needs acceptance:** first-time OAuth and new-account setup, actual OS sleep, multiday renewal, other accounts/providers, and a full editing workflow need separate tests. The observed renewal and leave/return tests cover one real account, not every interruption. Reading a request or answering only in AI chat does not deliver a board reply; burst reply handling has required a task-prompt repair requested from the website. This remains a testing beta, without a promise of permanent or bug-free connectivity.

### Codex and Claude Code plugins

Choose **Codex** or **Claude Code** in **Connect an AI** to get the relevant install and pairing instructions on the website. Each plugin connects outward to the hosted relay from its AI app; it does not start a localhost web server or use another model.

| Client | Setup and current boundary |
| --- | --- |
| **Codex** | Install the SharedBoard marketplace and plugin, enable it in the existing conversation, and use the generated pairing prompt. Requires Node.js 22+ and an installed Codex CLI with the official queue command. The prompt must use that conversation's actual `CODEX_THREAD_ID`. |
| **Claude Code** | Install the SharedBoard plugin, resume the intended conversation with its Channels research-preview flag, and use the generated one-use connect command. Requires Claude Code 2.1.275+, Node.js 22+, supported Anthropic authentication, and an account policy permitting Channels. |

For Codex, the same install commands apply on **macOS, Windows, and Linux**. Install Node.js 22+ and the Codex CLI on the computer running Codex, with both `node` and `codex` available to the app on `PATH`. Run these commands in macOS Terminal, Windows PowerShell, or a Linux terminal:

```sh
codex plugin marketplace add AndBarresi/sharedboard-app
codex plugin add sharedboard@sharedboard
```

Then send the website's one-use `$sharedboard-connect` prompt **in the intended Codex conversation**, rather than the terminal. Node.js runs the local SharedBoard plugin; drawing on the website does not require it. The local plugin runtime requirement is separate from public directory listing: adding this GitHub marketplace does not submit SharedBoard to OpenAI's universal public directory, which has its own [submission and review process](https://developers.openai.com/plugins/build/plugins).

Keep the AI app's paired plugin process and an awake, responsive browser board open. Choose **Test automatic reply** after pairing: normal mini chat and reviews stay unavailable until a real capture is read and its actual reply returns. A connected socket, accepted queue receipt, or provider name does not establish that result. Network reconnection can reuse the running process; restarting it requires fresh pairing, while the drawing and saved history remain in the browser. A suspended background tab can delay requests. Foreground it, check saved status, and retry the original request when appropriate; do not automatically resend uncertain work as a new request. See [setup steps and limitations](CONNECTIONS.md).

The installed Codex plugin has returned actual replies and completed a captured review after website requests woke the same existing Windows conversation. Its requested edit changed only the specified text and preserved nine unrelated objects; reload retained the drawing, grant, and saved conversation history. Automated tests and website builds also pass on Linux, Windows, and macOS ARM. These results do not establish fresh-account setup, Mac GUI use, multiday or OS sleep reliability, or Claude Code account acceptance.

### Other remote MCP clients

Compatible remote MCP clients can read the board and make authorized edits from their own conversations. Their **Live collaboration · experimental** option uses a finite active AI run: waits default to 40 seconds, allow up to 45 seconds, and share a 20-minute deadline. New sends require an actual pending wait. Empty continuations can use AI allowance, and an ended run needs another explicit start. The website preserves drafts and provides **Pause live collaboration**. This mode still needs provider-specific acceptance testing.

Claude's MCP Apps panel remains diagnostic: the tested `ui/message` path filled a composer draft and required Send in Claude. A one-off OpenAI immediate-send test is offered only when the host advertises that extension; it does not enable automatic mini chat or establish the local Codex plugin's behavior. Existing remote Codex and Claude Code grants keep their original route; they are not silently converted to local plugins. Separate cloud runs are not the chosen path. See [connection behavior](BRIDGE.md).

SharedBoard uses your existing AI account/conversation through the relay. The AI provider controls model execution and task settings; tasks are not guaranteed to use the model manually selected in a chat. SharedBoard does not host a replacement model or include an AI subscription. Shared context passes through Cloudflare to the connected AI service. Saved requests keep their original captures, and delivery, reading, and actual replies remain distinct states.

Use **Projects & boards** to delete a board or project only after reviewing its confirmation. Project deletion includes every board it contains and revokes those boards’ connections. This permanently removes their local drawings, notes, saved messages, and recovery history. Export wanted backups first. Unrelated boards remain available, and deleting the final board creates a blank board to continue in.

## Build and contribute

Use the pinned Node version in [`.node-version`](.node-version) and pnpm **11.25.0** to work on the source:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build:web
pnpm preview:web
```

These are developer commands; people using the app start at the website. See [Development](docs/LOCAL-DEVELOPMENT.md) for isolated previews and testing, and [Hosting](HOSTING.md) for the frontend and hosted relay deployment.

## Read more

[Connection setup](CONNECTIONS.md) · [Connection behavior](BRIDGE.md) · [Development](docs/LOCAL-DEVELOPMENT.md) · [Hosting](HOSTING.md) · [Changelog](CHANGELOG.md) · [Authorship & credits](AUTHORS.md) · [MIT license](LICENSE)

SharedBoard.app is a **0.x testing beta**. Live voice, multi-user cloud board storage, and automatic verification of generated code are not implemented. Broader client/account acceptance still needs real testing. The project uses the [Excalidraw editor](https://github.com/excalidraw/excalidraw); third-party components retain their own [notices and licenses](THIRD_PARTY_NOTICES.md).
