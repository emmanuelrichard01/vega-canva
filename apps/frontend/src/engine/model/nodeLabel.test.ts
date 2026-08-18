import { describe, it, expect } from 'vitest';
import { TYPE_LABEL, TYPE_ORDER } from './nodeLabel';
import { NODE_TYPES } from './schema';

describe('type chips', () => {
  it('offers a chip for every node type the schema declares', () => {
    // `connector` was missing from both lists, so a board built out of
    // connectors had no way to filter for them. A list that has to stay in
    // step with another list does not stay in step on its own.
    expect([...TYPE_ORDER].sort()).toEqual([...NODE_TYPES].sort());
    NODE_TYPES.forEach((t) => expect(TYPE_LABEL[t]).toBeTruthy());
  });

  it('names each type once', () => {
    expect(new Set(TYPE_ORDER).size).toBe(TYPE_ORDER.length);
  });
});
