# Hosted connection behavior

SharedBoard connects the board at **https://sharedboard.app** to a compatible existing AI account/conversation through the hosted relay at **https://connect.sharedboard.app**. The recommended automatic route uses ChatGPT Work with Cloud selected and native event tasks. The browser is the authoritative drawing store. SharedBoard does not run a model or require a companion application; the AI provider controls model execution and task settings.

For setup, follow [Connect your existing AI conversation](CONNECTIONS.md). Always use the server URL and pairing instructions generated for the intended board; do not guess a conversation or board ID.

## What travels with a request

A mini-chat message is saved with its text, intent, drawing revision, planning revision, selected scope, relevant notes, and captured PNG before it is handed to the AI. **Whole board**, **Current selection**, and **Named area** define that scope. A later drawing or note change does not rewrite a request already sent. The relay queue holds request IDs and delivery metadata rather than the captured message text, drawing, or reply.

The assistant reads that captured request through the board tools. Before making an authorized drawing change, it must also read the live board and use its current object versions. A stale or overlapping edit is rejected rather than silently overwriting newer work.

Your board and chat history stay in this browser profile, while the relay processes authorization, routing, tool traffic, and the context being shared. Your AI provider receives the context its tools read. Keep the browser tab open while the connected assistant works.

## Delivery is a capability, not a promise

| State | What it establishes |
| --- | --- |
| Pairing completed | The client has a scoped connection to this board. |
| Board access verified | The AI actually read and confirmed a current board revision. |
| Panel rendered or composer filled | A diagnostic UI operation succeeded. This does not show that a message was sent or an assistant turn started. |
| Live session actually waiting | An active model turn has a pending `wait_for_board_request` call for this board and session. New sends can be accepted while that wait remains valid. |
| Live session processing | A waiting call returned a request, or no new pending wait is observed. New sends stay unavailable; the current draft is retained. |
| Native subscription verified | The host's signed callback verification succeeded for an active, board-scoped subscription. This enables event delivery but does not by itself prove that a model read or answered a request. |
| Request queued | Its ID is waiting for a supported delivery route; the assistant has not necessarily received it. |
| Delivery acknowledged | The supported route accepted the event. This is not an assistant answer. |
| Request read | The connected AI used the board tools to read the saved request. |
| Reply received | The AI explicitly posted an answer using the board reply tool. |

For a delivered mini-chat request, the assistant retrieves its immutable capture and posts its complete actual answer using **`reply_to_chat_message`**. Both read-only and requested-edit drawing grants permit this reply. Every unanswered delivered ID must be completed separately, including batches. Skip only an actual existing `message.reply`, without repeating work or overwriting it. An answer only in AI chat, reading status, or an acknowledgement does not complete board delivery.

Mini chat and **Ask AI to look** use their verified incoming-event subscriptions, or an actual pending wait in the experimental finite route for other clients. Ordinary remote MCP tools in local Codex and Claude Code do not provide idle-chat wakeup. New board-originated sends remain unavailable without an active route; they do not become copied messages or composer drafts. Native mini chat keeps the next draft while a previous reply remains outstanding.

## ChatGPT Work Cloud native events

The website's initial pairing instructions activate board access, read and confirm its exact revision, then create or update two native event tasks sequentially in the existing conversation. The tasks use **`sharedboard.message.created`** and **`sharedboard.review.requested`**, each filtered to the exact authorized board. Setup reuses matching tasks, updates their prompts to the current delivery contract, and preserves their source, account, filter, and enabled state. It does not create duplicates or time-based polling schedules.

The website-generated post-pair instructions passed a real setup-reuse test in the existing conversation: the board was read and confirmed, then both tasks were reused and updated sequentially. Both stayed active, with no duplicates, waiting loop, or drawing changes. This is existing-account acceptance, not first-time OAuth or a new-account test.

The host generates callback credentials. The relay approves only explicitly reviewed HTTPS callback origins; the observed OpenAI origin **`https://connectors.api.openai.com`** is configured and its signed verification has passed. The native fetch callback path is covered by a workerd regression. Activation diagnostics contain a fixed outcome/reason and sanitized callback origin, never a private callback URL or signing key.

