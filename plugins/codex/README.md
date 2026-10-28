# SharedBoard.app for local Codex

This plugin connects a browser-saved board to an existing local Codex conversation. It uses an outbound Cloudflare connection and the installed `codex queue` command. It does not start a listening server, create a replacement chat, change your model settings, or bypass approvals.

The developer build requires Node.js 22 or later and the Codex command on PATH. Package/runtime installation and actual account acceptance must pass before this is advertised as ready for friends. A queue receipt alone does not prove that a model read or answered a request.

Get the one-time setup and connection code from https://sharedboard.app. Use the actual conversation's `CODEX_THREAD_ID` through the connect skill. Keep Codex and the browser board open. Network reconnect retains the process-bound grant; restarting the plugin requires a fresh connection code. Normal permission prompts can still need attention in Codex.

An initial board call waits up to ten seconds for socket authentication. A temporary `CHANNEL_CONNECTING` result retains the pairing and performs no board operation or automatic retry. Queue uncertainty stops delivery without replay; status and explicit disconnect remain available. Private credentials stay in memory, and the plugin stores only routing claim receipts in the Codex profile's `sharedboard-plugin` directory.

Created by [Andrew Barresi](https://github.com/AndBarresi). MIT; third-party notices accompany the built package.
