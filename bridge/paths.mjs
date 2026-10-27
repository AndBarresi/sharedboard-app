// Created by Andrew Barresi: https://github.com/AndBarresi
// Copyright (c) 2026 Andrew Barresi
// Licensed under the MIT License. See LICENSE.
import path from 'node:path';
import {homedir} from 'node:os';

export function defaultDataDir(env=process.env,platform=process.platform){
 if(env.SHARED_BOARD_BRIDGE_DATA_DIR)return path.resolve(env.SHARED_BOARD_BRIDGE_DATA_DIR);
 const base=platform==='win32'?(env.LOCALAPPDATA??path.join(homedir(),'AppData','Local')):platform==='darwin'?path.join(homedir(),'Library','Application Support'):(env.XDG_DATA_HOME??path.join(homedir(),'.local','share'));
 return path.join(base,'SharedBoardBridge','data');
}
