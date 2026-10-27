# Connect the website to your existing Codex chat

SharedBoard Bridge connects **https://sharedboard.app** to a local Codex conversation. Your board and mini-chat history stay in this browser profile. The companion relays requests to the open board tab; it does not host a model or put your boards in a server database.

## First-time setup

1. Open SharedBoard.app and choose **Connect Codex**.
2. Download the Windows x64 bridge ZIP from the setup window and extract the whole archive.
3. Open **Install SharedBoard Bridge.cmd**. It installs for your Windows user without administrator access, includes Node, starts the bridge, and registers the webpage's **Open bridge** link.
4. Return to the board and choose **Check for bridge**. If the browser asks for local access, allow it for SharedBoard.app to reach the companion on this computer.
5. Choose **Read only** or **Read and edit when I request changes**, then prepare and copy the connection instructions.
6. Paste the instructions into the existing Codex chat you want to keep using. Codex runs the helper using that conversation's actual identity, reads the board and confirms its revision.
7. Choose **Test with a reply**. Board access, delivery to the existing chat, and a returned mini-chat reply are separate checks.

You do not type commands or edit configuration files. The browser cannot install or launch desktop software silently, so the first download/installation and any operating-system permission prompts still require your action. Codex must already be installed and signed in; its installation must support the queue command.

## Next time

Open the same website in the same browser profile. If the helper is stopped, choose **Open bridge**, then check again. The browser retains the board-specific grant. You can also use **Start SharedBoard Bridge.cmd**. The helper is installed under `%LOCALAPPDATA%\SharedBoardBridge`.

Keep the board tab open while Codex uses it. Closing or suspending it can interrupt live tool calls. The assistant must read the current board again after reconnecting. Another open tab can display the same saved board, but only one tab handles a given board's bridge operations at a time.

## What travels through the connection

- A mini-chat message keeps its text, intent, board revision, selection or named area, notes and captured PNG together in browser storage before notification.
- The bridge queues a notice to the paired existing Codex conversation. Codex reads the captured request with its board helper and posts an explicit reply back to the mini chat.
- Drawing reads and permitted edits go through the open browser, with version checks and browser-side persistence. Newer human edits are preserved by conflict checks.
- The mini chat contains board-originated requests and explicit replies. It does not mirror every message or private reasoning from the external conversation.
- Selected content reaches your existing model provider when you ask that assistant to inspect it, under that provider's normal handling.

The helper persists scoped credential hashes, local agent credentials and a bounded routing/receipt ledger. It stores no drawing database or chat snapshots. A CLI visual read can create a temporary local PNG for the assistant's image-viewing tool. Exported `.sharedboard` backups omit bridge credentials, connection grants and chat history.

## Status and recovery

**Saved in this browser** describes drawing storage. The Codex connection has its own status. If the bridge stops, keep drawing and export a backup normally; reopen the helper to restore AI access.

A queued receipt confirms Codex accepted a request, not that it has read or answered it. An active Codex task may finish before handling a queued board message. Replies appear only after the model reads the request and uses the reply tool. An uncertain delivery is preserved with its original request ID rather than automatically sent again after a restart.

The assistant's drawing helper also keeps a stable ID for repeated add/edit payloads so a lost response does not create duplicate shapes. For an intentional new copy of an identical addition, the assistant can supply fresh element IDs or a fresh `requestId` UUID in its JSON request. This metadata stays local and contains no drawing payload.

Disconnecting revokes that board's grant and preserves its saved drawing and messages. Each board is paired separately. Switching boards never retargets a conversation silently. **Discuss** requests inspection/explanation; **Request work** authorizes only the work typed in that message. Neither the drawing nor attached notes independently authorize execution.

## Current support

This first companion release supports **Codex on Windows x64**. Hosted Claude Code, Cursor, generic MCP, ChatGPT web, Claude web and proposal-only access remain visible WIP. The separate portable local app retains its existing connection options.

The loopback service listens at `http://127.0.0.1:4319` and permits the exact website origin `https://sharedboard.app`. A `pages.dev` preview or another hostname is a separate browser origin and is not authorized by this companion. There is no public tunnel or cloud relay.

## Build the companion

Use the pinned runtime and package manager, then run `pnpm package:bridge` after recording the release. The archive contains only the bridge source, launcher, runtime, version metadata and licenses. It excludes all data and credentials. A `bridge-v<package version>` Git tag runs the Windows release workflow and publishes the download used by the website.

Created by [Andrew Barresi](https://github.com/AndBarresi). Project code is [MIT-licensed](LICENSE).
