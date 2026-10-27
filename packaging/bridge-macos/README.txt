SharedBoard Bridge for macOS 13.5 or later
Created by Andrew Barresi — https://github.com/AndBarresi

Choose the Apple Silicon (arm64) ZIP for M-series Macs, or Intel (x64) ZIP for
Intel Macs. This package includes its own official Node runtime. No Homebrew,
administrator password, commands to type, or separate Node install is needed.

1. Extract the entire ZIP using Finder.
2. Open Install SharedBoard Bridge.command once. This installs SharedBoard Bridge.app
   into your own ~/Applications folder and registers the webpage's Open bridge link.
3. Return to https://sharedboard.app, choose Connect Codex, then Check bridge.
4. Prepare a pairing code and paste the generated instruction into your existing
   Codex conversation. Codex must already be installed, signed in, and support queue.
5. Use Test with a reply to verify that an actual answer returns to the board.

This beta is not Developer ID signed or notarized. macOS may ask you to approve
opening it. Only approve a release you trust. Apple's instructions are at:
https://support.apple.com/en-us/102445
After attempting to open it, System Settings > Privacy & Security > Open Anyway
may be available. Managed Macs may require an administrator's policy approval.
The installer does not change Gatekeeper settings or remove quarantine metadata.

Later, use the webpage's Open bridge button, the installed app in ~/Applications,
or Start SharedBoard Bridge.command. Stop SharedBoard Bridge.command stops only
the matching helper. Closing the browser tab does not stop the background helper.
The sharedboard-bridge:// handler ignores URL contents and only starts the bridge.

Boards, images, notes, and mini-chat history stay in the browser profile. Export
.sharedboard backups and keep the board tab open while your AI uses it. The helper
stores only local grants and routing state under:
~/Library/Application Support/SharedBoardBridge/data
Installation and updates preserve these grants. Never share that populated folder.

Mac lifecycle and browser-launch checks run on separate native Apple Silicon and
Intel CI runners. Physical Mac/Codex acceptance remains a separate testing step.
Project code is MIT-licensed; bundled Node retains the included Node license.
