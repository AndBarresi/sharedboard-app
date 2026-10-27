import React from 'react';
import {Icon} from './Icons.jsx';

// Kept as a visible roadmap marker; no web startup or approval controls ship in this beta.
export function WebConnectionSetup(){
  return <section className="web-wip-note" aria-label="In-chat connections work in progress"><Icon name="lock" size={15}/><div><strong>In-chat connections · Work in progress</strong><p>Direct linking inside ChatGPT and Claude chats is planned for a later release. Use your existing local AI client in this beta.</p></div></section>;
}

export function WebApprovals(){return null;}
