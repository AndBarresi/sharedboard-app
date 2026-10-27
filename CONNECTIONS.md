# Connect your existing AI conversation

Start at [sharedboard.app](https://sharedboard.app). SharedBoard uses a hosted Cloudflare relay and remote MCP tools; no SharedBoard software needs to be installed on your computer.

## Set up from the board

1. Open the board you want to use and choose **Connect an AI**.
2. Select **Codex**, **ChatGPT**, **Claude**, or **Other MCP client**, then choose **Read only** or **Read and edit when I request changes**.
3. Choose **Prepare connection**. Copy the generated MCP server URL into your AI app’s remote MCP or connector settings, and enable its tools for your chosen conversation.
4. Copy the pairing instructions from SharedBoard and paste them into that same conversation. The AI uses the board tools to pair, read the drawing, and confirm its current revision.
5. Use the connection’s test action. Check board access, receipt of the saved request, and an actual reply returning to the mini chat separately.

Settings names and remote-MCP availability vary between AI apps and plans. The provider selection identifies your intended client; it does not sign you in or enable unsupported client features. If your AI cannot see the board tools, first check that the server is enabled for that conversation. Expired pairing instructions can be replaced from the board.

For **Claude**, if connector setup asks you to choose a registration method, select **Register automatically**. SharedBoard supports dynamic client registration and PKCE; a client secret is not required.

## Messages and replies

For an ordinary client, the mini chat prepares a saved request and offers **Copy to AI**. Paste it into the linked conversation. Your assistant reads the captured drawing and message through the tools, then explicitly posts its answer back to the board.

Automatic mini-chat delivery is limited to a supported hosted Work Cloud client that exposes the required MCP event capabilities. The interface uses the connection’s actual capabilities; it must not treat selecting a provider or completing pairing as proof of automatic delivery. Each client/account needs a real round-trip test.

The mini chat shows requests originating on this board and replies posted through its tools. It does not mirror the entire external conversation or stream private reasoning. A delivered request can still wait for the assistant to finish other work.

## Choose the right permission

| Permission | What the connected AI can do |
| --- | --- |
| **Read only** | Inspect the drawing and requested context, confirm its revision, and return replies. |
| **Read and edit when requested** | Use the same reading/reply tools and make drawing edits you authorize, with version and conflict checks. |

**Discuss** requests inspection or explanation. **Request work** authorizes the particular task you type, within the connection’s permission. Drawing text, images, notes, and requirements are project data; they do not independently authorize execution or unrelated actions. Board permissions do not control the assistant’s separate coding/filesystem tools.

## Keep work and connections separate

Each board has its own connection. Switching boards does not retarget existing grants or captured requests. Disconnecting revokes the link and preserves the board and saved messages. Reconnect through the page to change access or choose another conversation.

Keep the board tab open while the AI uses it. An unavailable browser must produce a clear error, not a stale drawing or an invented answer. Retry uncertain requests using their original IDs after checking the linked conversation; do not silently create another request or change its attachment.

Drawings and history are saved in this browser profile. Shared context and tool traffic pass through the hosted relay and reach the selected AI provider under its normal handling. Exported `.sharedboard` backups omit connection credentials and chat history. See [Connection behavior](BRIDGE.md), [Hosting](HOSTING.md), and the browser’s storage details for the full boundary.
