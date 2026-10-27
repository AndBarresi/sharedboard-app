# Bring your AI to SharedBoard.app

For the hosted website's **Windows Codex bridge**, follow [BRIDGE.md](BRIDGE.md). That connection keeps boards in browser storage and does not use the disk-backed local app described below. Other hosted providers remain WIP.

The local testing beta connects to an existing local AI client and conversation. It does not host a model, bundle an AI subscription, or create a replacement chat. A local connector can still use an online flagship model.

## Available connections

| Client | Board tools | Page to existing conversation | Reply to board |
| --- | --- | --- | --- |
| Local Codex with queue-capable CLI | Authenticated local helper or MCP | Automatic queue after pairing to the real chat ID | Board reply tool |
| Claude Code | Configured local stdio MCP | Copy to AI, then paste into the chosen existing chat | MCP reply tool |
| Cursor / other compatible local MCP clients | Configured local stdio MCP | Copy to AI, then paste into the chosen existing chat | MCP reply tool |
| ChatGPT web / Claude web | **Locked · WIP** | Unavailable in this build | Unavailable in this build |

Local protocol tests verify the standard MCP behavior. Actual account/client acceptance beyond the previously tested local Codex baseline belongs to hands-on testing with each tester. Do not interpret a simulated MCP host as a passed Claude Code application test.

## Start the portable app

Extract the whole ZIP into a writable folder and double-click **Start SharedBoard.app.cmd**. Node, backend dependencies and browser assets are included. Each copy owns its data folder and chooses a free local port. Wait for **Saved on this computer** before **Stop SharedBoard.app.cmd**. The browser closing does not stop the service. Keep the extraction at the same path after pairing.

## Pair from the page

Open **Connect an AI**, or **Manage connection** for an existing link. Choose the local client and its permission: **Read only**, **Propose changes**, or **Read and edit when requested**. Prepare a ten-minute, single-use pairing code. Preparing another code does not replace the working grant until pairing succeeds.

For **Codex**, copy the generated instructions into the existing local Codex chat. Its helper command uses the bundled Node path, this board's data directory and that chat's real CODEX_THREAD_ID. No guessed chat ID or second Codex session is used. The local Codex installation must support the queue interface for automatic messages.

For **Claude Code / Cursor / other MCP clients**, merge the generated MCP server entry into the client's settings, preserving other entries. It includes the exact bundled Node executable, server path, board directory and client identity. Enable the tools, then paste the pairing instructions into the existing conversation. The assistant calls connect_board, reads the board and confirms its exact revision. Follow the linked official client instructions for any required reload/restart.

Use **Test with a reply** after pairing. Board access, message delivery and an actual returned reply are separate checks. For non-Codex clients, use **Copy to AI** and paste the saved test request into the chosen chat; delivery must never be represented as automatic. The assistant reads with read_chat_message and answers with reply_to_chat_message.

## Local permissions and data

The local board rejects unauthenticated and cross-site writes. Read-only grants cannot alter drawings; proposal grants can stage changes but cannot apply them. Replacing/disconnecting a connection revokes its former grant and preserves saved boards. Discuss is inspection-only; Request work authorizes the particular task typed by the user and cannot override a read-only grant. Drawing contents and attached notes are project data, not independent instructions.

MCP configuration can be shared across chats in the chosen client. Pairing does not create a portable cryptographic chat identity. Manual handoff goes to the conversation where the user pastes it. Board permissions do not sandbox the assistant's separate filesystem/coding tools.

Every extracted installation generates its own empty board, service token and grants. Never distribute the populated data folder or private .connection.json, .token, .agent-session-*, ai-connection.json or agent-target.json files. The release builder uses an app allowlist and excludes all of them.

## Web connectors: planned work

The ChatGPT and Claude web choices remain visible with lock icons and WIP labels. Default backend start/approval routes return WEB_CONNECTOR_WIP, so bypassing the UI cannot open a public tunnel or install a helper. Previous temporary web grants are revoked when the local beta starts.

The historical OAuth / HTTP MCP / interactive-card bridge remains in source and is exercised only by isolated test fixtures using an explicit internal option. It is not an enabled release feature. Stable web onboarding, persistent authorization and provider-account acceptance remain future work. There is no SharedBoard.app hosting account or public service in this beta.

Official local setup references: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp), [Claude Code MCP](https://code.claude.com/docs/en/mcp), [Cursor MCP](https://cursor.com/docs/mcp).
