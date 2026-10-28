// Copyright (c) 2026 Andrew Barresi. SPDX-License-Identifier: MIT
// Direct iframe providers supported by Excalidraw 0.18.1. Figma's official
// Embed Kit redirects to embed.figma.com. SimplePDF uses customer subdomains.
export const embedFrameSources=Object.freeze([
  'https://www.youtube.com','https://player.vimeo.com',
  'https://www.figma.com','https://embed.figma.com',
  'https://link.excalidraw.com','https://stackblitz.com','https://www.stackblitz.com',
  'https://val.town','https://www.val.town','https://giphy.com','https://*.simplepdf.eu',
]);
const inputHosts=new Set(['youtube.com','www.youtube.com','youtu.be','www.youtu.be','vimeo.com','www.vimeo.com','player.vimeo.com','figma.com','www.figma.com','embed.figma.com','link.excalidraw.com','stackblitz.com','www.stackblitz.com','val.town','www.val.town','giphy.com','www.giphy.com']);

// Twitter, Reddit and Gist use scripts inside srcDoc rather than direct frames.
// Reject them before insertion instead of showing a blank CSP-blocked widget.
export function isSupportedEmbed(value){
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.port)return false;
    return inputHosts.has(url.hostname)||/^[a-z0-9-]+\.simplepdf\.eu$/.test(url.hostname);
  }catch{return false;}
}
