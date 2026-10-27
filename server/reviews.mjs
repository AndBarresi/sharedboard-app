import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { selectElements } from '../shared/scene.mjs';

export class ReviewStore {
  constructor(directory) {
    this.filename = path.join(directory, 'review-requests.json');
    mkdirSync(directory, { recursive: true });
    this.requests = existsSync(this.filename) ? JSON.parse(readFileSync(this.filename, 'utf8')) : [];
    if (!Array.isArray(this.requests)) throw new Error('The saved review queue is not readable. Its original file was preserved.');
  }

  save() {
    writeFileSync(`${this.filename}.tmp`, JSON.stringify(this.requests, null, 2), { encoding: 'utf8', flush: true });
    renameSync(`${this.filename}.tmp`, this.filename);
  }

  list() { return this.requests.map(({ snapshot, targetThreadId, ...metadata }) => structuredClone(metadata)); }
  find(id) {
    const request = this.requests.find((item) => item.id === id);
    if (!request) throw Object.assign(new Error('That board review request does not exist.'), { status: 404 });
    return request;
  }

  create(board, { id, expectedRevision, selectedIds, connectionId, targetThreadId,scope,areaId,expectedPlanningVersion,currentPlanningVersion }) {
    selectedIds=[...selectedIds].sort();
    const duplicate = this.requests.find((item) => item.id === id);
    if (duplicate) {
      if (duplicate.boardRevision !== expectedRevision || duplicate.scope!==(scope??(selectedIds.length?'selection':'board')) || duplicate.areaId!==areaId || expectedPlanningVersion!==undefined&&duplicate.planningVersion!==expectedPlanningVersion || JSON.stringify(duplicate.selectedIds) !== JSON.stringify(selectedIds)) throw Object.assign(new Error('That request ID belongs to a different review.'), { status: 409 });
      return { request: duplicate, created: false };
    }
    if (board.revision !== expectedRevision) throw Object.assign(new Error('The board changed just before this request. Please ask again to include the latest changes.'), { status: 409 });
    const active = board.elements.filter((element) => !element.isDeleted);
    if (selectedIds.some((id) => !active.some((element) => element.id === id))) throw Object.assign(new Error('Part of that selection no longer exists. Select the objects again.'), { status: 409 });
    const planningVersion=expectedPlanningVersion??currentPlanningVersion;
    const equivalent = this.requests.find((item) => item.connectionId === connectionId && item.boardRevision === board.revision && item.planningVersion===planningVersion && item.scope===(scope??(selectedIds.length?'selection':'board')) && item.areaId===areaId && JSON.stringify(item.selectedIds) === JSON.stringify(selectedIds) && ['requested', 'reviewing'].includes(item.status));
    if (equivalent) return { request: equivalent, created: false };
    if (this.requests.filter((item) => ['requested', 'reviewing'].includes(item.status)).length >= 10) throw Object.assign(new Error('There are already several reviews waiting. Let the agent finish before requesting more.'), { status: 429 });
    const elements = structuredClone(scope==='area'&&!selectedIds.length?[]:selectElements(board.elements, selectedIds));
    const files = Object.fromEntries(Object.entries(board.files).filter(([id]) => elements.some((element) => element.fileId === id)));
    const request = {
      id, boardId: board.id, boardRevision: board.revision,planningVersion, selectedIds: [...selectedIds], connectionId, targetThreadId,
      objectCount: elements.length, scope: scope??(selectedIds.length ? 'selection' : 'board'),...(areaId?{areaId}:{}),
      createdAt: new Date().toISOString(), status: 'requested', delivery: 'pending',
      snapshot: { id: board.id, title: board.title, revision: board.revision, elements, files: structuredClone(files), elementVersions: Object.fromEntries(elements.map(element=>[element.id,board.elementVersions[element.id]])) },
    };
    this.requests.unshift(request);
    this.requests = this.requests.filter((item, index) => index < 40 || ['requested', 'reviewing'].includes(item.status));
    this.save();
    return { request, created: true };
  }

  delivered(id, receipt) {
    const request = this.find(id);
    Object.assign(request, { delivery: 'queued', deliveredAt: new Date().toISOString(), receipt });
    delete request.deliveryError;
    this.save();
  }
  deliveryFailed(id, message) {
    Object.assign(this.find(id), { delivery: 'failed', deliveryError: message });
    this.save();
  }
  readForAgent(id, latestRevision) {
    const request = this.find(id);
    if (request.status !== 'reviewed') { request.status = 'reviewing'; request.startedAt ??= new Date().toISOString(); this.save(); }
    const { snapshot, targetThreadId, ...metadata } = request;
    return { request: structuredClone(metadata), board: { ...structuredClone(snapshot), elementVersions:Object.fromEntries(snapshot.elements.map(element=>[element.id,snapshot.elementVersions[element.id]])), files: Object.fromEntries(Object.entries(snapshot.files).map(([id, file]) => [id, { id, mimeType: file.mimeType }])) }, latestRevision, boardChangedSinceRequest: latestRevision !== request.boardRevision, instructions: 'Review this captured board or selection and explain what you see in chat. This click requests inspection only; it does not approve drawing changes or code generation. Complete the review request after inspecting it.' };
  }
  complete(id, summary) {
    const request = this.find(id);
    if (request.status !== 'reviewing' && request.status !== 'reviewed') throw Object.assign(new Error('Read this review request before marking it reviewed.'), { status: 409 });
    Object.assign(request, { status: 'reviewed', completedAt: new Date().toISOString(), summary });
    this.save();
    return this.list().find((item) => item.id === id);
  }
}
