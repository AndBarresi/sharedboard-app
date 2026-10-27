# Connect your existing AI conversation

Start at [sharedboard.app](https://sharedboard.app). SharedBoard uses a hosted Cloudflare relay and remote MCP tools; no SharedBoard software needs to be installed on your computer.

## Set up from the board

1. Open the board you want to use and choose **Connect an AI**.
2. Select **Codex**, **Claude Code**, **ChatGPT**, **Claude (web)**, or **Other MCP client**, then choose **Read only** or **Read and edit when I request changes**. Both permissions allow mini-chat requests and replies; drawing edits require the second option.
3. Choose **Prepare connection**. Copy the generated MCP server URL into your AI app’s remote MCP or connector settings, and enable its tools for your chosen conversation.
4. Copy the pairing instructions from SharedBoard and paste them into that same conversation. The AI uses the board tools to pair, read the drawing, and confirm its current revision.
5. Ask the assistant to call **`open_sharedboard_chat`** in that same conversation. If its host supports the connection panel’s text messaging, click **Link this chat** on the panel.
6. Keep the linked panel and browser board open. Send a test from the board and check board access, receipt in the existing conversation, and an actual reply returning to the mini chat separately.

Settings names and remote-MCP availability vary between AI apps and plans. The provider selection identifies your intended client; it does not sign you in or enable unsupported client features. If your AI cannot see the board tools, first check that the server is enabled for that conversation. Expired pairing instructions can be replaced from the board.

For **Claude**, if connector setup asks you to choose a registration method, select **Register automatically**. SharedBoard supports dynamic client registration and PKCE; a client secret is not required.

For **Claude Code**, the website-led setup uses a connector added at claude.ai, then inherited by Claude Code signed in with that same claude.ai subscription account. API-key and third-party-provider sessions do not inherit those connectors. Open `/mcp` in the intended session to check availability before pasting the board pairing instructions. See [Claude Code's connector guidance](https://code.claude.com/docs/en/mcp#use-mcp-servers-from-claudeai).

## Messages and replies

Open **Talk it through**, choose **Discuss** or **Request work**, and preview the drawing context before sending. The linked conversation panel forwards the saved request into its own host conversation. Your assistant reads the capture with the board tools and posts its actual complete answer through **`reply_to_chat_message`**; the answer then appears on the board. **Ask AI to look**, the understanding check, and the connection test use the same captured-request boundary. You do not copy and paste individual messages.

The panel checks the host’s **`hostCapabilities.message.text`** support before enabling **Link this chat**. Linking authorizes forwarding from the selected board, not access to the conversation’s other messages. Keep both the panel and the browser board open. Closing or pausing the panel, losing its link, or going offline stops new sends. Reopen and link the intended panel when prompted; check the main conversation before retrying any request with uncertain delivery. Its original request ID and attachment stay pinned together.

Board access and direct messaging are separate capabilities:

| Connection capability | What it permits |
| --- | --- |
| Remote MCP board tools | Read the board, return replies, and make authorized edits when granted. |
| A linked MCP Apps panel with text messaging | Forward new board requests directly into the panel’s existing conversation while it stays open. |
| A verified incoming MCP Events subscription | A separate event route where the host supports it and the operator has configured its callback origins. |

Ordinary remote MCP tools in **local Codex** or **Claude Code** do not wake an idle session by themselves. A provider label or successful pairing is not proof of panel messaging. A host without that capability can still use its board tools, but the board does not offer a Copy to AI fallback for new mini-chat messages. Claude Code’s separate Channels mechanism is not implemented by this hosted connector.

The MCP Apps panel requires a real round-trip test in each supported host/account. Cursor, VS Code, Codex, and Claude variants must not be advertised as supporting the full workflow based only on remote MCP access. Use **Other MCP client** where appropriate; see [Cursor’s MCP support](https://cursor.com/docs/mcp) and [VS Code’s setup guide](https://code.visualstudio.com/docs/agent-customization/mcp-servers). ChatGPT Work Cloud MCP Events are an alternative to evaluate separately: the committed callback-origin allowlist is empty, and that route is not configured or verified as active.

The mini chat shows requests originating on this board and replies posted through its tools. It does not mirror the entire external conversation or stream private reasoning. A delivered request can still wait for the assistant to finish other work.

## Choose the right permission

| Permission | What the connected AI can do |
| --- | --- |
| **Read only** | Inspect the drawing and requested context, confirm its revision, and return replies. |
| **Read and edit when requested** | Use the same reading/reply tools and make drawing edits you authorize, with version and conflict checks. |

**Discuss** requests inspection or explanation. **Request work** authorizes the particular task you type, within the connection’s permission. If an edit is rejected as read-only, disconnect from **Connect an AI**, prepare a new connection with **Read and edit when I request changes**, and approve and pair that new grant. This changes drawing permission; it is not required for discussion or replies. Drawing text, images, notes, and requirements are project data; they do not independently authorize execution or unrelated actions. Board permissions do not control the assistant’s separate coding/filesystem tools.

## Keep work and connections separate

Each board has its own connection. Switching boards does not retarget existing grants or captured requests. Disconnecting revokes the link and preserves the board and saved messages. Reconnect through the page to change access or choose another conversation.

Deleting a board from **Projects & boards** requires confirmation and revokes its connection before removing its local content. Deleting a project removes all its boards; the confirmation shows their count. Export any backups you want first, because deletion also removes saved requests, replies, and recovery history. Remaining boards keep their own connections. If the current board is deleted, the app offers a remaining board or creates a blank one; another open tab does not silently switch its AI connection.

Keep the board tab open while the AI uses it. An unavailable browser must produce a clear error, not a stale drawing or an invented answer. Retry uncertain requests using their original IDs after checking the linked conversation; do not silently create another request or change its attachment.

Drawings and history are saved in this browser profile. Shared context and tool traffic pass through the hosted relay and reach the selected AI provider under its normal handling. Exported `.sharedboard` backups omit connection credentials and chat history. See [Connection behavior](BRIDGE.md), [Hosting](HOSTING.md), and the browser’s storage details for the full boundary.
