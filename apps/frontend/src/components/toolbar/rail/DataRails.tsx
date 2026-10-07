import React from 'react';
import type { ChartNode, CodeNode, LinkNode } from '../../../engine/model/schema';
import { ChartRailSection } from '../ChartRailSection';
import { CodeLanguageControl, CodeThemeControl } from '../CodeRailSection';
import { codeVerbs } from './codeVerbs';
import { LinkDisplayControl } from '../LinkRailSection';
import { linkVerbs } from './linkVerbs';
import { RailAnatomy } from './anatomy';
import type { SingleRail } from './types';

/**
 * A chart brings its own section from the chart module, which leads with its
 * kind picker; the frame adds the tail.
 */
export const ChartRail: SingleRail<ChartNode> = ({ node, conditional, tail, tailControls }) => (
  <RailAnatomy section={<ChartRailSection node={node} />} conditional={conditional} tail={tail} tailControls={tailControls} />
);

/** A code block: its language as the kind, its theme as the paint. */
export const CodeRail: SingleRail<CodeNode> = ({ node, menuActions, conditional, tail, tailControls }) => (
  <RailAnatomy
    kind={<CodeLanguageControl node={node} />}
    kindControls={1}
    paint={<CodeThemeControl node={node} />}
    paintControls={1}
    verbs={codeVerbs(node, menuActions.renderDiagram)}
    conditional={conditional}
    tail={tail}
    tailControls={tailControls}
  />
);

/** A link card: how it is shown, then where it goes. */
export const LinkRail: SingleRail<LinkNode> = ({ node, conditional, tail, tailControls }) => {
  return (
    <RailAnatomy
      paint={<LinkDisplayControl node={node} />}
      paintControls={1}
      verbs={linkVerbs(node)}
      conditional={conditional}
      tail={tail}
      tailControls={tailControls}
    />
  );
};
