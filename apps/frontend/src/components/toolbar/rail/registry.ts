import type { AnyNode } from '../../../engine/model/schema';
import { ConnectorRail } from './ConnectorRail';
import { ChartRail, CodeRail, LinkRail } from './DataRails';
import { GridRail } from './GridRail';
import { LineRail } from './LineRail';
import { AudioRail, DefaultRail, ImageRail } from './MediaRails';
import { FrameRail } from './FrameRail';
import { ShapeRail } from './ShapeRail';
import { StickyRail } from './StickyRail';
import { TableRail } from './TableRail';
import { TextRail } from './TextRail';
import { FreehandRail, VectorRail } from './VectorRail';
import type { RailSubjectKind } from './subject';
import type { SingleRail } from './types';

/**
 * One rail module per subject.
 *
 * A subject's module owns its kind chip, paint and verbs; the frame owns the
 * placement, the conditional slot and the tail. Adding a subject is adding a
 * row here, and the cap test picks it up from this table.
 */
export const RAIL_SECTIONS: Record<RailSubjectKind, SingleRail<AnyNode>> = {
  shape: ShapeRail as SingleRail<AnyNode>,
  line: LineRail as SingleRail<AnyNode>,
  vector: VectorRail as SingleRail<AnyNode>,
  freehand: FreehandRail as SingleRail<AnyNode>,
  connector: ConnectorRail as SingleRail<AnyNode>,
  text: TextRail as SingleRail<AnyNode>,
  sticky: StickyRail as SingleRail<AnyNode>,
  image: ImageRail as SingleRail<AnyNode>,
  audio: AudioRail as SingleRail<AnyNode>,
  table: TableRail as SingleRail<AnyNode>,
  grid: GridRail as SingleRail<AnyNode>,
  chart: ChartRail as SingleRail<AnyNode>,
  code: CodeRail as SingleRail<AnyNode>,
  link: LinkRail as SingleRail<AnyNode>,
  frame: FrameRail as SingleRail<AnyNode>,
  other: DefaultRail,
};