After a website request is captured, the relay sends its routing metadata to the host. A native task starts a model turn even after the setup turn has ended, reads the saved request from the browser, and posts its actual answer or review completion. No active waiting tool or open AI browser tab is required by the tested path. The browser board itself must remain open and reachable.

Actual account tests have verified an ended-turn wake, mini-chat answers, and captured reviews with AI browser tabs closed. Reload preserved the unchanged board, connection, and history. After an idle period, an actual reply unlocked Send with the next editable draft intact; that draft then received its own reply. Both native subscriptions later renewed autonomously, with an actual reply verified after renewal. Navigating away made the browser report offline and board reads fail explicitly. Returning in the same browser profile restored the same board, grant, history, and unsent draft; sending it returned an actual reply. A prior burst required a website-requested task-prompt repair to return missing replies without drawing changes. First-time OAuth and new-account setup, actual OS sleep, multiday renewal, other accounts/providers, and a full editing workflow remain unverified.

Focused lifecycle tests cover independent concurrent renewals, scoped and full revocation, signing-key rotation, late 410 responses, and receipt preservation. They establish server behavior separately from the observed account renewal; neither establishes permanent connectivity.

SharedBoard does not select or host a replacement model. The provider controls task execution and settings; a native task is not guaranteed to use the model manually selected in a conversation.

## Other clients: experimental finite Live collaboration

After pairing, the website supplies one-time **Copy start instructions** under **Start live collaboration · experimental**. The user sends them in the existing AI conversation. This explicitly asks that AI run to keep using a normal remote waiting tool; no iframe, downloaded helper, scheduled monitor, or replacement model is involved.

The first **`wait_for_board_request`** call omits `sessionId` and starts a session scoped to the board, connection, and authorization. Later calls must supply the exact returned ID. A wait defaults to **40 seconds**, is bounded to **45 seconds**, and the session has a **20-minute hard deadline** that repeated waits do not extend. The result contains session and request routing metadata, not a cloud copy of message bodies or drawings.

When a browser request arrives during an actual wait, the relay durably claims its ID before returning it to that waiting tool call. The model must then read the immutable capture, respect its intent, and use **`reply_to_chat_message`** or **`complete_review_request`** for its actual answer. It can enter another wait using the same session ID. A routing receipt or successful wait result does not prove that the capture was read or an answer was generated.

Only an actual, unexpired pending wait enables new mini-chat sends and board reviews. While the AI processes a request or stops waiting, a draft can remain in the page but Send stays unavailable. **Pause live collaboration** on the website releases a pending wait and stops new live delivery. Pause does not delete the board or undo work already performed, and it is not a guarantee that the host aborts an action already running. `stopped`, `expired`, errors, explicit stops, and ended AI runs must terminate the loop without an automatic replacement session or replay of old requests.

This is an active-turn experiment, not an idle-chat wakeup mechanism. The host must keep the run and tool connection alive. Tool approvals, network failures, host timeouts, context or tool limits, and the model deciding to finish can end it sooner. Empty timeout results still require model continuations, so waiting can consume subscription usage and context without new board messages. The browser remains the authoritative store and must stay open.

Reliable acceptance of the full finite loop remains incomplete. Unit, SDK, browser-storage, and Worker transport tests do not establish that a particular account will keep its model turn running. Each client needs actual repeated-message, review, empty-wait, background, pause, and expiry tests. ChatGPT's recommended native route is separate and does not depend on this loop.

## Other delivery paths and observed limits

