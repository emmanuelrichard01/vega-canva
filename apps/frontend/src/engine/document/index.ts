/**
 * The collaborative document layer.
 *
 * Import everything document-related from this barrel. Previously all of this
 * lived inside `hooks/useSync.ts` — a React hooks module that also happened to
 * construct the Y.Doc, own the websocket provider, and run its own change
 * observer, which is why non-React code (tools, exporters, physics, the
 * minimap) all had to reach into a hooks file to touch the CRDT.
 */
export {
  roomId,
  doc,
  provider,
  indexeddbProvider,
  objectsMap,
  metadataMap,
  commentsMap,
  historyArray,
  undoManager,
  getConnectionStatus,
  onStatusChange,
  onSyncedChange,
} from './doc';
export type { ConnectionStatus } from './doc';

export {
  createNode,
  updateNode,
  deleteNode,
  readNode,
  readAllNodes,
  nextZIndex,
  lowestZIndex,
  localAuthorId,
  localAuthor,
} from './mutations';
export type { NewNodeInput } from './mutations';

export { observeNodes } from './observe';
export type { NodeChangeSet } from './observe';

export { normalizeNode, isCanonical } from './normalize';
export { migrateDocument, scheduleMigration } from './migrate';
