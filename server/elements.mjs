import { randomBytes, randomUUID } from 'node:crypto';

const nonce = () => randomBytes(4).readUInt32LE(0) >>> 1;
const labelColor=(spec,base)=>{
  if(spec.textColor)return spec.textColor;
  if(base.strokeColor!==base.backgroundColor)return base.strokeColor;
  const rgb=/^#([0-9a-f]{6})$/i.exec(base.backgroundColor);
  if(!rgb)return '#26352e';
  const [r,g,b]=[0,2,4].map(i=>parseInt(rgb[1].slice(i,i+2),16));
  return .299*r+.587*g+.114*b>150?'#26352e':'#ffffff';
};
const textSize = (text, fontSize) => ({
  width: Math.max(8, Math.max(...text.split('\n').map((line) => line.length)) * fontSize * 0.62),
  height: Math.max(1, text.split('\n').length) * fontSize * 1.25,
});

export function createElements(specs) {
  const elements = [];
  for (const spec of specs) {
    const id = spec.id ?? randomUUID();
    const type = spec.type ?? 'rectangle';
    const base = {
      id, type, x: spec.x ?? 0, y: spec.y ?? 0, width: spec.width ?? 240,
      height: spec.height ?? 120, angle: 0, strokeColor: spec.strokeColor ?? '#26352e',
      backgroundColor: spec.backgroundColor ?? 'transparent', fillStyle: 'solid',
      strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100,
      groupIds: [], frameId: null, index: null, roundness: type === 'rectangle' ? { type: 3 } : null,
      seed: nonce(), version: 1, versionNonce: nonce(), isDeleted: false,
      boundElements: null, updated: Date.now(), link: null, locked: false,
    };
    if (type === 'text') {
      const fontSize = spec.fontSize ?? 20;
      const text = spec.text ?? '';
      elements.push({ ...base, ...textSize(text, fontSize), text, originalText: text,
        fontSize, fontFamily: 2, textAlign: 'left', verticalAlign: 'top',
        containerId: null, autoResize: true, lineHeight: 1.25 });
    } else if (type === 'arrow' || type === 'line') {
      elements.push({ ...base, points: [[0, 0], [base.width, base.height]],
        startBinding: null, endBinding: null, startArrowhead: null,
        endArrowhead: type === 'arrow' ? 'arrow' : null, elbowed: false });
    } else {
      if (spec.text) {
        const labelId = `${id}_label`;
        const fontSize = spec.fontSize ?? 20;
        const size = textSize(spec.text, fontSize);
        base.boundElements = [{ id: labelId, type: 'text' }];
        elements.push(base, {
          ...base, id: labelId, type: 'text', ...size,
          x: base.x + (base.width - size.width) / 2,
          y: base.y + (base.height - size.height) / 2,
          backgroundColor: 'transparent', roundness: null, boundElements: null,
          strokeColor: labelColor(spec,base),
          text: spec.text, originalText: spec.text, fontSize, fontFamily: 2,
          textAlign: 'center', verticalAlign: 'middle', containerId: id,
          autoResize: true, lineHeight: 1.25,
        });
      } else elements.push(base);
    }
  }
  return elements;
}

export function editElements(board, edits) {
  const map = new Map(board.elements.map((element) => [element.id, element]));
  const changed = new Map();
  // Validate explicit targets before staging their dependent labels. A stale label
  // in the same batch must reject the whole operation, regardless of edit order.
  for (const edit of edits) {
    const original = map.get(edit.id);
    if (!original) throw Object.assign(new Error(`Object ${edit.id} does not exist. Read the board again.`), { status: 404 });
    if (board.elementVersions[edit.id] !== edit.expectedVersion) {
      throw Object.assign(new Error(`Object ${edit.id} changed. Read the board again before editing.`), { status: 409 });
    }
  }
  for (const edit of edits) {
    const original = map.get(edit.id);
    const current = changed.get(edit.id)?.element ?? original;
    const fields={...edit.changes};
    const labelFields={};
    let labelTargetId;
    if(current.type!=='text'&&(fields.text!==undefined||fields.fontSize!==undefined)){
      const label=(current.boundElements??[]).filter(bound=>bound.type==='text').map(bound=>map.get(bound.id)).find(label=>label?.type==='text'&&!label.isDeleted);
      if(!label)throw Object.assign(new Error(`Object ${edit.id} has no editable bound text label. Read the board and target a text object.`),{status:400});
      labelTargetId=label.id;
      for(const field of ['text','fontSize'])if(fields[field]!==undefined){
        labelFields[field]=fields[field];delete fields[field];
        if(edits.some(other=>other.id===label.id&&other.changes[field]!==undefined&&other.changes[field]!==labelFields[field]))throw Object.assign(new Error(`The container and its label request different ${field} changes. Edit the label once in this batch.`),{status:400});
      }
    }
    const next = { ...current, ...fields, version: current.version + 1, versionNonce: nonce(), updated: Date.now() };
    if(current.type!=='text'&&Object.keys(labelFields).length){delete next.text;delete next.originalText;delete next.fontSize;}
    if (next.type==='text'&&(edit.changes.text !== undefined || edit.changes.fontSize !== undefined)) {
      next.originalText = edit.changes.text!==undefined?next.text:next.originalText??next.text;
      next.text=next.originalText;
      Object.assign(next, textSize(next.text, next.fontSize ?? 20));
      if(next.containerId){const container=changed.get(next.containerId)?.element??map.get(next.containerId);if(container&&['rectangle','ellipse','diamond'].includes(container.type)){next.x=container.x+(container.width-next.width)/2;next.y=container.y+(container.height-next.height)/2;}}
    }
    changed.set(edit.id, { id: edit.id, expectedVersion: edit.expectedVersion, element: next });
    // Moving/deleting a container moves/deletes its bound label as one atomic operation.
    for (const bound of current.boundElements ?? []) {
      if (bound.type !== 'text') continue;
      const label = changed.get(bound.id)?.element??map.get(bound.id);
      if (!label) continue;
      const moved = { ...label, x: label.x + next.x - current.x + (next.width - current.width) / 2,
        y: label.y + next.y - current.y + (next.height - current.height) / 2,
        ...(edit.changes.isDeleted!==undefined?{isDeleted:next.isDeleted}:{}),version: label.version + 1, versionNonce: nonce(), updated: Date.now() };
      if(label.id===labelTargetId){
        Object.assign(moved,labelFields);moved.originalText=labelFields.text!==undefined?moved.text:moved.originalText??moved.text;moved.text=moved.originalText;Object.assign(moved,textSize(moved.text,moved.fontSize??20));
        moved.x=next.x+(next.width-moved.width)/2;moved.y=next.y+(next.height-moved.height)/2;
      }
      changed.set(label.id, { id: label.id, expectedVersion: board.elementVersions[label.id], element: moved });
    }
  }
  return [...changed.values()];
}
