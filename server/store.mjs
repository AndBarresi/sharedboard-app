import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { same } from '../shared/scene.mjs';

export class BoardStore {
  constructor(directory,{id,title}={}) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true });
    this.filename = path.join(directory, 'board.json');
    this.board = existsSync(this.filename) ? JSON.parse(readFileSync(this.filename, 'utf8')) : {
      schemaVersion: 1, id: id??randomUUID(), title: title??'Our first board', revision: 0,
      updatedAt: new Date().toISOString(), elements: [], elementVersions: {}, files: {}, activity: [],
    };
    if (this.board.schemaVersion !== 1 || !Array.isArray(this.board.elements)) throw new Error('Unsupported or damaged board file. The original has been preserved.');
    if(id&&this.board.id!==id)throw new Error('This board directory belongs to a different board. Its data was preserved.');
    if (!existsSync(this.filename)) this.persist(this.board);
  }

  persist(board) {
    const temporary = `${this.filename}.tmp`;
    writeFileSync(temporary, JSON.stringify(board, null, 2), { encoding: 'utf8', flush: true });
    if (existsSync(this.filename)) copyFileSync(this.filename, `${this.filename}.bak`);
    renameSync(temporary, this.filename);
  }

  apply({ changes, files = {}, summary = 'Updated the board', actor = 'user' }) {
    const board = this.board;
    const conflicts = changes.filter((change) => (board.elementVersions[change.id] ?? 0) !== change.expectedVersion).map((change) => change.id);
    if (conflicts.length) throw Object.assign(new Error('These objects changed while you were editing. Your local drawing is still available.'), { status: 409, conflicts, board });
    const map = new Map(board.elements.map((element) => [element.id, element]));
    const versions = { ...board.elementVersions };
    const previous = new Map(map),changedIds=new Set();
    let dirty = false;
    for (const change of changes) {
      if (same(map.get(change.id), change.element)) continue;
      map.set(change.id, change.element);
      versions[change.id] = (versions[change.id] ?? 0) + 1;
      changedIds.add(change.id);
      dirty = true;
    }
    // A shape's readable label is part of the same logical object. Content edits
    // to that label invalidate an earlier shape editVersion without changing the
    // shape's geometry or native Excalidraw version. Derived text measurement and
    // wrapping of the same originalText do not change this logical version.
    const labelContent=element=>element?.type==='text'?{text:element.originalText??element.text,fontSize:element.fontSize,fontFamily:element.fontFamily,lineHeight:element.lineHeight,textAlign:element.textAlign,verticalAlign:element.verticalAlign,isDeleted:Boolean(element.isDeleted),containerId:element.containerId}:null;
    for(const change of changes){
      if(!changedIds.has(change.id))continue;
      const before=previous.get(change.id),after=map.get(change.id);
      if(same(labelContent(before),labelContent(after)))continue;
      for(const owner of new Set([before?.containerId,after?.containerId])){
        if(!owner||changedIds.has(owner)||!['rectangle','ellipse','diamond','arrow','line'].includes(map.get(owner)?.type))continue;
        versions[owner]=(versions[owner]??0)+1;changedIds.add(owner);
      }
    }
    const nextFiles = { ...board.files };
    for (const [id, file] of Object.entries(files)) {
      if (!same(nextFiles[id], file)) { nextFiles[id] = file; dirty = true; }
    }
    if (!dirty) return board;
    const elements = [...map.values()];
    if (elements.every((element) => typeof element.index === 'string')) {
      elements.sort((a, b) => a.index < b.index ? -1 : a.index > b.index ? 1 : 0);
    }
    const next = {
      ...board, revision: board.revision + 1, updatedAt: new Date().toISOString(),
      elements, elementVersions: versions, files: nextFiles,
      activity: [{ actor, summary, revision: board.revision + 1, at: new Date().toISOString(), ids: [...changedIds] }, ...board.activity].slice(0, 40),
    };
    this.persist(next);
    this.board = next;
    return next;
  }
}
