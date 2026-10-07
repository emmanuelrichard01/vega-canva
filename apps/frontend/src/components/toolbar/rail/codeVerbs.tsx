import { SquarePen, Workflow } from 'lucide-react';
import type { CodeNode } from '../../../engine/model/schema';
import { useStore } from '../../../hooks/useStore';
import { withShortcut } from '../../menu/shortcuts';
import { RailButton } from '../RailBase';
import { CodeViewControl, CopyCodeButton } from '../CodeRailSection';
import type { RailVerb } from './verbs';

/** What a selected code block does: open it, copy it, draw it, lay it out. */
export function codeVerbs(node: CodeNode, onRenderDiagram: (source: string) => void): RailVerb[] {
  const { code } = node;
  const verbs: RailVerb[] = [
    {
      id: 'edit',
      controls: 1,
      node: (
        <RailButton
          label="Edit code"
          hint={withShortcut('Edit code', 'Enter')}
          onClick={() => useStore.getState().setCodeEditNodeId(node.id)}
        >
          <SquarePen size={16} />
        </RailButton>
      ),
    },
    { id: 'copy', controls: 1, node: <CopyCodeButton source={code.source} /> },
  ];
  // A Mermaid block is a diagram written down: one press draws it.
  if (code.language === 'mermaid' && code.source.trim()) {
    verbs.push({
      id: 'diagram',
      controls: 1,
      node: (
        <RailButton
          label="Render as diagram"
          hint="Draw this Mermaid on the board as shapes and arrows"
          onClick={() => onRenderDiagram(code.source)}
        >
          <Workflow size={16} />
        </RailButton>
      ),
    });
  }
  verbs.push({ id: 'layout', controls: 1, node: <CodeViewControl node={node} /> });
  return verbs;
}
