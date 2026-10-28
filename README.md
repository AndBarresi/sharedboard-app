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
| **Bring your existing AI** | Connect a compatible AI chat through SharedBoard’s hosted MCP relay, with read-only or requested-edit access. |

<details>
<summary><strong>Take a closer look at the planning workspace</strong></summary>

![SharedBoard.app planning tools alongside a board](docs/images/sharedboard-planning.png)

Keep requirements, named areas, and reusable building blocks beside the drawing they describe.

</details>

## Start on the website

1. Open [**sharedboard.app**](https://sharedboard.app) in a regular browser profile.
2. Draw something, add a reference or note, and wait for the saved indicator.
3. Use **Export board** to keep a `.sharedboard` backup outside the browser.

SharedBoard runs in the browser. There is no SharedBoard application or companion to install on Windows or Mac.

> **Your boards stay in your browser.** They are saved on this device in this browser profile, with no cross-device sync. Clearing site data or leaving private browsing can remove them. Export regularly; each backup contains one board's drawing and planning details. Another domain or preview address has separate storage.

## Connect the AI conversation you already use

The recommended automatic connection is **ChatGPT Work with Cloud selected**, using native event-triggered tasks:

1. Choose **Connect an AI → ChatGPT Work Cloud**, select drawing access, and prepare the connection.
2. Add the website's generated MCP URL in ChatGPT and approve access to the intended board.
3. Paste SharedBoard's one-time instructions into the existing Work Cloud conversation. They pair, read, and confirm the board, then create or update the message and review tasks sequentially.
4. Return to SharedBoard. Use **Talk it through** for a question or specific request, and **Ask AI to look** for a captured board review. Actual answers return to the page; individual requests need no copying or Send click in ChatGPT.

Your account must expose native event tasks. A provider label never enables delivery by itself: the website checks the actual subscriptions. Keep the board tab open because it owns the saved drawing and captures. Read-only drawing access allows inspection and replies; requested drawing changes require edit access. Follow [the connection guide](CONNECTIONS.md).

**What has been verified:** native delivery woke an ended AI turn, and mini-chat and review tests completed with AI browser tabs closed and no timed wait active. The production page reloaded with its board, connection, and history preserved. After more than ten minutes with AI tabs closed, another actual reply returned to the website. The next draft stayed editable while Send was disabled, then unlocked with the text intact when the reply arrived.

The preserved draft was then sent and received a second actual automatic reply from the same native Work Cloud chat, with AI tabs still closed.

**What still needs acceptance:** fresh one-time setup, sleep/reconnect, long-term host renewal, other accounts/providers, and a full editing workflow need separate tests. Eighteen focused lifecycle tests cover renewal, revocation, signing-key rotation, and receipt preservation; they do not replace those real-client checks. Reading a request or answering only in AI chat does not deliver a board reply; burst reply handling has required a task-prompt repair requested from the website. This remains a testing beta, without a promise of permanent or bug-free connectivity.

### Other AI clients

Compatible remote MCP clients can read the board and make authorized edits from their own conversations. Their **Live collaboration · experimental** option uses a finite active AI run: waits default to 40 seconds, allow up to 45 seconds, and share a 20-minute deadline. New sends require an actual pending wait. Empty continuations can use AI allowance, and an ended run needs another explicit start. The website preserves drafts and provides **Pause live collaboration**. This mode still needs provider-specific acceptance testing.

Claude's MCP Apps panel remains diagnostic: the tested `ui/message` path filled a composer draft and required Send in Claude. It does not enable automatic mini chat. See [connection behavior](BRIDGE.md).

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

SharedBoard.app is a **0.x testing beta**. Live voice, multi-user cloud board storage, and automatic verification of generated code are not implemented. Client/account acceptance still needs real testing. The project uses the [Excalidraw editor](https://github.com/excalidraw/excalidraw); third-party components retain their own [notices and licenses](THIRD_PARTY_NOTICES.md).
