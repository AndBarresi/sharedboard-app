// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
import React from 'react';
import {CloudConnectionSetup} from './CloudConnectionSetup.jsx';

export async function copyText(text){
  try{await navigator.clipboard.writeText(text);return;}catch{}
  const el=document.createElement('textarea');el.value=text;el.style.position='fixed';el.style.left='-9999px';document.body.append(el);el.select();const done=document.execCommand('copy');el.remove();if(!done)throw new Error('Select the instructions and copy them manually.');
}
export function ConnectionSetup(props){return <CloudConnectionSetup {...props} copyValue={copyText}/>;}
