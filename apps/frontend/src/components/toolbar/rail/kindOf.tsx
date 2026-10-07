import { Square } from 'lucide-react';
import { isOpenShape, type AnyNode } from '../../../engine/model/schema';
import { SHAPE_BY_PRESET } from '../../workspace/shapeCatalog';
import { presetForGeometry } from '../../workspace/shapePicker';
import { TYPE_LABEL } from '../railConstants';
import type { RailSubjectKind } from './subject';

/** The name and glyph a subject is shown with. */
export function kindOf(node: AnyNode, subject: RailSubjectKind): { icon: React.ReactNode; name: string } {
  if (node.type === 'shape') {
    const base = TYPE_LABEL.shape;
    if (isOpenShape(node.geometry.kind)) {
      return { icon: base.icon, name: node.geometry.kind === 'arrow' ? 'Arrow' : 'Line' };
    }
    return { icon: base.icon, name: SHAPE_BY_PRESET[presetForGeometry(node.geometry)]?.label ?? base.name };
  }
  const key = subject === 'freehand' ? 'freehand' : node.type;
  return TYPE_LABEL[key] ?? { icon: <Square size={15} />, name: node.type };
}
