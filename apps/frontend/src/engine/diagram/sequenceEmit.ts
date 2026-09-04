/**
 * A sequence diagram on the board, read back as code.
 *
 * ## The bug this exists to fix
 *
 * "Edit diagram" re-derives source from the objects rather than remembering
 * what it was given, which is right and is most of the value: a diagram that
 * has been rearranged by hand emits what it actually *is* now. But
 * `diagramToMermaid` only knows how to write flowcharts, so pointing it at a
 * sequence diagram produced a flowchart made of lifelines and arrow stubs --
 * and applying that replaced a correct diagram with the nonsense. Editing was
 * destructive on exactly the diagrams this feature had just learned to draw.
 *
 * ## How the shape is recovered
 *
 * Nothing extra is stored. The build leaves enough structure to read back:
 *
 * - A **lifeline** is the one `line` shape carrying a `diagramKey`, and its
 *   left-to-right order is the participant order.
 * - A **head** is the other shape with that same key; its text is the label,
 *   and a `cornerRadius` big enough to have made a pill is how `actor` was
 *   drawn, so it is how `actor` is recognised.
 * - A **message** is a connector between two lifelines, and its row is the
 *   `v` of its anchor -- which is a fraction of the lifeline's own box, so it
 *   still means the same row after the diagram has been moved or stretched.
 * - A **note** is a plate with text and no key, and the participants it covers
 *   are the lifelines its box spans.
 * - A **frame** is an unfilled plate whose text starts with a block keyword,
 *   and its `else` compartments are the dividers lying inside it. Nesting is
 *   read from containment, which is the only record of it and is sufficient:
 *   a frame drawn inside another was written inside it.
 *
 * ## What does not survive
 *
 * `-)` and `->>` are drawn with the same arrowhead, because every filled cap
 * in this vocabulary is filled and there is no open one to spend on async. So
 * an async message comes back as an ordinary one. That is a real loss and it
 * is the only one; it is recorded here rather than hidden because somebody
 * will eventually notice their `-)` became `->>` and deserve an explanation.
 */

import type { AnyNode } from '../model/schema';
import { BLOCK_TYPES, type SeqBlockType } from './sequence';

/** The pill radius `buildSequence` uses for an actor; anything near it is one. */
const ACTOR_RADIUS = 100;

interface Lifeline {
  id: string;
  key: string;
  x: number;
  y: number;
  height: number;
  centreX: number;
}

function diagramKeyOf(node: AnyNode): string | undefined {
  const key = (node as unknown as Record<string, unknown>).diagramKey;
  return typeof key === 'string' && key ? key : undefined;
}

function lifelinesOf(nodes: readonly AnyNode[]): Lifeline[] {
  return nodes
    .flatMap((node) => {
      if (node.type !== 'shape') return [];
      const geometry = (node as { geometry?: { kind?: string } }).geometry;
      if (geometry?.kind !== 'line') return [];
      const key = diagramKeyOf(node);
      if (!key) return [];
      return [
        {
          id: node.id,
          key,
          x: node.x,
          y: node.y,
          height: node.height,
          centreX: node.x + node.width / 2,
        },
      ];
    })
    .sort((a, b) => a.centreX - b.centreX);
}

/**
 * Whether this selection is a sequence diagram rather than a flowchart.
 *
 * Asked before `diagramToMermaid`, which would otherwise happily write a
 * flowchart out of it.
 */
export function isSequenceDiagram(nodes: readonly AnyNode[]): boolean {
  return lifelinesOf(nodes).length > 0;
}

