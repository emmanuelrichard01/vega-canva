import { describe, expect, it } from 'vitest';
import {
  CLIPBOARD_MAGIC,
  offsetOrigin,
  parseClipboard,
  pasteNodes,
  writeClipboard,
} from './clipboard';
import type { AnyNode } from '../model/schema';

const node = (over: Record<string, unknown>): AnyNode =>
  ({ id: 'n', type: 'shape', x: 0, y: 0, width: 100, height: 100, ...over }) as unknown as AnyNode;

describe('writeClipboard', () => {
  it('refuses to overwrite the clipboard with a copy of nothing', () => {
    // Cmd+C on empty space is a common accident, and losing what you copied a
    // minute ago to it is a real annoyance.
    expect(writeClipboard([])).toBeNull();
  });

  it('records the top-left of the copied set', () => {
    const payload = writeClipboard([
      node({ id: 'a', x: 300, y: 120 }),
      node({ id: 'b', x: 140, y: 400 }),
    ])!;
    expect(payload.origin).toEqual({ x: 140, y: 120 });
  });

  it('leaves comment pins out', () => {
    // A comment is anchored to something; pasting one elsewhere anchors it to
    // nothing.
    expect(writeClipboard([node({ id: 'c', type: 'comment' })])).toBeNull();
  });

  it('survives a node with no usable position', () => {
    const payload = writeClipboard([node({ id: 'a', x: NaN, y: NaN })])!;
    expect(Number.isFinite(payload.origin.x)).toBe(true);
  });
});

describe('parseClipboard', () => {
  const valid = () => JSON.stringify(writeClipboard([node({ id: 'a' })]));

  it('reads back what it wrote', () => {
    const parsed = parseClipboard(valid())!;
    expect(parsed.kind).toBe(CLIPBOARD_MAGIC);
    expect(parsed.nodes).toHaveLength(1);
  });

  it('ignores text that is not ours', () => {
    // The clipboard holds whatever the person last copied, which is usually
    // prose. Treating any JSON as a payload is how pasting a config file
    // scatters objects across a board.
    expect(parseClipboard('just some words')).toBeNull();
    expect(parseClipboard('{"nodes":[{"type":"shape"}]}')).toBeNull();
    expect(parseClipboard('')).toBeNull();
  });

  it('ignores a truncated payload rather than throwing', () => {
    expect(parseClipboard(valid().slice(0, 40))).toBeNull();
  });

  it('ignores an envelope with nothing in it', () => {
    expect(parseClipboard(JSON.stringify({ kind: CLIPBOARD_MAGIC, nodes: [] }))).toBeNull();
  });
});

