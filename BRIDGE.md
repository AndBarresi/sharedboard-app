# Connect the website to your existing Codex chat

SharedBoard Bridge connects **https://sharedboard.app** to a local Codex conversation. Start and finish the setup on the website: it contains the downloads, installation instructions, pairing message, connection checks and troubleshooting. No GitHub account or repository visit is required; GitHub only serves the public download files behind the website's download links. Your board and mini-chat history stay in this browser profile. The companion relays requests to the open board tab; it does not host a model or put your boards in a server database.

## First-time setup

1. Open SharedBoard.app and choose **Connect Codex**.
2. Select **Windows**, **Mac · Apple Silicon**, or **Mac · Intel**, download the matching ZIP and extract the whole archive. On a Mac, **Apple menu → About This Mac** shows either a Chip (Apple Silicon) or Processor (Intel).
3. On Windows, open **Install SharedBoard Bridge.cmd**. On Mac, open **Install SharedBoard Bridge.command**. It installs for your user without administrator access, includes Node, starts the bridge, and registers the webpage's **Open bridge** link. Mac users should read the installation approval note below.
4. Return to the original board tab and choose **Check for bridge**. The installer starts the helper for you. On later visits, use **Open bridge** if it is stopped. If the browser asks for local access, allow it for SharedBoard.app to reach the companion on this computer.
5. Choose **Read only** or **Read and edit when I request changes**, then prepare and copy the connection instructions.
6. Paste the instructions into the existing Codex chat you want to keep using. Codex runs the helper using that conversation's actual identity, reads the board and confirms its revision.
7. Choose **Test with a reply**. Board access, delivery to the existing chat, and a returned mini-chat reply are separate checks.

You do not type commands or edit configuration files. The browser cannot install or launch desktop software silently, so the first download/installation and any operating-system permission prompts still require your action. Codex must already be installed and signed in; automatic mini-chat delivery requires its queue command. Drawing access and automatic chat delivery are checked separately.

If the installed Codex does not support automatic delivery, the page clearly switches to **Copy to Codex**. Compose your request normally, copy its prepared instructions, and paste them into the same paired conversation. The assistant reads that saved request and sends its real reply back to the mini chat through the helper. This fallback needs no configuration changes, but it does require copying each request. Creating or copying a prompt does not mark delivery verified; the check updates only when Codex actually reads it.

## Mac installation approval

The Mac companion supports **macOS 13.5 or later**, with separate native Apple Silicon and Intel downloads. These beta packages are not signed with an Apple Developer ID or notarized. A Mac may ask you to approve the downloaded installer or app before it can run. The website explains the approval steps and links to [Apple's instructions for opening a trusted downloaded app](https://support.apple.com/102445); only approve the SharedBoard package you deliberately downloaded from SharedBoard.app. Managed Macs may require an administrator's approval. The installer never disables Gatekeeper, removes quarantine, installs Rosetta, or changes macOS security settings.

The installed **SharedBoard Bridge.app** is in `~/Applications`. The companion and its Node runtime run locally; its private connection metadata is under `~/Library/Application Support/SharedBoardBridge/data`. The app's **Open bridge** link starts this installed copy without starting another AI conversation.

## Next time

Open the same website in the same browser profile. If the helper is stopped, choose **Open bridge**, then check again. The browser retains the board-specific grant. You can also use **Start SharedBoard Bridge.cmd** on Windows or **Start SharedBoard Bridge.command** on Mac. The Windows helper is installed under `%LOCALAPPDATA%\SharedBoardBridge`; the Mac app is under `~/Applications`.

Keep the board tab open while Codex uses it. Closing or suspending it can interrupt live tool calls. The assistant must read the current board again after reconnecting. Another open tab can display the same saved board, but only one tab handles a given board's bridge operations at a time.

## What travels through the connection

- A mini-chat message keeps its text, intent, board revision, selection or named area, notes and captured PNG together in browser storage before notification.
- With automatic delivery, the bridge queues a notice to the paired existing Codex conversation. In manual mode, the page prepares **Copy to Codex** instructions for that same saved request. Codex reads the captured request with its board helper and posts an explicit reply back to the mini chat in either mode.
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

The current release focuses on **local Codex ↔ browser connections**, with Windows x64, macOS Apple Silicon and macOS Intel companion packages. The bridge uses the real conversation identity supplied by Codex. A queue-capable CLI is needed for automatic mini-chat delivery; a model name or ChatGPT subscription alone does not provide that local capability.

Claude Code, Cursor, direct ChatGPT/Claude web-chat connections, MCP tools callable inside an AI chat and proposal-only access remain visible WIP in the website. They are planned additions rather than prerequisites for using the current bridge. The separate older portable local app retains its developer interfaces.

The loopback service listens at `http://127.0.0.1:4319` and permits the exact website origin `https://sharedboard.app`. A `pages.dev` preview or another hostname is a separate browser origin and is not authorized by this companion. There is no public tunnel or cloud relay.

## Build the companion

Use the pinned runtime and package manager, then run `pnpm package:bridge` on the corresponding operating system after recording the release. The archive contains only the bridge source, launcher, runtime, version metadata and licenses. It excludes all data and credentials. A `bridge-v<package version>` Git tag runs the Windows and native Mac release checks, then publishes all three downloads used by the website only after every platform succeeds.

Created by [Andrew Barresi](https://github.com/AndBarresi). Project code is [MIT-licensed](LICENSE).
