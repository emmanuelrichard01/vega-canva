import { RouteIcon } from '../../panel/connectorIcons';

/** The three routes, each drawn as itself. */
export const ROUTE_SEGMENTS = [
  { value: 'straight', label: 'Straight', hint: 'A direct line', icon: <RouteIcon routing="straight" /> },
  { value: 'orthogonal', label: 'Right angles', hint: 'Elbows, the way a flowchart reads', icon: <RouteIcon routing="orthogonal" /> },
  { value: 'curved', label: 'Curved', hint: 'A smooth arc', icon: <RouteIcon routing="curved" /> },
];
