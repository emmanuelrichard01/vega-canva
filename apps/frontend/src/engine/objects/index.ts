/**
 * Object type registry — the barrel is the *only* supported entry point.
 *
 * Importing `./definitions` here for its registration side effects is what
 * makes `objectRegistry` non-empty. Previously `ObjectDefinitions.ts` was
 * imported by nothing at all, so the registry was empty at runtime and every
 * `capabilities.supports*` gate in the Properties panel evaluated false —
 * meaning Fill, Stroke, Typography, Opacity and Corner Radius silently never
 * rendered for any object type. The panel looked intentionally minimal
 * instead of broken, which is why it survived so long.
 *
 * Routing all consumers through this barrel rather than through
 * `./registry` directly makes registration impossible to forget: you cannot
 * obtain the registry without also having populated it.
 */
import './definitions';

export { objectRegistry } from './registry';
export type {
  ObjectCapabilities,
  CanvasObjectDef,
  ObjectRendererProps,
  ObjectInspectorProps,
  ObjectToolbarProps,
} from './registry';
