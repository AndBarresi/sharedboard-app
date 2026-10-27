// Created by Andrew Barresi: https://github.com/AndBarresi
// Copyright (c) 2026 Andrew Barresi
// Licensed under the MIT License. See LICENSE.
import path from 'node:path';
import {homedir} from 'node:os';

export function defaultDataDir(env=process.env,platform=process.platform,homeDirectory=homedir()){
 const paths=platform==='win32'?path.win32:path.posix;
 if(env.SHARED_BOARD_BRIDGE_DATA_DIR)return paths.resolve(env.SHARED_BOARD_BRIDGE_DATA_DIR);
 const base=platform==='win32'?(env.LOCALAPPDATA??paths.join(homeDirectory,'AppData','Local')):platform==='darwin'?paths.join(homeDirectory,'Library','Application Support'):(env.XDG_DATA_HOME??paths.join(homeDirectory,'.local','share'));
 return paths.join(base,'SharedBoardBridge','data');
}