export function sequenceToMermaid(nodes: readonly AnyNode[]): string | null {
  const lifelines = lifelinesOf(nodes);
  if (lifelines.length === 0) return null;

  const byId = new Map(lifelines.map((l) => [l.id, l]));
  const lifelineKeys = new Set(lifelines.map((l) => l.key));

  // Heads carry the label and say whether the participant was drawn as an
  // actor. Matched by key rather than by position, so moving a box by hand
  // does not detach its name from its lifeline.
  const heads = new Map<string, { label: string; actor: boolean }>();
  for (const node of nodes) {
    if (node.type !== 'shape') continue;
    const geometry = (node as { geometry?: { kind?: string } }).geometry;
    if (geometry?.kind === 'line') continue;
    const key = diagramKeyOf(node);
    if (!key || !lifelineKeys.has(key)) continue;
    const radius = (node as { appearance?: { cornerRadius?: number } }).appearance?.cornerRadius;
    heads.set(key, {
      label: ((node as { text?: string }).text || key).replace(/\n/g, ' ').trim(),
      actor: (radius ?? 0) >= ACTOR_RADIUS,
    });
  }

  type Step = { y: number; line: string; depth: number };
  const steps: Step[] = [];

  /**
   * Frames, and the compartments inside them.
   *
   * A frame is told apart from a note by its text: it opens with one of the
   * block keywords, which is exactly the string the build wrote there so that
   * the tab and the emitted line could never drift apart.
   */
  interface Frame {
    block: SeqBlockType;
    label: string;
    top: number;
    bottom: number;
    left: number;
    right: number;
  }
  const frames: Frame[] = [];
  const dividers: Array<{ y: number; label: string; left: number; right: number }> = [];

  for (const node of nodes) {
    if (node.type === 'text') {
      const text = ((node as { text?: string }).text || '').trim();
      if (/^else\b/i.test(text)) {
        dividers.push({
          y: node.y,
          label: text.replace(/^else\s*/i, ''),
          left: node.x,
          right: node.x + node.width,
        });
      }
      continue;
    }
    if (node.type !== 'shape' || diagramKeyOf(node)) continue;
    const geometry = (node as { geometry?: { kind?: string } }).geometry;
    if (geometry?.kind !== 'rect') continue;
    const text = ((node as { text?: string }).text || '').replace(/\n/g, ' ').trim();
    const word = text.split(/\s+/)[0]?.toLowerCase();
    if (!word || !(BLOCK_TYPES as readonly string[]).includes(word)) continue;
    frames.push({
      block: word as SeqBlockType,
      label: text.slice(word.length).trim(),
      top: node.y,
      bottom: node.y + node.height,
      left: node.x,
      right: node.x + node.width,
    });
  }

  /** Outermost first, so an opener is written before anything it contains. */
  frames.sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  const depthOf = (frame: Frame) =>
    frames.filter((f) => f !== frame && f.top <= frame.top && f.bottom >= frame.bottom).length;

  // --- messages ------------------------------------------------------------
  for (const node of nodes) {
    if (node.type !== 'connector') continue;
    const connector = node as unknown as {
      from: { nodeId?: string; anchor?: { v?: number } };
      to: { nodeId?: string; anchor?: { v?: number } };
      label?: string;
      endEnd?: string;
      appearance?: { stroke?: { dash?: number[] } };
    };
    const from = connector.from.nodeId ? byId.get(connector.from.nodeId) : undefined;
    const to = connector.to.nodeId ? byId.get(connector.to.nodeId) : undefined;
    if (!from || !to) continue;

    // The row, from the anchor rather than from any coordinate: `v` is a
    // fraction of the lifeline's own box and so survives it being moved.
    const v = connector.from.anchor?.v ?? 0.5;
    const y = from.y + v * from.height;

    const dotted = Boolean(connector.appearance?.stroke?.dash?.length);
    const token = arrowToken(dotted, connector.endEnd);
    const label = (connector.label ?? '').replace(/\n/g, ' ').trim();
    steps.push({
      y,
      depth: 0,
      line: `${from.key}${token}${to.key}${label ? `: ${label}` : ''}`,
    });
  }

  // --- notes ---------------------------------------------------------------
  for (const node of nodes) {
    if (node.type !== 'shape') continue;
    if (diagramKeyOf(node)) continue;
    const geometry = (node as { geometry?: { kind?: string } }).geometry;
    if (geometry?.kind !== 'rect') continue;
    const text = ((node as { text?: string }).text || '').replace(/\n/g, ' ').trim();
    if (!text) continue;
    // A frame is a plate too; it is written out as a block, not as a note.
    const opener = text.split(/\s+/)[0]?.toLowerCase();
    if (opener && (BLOCK_TYPES as readonly string[]).includes(opener)) continue;

    // Which participants the plate covers. A note over two of them spans both
    // lifelines; one over a single participant sits on its own.
    const left = node.x;
    const right = node.x + node.width;
    const covered = lifelines.filter((l) => l.centreX >= left && l.centreX <= right);
    if (covered.length === 0) continue;
    const over = covered.length === 1 ? covered[0].key : `${covered[0].key},${covered[covered.length - 1].key}`;
    steps.push({ y: node.y + node.height / 2, depth: 0, line: `Note over ${over}: ${text}` });
  }

  /**
   * Openers, dividers and closers folded into the stream by position.
   *
   * Each frame contributes three markers -- an opener just above its top, a
   * divider at each rule, and an `end` just below its bottom -- and then the
   * whole lot is sorted by y. Sorting rather than recursing is what makes
   * nesting fall out for free: an inner frame's opener has a larger y than the
   * outer one's, so it lands after it, and its `end` lands before the outer
   * `end` because its bottom is higher up.
   *
   * The epsilons keep a marker on the correct side of a step that shares its
   * coordinate, which is otherwise decided by sort stability and the order the
   * board happened to be walked in.
   */
  for (const frame of frames) {
    const depth = depthOf(frame);
    steps.push({
      y: frame.top - 0.5,
      depth,
      line: frame.label ? `${frame.block} ${frame.label}` : frame.block,
    });
    steps.push({ y: frame.bottom + 0.5, depth, line: 'end' });
    for (const divider of dividers) {
      // Belongs to the innermost frame that contains it.
      const inside =
        divider.y > frame.top &&
        divider.y < frame.bottom &&
        divider.left >= frame.left - 1 &&
        divider.right <= frame.right + 1;
      if (!inside) continue;
      const innermost = frames.every(
        (other) =>
          other === frame ||
          !(
            divider.y > other.top &&
            divider.y < other.bottom &&
            other.top >= frame.top &&
            other.bottom <= frame.bottom
          )
      );
      if (!innermost) continue;
      steps.push({
        y: divider.y,
        depth: depth + 1,
        line: divider.label ? `else ${divider.label}` : 'else',
      });
    }
  }

  steps.sort((a, b) => a.y - b.y);

  /**
   * Indented by nesting, which mermaid does not require and a reader does.
   *
   * Tracked by counting openers and `end`s on the way out rather than by the
   * `depth` computed above: that one describes the frames, and this one has to
   * describe the *lines*, so a divider sits one level in from its own frame.
   */
  let level = 0;
  const written = steps.map((step) => {
    if (step.line === 'end') level = Math.max(0, level - 1);
    const isDivider = /^else\b/.test(step.line);
    const indent = '    '.repeat(1 + Math.max(0, isDivider ? level - 1 : level));
    if ((BLOCK_TYPES as readonly string[]).includes(step.line.split(/\s+/)[0])) level += 1;
    return indent + step.line;
  });

  const declarations = lifelines.map((l) => {
    const head = heads.get(l.key);
    const label = head?.label ?? l.key;
    const keyword = head?.actor ? 'actor' : 'participant';
    // `as` only when the label is not already the key, which keeps a diagram
    // written with bare names emitting bare names.
    return label === l.key
      ? `    ${keyword} ${l.key}`
      : `    ${keyword} ${l.key} as ${label}`;
  });

  return ['sequenceDiagram', ...declarations, ...written].join('\n');
}

/** The arrow the build drew, read back from the cap and the dash. */
function arrowToken(dotted: boolean, endEnd: string | undefined): string {
  // `bar` is what a lost message (`-x`) was drawn with; there is no cross cap.
  if (endEnd === 'bar') return dotted ? '--x' : '-x';
  // No cap at all is mermaid's `->`, which genuinely has no arrowhead.
  if (endEnd === 'none' || !endEnd) return dotted ? '-->' : '->';
  return dotted ? '-->>' : '->>';
}
