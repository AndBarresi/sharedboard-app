SharedBoard Bridge for Windows x64
Created by Andrew Barresi — https://github.com/AndBarresi

1. Extract the entire ZIP.
2. Open Install SharedBoard Bridge.cmd once. It installs for your Windows user;
   no administrator access, separate Node installation or configuration edit is needed.
3. Open https://sharedboard.app and choose Connect Codex.
4. Choose Check bridge. Allow local access if your browser asks.
5. Prepare a pairing code, copy the instruction, and paste it into the existing
   Codex chat you want to use. The assistant runs the pairing command for you.
6. Use Test with a reply to check a real returned answer.

Later, the webpage's Open bridge button reopens the installed helper. You can
also use Start SharedBoard Bridge.cmd. Stop SharedBoard Bridge.cmd stops only
this copy of the helper.

Boards, image references, notes and mini-chat history stay in this browser
profile. Export .sharedboard backups. Keep the board tab open while your AI
uses it. The helper stores only local connection grants and routing state;
it does not move your board into a server database or host a model.

This first bridge supports Codex on Windows. Codex must already be installed,
signed in and support its queue command. Other AI connection choices remain WIP.
The mini chat shows board-originated messages and explicit AI replies; it does
not mirror the entire external conversation.

Default installation: %LOCALAPPDATA%\SharedBoardBridge
The sharedboard-bridge://open handler only starts the bridge. It does not
execute commands from a URL. Pairing and board permissions are still required.

Do not share a populated data folder. Share the original release ZIP instead.
Project code is MIT-licensed; bundled Node retains the included Node license.
