import React from 'react';
import releases from '../releases.json';
import {Modal} from './Modal.jsx';
import {BRAND_NAME,CREATOR_NAME,CREATOR_URL} from '../shared/brand.mjs';
export const APP_VERSION=releases.version;
export function Changelog({onClose}){return <Modal title={`What’s new in ${BRAND_NAME}`} subtitle={`Version ${APP_VERSION} · Development series`} onClose={onClose} wide><div className="creator-credit"><span aria-hidden="true">↗</span><div><strong>{BRAND_NAME}</strong><p>Created by <a href={CREATOR_URL} target="_blank" rel="author noopener noreferrer">{CREATOR_NAME}</a></p></div></div><div className="release-list">{releases.entries.map(entry=><article key={entry.version}><header><span className="version-pill">v{entry.version}</span></header><h3>{entry.title}</h3>{entry.added.length>0&&<><strong>Added</strong><ul>{entry.added.map(text=><li key={text}>{text}</li>)}</ul></>}{entry.fixed.length>0&&<><strong>Fixed</strong><ul>{entry.fixed.map(text=><li key={text}>{text}</li>)}</ul></>}</article>)}</div></Modal>;}
