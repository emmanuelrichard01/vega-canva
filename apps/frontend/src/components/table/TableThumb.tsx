import React from 'react';
import { tableToSvg } from '../../engine/table/tableSvg';
import { tableSizeFor } from '../../engine/table/tableApply';
import type { TableExample } from '../../engine/table/tableExamples';

/**
 * A table example as a picture — the real table, not a drawing of one.
 *
 * Painted by `tableToSvg` from the same layout the board draws, at the size
 * the table would land at, so a card cannot promise a merge, a tint or a
 * column the example does not have. The SVG's viewBox does the shrinking.
 *
 * Kept for the session: the dock's flyout and the panel's gallery ask for the
 * same pictures, and neither should pay for them twice.
 */

const cache = new Map<string, { markup: string; width: number; height: number }>();

export function tableThumb(example: TableExample) {
  let hit = cache.get(example.id);
  if (!hit) {
    const { width, height } = tableSizeFor(example.spec);
    hit = { markup: tableToSvg(example.spec, width, height, { id: example.id }), width, height };
    cache.set(example.id, hit);
  }
  return hit;
}

export const TableThumb: React.FC<{
  example: TableExample;
  /** Fill the box from the top-left — the header and first rows — rather than fit the whole table. */
  crop?: boolean;
  className?: string;
  style?: React.CSSProperties;
}> = ({ example, crop, className, style }) => {
  const t = tableThumb(example);
  return (
    <svg
      className={className}
      style={style}
      viewBox={`0 0 ${t.width} ${t.height}`}
      preserveAspectRatio={crop ? 'xMinYMin slice' : 'xMidYMid meet'}
      aria-hidden="true"
      focusable="false"
      // Our own markup from our own escaper: the examples are static and
      // `tableToSvg` escapes every string it writes.
      dangerouslySetInnerHTML={{ __html: t.markup }}
    />
  );
};
