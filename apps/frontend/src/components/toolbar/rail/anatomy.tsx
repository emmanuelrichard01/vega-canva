import React from 'react';
import { Divider } from '../RailBase';
import { fitVerbs, RAIL_CONTROL_CAP, type RailVerb } from './verbs';

export type { RailVerb };

/**
 * The rail's fixed anatomy.
 *
 * Every subject fills the same five slots, left to right, so the hand that
 * learned where Stroke is on a rectangle finds it in the same place on a line:
 *
 * 1. **Kind**: the picker for what the selection is (its shape, its font, its
 *    route, its arrangement), as FigJam leads. A subject with nothing to pick
 *    leaves it empty rather than restating its own name; the toolbar's label
 *    already says what it acts on.
 * 2. **Paint**: fill and stroke, wearing their current colours.
 * 3. **Verbs**: what this subject does, most important first.
 * 4. **Conditional**: Paste style, only while a copied style would land here.
 * 5. **Tail**: Comment and the `⋯` menu.
 *
 * Empty slots are not drawn, and a divider only ever stands between two slots
 * that are. The cap is enforced here: verbs that do not fit after the other
 * slots have taken their seats drop off, lowest priority first, to `⋯` and
 * the panel.
 */

export interface RailAnatomyProps {
  kind?: React.ReactNode;
  /** Controls the kind slot puts on the rail: 0 for a label, 1 for a picker. */
  kindControls?: number;
  paint?: React.ReactNode;
  paintControls?: number;
  verbs?: readonly RailVerb[];
  /**
   * A self-contained section that fills paint and verbs on its own, ending in
   * its own divider. Only the chart rail uses it. Its control count is not
   * trimmed here because its optional controls are exclusive by chart kind;
   * `rail.component.test.tsx` holds every chart kind, with Paste style and the
   * tail seated, within the cap.
   */
  section?: React.ReactNode;
  /** Paste style, when it applies. */
  conditional?: React.ReactNode;
  tail: React.ReactNode;
  tailControls: number;
}

const has = (n: React.ReactNode) => n !== null && n !== undefined && n !== false;

export const RailAnatomy: React.FC<RailAnatomyProps> = ({
  kind,
  kindControls = 0,
  paint,
  paintControls = 0,
  verbs = [],
  section,
  conditional,
  tail,
  tailControls,
}) => {
  const tailGroup = (
    <div className="ctx-group" data-slot="tail">
      {conditional}
      {tail}
    </div>
  );

  if (has(section)) {
    return (
      <>
        {has(kind) && (
          <>
            <div className="ctx-group" data-slot="kind">{kind}</div>
            <Divider />
          </>
        )}
        {section}
        {tailGroup}
      </>
    );
  }

  const budget = RAIL_CONTROL_CAP - kindControls - paintControls - tailControls - (has(conditional) ? 1 : 0);
  const shown = fitVerbs(verbs, Math.max(0, budget));
  const groups: React.ReactNode[] = [];
  if (has(kind)) groups.push(<div key="kind" className="ctx-group" data-slot="kind">{kind}</div>);
  if (has(paint)) groups.push(<div key="paint" className="ctx-group" data-slot="paint">{paint}</div>);
  if (shown.length > 0) {
    groups.push(
      <div key="verbs" className="ctx-group" data-slot="verbs">
        {shown.map((verb) => (
          <React.Fragment key={verb.id}>{verb.node}</React.Fragment>
        ))}
      </div>
    );
  }
  groups.push(<React.Fragment key="tail">{tailGroup}</React.Fragment>);

  return (
    <>
      {groups.map((group, i) => (
        <React.Fragment key={i}>
          {i > 0 && <Divider />}
          {group}
        </React.Fragment>
      ))}
    </>
  );
};