The experimental **`open_sharedboard_chat`** MCP Apps panel remains diagnostic WIP. In a native Claude test, it rendered and **`ui/message`** filled the composer, but the user still needed to press Send. A **`hostCapabilities.message.text`** flag and a successful RPC response therefore do not prove automatic model execution or a reply. The [composer-behavior explanation in Anthropic's MCP issue tracker](https://github.com/anthropics/claude-ai-mcp/issues/33#issuecomment-3817124671) and an [open request to change it](https://github.com/anthropics/claude-ai-mcp/issues/1111) distinguish drafting from starting a turn.

Only a host advertising the OpenAI immediate-send extension receives the optional one-off diagnostic. A deliberate user click sends a fixed harmless test to the existing conversation; it does not attach a link, forward a capture, enable automatic routing, or retry. An accepted diagnostic still needs an actual model response, and the Codex test remains unverified. The panel is not used by the live waiting-tool flow.

[Claude Code Channels](https://code.claude.com/docs/en/channels-reference) is the approved direction for automatic Claude delivery. The planned plugin is installed and managed inside Claude Code and runs as its local stdio process, connecting outward to SharedBoard's hosted relay. This is a specific exception to the default installation-free flow, not a standalone bridge installer or home-network server. Native plugin setup and launch requirements still need verification. Implementation, Windows/Mac acceptance, and actual automatic replies are not complete. The existing Claude Code session must stay open; regular Claude web chat is not covered. Cloud routines create separate sessions and are not the chosen path.

Native task discovery belongs to the AI host; it is not an ordinary board tool. Inspecting only a regular tool catalog cannot establish whether the host exposes that capability. No provider name, successful pairing, UI rendering, or protocol fixture replaces a real account send/read/reply test. Unsupported clients remain limited to their verified tools or experimental finite mode, without a downloaded helper or replacement hosted model.

A missing receipt remains uncertain. Keep its original request ID, check the linked conversation, and use the same request for any safe retry. Never change its saved attachment or automatically switch delivery modes after an uncertain attempt. Do not repeat work or overwrite an existing answer when a request was already handled.

## Permissions and revocation

Read-only access permits inspection and replies, while requested-edit access permits authorized drawing changes with version checks. **Discuss** permits explanation and posting its actual board reply, but no drawing or code work. **Request work** authorizes the specific typed task; drawing edits additionally require the drawing grant. Nothing written or embedded on the drawing independently authorizes actions.

A connection belongs to one board. Captured requests remain pinned to that connection even after switching boards. Disconnecting revokes access and leaves saved board data and messages intact. A new connection must not inherit private credentials or silently answer the previous connection’s requests.

Deleting a board or project is different from disconnecting: it permanently removes the confirmed local content. The app previews the target and affected board count, then requires an explicit confirmation. It checks that catalog, drawing, and planning versions still match, revokes only the target boards’ grants, and removes their records, snapshots, connection metadata, and scoped chat drafts. Export wanted backups before confirming. Unrelated boards and grants remain intact. Deleting the current board opens a remaining board without saving the deleted canvas; a blank fallback is created if none remain. Other tabs pinned to a deleted board stop saving and require the user to choose the remaining board.

## Storage and recovery

Ordinary page reloads keep saved browser data on the same origin. Changing hostname, browser profile, or device does not move it. Clearing site data or ending private browsing can remove it. Use **Download board backup** regularly to keep an independent `.sharedboard` backup; those user-data exports are available from the board menu.

The browser relay detects a stalled connection opening or missing pong after ten seconds. Online, pageshow, focus, and visible-page events check liveness and restore the same scoped grant without re-pairing or replaying uncertain requests. Isolated tests cover retained IndexedDB state and transport races. The observed navigation-away/return test also preserved the unsent draft and completed a real round trip after return; it is not an actual OS sleep test.

Backups contain one board’s drawing, image files, notes, areas, work cards, and reusable blocks. They omit connection credentials, grants, chat/review history, other boards, and checkpoint history. Restore validates a backup and captures current work in recovery before replacing it.

The relay must reject expired or revoked access, wrong-board requests, unsupported actions, and stale revisions. Errors must remain visible. A disconnected browser is never permission to use an older disk-based drawing or manufacture a reply.

Created by [Andrew Barresi](https://github.com/AndBarresi). Project code is [MIT-licensed](LICENSE).
