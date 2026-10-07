import React from 'react';
import { ArrowUpRight, BarChart3, Plus } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Note, Section } from '../panel/grammar';
import { useStore } from '../../hooks/useStore';
import { nodeLabel } from '../../engine/model/nodeLabel';
import { layerHover } from '../../engine/interaction/layerHover';
import { linkRangeLabel } from '../../engine/chart/chartFromTable';
import type { AnyNode, TableNode } from '../../engine/model/schema';
import { useChartsReading } from './useDataBoard';
import { jumpTo, useCanEditData } from './dataActions';
import { ChartThisPreview } from './ChartThisPreview';
import './data.css';

/**
 * A table's charts: every chart drawn from it, with the range and name it
 * reads and a jump to it, and "Chart this table" with a preview first.
 */
export const TableCharts: React.FC<{ node: TableNode }> = ({ node }) => {
  const ids = useChartsReading(node.id);
  const charts = useStore(useShallow((s) => ids.map((id) => s.objects[id]).filter((n): n is AnyNode => n?.type === 'chart')));
  const canEdit = useCanEditData();
  const [previewing, setPreviewing] = React.useState(false);
  React.useEffect(() => () => layerHover.clearPanel(), []);

  return (
    <Section
      id="table-charts"
      title="Charts"
      subject="table"
      meta={charts.length > 0 ? charts.length : undefined}
      onAdd={canEdit && !previewing ? () => setPreviewing(true) : undefined}
      addLabel="Chart this table"
    >
      {previewing && <ChartThisPreview tableId={node.id} table={node.table} onDone={() => setPreviewing(false)} />}
      {charts.length > 0 ? (
        <ul className="data-usedby" aria-label="Charts reading this table">
          {charts.map((c) => {
            const link = c.type === 'chart' ? c.chart.link : undefined;
            const where = link ? linkRangeLabel(node.table, link) : '';
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className="data-usedby__row"
                  onClick={() => jumpTo(c.id)}
                  onPointerEnter={() => layerHover.set(c.id)}
                  onPointerLeave={() => layerHover.clearPanel()}
                  onFocus={() => layerHover.set(c.id)}
                  onBlur={() => layerHover.clearPanel()}
                >
                  <BarChart3 size={14} aria-hidden="true" />
                  <span className="data-usedby__text">
                    <span className="data-usedby__name">{nodeLabel(c)}</span>
                    <span className="data-usedby__meta">{link?.name ? `${link.name} · ${where}` : where}</span>
                  </span>
                  <ArrowUpRight size={12} aria-hidden="true" className="data-usedby__go" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        !previewing && (
          <>
            <Note>No chart reads this table yet. A linked chart follows every edit here.</Note>
            {canEdit && (
              <button type="button" className="data-textbtn" onClick={() => setPreviewing(true)}>
                <Plus size={14} aria-hidden="true" />
                Chart this table
              </button>
            )}
          </>
        )
      )}
    </Section>
  );
};
