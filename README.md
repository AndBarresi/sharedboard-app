<div align="center">

# SharedBoard.app

### Turn sketches into a clearer plan for your next build.

A persistent whiteboard for app screens, architecture, references, and the context behind them.

**Browser beta · 0.6.x · Open source · MIT**

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
| **Bring your existing AI** | Connect the website to your existing local Codex chat with SharedBoard Bridge for Windows or Mac. |

<details>
<summary><strong>Take a closer look at the planning workspace</strong></summary>

![SharedBoard.app planning tools alongside a board](docs/images/sharedboard-planning.png)

Keep requirements, named areas, and reusable building blocks beside the drawing they describe.

</details>

## Start in the browser

1. Open [**sharedboard.app**](https://sharedboard.app) in a regular browser profile.
2. Draw something, add a reference or note, and wait for the saved indicator.
3. Use **Export board** to keep a `.sharedboard` backup outside the browser.

Drawing in the browser needs no installation. To connect a local Codex chat, install the small bridge companion once. The website is hosted on Cloudflare Pages at **sharedboard.app**; pushes to this repository's `main` branch run tests and automatically deploy updates. Build and domain settings are documented in [Hosting](HOSTING.md).

> **Your boards stay in your browser.** They are saved on this device in this browser profile, with no account or cross-device sync. Clearing site data or leaving private browsing can remove them. Export regularly; each backup contains one board's drawing and planning details. Another domain or preview address has separate storage.

## Connect your local Codex chat

SharedBoard's current focus is **your browser board ↔ your existing local Codex conversation**. The mini chat sends a captured board request to that conversation, and Codex posts an explicit answer back to the board. A queue-capable Codex installation receives requests automatically; other installations get a working **Copy to Codex** handoff for each saved request. Your drawings and chat history stay in your browser profile. No extra model subscription or API key is required.

| Your computer | Bridge download |
| --- | --- |
| Windows x64 | [Windows ZIP](https://sharedboard.app/downloads/SharedBoard-Bridge-windows-x64.zip) |
| Mac with Apple Silicon · macOS 13.5+ | [Mac Apple Silicon ZIP](https://sharedboard.app/downloads/SharedBoard-Bridge-macos-arm64.zip) |
| Mac with Intel · macOS 13.5+ | [Mac Intel ZIP](https://sharedboard.app/downloads/SharedBoard-Bridge-macos-x64.zip) |

Use **Chrome or Edge** for the local bridge on Windows or Mac; Safari bridge connections are not supported in this beta. Choose **Connect Codex** on the website for the guided setup. Select your computer, download and install the helper once, check the connection, then paste the generated pairing instruction into your existing Codex conversation. Downloads and instructions start on the website; no GitHub account or repository visit is required. The assistant runs its helper command; you do not edit configuration files. Keep the board tab open during AI use. See [Bridge setup](BRIDGE.md) for permissions, Mac installation approval, and troubleshooting.

Direct ChatGPT/Claude web-chat connections, other clients, and MCP tools inside an AI chat are **planned WIP**. These are not required for the local bridge workflow. SharedBoard does not host an AI model or create a replacement conversation.

The earlier disk-backed portable app remains available for development and existing local installations. Its legacy interfaces are documented separately in [Local development & agent tools](docs/LOCAL-DEVELOPMENT.md).

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

[Bridge setup](BRIDGE.md) · [Connection setup](CONNECTIONS.md) · [Development guide](docs/LOCAL-DEVELOPMENT.md) · [Hosting](HOSTING.md) · [Changelog](CHANGELOG.md) · [Authorship & credits](AUTHORS.md) · [MIT license](LICENSE)

SharedBoard.app is a **0.x testing beta**. Live voice, hosted multi-user collaboration, other hosted AI clients, and automatic verification of generated code are planned or unimplemented. The project uses the [Excalidraw editor](https://github.com/excalidraw/excalidraw); third-party components retain their own [notices and licenses](THIRD_PARTY_NOTICES.md).
