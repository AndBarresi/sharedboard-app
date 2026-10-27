import React from 'react';
import {Icon} from './Icons.jsx';

// Kept as a visible roadmap marker; no web startup or approval controls ship in this beta.
export function WebConnectionSetup(){
  return <section className="web-wip-note" aria-label="Web connectors work in progress"><Icon name="lock" size={15}/><div><strong>Web connectors · Work in progress</strong><p>ChatGPT and Claude web-chat linking is planned for a later release. This local beta does not open public tunnels. Local AI connections stay available.</p></div></section>;
}

export function WebApprovals(){return null;}
