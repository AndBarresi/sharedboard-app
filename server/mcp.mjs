import {serveStdio} from '@modelcontextprotocol/server/stdio';
import {callBoard} from './agent-client.mjs';
import {createBoardMcp} from './tools.mjs';

process.env.WHITEBOARD_CLIENT_ID ??= 'sharedboard-mcp';
serveStdio(() => createBoardMcp(callBoard));
