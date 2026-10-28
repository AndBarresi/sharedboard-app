export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const indexById = (elements) => new Map(elements.map((element) => [element.id, element]));
// restoreElements assigns missing ordering keys with mutateElement, which bumps
// version/nonce/time once. It also measures text and repairs empty/deleted
// bindings. Those derived updates must not make an AI action impossible to undo.
export function isRenderNormalization(before,after,scene=[]){
  if(!before||!after)return false;
  const sameEdit=before.version===after.version&&before.versionNonce===after.versionNonce&&before.updated===after.updated;
  const firstIndex=before.index==null&&typeof after.index==='string'&&after.index.length>0&&after.version===before.version+1&&Number.isFinite(after.updated)&&after.updated>=before.updated;
  if(!sameEdit&&!firstIndex)return false;
  const allowed=new Set(before.type==='text'?['x','y','width','height','baseline','index']:['index']);
  if(firstIndex)for(const key of ['version','versionNonce','updated'])allowed.add(key);
  if(before.type==='text'&&typeof before.originalText==='string'&&before.originalText===after.originalText)allowed.add('text');
  const oldBindings=before.boundElements??[],newBindings=after.boundElements??[];
  if(Array.isArray(oldBindings)&&Array.isArray(newBindings)){
    const map=scene instanceof Map?scene:indexById(scene),kept=new Set(newBindings.map(binding=>binding.id));
    const expected=oldBindings.filter(binding=>kept.has(binding.id)||!map.get(binding.id)?.isDeleted);
    if(same(oldBindings,newBindings)||same(expected,newBindings))allowed.add('boundElements');
  }
  const changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>!same(before[key],after[key]));
  return changed.length>0&&changed.every(key=>allowed.has(key));
}

export function diffElements(before, after) {
  const previous = indexById(before);
  const next = indexById(after);
  const changes = after.filter((element) => !same(previous.get(element.id), element));
  for (const element of before) {
    if (!next.has(element.id) && !element.isDeleted) changes.push({ ...element, isDeleted: true });
  }
  return changes;
}

// Rebase disjoint edits. A collision is surfaced to the person; never choose a winner silently.
export function rebaseElements(base, local, remote) {
  const localChanges = diffElements(base, local);
  const remoteChanges = new Map(diffElements(base, remote).map((element) => [element.id, element]));
  const conflicts = localChanges.filter((element) => remoteChanges.has(element.id) && !same(element, remoteChanges.get(element.id))).map((element) => element.id);
  if (conflicts.length) return { conflicts, elements: local };
  const result = indexById(remote);
  for (const element of localChanges) result.set(element.id, element);
  return { conflicts: [], elements: [...result.values()] };
}

export function selectElements(elements, ids = []) {
  const active = elements.filter((element) => !element.isDeleted);
  if (!ids.length) return active;
  const byId = indexById(active), children = new Map();
  for (const element of active) {
    for (const parentId of [element.containerId, element.frameId]) {
      if (!parentId) continue;
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(element.id);
    }
  }
  const selected = new Set(ids.filter((id) => byId.has(id))), pending = [...selected];
  // Follow descendants and existing bound relationships to a fixed point, even
  // when a label or nested frame appears before its parent in the scene order.
  while (pending.length) {
    const id = pending.pop(), element = byId.get(id);
    const related = [...(children.get(id) ?? []), ...(element.boundElements ?? []).map((bound) => bound.id)];
    for (const relatedId of related) {
      if (!byId.has(relatedId) || selected.has(relatedId)) continue;
      selected.add(relatedId); pending.push(relatedId);
    }
  }
  return active.filter((element) => selected.has(element.id));
}

export function summarizeScene(board, selection = []) {
  return {
    boardId: board.id,
    revision: board.revision,
    selectedIds: selection,
    updatedAt: board.updatedAt,
    elements: board.elements.filter((element) => !element.isDeleted).map((element) => ({
      id: element.id, editVersion: board.elementVersions[element.id], type: element.type,
      x: element.x, y: element.y, width: element.width, height: element.height,
      text: element.text, containerId: element.containerId, boundElements: element.boundElements,
      name:element.customData?.sharedboardName,groupIds:element.groupIds,groupNames:element.customData?.sharedboardGroupNames,locked:element.locked,opacity:element.opacity,
      startBinding: element.startBinding, endBinding: element.endBinding,
      strokeColor: element.strokeColor, backgroundColor: element.backgroundColor,
    })),
    activity: board.activity.slice(0, 12),
  };
}