describe('pasteNodes', () => {
  it('gives every pasted node a new id', () => {
    // Keeping the ids would overwrite the originals one for one — a paste that
    // is really a no-op, and destructive if anything had changed since.
    const payload = writeClipboard([node({ id: 'a' }), node({ id: 'b' })])!;
    const { nodes, ids } = pasteNodes(payload, { x: 0, y: 0 });
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain('a');
    expect(nodes.every((n, i) => n.id === ids[i])).toBe(true);
  });

  it('keeps the relative arrangement of the copied set', () => {
    const payload = writeClipboard([
      node({ id: 'a', x: 100, y: 100 }),
      node({ id: 'b', x: 160, y: 220 }),
    ])!;
    const { nodes } = pasteNodes(payload, { x: 500, y: 500 });
    expect(nodes[0].x).toBe(500);
    expect(nodes[0].y).toBe(500);
    // 60 right and 120 down, exactly as they were.
    expect(nodes[1].x).toBe(560);
    expect(nodes[1].y).toBe(620);
  });

  /**
   * The defect the in-memory version had: a connector stores the ids of the
   * objects it joins, so regenerating ids without rewriting them pastes a
   * flowchart whose arrows point at the *originals*. Dragging the copy leaves
   * its arrows behind.
   */
  it('rewrites a connector to point at the copies', () => {
    const payload = writeClipboard([
      node({ id: 'a' }),
      node({ id: 'b' }),
      node({ id: 'edge', type: 'connector', from: { nodeId: 'a' }, to: { nodeId: 'b' } }),
    ])!;
    const { nodes, ids } = pasteNodes(payload, { x: 0, y: 0 });
    const edge = nodes[2];
    expect((edge.from as { nodeId: string }).nodeId).toBe(ids[0]);
    expect((edge.to as { nodeId: string }).nodeId).toBe(ids[1]);
  });

  it('leaves an end that points outside the copied set alone', () => {
    // An arrow copied without its target still points at that target, which is
    // the only meaning available.
    const payload = writeClipboard([
      node({ id: 'edge', type: 'connector', from: { nodeId: 'outside' }, to: { nodeId: 'gone' } }),
    ])!;
    const { nodes } = pasteNodes(payload, { x: 0, y: 0 });
    expect((nodes[0].from as { nodeId: string }).nodeId).toBe('outside');
  });

  /**
   * Reported from the running app: copying a group and pasting it put the copy
   * *inside* the original group in the layers panel, rather than beside it as a
   * second group.
   *
   * `parentId` is the synthetic id that **is** the group — it belongs to no
   * node, so a remap built from node ids never contains it, and carrying it
   * through unchanged makes the pasted objects members of the group they came
   * from. They then move together forever, which is the opposite of a copy.
   */
  it('does not paste a group into the group it was copied from', () => {
    const payload = writeClipboard([
      node({ id: 'a', parentId: 'g1' }),
      node({ id: 'b', parentId: 'g1' }),
    ])!;
    const { nodes } = pasteNodes(payload, { x: 0, y: 0 });
    for (const pasted of nodes) {
      expect(pasted.parentId).not.toBe('g1');
    }
  });

  it('keeps two copied groups apart rather than merging them', () => {
    const payload = writeClipboard([
      node({ id: 'a', parentId: 'g1' }),
      node({ id: 'b', parentId: 'g1' }),
      node({ id: 'c', parentId: 'g2' }),
    ])!;
    const { nodes } = pasteNodes(payload, { x: 0, y: 0 });
    expect(nodes[0].parentId).toBe(nodes[1].parentId);
    expect(nodes[2].parentId).not.toBe(nodes[0].parentId);
  });

  it('leaves an ungrouped object ungrouped', () => {
    const payload = writeClipboard([node({ id: 'a' })])!;
    const { nodes } = pasteNodes(payload, { x: 0, y: 0 });
    expect(nodes[0].parentId).toBeUndefined();
  });

  it('remaps a group so the copy is its own group', () => {
    // Otherwise the pasted objects join the original's group and the two move
    // together forever after.
    const payload = writeClipboard([
      node({ id: 'a', parentId: 'g1' }),
      node({ id: 'b', parentId: 'g1' }),
    ])!;
    const { nodes } = pasteNodes(payload, { x: 0, y: 0 });
    expect(nodes[0].parentId).toBe(nodes[1].parentId);
    expect(nodes[0].parentId).not.toBe('g1');
  });

  it('drops frame membership so it is re-derived where it lands', () => {
    // Carrying it would put a pasted object inside a frame it is not over.
    const payload = writeClipboard([node({ id: 'a', frameId: 'f1' })])!;
    const { nodes } = pasteNodes(payload, { x: 900, y: 900 });
    expect(nodes[0].frameId).toBeUndefined();
  });

  it('offsets from the originals when no point is given', () => {
    // A paste into the same board must be visibly a second object rather than
    // looking like nothing happened.
    const payload = writeClipboard([node({ id: 'a', x: 40, y: 60 })])!;
    const { nodes } = pasteNodes(payload, offsetOrigin(payload));
    expect(nodes[0].x).toBeGreaterThan(40);
    expect(nodes[0].y).toBeGreaterThan(60);
  });

  it('round-trips through text, which is what crossing a tab means', () => {
    const payload = writeClipboard([node({ id: 'a', x: 10, y: 20 })])!;
    const parsed = parseClipboard(JSON.stringify(payload))!;
    const { nodes } = pasteNodes(parsed, { x: 0, y: 0 });
    expect(nodes[0].x).toBe(0);
    expect(nodes[0].type).toBe('shape');
  });
});
