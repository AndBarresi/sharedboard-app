# SharedBoard.app for Claude Code

This is a Channels plugin for an existing running Claude Code session. It connects outward to SharedBoard's hosted relay; it does not open a local HTTP server or host a model. The browser remains the drawing store.

The first build requires Node 22 or newer on the machine running Claude Code. The distributed JavaScript bundle contains its SDK dependencies. Managed runtime packaging and Windows/Mac acceptance remain separate work; this package is not a claim that those tests have passed.

Claude Code access requires Pro/Max, an eligible Team/Enterprise seat, or separately billed Claude Console API access; Free Claude alone is insufficient. Organization policy must allow Channels. See [Claude Code authentication](https://code.claude.com/docs/en/authentication#log-in-to-claude-code) and [Channels eligibility](https://code.claude.com/docs/en/channels).

Install from the website's published marketplace using its generated command, then resume the intended Claude Code conversation with the website's channel launch instructions. Custom channels need Claude Code's interactive research-preview approval until allowlisted. Installing a plugin or seeing its tools does not prove that channel turns are enabled.

Run `/sharedboard:connect <the-fresh-website-code>` once in that session, then use the website's actual reply test. Read-only access permits discussion and replies; requested drawing edits require the selected edit grant. Discuss and board reviews do not authorize drawing or code work.

Keep this Claude Code process and the browser board open. The scoped credential stays in memory. A network reconnect can reuse it in this process; after a process exits or restarts, explicitly prepare a fresh website code and pair the intended session again. The plugin stores only notification claim metadata in Claude's private plugin data directory. It never replays an uncertain notification automatically or uses a saved drawing when the browser is offline.

The first board call waits up to ten seconds for socket authentication. A temporary `CHANNEL_CONNECTING` result preserves the existing pairing and reports pending readiness; it does not run or retry the board operation. Check the connection before making that call again. Native packages request their exact provider mode when pairing, so a code for another provider is rejected before consumption by the relay.

The plugin does not relay or bypass Claude permission prompts. It also does not connect regular Claude web chat or create cloud routine sessions.

Created by [Andrew Barresi](https://github.com/AndBarresi). MIT licensed.
