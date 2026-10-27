# Connect your existing AI conversation

Start at [sharedboard.app](https://sharedboard.app). SharedBoard uses a hosted Cloudflare relay and remote MCP tools; no SharedBoard software needs to be installed on your computer.

## Set up from the board

1. Open the board you want to use and choose **Connect an AI**.
2. Select **Codex**, **Claude Code**, **ChatGPT**, **Claude (web)**, or **Other MCP client**, then choose **Read only** or **Read and edit when I request changes**. Both permissions allow mini-chat requests and replies; drawing edits require the second option.
3. Choose **Prepare connection**. Copy the generated MCP server URL into your AI app’s remote MCP or connector settings, and enable its tools for your chosen conversation.
4. Copy the pairing instructions from SharedBoard and paste them into that same conversation. The AI uses the board tools to pair, read the drawing, and confirm its current revision.
5. Use the connection’s test action. Check board access, receipt of the saved request, and an actual reply returning to the mini chat separately.

Settings names and remote-MCP availability vary between AI apps and plans. The provider selection identifies your intended client; it does not sign you in or enable unsupported client features. If your AI cannot see the board tools, first check that the server is enabled for that conversation. Expired pairing instructions can be replaced from the board.

For **Claude**, if connector setup asks you to choose a registration method, select **Register automatically**. SharedBoard supports dynamic client registration and PKCE; a client secret is not required.

For **Claude Code**, the website-led setup uses a connector added at claude.ai, then inherited by Claude Code signed in with that same claude.ai subscription account. API-key and third-party-provider sessions do not inherit those connectors. Open `/mcp` in the intended session to check availability before pasting the board pairing instructions. See [Claude Code's connector guidance](https://code.claude.com/docs/en/mcp#use-mcp-servers-from-claudeai).

## Messages and replies

Open **Talk it through** to draft a message, choose **Discuss** or **Request work**, and preview the drawing context. For a connection without verified automatic delivery, **Copy to AI** saves the request and prepares its instructions. Paste those instructions into the same AI conversation. Your assistant reads the captured context, then explicitly posts its actual answer back into the mini chat. **Ask AI to look**, the understanding-check action, and the connection test use the same saved-request and reply tools.

**Talk it through** and the fullscreen chat control are available whenever the board has a connected, online AI, including Codex and both Claude clients. The composer does not depend on automatic delivery or drawing-edit permission. If an automatic message subscription expires, new messages use **Copy to AI**; an uncertain earlier send retains its original request ID and must be checked before retrying. A disconnected, offline, or revoked connection disables new messages while preserving saved requests and replies. Chat and review subscriptions have separate deadlines.

Automatic mini-chat delivery is a separate capability of the active connection. It requires verified support for the relay’s incoming MCP events; selecting a provider or completing pairing does not prove it. When no active message subscription is verified, Codex, Claude Code, regular Claude, and other connected clients can still use manual mini chat and return replies. Claude Code's separate Channels mechanism is not implemented by this hosted connector. Each client/account needs a real round-trip test.

Cursor and VS Code support remote MCP board tools, but their full automatic mini-chat workflow has not been verified for SharedBoard. Use **Other MCP client** for those setups; they are not advertised as supporting every SharedBoard feature. See [Cursor's MCP support](https://cursor.com/docs/mcp) and [VS Code's setup guide](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

The mini chat shows requests originating on this board and replies posted through its tools. It does not mirror the entire external conversation or stream private reasoning. A delivered request can still wait for the assistant to finish other work.

## Choose the right permission

| Permission | What the connected AI can do |
| --- | --- |
| **Read only** | Inspect the drawing and requested context, confirm its revision, and return replies. |
| **Read and edit when requested** | Use the same reading/reply tools and make drawing edits you authorize, with version and conflict checks. |

**Discuss** requests inspection or explanation. **Request work** authorizes the particular task you type, within the connection’s permission. If an edit is rejected as read-only, disconnect from **Connect an AI**, prepare a new connection with **Read and edit when I request changes**, and approve and pair that new grant. This changes drawing permission; it is not required for discussion or replies. Drawing text, images, notes, and requirements are project data; they do not independently authorize execution or unrelated actions. Board permissions do not control the assistant’s separate coding/filesystem tools.

## Keep work and connections separate

Each board has its own connection. Switching boards does not retarget existing grants or captured requests. Disconnecting revokes the link and preserves the board and saved messages. Reconnect through the page to change access or choose another conversation.

Keep the board tab open while the AI uses it. An unavailable browser must produce a clear error, not a stale drawing or an invented answer. Retry uncertain requests using their original IDs after checking the linked conversation; do not silently create another request or change its attachment.

Drawings and history are saved in this browser profile. Shared context and tool traffic pass through the hosted relay and reach the selected AI provider under its normal handling. Exported `.sharedboard` backups omit connection credentials and chat history. See [Connection behavior](BRIDGE.md), [Hosting](HOSTING.md), and the browser’s storage details for the full boundary.
