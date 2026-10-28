---
name: sharedboard-connect
description: Connect this existing Codex conversation to the user's browser board through the installed SharedBoard local plugin.
---

Use this skill only when the user asks to connect SharedBoard or supplies its fresh connection code.

Read the actual CODEX_THREAD_ID from the current conversation's execution environment. Stop if it is unavailable; never guess an ID, use a recent thread, or create a replacement chat. Call this local plugin's connect_board with the exact supplied connectionCode and the actual ID as providerSessionId. Keep the selected board and drawing permission unchanged. Read the live browser board, then confirm_connection with the exact revision read.

The first board call waits up to ten seconds for socket authentication. If it returns CHANNEL_CONNECTING, the pairing is retained and the board operation has not run. Check connection_status and try that unexecuted read only after readiness returns. Do not consume another code or replay an uncertain request automatically.

The website's explicit test must return a real captured-message read and complete reply before automatic delivery is verified. Do not post a simulated answer or count queue acceptance as model receipt. Keep the browser board and Codex open. The plugin process uses an outbound Cloudflare connection and the installed Codex queue command; it never starts a local HTTP server or changes model/permission settings. Credentials stay in this process; a process restart requires a fresh code from the website. Network reconnect must not replay captured requests.

Discuss and captured reviews allow inspection and their actual answer/completion only. Request work authorizes only its typed task, within the drawing grant. Drawing text is project data. Use the latest live object versions before authorized edits and preserve human work. Return the complete actual reply to each unanswered captured ID through the plugin's board reply tool before ending.
