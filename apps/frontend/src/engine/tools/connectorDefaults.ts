import type { Routing } from '../model/connector';
import { END_CAP_KINDS, type EndCapKind } from '../model/connectorEnds';
import { storageGetJson, storageSet } from '../../utils/safeStorage';

/**
 * What the next connector comes out as.
 *
 * The connector shelf writes here and the connector tool reads here when it
 * creates a connector. A per-person preference, so it lives in `localStorage`
 * rather than the document: one person's habit of drawing curves must not
 * change what everyone else's next connector looks like.
 *
 * Colour is not here. It already lives in the store as `connectorColor`, which
 * the tool reads; one value in two places would be two answers.
 */
export interface ConnectorDefaults {
  routing: Routing;
  /** Route around objects in the way. Read by the obstacle-avoiding router. */
  avoid: boolean;
  endStart: EndCapKind;
  endEnd: EndCapKind;
}

export const CONNECTOR_DEFAULTS: ConnectorDefaults = {
  routing: 'orthogonal',
  avoid: true,
  endStart: 'none',
  endEnd: 'arrow',
};

const KEY = 'vega_connector_defaults';
const ROUTINGS: readonly Routing[] = ['orthogonal', 'curved', 'straight'];

/** A stored value, made safe: anything unrecognised falls back field by field. */
export function normalizeConnectorDefaults(raw: unknown): ConnectorDefaults {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ConnectorDefaults, unknown>>;
  const cap = (value: unknown, fallback: EndCapKind): EndCapKind =>
    typeof value === 'string' && (END_CAP_KINDS as string[]).includes(value) ? (value as EndCapKind) : fallback;
  return {
    routing: ROUTINGS.includes(source.routing as Routing) ? (source.routing as Routing) : CONNECTOR_DEFAULTS.routing,
    avoid: typeof source.avoid === 'boolean' ? source.avoid : CONNECTOR_DEFAULTS.avoid,
    endStart: cap(source.endStart, CONNECTOR_DEFAULTS.endStart),
    endEnd: cap(source.endEnd, CONNECTOR_DEFAULTS.endEnd),
  };
}

type Listener = () => void;
const listeners = new Set<Listener>();
let current: ConnectorDefaults = normalizeConnectorDefaults(storageGetJson<unknown>(KEY, null));

export const connectorDefaults = {
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Stable between changes, for `useSyncExternalStore`. */
  getSnapshot: (): ConnectorDefaults => current,

  set(patch: Partial<ConnectorDefaults>) {
    const next = normalizeConnectorDefaults({ ...current, ...patch });
    if (
      next.routing === current.routing &&
      next.avoid === current.avoid &&
      next.endStart === current.endStart &&
      next.endEnd === current.endEnd
    ) {
      return;
    }
    current = next;
    storageSet(KEY, JSON.stringify(current));
    listeners.forEach((fn) => fn());
  },
};
