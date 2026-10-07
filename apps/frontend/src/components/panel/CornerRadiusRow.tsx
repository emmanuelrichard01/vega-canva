import React from 'react';
import { Link2, Squircle, Unlink2 } from 'lucide-react';
import { IconToggle, NumberField, PairRow, Row } from './grammar';
import {
  cornerRadiiOf,
  isUniform,
  packRadii,
  type CornerRadii,
  type CornerRadiusValue,
} from '../../engine/model/cornerRadii';
import type { Shared } from '../../engine/model/selection';

/** Corner order on screen: top row, then bottom row, matching the shape. */
const GRID: readonly { index: number; label: string }[] = [
  { index: 0, label: 'Top left' },
  { index: 1, label: 'Top right' },
  { index: 3, label: 'Bottom left' },
  { index: 2, label: 'Bottom right' },
];

/**
 * Corner radius: one field for all four, or four fields once unlinked. A
 * shape whose corners already differ opens unlinked, because one number
 * cannot describe it. Relinking takes the largest corner for all four.
 */
export const CornerRadiusRow: React.FC<{
  value: Shared<CornerRadiusValue | undefined>;
  onChange: (next: CornerRadiusValue | undefined) => void;
}> = ({ value, onChange }) => {
  const radii = cornerRadiiOf(value.value);
  const uniform = isUniform(value.value);
  const [expanded, setExpanded] = React.useState(false);
  const open = (expanded || !uniform) && !value.mixed;

  const setOne = (index: number, n: number) => {
    const next = [...radii] as CornerRadii;
    next[index] = Math.max(0, n);
    onChange(packRadii(next));
  };

  const link = (
    <IconToggle
      label={open ? 'Link corners' : 'Set corners separately'}
      pressed={!open}
      onClick={() => {
        if (open) {
          setExpanded(false);
          const max = Math.max(...radii);
          onChange(packRadii([max, max, max, max]));
        } else {
          setExpanded(true);
        }
      }}
    >
      {open ? <Unlink2 size={13} /> : <Link2 size={13} />}
    </IconToggle>
  );

  if (!open) {
    return (
      <Row label="Radius" hint="Rounds every corner by the same amount. Unlink to set each on its own.">
        <NumberField
          label="Corner radius"
          glyph={<Squircle size={12} />}
          unit="px"
          min={0}
          max={200}
          value={value.mixed ? 'mixed' : radii[0]}
          onChange={(n) => onChange(n === 0 ? undefined : n)}
        />
        {link}
      </Row>
    );
  }

  return (
    <Row stack label="Radius" hint="Each corner on its own. Link them to set all four at once.">
      <div className="pg-radius">
        <div className="pg-radius__grid">
          <PairRow>
            {GRID.slice(0, 2).map(({ index, label }) => (
              <NumberField
                key={index}
                label={`${label} radius`}
                glyph={<CornerGlyph index={index} />}
                min={0}
                max={200}
                value={radii[index]}
                onChange={(n) => setOne(index, n)}
              />
            ))}
          </PairRow>
          <PairRow>
            {GRID.slice(2).map(({ index, label }) => (
              <NumberField
                key={index}
                label={`${label} radius`}
                glyph={<CornerGlyph index={index} />}
                min={0}
                max={200}
                value={radii[index]}
                onChange={(n) => setOne(index, n)}
              />
            ))}
          </PairRow>
        </div>
        {link}
      </div>
    </Row>
  );
};

/** One corner of a square, drawn as the two edges that meet there. */
const CornerGlyph: React.FC<{ index: number }> = ({ index }) => {
  const d = ['M2 8V2h6', 'M2 2h6v6', 'M8 2v6H2', 'M8 8H2V2'][index];
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
};
