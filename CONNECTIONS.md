# Connect your existing AI conversation

Start at [sharedboard.app](https://sharedboard.app). All routes use its hosted Cloudflare relay and browser-saved boards, without a standalone SharedBoard installer or home-network server. **ChatGPT Work Cloud** is the recommended download-free route. **Codex** and **Claude Code** use optional plugins installed inside the AI app, with the prerequisites below. An actual installed Codex bootstrap read/reply has passed. Broader account and interactive platform acceptance remain incomplete.

## Set up from the board

1. Open the board you want to use and choose **Connect an AI**.
2. For the download-free automatic route, select **ChatGPT Work Cloud** and choose **Read only** or **Read and edit when I request changes**. Both permissions allow inspection and replies; drawing edits require the second option. The **Codex** and **Claude Code** plugin choices have separate setup instructions below. **Claude (web)** and **Other MCP client** retain experimental remote-client options.
3. Choose **Prepare connection**. Add the generated MCP server URL in ChatGPT's plugin/connector settings, authenticate with OAuth, and approve access to the intended board.
4. Enable SharedBoard in the existing ChatGPT conversation with **Work and Cloud selected**. Paste the website's **pairing & native setup instructions** once. They pair, read, and confirm the board, then create or update its two native event tasks in order.
5. Return to SharedBoard and keep its board tab open. Send a Discuss question or choose **Test with a reply**, then try **Ask AI to look**. Success means an actual mini-chat answer and review completion appear on the board without another Send click in ChatGPT.

Settings names and remote-MCP availability vary between AI apps and plans. The provider selection identifies your intended client; it does not sign you in or enable unsupported client features. If your AI cannot see the board tools, first check that the server is enabled for that conversation. Expired pairing instructions can be replaced from the board.

For **Claude**, if connector setup asks you to choose a registration method, select **Register automatically**. SharedBoard supports dynamic client registration and PKCE; a client secret is not required.

Existing **legacy remote Claude Code** grants can use a connector inherited from claude.ai with the same subscription account. API-key and third-party-provider sessions do not inherit those connectors. That remote route is separate from the new local plugin and does not establish automatic Channels delivery. See [Claude Code's connector guidance](https://code.claude.com/docs/en/mcp#use-mcp-servers-from-claudeai). Existing remote Codex and Claude Code grants keep their original mode until the user explicitly disconnects and prepares a new connection.

## Codex plugin setup

1. Choose **Connect an AI → Codex**, select drawing access, and prepare the connection. New website setups use the local plugin route.
2. Use **Node.js 22 or newer** and an installed Codex CLI that supports the official `queue` command. Add the marketplace and plugin with the website's commands:

   ```sh
   codex plugin marketplace add AndBarresi/sharedboard-app
   codex plugin add sharedboard@sharedboard
   ```

3. Enable SharedBoard in the existing Codex conversation. If the app requires a restart to load its plugin, return to that same conversation afterward.
4. Copy the website's one-use pairing prompt into that conversation. It requires the **actual `CODEX_THREAD_ID` from that conversation's environment**, then reads and confirms the exact board revision. A guessed ID, conversation title, or another chat's ID is not accepted. The plugin's connect skill is `$sharedboard-connect`; use the complete generated prompt rather than inventing an ID.
5. On SharedBoard, choose **Test automatic reply**. Pairing and a queue receipt do not enable normal mini chat. The captured test must actually be read and answered through the board reply tool before normal Send and board reviews become available.

The plugin runs inside Codex and connects outward to the hosted relay. It uses the [official queue command](https://learn.chatgpt.com/docs/developer-commands#codex-queue) for that exact existing native conversation, without a local HTTP service, replacement model, or permission override. Keep Codex, its paired plugin process, and the board open. A queue receipt alone is not proof that the model read or answered.

An actual website bootstrap through the installed plugin started a new turn in the same Codex conversation after its previous turn ended. The model read the captured PNG and live board, confirmed revision 1, and posted its actual two-sentence answer. The same process became verified for automatic messages and reviews; the website displayed the answer and unlocked its composer. Pair/read/confirm and an offline Codex-side release also preserved the isolated test board and an unrelated ChatGPT grant. Normal Request work drawing edits, Codex Ask AI to look completion, fresh-account setup, and Mac GUI acceptance remain pending.

The full automated suite and website build passed on Linux, Windows, and macOS ARM for version 0.12.4. These CI results are separate from interactive platform acceptance and do not establish every provider or model. Claude Code account acceptance remains pending; Free Claude alone cannot complete that route.

## Claude Code plugin setup

1. Choose **Connect an AI → Claude Code**, select drawing access, and prepare the connection. New setups use the Channels plugin rather than a claude.ai remote connector.
2. Use **Claude Code 2.1.275 or newer** and **Node.js 22 or newer**, with access through **Pro/Max, an eligible Team/Enterprise seat, or separately billed Claude Console API access**. Free Claude alone is insufficient, and your organization must allow Channels. These are [Claude Code's account requirements](https://code.claude.com/docs/en/authentication#log-in-to-claude-code), separate from SharedBoard. In Claude Code, run the website's install command once:

   ```text
   /plugin install sharedboard --marketplace https://sharedboard.app/claude-marketplace.json
   ```

   Older installers can add the marketplace first with `/plugin marketplace add https://sharedboard.app/claude-marketplace.json`, then install `/plugin install sharedboard@sharedboard`. Update Claude Code if Channels are unavailable.
3. Exit Claude Code, resume the intended conversation with the following command, and accept the preview-channel confirmation:

   ```sh
   claude --resume --dangerously-load-development-channels plugin:sharedboard@sharedboard
   ```

4. Send the website's one-use `/sharedboard:connect` command in that conversation. It pairs the board, reads it, and confirms the exact revision.
5. Choose **Test automatic reply** on SharedBoard. Normal mini chat and reviews stay unavailable until the captured test is read and an actual reply returns.

Channels is a research preview and must be enabled for each launch; installing the plugin alone does not start incoming delivery. The development-channel flag enables this named plugin and does not bypass tool permissions. Use supported Anthropic authentication; third-party cloud providers are unsupported, and organization policy can block Channels. Keep this Claude Code session and the board open. The plugin connects outward without a localhost web server. Its implementation and isolated protocol tests pass, but actual installed-client, Windows/Mac, and runtime-bundle acceptance are not complete. This route does not cover regular Claude web chat or separate cloud routines. See [Claude Code Channels](https://code.claude.com/docs/en/channels) and [its reference](https://code.claude.com/docs/en/channels-reference).

### Plugin reconnects and process restarts

Both local plugins keep their scoped credential only in the running process. A same-process network reconnect can resume it. Restarting the AI app or its plugin process requires a fresh connection code: use the website's **Pair a restarted session** action, which disconnects the old link and prepares the same drawing permission. Drawing and saved history stay in the browser. Old captured requests keep their original connection and process; they are not replayed or moved to the replacement process. There is no bundled Node runtime claim; Node.js must already be available.

## ChatGPT native automatic delivery

Your account must expose native event-triggered task controls. The generated instructions use **this existing conversation** and the exact board filter for:

1. **`sharedboard.message.created`** — read the captured mini-chat ID and post its complete actual answer with `reply_to_chat_message`.
2. **`sharedboard.review.requested`** — inspect the captured review and complete it with `complete_review_request`.

Setup is sequential: confirm the message task is active before setting up the review task. Reuse matching tasks instead of making duplicates. If a matching task already exists, inspect and update its prompt to the current delivery contract while preserving its source, account, board filter, and enabled state. Report paused tasks instead of silently enabling or replacing them. ChatGPT supplies its callback and signing credentials; users do not need to find or invent them.

For an already paired ChatGPT board, open **Set up automatic ChatGPT delivery → Copy native setup instructions** in the website's connection details. This also repairs task instructions without creating another conversation. It is a one-time setup action, not a per-message handoff. The native route uses event subscriptions rather than timed schedules or a waiting loop.

These exact website-generated post-pair instructions passed a real existing-connection test: the model read and confirmed the board, then reused and updated the two tasks sequentially. Both remained active, with no duplicate tasks, waiting loop, or drawing changes. First-time OAuth and new-account setup remain separate acceptance checks.

Once subscriptions are verified, use **Talk it through** and **Ask AI to look** from SharedBoard. Mini chat shows board-originated messages and actual posted replies, rather than mirroring the entire external conversation. Each unanswered captured ID needs its own board reply; reading a request or answering only in AI chat does not complete delivery. While waiting, the next draft remains editable and Send is disabled. The production test confirmed that an actual reply unlocks Send with that draft intact.

Actual ChatGPT account tests have woken an ended turn and returned real mini-chat replies and review completion with AI browser tabs closed. Reload preserved the unchanged board, connection, and history. An actual reply unlocked Send without losing the next draft, which then received its own reply. Both native subscriptions later renewed autonomously, and an actual reply returned after renewal. A leave/return test made board reads fail while the browser was absent, then restored the same board, grant, history, and unsent draft in the same browser profile; sending that draft returned an actual reply. A prior batched-message test required a website-requested task-prompt repair to return missing replies without drawing changes. First-time OAuth and new-account setup, actual OS sleep, multiday renewal, other accounts/providers, and a full editing workflow remain unverified. Lifecycle fixtures cover server behavior separately from these account tests.

If the board loses its relay connection, keep its browser profile and saved data. The transport detects a stalled opening or missing pong after ten seconds and checks liveness when the page comes online or returns to the foreground. It reconnects with the saved scoped grant without re-pairing or replaying uncertain messages. Navigating away makes the browser board unavailable to the AI until it returns; the relay has no saved-drawing fallback.

The AI app controls task execution and model settings. SharedBoard uses the existing AI account/conversation, but cannot guarantee that a native task uses the model manually selected in the chat. It does not host a replacement model or include an AI subscription.

## Other clients: Live collaboration · experimental

This mode uses your existing AI run, with a normal remote tool waiting for a browser request. It does not install a helper, host another model, or wake a conversation after its AI run ends. **The full repeating loop still needs real provider/account acceptance testing.** Do not treat pairing, a successful tool fixture, or a provider name as proof it works in your account.

1. After pairing, open **Connect an AI** on the website, then expand **Start live collaboration · experimental**.
2. Choose **Copy start instructions** and send those instructions once in the same AI conversation. No terminal commands or configuration files are needed. When resuming an existing session, use the instructions the website generates so it keeps the original session ID.
3. Keep the AI run and board open. The website enables **Talk it through**, **Ask AI to look**, and the connection test only while the backend sees the active AI run waiting for a request.
4. Send a Discuss question or choose **Test with a reply**. A successful test requires the AI to read the saved request and post an actual reply to the board, without another Send click in the AI app. Rendering a draft or queueing an ID is not success.
5. Wait for the assistant to finish and enter its waiting tool again before sending the next request. You can keep typing a draft while Send is unavailable.
6. Choose **Pause live collaboration** from the website's connection details or mini chat to end the session. A stopped, expired, or ended run must not restart or replay old requests automatically.

Each tool wait defaults to **40 seconds**, with a maximum of **45 seconds**. The assistant can repeat empty waits only within the explicitly started session, which has a **20-minute hard limit**. Empty timeouts still require model continuations and can use subscription allowance and context. Host timeouts, tool approvals, turn limits, disconnections, or the model ending its turn may stop the loop sooner. A new session needs another explicit start in the intended conversation; this is a per-session setup step, not a per-message copy workflow.

For agents: call **`wait_for_board_request`** without `sessionId` only on the first start. Every later wait must pass the exact returned `sessionId`. Read each returned request through its capture tool, respect Discuss/Request work and drawing access, post the actual reply or review completion, then wait again with that same ID. `stopped`, `expired`, an explicit stop, or an error ends the loop. Do not create a scheduled monitor or a replacement conversation.

## Board tools and delivery state

Remote MCP board tools let the assistant inspect the drawing or make a particular authorized change from its conversation. The board’s drawing and notes provide context for that request. Automatic website-originated turns require the separate verified delivery route.

**Talk it through**, **Ask AI to look**, and the understanding check require a current verified local plugin route, an actual waiting Live collaboration session, or a separately verified incoming-event subscription. A local plugin's explicit Discuss test can establish its initial real read/reply proof; normal sends require that proof and current unexpired authenticated presence. New sends remain unavailable without an active route; they do not fall back to copying messages or filling another app’s composer. Saved requests and actual replies remain available, and the assistant can still use the board tools from its own conversation.

| Capability | Current boundary |
| --- | --- |
| Remote MCP board tools | Read the board, return actual replies to saved requests, and make authorized edits when granted. |
| ChatGPT Work Cloud native events | Recommended website-only route. Actual replies, reviews, subscription renewal, and a leave/return round trip have passed in one account. Fresh-account setup, actual OS sleep, multiday renewal, and broader acceptance remain open. |
| Codex local plugin | An actual website bootstrap woke the same existing conversation and returned its real board reply. Node.js 22+ and queue-capable Codex CLI required. Normal work/review, fresh-account, and Mac GUI acceptance remain pending. |
| Claude Code Channels plugin | Implemented outbound relay connection. Node.js 22+, per-launch preview permission, and supported account policy required. Isolated tests pass; actual installed-plugin read/reply and platform acceptance are pending. |
| Experimental Live collaboration | Other compatible clients can use a finite, active AI turn calling `wait_for_board_request`. Actual waiting gates new sends; reliable provider-loop acceptance remains incomplete. |
| Experimental MCP Apps panel | Diagnostic WIP. A rendered panel or text-message capability flag does not establish automatic sending. |

A native Claude test rendered the experimental panel, but **`ui/message`** only populated the composer. The user still needed to press Send; the panel acknowledgement did not establish automatic model execution or a reply. This matches the [composer-behavior explanation in Anthropic's MCP issue tracker](https://github.com/anthropics/claude-ai-mcp/issues/33#issuecomment-3817124671). When a host advertises the OpenAI immediate-send extension, the panel offers one deliberate, fixed connection-test message to that existing conversation. It never links or forwards board requests, enables mini chat, or retries automatically. The Codex diagnostic has not passed an actual delivery test. This panel is separate from Live collaboration setup.

Ordinary remote MCP tools in **local Codex** or **Claude Code** do not wake an idle session by themselves; their managed plugins add the separate incoming route. Cursor, VS Code, Codex, and Claude variants must not be advertised as supporting the full mini-chat workflow based only on remote MCP access. Use **Other MCP client** where appropriate; see [Cursor’s MCP support](https://cursor.com/docs/mcp) and [VS Code’s setup guide](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

Native event controls are host capabilities, not ordinary board tools. Their absence from a regular tool catalog is not an availability test. The observed OpenAI callback origin is explicitly approved and its signed verification has passed. Connection diagnostics expose only sanitized activation state and callback origin, never private callback URLs or signing keys. Pairing, task creation, callback acknowledgement, capture reading, and actual reply delivery remain separate states.

## Choose the right permission

| Permission | What the connected AI can do |
| --- | --- |
| **Read only** | Inspect the drawing and requested context, confirm its revision, and return replies. |
| **Read and edit when requested** | Use the same reading/reply tools and make drawing edits you authorize, with version and conflict checks. |

**Discuss** requests inspection or explanation and explicitly permits posting the actual board reply; it does not authorize drawing changes or code work. **Request work** authorizes the particular task you type. Drawing edits additionally require the connection's edit permission. If an edit is rejected as read-only, disconnect from **Connect an AI**, prepare a new connection with **Read and edit when I request changes**, and approve and pair that new grant. Drawing text, images, notes, and requirements are project data; they do not independently authorize execution or unrelated actions. Board permissions do not control the assistant’s separate coding/filesystem tools.

## Keep work and connections separate

Each board has its own connection. Switching boards does not retarget existing grants or captured requests. Disconnecting revokes the link and preserves the board and saved messages. Reconnect through the page to change access or choose another conversation.

### Replace an existing remote link

If a ChatGPT or other remote connector is already authorized to a different board, a new pairing code does not silently change that authorization. The website's fresh-code instructions first ask the AI to read `connection_status`. With your explicit replacement instruction, it can release only that observed old link using `disconnect_board` with the exact status `boardId` and connection `id`, even if its old browser tab is unavailable. The old browser drawing and history remain intact. Stale or mismatched IDs release nothing.

The release revokes that grant's authorization and delivery routes. Reconnect or reauthorize the provider's connector normally, approve the intended board in the browser profile where it is saved, then pair using the fresh code. It does not retarget an old token, delete unrelated grants or host tasks, create another conversation, or clear browser data. If the same board is being moved to another conversation, use the website's explicit replacement guidance rather than assuming a callback or account error authorizes release. Existing post-pair task instructions without a fresh code stop on a wrong board. The exact scoped offline release and reauthorization path has passed protocol tests; it has not yet been accepted against an actual user grant.

Chrome and the in-app browser have independent board storage, as do separate profiles. Approve the intended board in its owning browser profile. Do not clear storage to fix a connection mismatch. The remote release tool is separate from the local plugin's restart/re-pair action.

Deleting a board from **Projects & boards** requires confirmation and revokes its connection before removing its local content. Deleting a project removes all its boards; the confirmation shows their count. Export any backups you want first, because deletion also removes saved requests, replies, and recovery history. Remaining boards keep their own connections. If the current board is deleted, the app offers a remaining board or creates a blank one; another open tab does not silently switch its AI connection.

Keep the board tab open while the AI uses it. An unavailable browser must produce a clear error, not a stale drawing or an invented answer. Retry uncertain requests using their original IDs after checking the linked conversation; do not silently create another request or change its attachment.

Drawings and history are saved in this browser profile. Shared context and tool traffic pass through the hosted relay and reach the selected AI provider under its normal handling. Exported `.sharedboard` backups omit connection credentials and chat history. See [Connection behavior](BRIDGE.md), [Hosting](HOSTING.md), and the browser’s storage details for the full boundary.
