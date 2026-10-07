import { Bold, Italic } from 'lucide-react';
import type { Typography } from '../../../engine/model/schema';
import { RailButton } from '../RailBase';
import type { RailVerb } from './verbs';
import { EffectsControl, ParagraphControl } from './text';

type SetTypography = (patch: Partial<Typography>) => void;

/** The verbs a text object puts on the rail after its font, most used first. */
export function textVerbs(typography: Typography, set: SetTypography): RailVerb[] {
  const bold = typography.fontWeight >= 600;
  return [
    {
      id: 'bold',
      controls: 1,
      node: (
        <RailButton label="Bold" pressed={bold} onClick={() => set({ fontWeight: bold ? 400 : 700 })}>
          <Bold size={15} />
        </RailButton>
      ),
    },
    {
      id: 'italic',
      controls: 1,
      node: (
        <RailButton label="Italic" pressed={typography.italic} onClick={() => set({ italic: !typography.italic })}>
          <Italic size={15} />
        </RailButton>
      ),
    },
    { id: 'paragraph', controls: 1, node: <ParagraphControl typography={typography} set={set} /> },
    { id: 'effects', controls: 1, node: <EffectsControl typography={typography} set={set} /> },
  ];
}
