# Hosted connection behavior

SharedBoard connects the board at **https://sharedboard.app** to a compatible existing AI conversation through the hosted relay at **https://connect.sharedboard.app**. The browser is the authoritative drawing store. SharedBoard does not run a model or require a companion application.

For setup, follow [Connect your existing AI conversation](CONNECTIONS.md). Always use the server URL and pairing instructions generated for the intended board; do not guess a conversation or board ID.

## What travels with a request

A mini-chat message is saved with its text, intent, drawing revision, planning revision, selected scope, relevant notes, and captured PNG before it is handed to the AI. **Whole board**, **Current selection**, and **Named area** define that scope. A later drawing or note change does not rewrite a request already sent.

The assistant reads that captured request through the board tools. Before making an authorized drawing change, it must also read the live board and use its current object versions. A stale or overlapping edit is rejected rather than silently overwriting newer work.

Your board and chat history stay in this browser profile, while the relay processes authorization, routing, tool traffic, and the context being shared. Your AI provider receives the context its tools read. Keep the browser tab open while the connected assistant works.

## Delivery is a capability, not a promise

| State | What it establishes |
| --- | --- |
| Pairing completed | The client has a scoped connection to this board. |
| Board access verified | The AI actually read and confirmed a current board revision. |
| Copy to AI ready | A saved request has instructions you can paste; it has not necessarily reached the AI yet. |
| Request received | The connected AI read the saved request, or a supported event delivery was acknowledged. |
| Reply received | The AI explicitly posted an answer using the board reply tool. |

Ordinary remote MCP clients use the explicit **Copy to AI** workflow. Automatic requests are enabled only for a supported hosted Work Cloud client with the required MCP event capabilities. Pairing and a successful protocol fixture alone do not establish that a particular provider/account supports automatic delivery.

A missing receipt remains uncertain. Keep its original request ID, check the linked conversation, and use the same request for any safe retry. Never change its saved attachment or automatically switch delivery modes after an uncertain attempt. Do not repeat work or overwrite an existing answer when a request was already handled.

## Permissions and revocation

Read-only access permits inspection and replies, while requested-edit access permits authorized drawing changes with version checks. **Discuss** requests explanation only. **Request work** authorizes the specific work described by the user, within the granted permission. Nothing written or embedded on the drawing independently authorizes actions.

A connection belongs to one board. Captured requests remain pinned to that connection even after switching boards. Disconnecting revokes access and leaves saved board data and messages intact. A new connection must not inherit private credentials or silently answer the previous connection’s requests.

## Storage and recovery

Ordinary page reloads keep saved browser data on the same origin. Changing hostname, browser profile, or device does not move it. Clearing site data or ending private browsing can remove it. Use **Export board** regularly to keep an independent `.sharedboard` backup; those user-data exports are available from the board menu.

Backups contain one board’s drawing, image files, notes, areas, work cards, and reusable blocks. They omit connection credentials, grants, chat/review history, other boards, and checkpoint history. Restore validates a backup and captures current work in recovery before replacing it.

The relay must reject expired or revoked access, wrong-board requests, unsupported actions, and stale revisions. Errors must remain visible. A disconnected browser is never permission to use an older disk-based drawing or manufacture a reply.

Created by [Andrew Barresi](https://github.com/AndBarresi). Project code is [MIT-licensed](LICENSE).
