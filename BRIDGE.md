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
| Conversation panel linked | A host-mounted MCP Apps panel passed its text-messaging capability check and the user clicked **Link this chat**. |
| Request queued | Its ID is waiting for the linked panel; the assistant has not necessarily received it. |
| Host accepted the message | The panel’s host acknowledged insertion into its existing conversation. This is not an assistant answer. |
| Request read | The connected AI used the board tools to read the saved request. |
| Reply received | The AI explicitly posted an answer using the board reply tool. |

The assistant opens **`open_sharedboard_chat`** inside the existing conversation. Its MCP Apps panel checks **`hostCapabilities.message.text`**, then lets the user link forwarding to that conversation. While the linked panel and browser board remain open, it claims a queued request ID, asks its host to add the saved request instructions as a user message, and records the host’s acknowledgement. The assistant retrieves the actual captured context from the browser through its tools and posts its answer with **`reply_to_chat_message`**. Individual messages do not require copying and pasting. Both read-only and requested-edit drawing access permit this reply path.

A host without MCP Apps text messaging can still have working board tools, but those tools do not provide idle-chat wakeup. This matters for ordinary remote MCP connections in local Codex and Claude Code. Do not infer full messaging support from a client name, pairing, or protocol fixtures: each host/account needs a real send and reply test. New mini-chat sends stop when the supported route is unavailable; they do not silently become copied requests.

Incoming MCP Events are a separate possible route for hosts such as ChatGPT Work Cloud. The committed deployment has no approved callback origins configured, and this route has not been verified as active. It must not be presented as a working fallback for a closed or unsupported panel.

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
