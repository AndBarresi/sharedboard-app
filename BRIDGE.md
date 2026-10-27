# Hosted connection behavior

SharedBoard connects the board at **https://sharedboard.app** to a compatible existing AI conversation through the hosted relay at **https://connect.sharedboard.app**. The browser is the authoritative drawing store. SharedBoard does not run a model or require a companion application.

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
| Incoming events verified | The active connection has a supported subscription and a real delivery test. Pairing alone does not establish this. |
| Request queued | Its ID is waiting for a supported delivery route; the assistant has not necessarily received it. |
| Delivery acknowledged | The supported route accepted the event. This is not an assistant answer. |
| Request read | The connected AI used the board tools to read the saved request. |
| Reply received | The AI explicitly posted an answer using the board reply tool. |

The current working connection exposes board tools to the existing AI conversation. The user asks the assistant there to read the drawing or make a requested change. For an existing saved mini-chat request, the assistant retrieves its capture with the board tools and posts its actual answer using **`reply_to_chat_message`**. Both read-only and requested-edit drawing grants permit replies.

Mini chat and **Ask AI to look** can use an actual pending wait in the experimental finite Live collaboration session, or a separately verified incoming-event route. Ordinary remote MCP tools in local Codex and Claude Code do not provide idle-chat wakeup. New board-originated sends remain unavailable without an active route; they do not become copied messages or composer drafts.

## Experimental finite Live collaboration

After pairing, the website supplies one-time **Copy start instructions** under **Start live collaboration · experimental**. The user sends them in the existing AI conversation. This explicitly asks that AI run to keep using a normal remote waiting tool; no iframe, downloaded helper, scheduled monitor, or replacement model is involved.

The first **`wait_for_board_request`** call omits `sessionId` and starts a session scoped to the board, connection, and authorization. Later calls must supply the exact returned ID. A wait defaults to **40 seconds**, is bounded to **45 seconds**, and the session has a **20-minute hard deadline** that repeated waits do not extend. The result contains session and request routing metadata, not a cloud copy of message bodies or drawings.

When a browser request arrives during an actual wait, the relay durably claims its ID before returning it to that waiting tool call. The model must then read the immutable capture, respect its intent, and use **`reply_to_chat_message`** or **`complete_review_request`** for its actual answer. It can enter another wait using the same session ID. A routing receipt or successful wait result does not prove that the capture was read or an answer was generated.

Only an actual, unexpired pending wait enables new mini-chat sends and board reviews. While the AI processes a request or stops waiting, a draft can remain in the page but Send stays unavailable. **Pause live collaboration** on the website releases a pending wait and stops new live delivery. Pause does not delete the board or undo work already performed, and it is not a guarantee that the host aborts an action already running. `stopped`, `expired`, errors, explicit stops, and ended AI runs must terminate the loop without an automatic replacement session or replay of old requests.

This is an active-turn experiment, not an idle-chat wakeup mechanism. The host must keep the run and tool connection alive. Tool approvals, network failures, host timeouts, context or tool limits, and the model deciding to finish can end it sooner. Empty timeout results still require model continuations, so waiting can consume subscription usage and context without new board messages. The browser remains the authoritative store and must stay open.

**Real provider acceptance of the full repeated wait/read/reply loop is outstanding.** Unit, SDK, browser-storage, and Worker transport tests cannot establish that a particular Claude, Codex, or ChatGPT account will keep its model turn running. A provider needs a real repeated-message and review test, including an empty wait, background use, pause, and expiry, before that workflow is described as verified.

## Other delivery paths and observed limits

The experimental **`open_sharedboard_chat`** MCP Apps panel remains diagnostic WIP. In a native Claude test on **2026-10-27**, it rendered and **`ui/message`** filled the composer, but the user still needed to press Send. A **`hostCapabilities.message.text`** flag and a successful RPC response therefore do not prove automatic model execution or a reply. The [composer-behavior explanation in Anthropic's MCP issue tracker](https://github.com/anthropics/claude-ai-mcp/issues/33#issuecomment-3817124671) and an [open request to change it](https://github.com/anthropics/claude-ai-mcp/issues/1111) distinguish drafting from starting a turn. This panel is not used by the live waiting-tool flow.

Native MCP Events remain a separate possible route to configure and test. In both the older and fresh ChatGPT Work Cloud conversations tested on this account, no incoming-event subscription interface was exposed. This does not establish a limitation for every account or host. The committed callback-origin allowlist is empty, and no native production event path is verified. No provider name, successful pairing, UI rendering, or protocol fixture replaces a real host/account send/read/reply test. SharedBoard does not introduce a downloaded helper or replacement hosted model to work around unsupported delivery.

A missing receipt remains uncertain. Keep its original request ID, check the linked conversation, and use the same request for any safe retry. Never change its saved attachment or automatically switch delivery modes after an uncertain attempt. Do not repeat work or overwrite an existing answer when a request was already handled.

## Permissions and revocation

Read-only access permits inspection and replies, while requested-edit access permits authorized drawing changes with version checks. **Discuss** requests explanation only. **Request work** authorizes the specific work described by the user, within the granted permission. Nothing written or embedded on the drawing independently authorizes actions.

A connection belongs to one board. Captured requests remain pinned to that connection even after switching boards. Disconnecting revokes access and leaves saved board data and messages intact. A new connection must not inherit private credentials or silently answer the previous connection’s requests.

Deleting a board or project is different from disconnecting: it permanently removes the confirmed local content. The app previews the target and affected board count, then requires an explicit confirmation. It checks that catalog, drawing, and planning versions still match, revokes only the target boards’ grants, and removes their records, snapshots, connection metadata, and scoped chat drafts. Export wanted backups before confirming. Unrelated boards and grants remain intact. Deleting the current board opens a remaining board without saving the deleted canvas; a blank fallback is created if none remain. Other tabs pinned to a deleted board stop saving and require the user to choose the remaining board.

## Storage and recovery

Ordinary page reloads keep saved browser data on the same origin. Changing hostname, browser profile, or device does not move it. Clearing site data or ending private browsing can remove it. Use **Download board backup** regularly to keep an independent `.sharedboard` backup; those user-data exports are available from the board menu.

Backups contain one board’s drawing, image files, notes, areas, work cards, and reusable blocks. They omit connection credentials, grants, chat/review history, other boards, and checkpoint history. Restore validates a backup and captures current work in recovery before replacing it.

The relay must reject expired or revoked access, wrong-board requests, unsupported actions, and stale revisions. Errors must remain visible. A disconnected browser is never permission to use an older disk-based drawing or manufacture a reply.

Created by [Andrew Barresi](https://github.com/AndBarresi). Project code is [MIT-licensed](LICENSE).
