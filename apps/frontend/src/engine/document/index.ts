/**
 * The collaborative document layer.
 *
 * Import everything document-related from this barrel.
 */
export {
  roomId,
  doc,
  provider,
  indexeddbProvider,
  objectsMap,
  groupsMap,
  metadataMap,
  identitiesMap,
  commentsMap,
  fontsMap,
  undoManager,
  getConnectionStatus,
  onStatusChange,
  onSyncedChange,
  isDocumentSynced,
  whenSynced,
  whenDocumentReady,
  DERIVED_ORIGIN,
  syncMeta,
} from './doc';
export type { ConnectionStatus } from './doc';

export {
  createNode,
  updateNode,
  updateNodes,
  applyNodePatches,
  toggleReaction,
  deleteNode,
  readNode,
  readAllNodes,
  nextZIndex,
  lowestZIndex,
  localAuthorId,
  localAuthor,
  publishLocalIdentity,
  setBoardMetadata,
} from './mutations';
export type { NewNodeInput, CreateNodeOptions, WriteOptions } from './mutations';
export { applyGroupPlan, renameGroup, writeGroupRecords } from './mutations';
export { observeGroups } from './observe';

export { observeNodes } from './observe';
export type { NodeChangeSet } from './observe';

export { normalizeNode, isCanonical } from './normalize';
export { migrateDocument, scheduleMigration } from './migrate';

export {
  registerBoardFont,
  removeBoardFont,
  readBoardFonts,
  listBoardFonts,
  groupBoardFonts,
  normalizeBoardFont,
} from './fonts';
export type { BoardFont } from './fonts';
