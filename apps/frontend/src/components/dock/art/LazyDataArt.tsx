import React, { Suspense, lazy } from 'react';
import type { ChartKind } from '../../../engine/chart/chartTypes';

/**
 * The dock's chart and grid pictures, fetched when a flyout first shows them.
 *
 * `DataArt` is a thousand lines of drawing that only the Data seat's flyouts
 * use; importing it statically put all of it in the board's first chunk.
 */
const Chart = lazy(() => import('./DataArt').then((m) => ({ default: m.ChartArt })));
const GridKind = lazy(() => import('./DataArt').then((m) => ({ default: m.GridKindArt })));

const blank = (size: number) => <span style={{ display: 'inline-block', width: size, height: size }} aria-hidden="true" />;

export const ChartArt: React.FC<{ kind: ChartKind; size?: number }> = ({ kind, size = 64 }) => (
  <Suspense fallback={blank(size)}>
    <Chart kind={kind} size={size} />
  </Suspense>
);

export const GridKindArt: React.FC<{ kind: React.ComponentProps<typeof GridKind>['kind']; size?: number }> = ({ kind, size = 64 }) => (
  <Suspense fallback={blank(size)}>
    <GridKind kind={kind} size={size} />
  </Suspense>
);

const Frame = lazy(() => import('./FrameArt').then((m) => ({ default: m.FrameArt })));

export const FrameArt: React.FC<React.ComponentProps<typeof Frame>> = ({ size = 64, ...rest }) => (
  <Suspense fallback={blank(size)}>
    <Frame size={size} {...rest} />
  </Suspense>
);
