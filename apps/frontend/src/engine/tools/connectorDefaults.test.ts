import { describe, expect, it } from 'vitest';
import { CONNECTOR_DEFAULTS, connectorDefaults, normalizeConnectorDefaults } from './connectorDefaults';

describe('normalizeConnectorDefaults', () => {
  it('gives the defaults for nothing at all', () => {
    expect(normalizeConnectorDefaults(null)).toEqual(CONNECTOR_DEFAULTS);
    expect(normalizeConnectorDefaults('garbage')).toEqual(CONNECTOR_DEFAULTS);
  });

  it('keeps every valid field and repairs each invalid one on its own', () => {
    expect(
      normalizeConnectorDefaults({ routing: 'curved', avoid: 'yes', endStart: 'circle', endEnd: 'rocket' })
    ).toEqual({ routing: 'curved', avoid: CONNECTOR_DEFAULTS.avoid, endStart: 'circle', endEnd: CONNECTOR_DEFAULTS.endEnd });
  });
});

describe('connectorDefaults', () => {
  it('notifies on a change and hands back a new snapshot', () => {
    let calls = 0;
    const off = connectorDefaults.subscribe(() => calls++);
    const before = connectorDefaults.getSnapshot();
    connectorDefaults.set({ routing: before.routing === 'straight' ? 'curved' : 'straight' });
    expect(calls).toBe(1);
    expect(connectorDefaults.getSnapshot()).not.toBe(before);
    off();
  });

  it('keeps the same snapshot when nothing changes', () => {
    const before = connectorDefaults.getSnapshot();
    let calls = 0;
    const off = connectorDefaults.subscribe(() => calls++);
    connectorDefaults.set({ routing: before.routing });
    expect(calls).toBe(0);
    expect(connectorDefaults.getSnapshot()).toBe(before);
    off();
  });
});
