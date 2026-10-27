<div align="center">

# SharedBoard.app

### Turn sketches into a clearer plan for your next build.

A persistent whiteboard for app screens, architecture, references, and the context behind them.

**Browser beta · 0.4.x · Open source · MIT**

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
| **Organize your work** | Separate projects and boards, named areas, object search, and a minimap. |
| **Explain the details** | Attached notes, requirements, work cards, and screenshot references. |
| **Reuse and recover** | Editable starting blocks, your own block library, checkpoints, and automatic recovery. |
| **Bring your existing AI** | Local Codex and MCP tools can inspect the board, reply, and propose edits. Hosted AI connections are **WIP**. |

<details>
<summary><strong>Take a closer look at the planning workspace</strong></summary>

![SharedBoard.app planning tools alongside a board](docs/images/sharedboard-planning.png)

Keep requirements, named areas, and reusable building blocks beside the drawing they describe.

</details>

## Start in the browser

1. Open [**sharedboard.app**](https://sharedboard.app) in a regular browser profile.
2. Draw something, add a reference or note, and wait for the saved indicator.
3. Use **Export board** to keep a `.sharedboard` backup outside the browser.

The browser edition needs no installation or local server. It is hosted on Cloudflare Pages at **sharedboard.app**; pushes to this repository's `main` branch run tests and automatically deploy updates. Build and domain settings are documented in [Hosting](HOSTING.md).

> **Your boards stay in your browser.** They are saved on this device in this browser profile, with no account or cross-device sync. Clearing site data or leaving private browsing can remove them. Export regularly; each backup contains one board's drawing and planning details. Another domain or preview address has separate storage.

## Choose the right edition

| Capability | Browser website | Portable Windows app |
| --- | --- | --- |
| Drawing, planning, projects, backups, and recovery | Available; saved in this browser | Available; saved in the app's local `data/` folder |
| Codex board tools and mini-chat replies | **WIP** | Enabled; automatic handoff needs a queue-capable local Codex CLI |
| Claude Code, Cursor, and compatible local MCP clients | **WIP** | Enabled tools; **Copy to AI** handoff and an explicit reply tool |
| ChatGPT / Claude web-chat connection | **Locked · WIP** | **Locked · WIP** |
| SharedBoard-hosted model or AI subscription | None | None; use your existing assistant |

For the portable build, extract the whole testing ZIP and double-click **Start SharedBoard.app.cmd**. Node and app dependencies are included. Follow its **START-HERE.txt** or the [connection guide](CONNECTIONS.md) to pair an existing local client. Actual support in each AI client still needs hands-on acceptance testing.

## Run from source

Use the pinned Node version in [`.node-version`](.node-version) and pnpm **11.25.0**.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

For a separate preview of the browser-storage edition:

```sh
pnpm build:web
pnpm preview:web
```

See [Local development & agent tools](docs/LOCAL-DEVELOPMENT.md) for CLI examples, MCP setup, storage layout, testing, versioning, and portable packaging. See [Hosting](HOSTING.md) for the static website build and deployment settings.

## Read more

[Connection setup](CONNECTIONS.md) · [Development guide](docs/LOCAL-DEVELOPMENT.md) · [Hosting](HOSTING.md) · [Changelog](CHANGELOG.md) · [Authorship & credits](AUTHORS.md) · [MIT license](LICENSE)

SharedBoard.app is a **0.x testing beta**. Live voice, hosted multi-user collaboration, browser AI linkage, and automatic verification of generated code are planned or unimplemented. The project uses the [Excalidraw editor](https://github.com/excalidraw/excalidraw); third-party components retain their own [notices and licenses](THIRD_PARTY_NOTICES.md).
