import { isOpenShape, type AnyNode } from '../../../engine/model/schema';

/**
 * Which rail a single selected object gets.
 *
 * Finer than `node.type`, because one type can be two subjects: a line and a
 * rectangle are both `shape`, and a pencil stroke and a pen path are both
 * `path`, but they offer different things and swap within different families.
 */
export type RailSubjectKind =
  | 'shape'
  | 'line'
  | 'vector'
  | 'freehand'
  | 'connector'
  | 'text'
  | 'sticky'
  | 'image'
  | 'audio'
  | 'table'
  | 'grid'
  | 'chart'
  | 'code'
  | 'link'
  | 'frame'
  | 'other';

export function railSubjectOf(node: AnyNode): RailSubjectKind {
  switch (node.type) {
    case 'shape':
      return isOpenShape(node.geometry.kind) ? 'line' : 'shape';
    case 'path':
      return node.geometry.kind === 'freehand' ? 'freehand' : 'vector';
    case 'connector':
    case 'text':
    case 'sticky':
    case 'image':
    case 'audio':
    case 'table':
    case 'grid':
    case 'chart':
    case 'code':
    case 'link':
    case 'frame':
      return node.type;
    default:
      return 'other';
  }
}
