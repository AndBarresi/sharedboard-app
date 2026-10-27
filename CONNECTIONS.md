# Connect your existing AI conversation

Start at [sharedboard.app](https://sharedboard.app). SharedBoard uses a hosted Cloudflare relay and remote MCP tools; no SharedBoard software needs to be installed on your computer.

## Set up from the board

1. Open the board you want to use and choose **Connect an AI**.
2. Select **Codex**, **Claude Code**, **ChatGPT**, **Claude (web)**, or **Other MCP client**, then choose **Read only** or **Read and edit when I request changes**. Both permissions allow inspection and replies; drawing edits require the second option. Automatic messages need a separate supported delivery route.
3. Choose **Prepare connection**. Copy the generated MCP server URL into your AI app’s remote MCP or connector settings, and enable its tools for your chosen conversation.
4. Copy the pairing instructions from SharedBoard and paste them into that same conversation. The AI uses the board tools to pair, read the drawing, and confirm its current revision.
5. Keep the browser board open. In that AI conversation, ask the assistant to read the board and report its exact revision. To test editing, grant requested-edit access and ask it to add a small disposable shape, then check the live board.

Settings names and remote-MCP availability vary between AI apps and plans. The provider selection identifies your intended client; it does not sign you in or enable unsupported client features. If your AI cannot see the board tools, first check that the server is enabled for that conversation. Expired pairing instructions can be replaced from the board.

For **Claude**, if connector setup asks you to choose a registration method, select **Register automatically**. SharedBoard supports dynamic client registration and PKCE; a client secret is not required.

For **Claude Code**, the website-led setup uses a connector added at claude.ai, then inherited by Claude Code signed in with that same claude.ai subscription account. API-key and third-party-provider sessions do not inherit those connectors. Check that SharedBoard appears in the intended session's connector settings before using the board pairing instructions. See [Claude Code's connector guidance](https://code.claude.com/docs/en/mcp#use-mcp-servers-from-claudeai).

## Start Live collaboration · experimental

This mode uses your existing AI run, with a normal remote tool waiting for a browser request. It does not install a helper, host another model, or wake a conversation after its AI run ends. **The full repeating loop still needs real provider/account acceptance testing.** Do not treat pairing, a successful tool fixture, or a provider name as proof it works in your account.

1. After pairing, open **Connect an AI** on the website, then expand **Start live collaboration · experimental**.
2. Choose **Copy start instructions** and send those instructions once in the same AI conversation. No terminal commands or configuration files are needed. When resuming an existing session, use the instructions the website generates so it keeps the original session ID.
3. Keep the AI run and board open. The website enables **Talk it through**, **Ask AI to look**, and the connection test only while the backend sees the active AI run waiting for a request.
4. Send a Discuss question or choose **Test with a reply**. A successful test requires the AI to read the saved request and post an actual reply to the board, without another Send click in the AI app. Rendering a draft or queueing an ID is not success.
5. Wait for the assistant to finish and enter its waiting tool again before sending the next request. You can keep typing a draft while Send is unavailable.
6. Choose **Pause live collaboration** from the website's connection details or mini chat to end the session. A stopped, expired, or ended run must not restart or replay old requests automatically.

Each tool wait defaults to **40 seconds**, with a maximum of **45 seconds**. The assistant can repeat empty waits only within the explicitly started session, which has a **20-minute hard limit**. Empty timeouts still require model continuations and can use subscription allowance and context. Host timeouts, tool approvals, turn limits, disconnections, or the model ending its turn may stop the loop sooner. A new session needs another explicit start in the intended conversation; this is a per-session setup step, not a per-message copy workflow.

For agents: call **`wait_for_board_request`** without `sessionId` only on the first start. Every later wait must pass the exact returned `sessionId`. Read each returned request through its capture tool, respect Discuss/Request work and drawing access, post the actual reply or review completion, then wait again with that same ID. `stopped`, `expired`, an explicit stop, or an error ends the loop. Do not create a scheduled monitor or a replacement conversation.

## Board tools and automatic messages

The working workflow starts in your existing AI conversation: ask the assistant to inspect the board or make a particular authorized change. The board’s drawing and notes provide context for that request. Remote MCP access does not by itself let the website start a new assistant turn.

**Talk it through**, **Ask AI to look**, the understanding check, and board-originated connection tests require either an actual waiting Live collaboration session or a separately verified incoming-event subscription. New sends remain unavailable while neither route is active; they do not fall back to copying messages or filling another app’s composer. Saved requests and actual replies remain available, and the assistant can still use the board tools from its own conversation.

| Capability | Current boundary |
| --- | --- |
| Remote MCP board tools | Read the board, return actual replies to saved requests, and make authorized edits when granted. |
| Experimental Live collaboration | A finite, active AI turn calls `wait_for_board_request`, reads browser requests, replies, and waits again. Actual waiting gates new sends; full provider-loop acceptance is outstanding. |
| Incoming MCP Events | A possible automatic route for a compatible host, after operator configuration and a real send/read/reply test. No production route is currently verified. |
| Experimental MCP Apps panel | Diagnostic WIP. A rendered panel or text-message capability flag does not establish automatic sending. |

On **2026-10-27**, a native Claude test rendered the experimental panel, but **`ui/message`** only populated the composer. The user still needed to press Send; the panel acknowledgement did not establish automatic model execution or a reply. This matches the [composer-behavior explanation in Anthropic's MCP issue tracker](https://github.com/anthropics/claude-ai-mcp/issues/33#issuecomment-3817124671). The diagnostic panel is separate from the plain waiting tool and is not part of Live collaboration setup.

Ordinary remote MCP tools in **local Codex** or **Claude Code** do not wake an idle session by themselves. Claude Code’s separate Channels mechanism is not implemented by this hosted connector. Cursor, VS Code, Codex, and Claude variants must not be advertised as supporting the full mini-chat workflow based only on remote MCP access. Use **Other MCP client** where appropriate; see [Cursor’s MCP support](https://cursor.com/docs/mcp) and [VS Code’s setup guide](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

Native events remain an option to test separately. Both an older and a fresh ChatGPT Work Cloud conversation on the tested account lacked an exposed incoming-event subscription interface. That is evidence about those tested sessions, not a claim that all accounts or hosts lack support. The committed callback-origin allowlist is empty, so native events are not a verified production feature. The finite waiting-tool experiment does not depend on that interface.

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
