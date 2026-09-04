/**
 * Mermaid sequence diagrams: parsing, and where everything goes.
 *
 * ## Why this is a separate module from `mermaid.ts`
 *
 * A flowchart is a *graph* — nodes with edges, whose positions are whatever a
 * layout engine decides — and `layout.ts` hands the whole problem to dagre for
 * exactly that reason. A sequence diagram is not a graph. It is a **timeline**:
 * the participants are columns in a fixed order, the messages are rows in the
 * order they were written, and the position of everything follows from those
 * two facts by arithmetic.
 *
 * Running it through dagre would be asking a layered-graph algorithm to
 * reproduce a grid it has no reason to prefer, and the first time two messages
 * crossed it would reorder the participants to uncross them — which is the one
 * thing a sequence diagram may never do, because the columns are the cast and
 * their order is the reader's map.
 *
 * So the layout here is deliberately not clever. It is a table.
 *
 * ## What is supported
 *
 * Participants (declared or inferred), every arrow form mermaid defines,
 * self-messages, activations, notes, and **blocks** — `loop`, `alt`/`else`,
 * `opt`, `par`/`and`, `critical`/`option` and `break`, nested to any depth.
 *
 * Blocks were refused at first, on the grounds that a frame around a *range*
 * of messages cannot be dropped without drawing a picture that looks complete
 * and says something the source does not. That reasoning was right and the
 * conclusion was wrong: the answer to a construct you cannot fake is to
 * implement it, and a sequence diagram without `alt` is missing the thing
 * sequence diagrams are mostly drawn for.
 *
 * They are parsed with a stack, so nesting works, and an unbalanced `end` is
 * an error with a line number rather than a frame that silently swallows the
 * rest of the document.
 */

export interface SeqParticipant {
  key: string;
  label: string;
  /** Declared with `actor`, which mermaid draws as a stick figure rather than a box. */
  actor: boolean;
}

/** How a message's line is drawn. */
export type SeqLine = 'solid' | 'dotted';

/** What sits at the arrow's far end. */
export type SeqHead =
  /** `->>` and `-->>` — a filled arrowhead. The ordinary call. */
  | 'arrow'
  /** `->` and `-->` — no head at all. Mermaid draws these as a plain line. */
  | 'open'
  /** `-x` and `--x` — a cross. Conventionally a failed or lost message. */
  | 'cross'
  /** `-)` and `--)` — an open arrow. Conventionally asynchronous. */
  | 'async';

export interface SeqMessage {
  kind: 'message';
  from: string;
  to: string;
  label: string;
  line: SeqLine;
  head: SeqHead;
  /** `->>+` — the receiver becomes active from here. */
  activate: boolean;
  /** `-->>-` — the *sender* stops being active at this point. */
  deactivate: boolean;
}

export interface SeqNote {
  kind: 'note';
  /** One participant for `left of`/`right of`, one or two for `over`. */
  over: string[];
  placement: 'left' | 'right' | 'over';
  text: string;
}

/** The frame kinds mermaid draws around a range of messages. */
export const BLOCK_TYPES = [
  'loop',
  'alt',
  'opt',
  'par',
  'critical',
  'break',
  'rect',
] as const;
export type SeqBlockType = (typeof BLOCK_TYPES)[number];

/**
 * A frame opening. Its extent is not known until the matching `end`, which is
 * why this is a marker in the step stream rather than a container: the parser
 * would otherwise have to buffer, and the layout walks the stream anyway.
 */
export interface SeqBlockStart {
  kind: 'block-start';
  block: SeqBlockType;
  label: string;
}

/**
 * A divider inside an open frame — `else` in an `alt`, `and` in a `par`.
 *
 * Its own compartment of the same frame rather than a frame of its own, which
 * is what mermaid draws and what the construct means: the alternatives are
 * exclusive branches of one decision, not two unrelated boxes.
 */
export interface SeqBlockSection {
  kind: 'block-section';
  label: string;
}

export interface SeqBlockEnd {
  kind: 'block-end';
}

export type SeqStep = SeqMessage | SeqNote | SeqBlockStart | SeqBlockSection | SeqBlockEnd;

export interface SequenceDiagram {
  participants: SeqParticipant[];
  steps: SeqStep[];
}

export interface SeqParseResult {
  diagram: SequenceDiagram | null;
  error: string | null;
  errorLine?: number;
  /** Lines that were understood but could not be represented. */
  skippedLines: number[];
}

/**
 * The arrow forms, longest first.
 *
 * Order is the whole correctness of this table: `-->>` contains `-->` which
 * contains `->`, so a shorter form matched first would claim the front of a
 * longer one and leave its tail in the label. Every one of these is a real
 * mermaid token, and the sort is by length rather than by hand so adding one
 * cannot reintroduce the bug.
 */
const ARROWS: { token: string; line: SeqLine; head: SeqHead }[] = ([
  { token: '-->>', line: 'dotted', head: 'arrow' },
  { token: '--x', line: 'dotted', head: 'cross' },
  { token: '--)', line: 'dotted', head: 'async' },
  { token: '->>', line: 'solid', head: 'arrow' },
  { token: '-->', line: 'dotted', head: 'open' },
  { token: '-x', line: 'solid', head: 'cross' },
  { token: '-)', line: 'solid', head: 'async' },
  { token: '->', line: 'solid', head: 'open' },
] as { token: string; line: SeqLine; head: SeqHead }[]).sort(
  (a, b) => b.token.length - a.token.length,
);

/**
 * The words that open a frame, and what each is called.
 *
 * `critical`/`option` and `par`/`and` are the same construct under two names
 * either side of a divider, so the opener maps to a type and the divider is
 * handled separately.
 */
const BLOCK_OPENERS: Record<string, SeqBlockType> = {
  loop: 'loop',
  alt: 'alt',
  opt: 'opt',
  par: 'par',
  critical: 'critical',
  break: 'break',
  rect: 'rect',
};

/** The words that divide an open frame rather than opening a new one. */
const BLOCK_DIVIDERS = new Set(['else', 'and', 'option']);

export function looksLikeSequence(text: string): boolean {
  return /^\s*sequenceDiagram\b/im.test(text);
}

/** A participant reference, with the `+`/`-` activation suffix removed. */
function cleanKey(raw: string): { key: string; activate: boolean; deactivate: boolean } {
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) return { key: trimmed.slice(1).trim(), activate: true, deactivate: false };
  if (trimmed.startsWith('-')) return { key: trimmed.slice(1).trim(), activate: false, deactivate: true };
  return { key: trimmed, activate: false, deactivate: false };
}

export function parseSequence(source: string): SeqParseResult {
  const skippedLines: number[] = [];
  const lines = source
    .split('\n')
    .map((text, i) => ({ text: text.trim(), lineNum: i + 1 }))
    .filter((l) => l.text.length > 0 && !l.text.startsWith('%%'));

  if (lines.length === 0) return { diagram: null, error: null, skippedLines };
  if (!/^sequenceDiagram\b/i.test(lines[0].text)) {
    return {
      diagram: null,
      error: 'Start with "sequenceDiagram".',
      errorLine: lines[0].lineNum,
      skippedLines,
    };
  }

  const participants: SeqParticipant[] = [];
  const byKey = new Map<string, SeqParticipant>();
  const steps: SeqStep[] = [];

  /**
   * Participants appear in the order they are first *seen*, declared or not.
   *
   * Mermaid's own rule, and the reason it matters is that the column order is
   * the reader's map: a diagram whose participants moved when a message was
   * added would be a different picture of the same conversation.
   */
  const ensure = (key: string, label?: string, actor = false): SeqParticipant => {
    const existing = byKey.get(key);
    if (existing) {
      if (label) existing.label = label;
      if (actor) existing.actor = true;
      return existing;
    }
    const created = { key, label: label ?? key, actor };
    byKey.set(key, created);
    participants.push(created);
    return created;
  };

  /**
   * Open frames, innermost last.
   *
   * A stack rather than a counter because the *kind* matters on the way out:
   * a divider is only legal inside a frame that has compartments, and an `end`
   * with nothing open is a real error rather than a line to skip.
   */
  const openBlocks: Array<{ block: SeqBlockType; lineNum: number }> = [];

  for (const { text, lineNum } of lines.slice(1)) {
    const first = text.split(/\s+/)[0].toLowerCase();

    const opener = BLOCK_OPENERS[first];
    if (opener) {
      openBlocks.push({ block: opener, lineNum });
      steps.push({
        kind: 'block-start',
        block: opener,
        // `rect rgb(200,200,255)` labels a colour rather than a condition, and
        // there is nothing useful to write in the tab for it.
        label: opener === 'rect' ? '' : stripQuotes(text.slice(first.length).trim()),
      });
      continue;
    }

    if (BLOCK_DIVIDERS.has(first)) {
      if (openBlocks.length === 0) {
        return {
          diagram: null,
          error: `"${first}" divides a block, but no block is open here.`,
          errorLine: lineNum,
          skippedLines,
        };
      }
      steps.push({ kind: 'block-section', label: stripQuotes(text.slice(first.length).trim()) });
      continue;
    }

    if (first === 'end') {
      if (openBlocks.length === 0) {
        return {
          diagram: null,
          error: '"end" closes a block, but no block is open here.',
          errorLine: lineNum,
          skippedLines,
        };
      }
      openBlocks.pop();
      steps.push({ kind: 'block-end' });
      continue;
    }

    // `participant A as Alice` / `actor B`
    const declared = /^(participant|actor)\s+(.+)$/i.exec(text);
    if (declared) {
      const body = declared[2];
      const alias = /^(\S+)\s+as\s+(.+)$/i.exec(body);
      if (alias) ensure(alias[1], stripQuotes(alias[2]), declared[1].toLowerCase() === 'actor');
      else ensure(body.trim(), undefined, declared[1].toLowerCase() === 'actor');
      continue;
    }

    // `Note over A,B: text` / `Note right of A: text`
    const note = /^note\s+(left of|right of|over)\s+([^:]+):\s*(.*)$/i.exec(text);
    if (note) {
      const placement = note[1].toLowerCase().startsWith('left')
        ? 'left'
        : note[1].toLowerCase().startsWith('right')
          ? 'right'
          : 'over';
      const over = note[2].split(',').map((s) => s.trim()).filter(Boolean);
      for (const key of over) ensure(key);
      steps.push({ kind: 'note', over, placement, text: stripQuotes(note[3]) });
      continue;
    }

    // Directives that change nothing this draws. Recorded rather than refused:
    // a diagram is still correct without them, and stopping on `autonumber`
    // would refuse a whole file over a line that only adds counters.
    if (/^(autonumber|activate|deactivate|title|accTitle|accDescr|box)\b/i.test(text)) {
      skippedLines.push(lineNum);
      continue;
    }

    const arrow = ARROWS.find((a) => text.includes(a.token));
    if (!arrow) {
      skippedLines.push(lineNum);
      continue;
    }

    const at = text.indexOf(arrow.token);
    const left = text.slice(0, at);
    const rest = text.slice(at + arrow.token.length);
    const colon = rest.indexOf(':');
    const rightRaw = colon >= 0 ? rest.slice(0, colon) : rest;
    const label = colon >= 0 ? stripQuotes(rest.slice(colon + 1).trim()) : '';

    const from = cleanKey(left);
    const to = cleanKey(rightRaw);
    if (!from.key || !to.key) {
      skippedLines.push(lineNum);
      continue;
    }

    ensure(from.key);
    ensure(to.key);
    steps.push({
      kind: 'message',
      from: from.key,
      to: to.key,
      label,
      line: arrow.line,
      head: arrow.head,
      /**
       * Both suffixes are written on the *right* of the arrow, and they mean
       * opposite ends.
       *
       * `A->>+B` activates B, the receiver -- the plus is where it looks. But
       * `B-->>-A` deactivates **B**, the sender, even though the minus is
       * written against A. Mermaid's reading is "this message is the last
       * thing the sender was doing", so the token sits with the reply and
       * refers back. Taking `deactivate` from the left-hand key looks more
       * natural and is simply wrong: nothing is ever written there.
       */
      activate: to.activate,
      deactivate: to.deactivate,
    });
  }

  if (openBlocks.length > 0) {
    /**
     * Reported against the line that *opened* it, not the end of the file.
     *
     * The missing `end` is invisible -- there is nothing to point at -- so the
     * only useful coordinate is where the frame that never closed began.
     */
    const unclosed = openBlocks[openBlocks.length - 1];
    return {
      diagram: null,
      error: `This "${unclosed.block}" is never closed. Add an "end" for it.`,
      errorLine: unclosed.lineNum,
      skippedLines,
    };
  }

  if (participants.length === 0) {
    return {
      diagram: null,
      error: 'No participants yet. Try "Alice->>Bob: Hello".',
      errorLine: lines[0].lineNum,
      skippedLines,
    };
  }

  return { diagram: { participants, steps }, error: null, skippedLines };
}

function stripQuotes(s: string): string {
  const t = s.trim();
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))
    ? t.slice(1, -1)
    : t;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * What a piece of text will occupy, and how it breaks.
 *
 * Injected rather than imported so this module stays pure and testable. The
 * default is an estimate good enough for a test to reason about; the app
 * passes a real measurer built on the same font machinery the flowchart path
 * uses, so the boxes match the type that will actually be drawn in them.
 *
 * `lines` comes back with the size because both renderers need it. The SVG
 * preview cannot wrap text by itself, and if it wrapped differently from the
 * canvas the preview would be showing a diagram nobody is about to get.
 */
export interface TextMetrics {
  width: number;
  height: number;
  lines: string[];
}

export type Measurer = (
  text: string,
  options: { fontSize: number; maxWidth?: number }
) => TextMetrics;

/** Roughly the average advance of Inter as a fraction of its size. */
const CHAR_RATIO = 0.55;
const LINE_RATIO = 1.35;

/**
 * A measurement for tests and for the moment before a font has loaded.
 *
 * Greedy word wrapping, which is what every text engine does at this scale and
 * what the real measurer will also do -- so a diagram laid out with this and
 * one laid out with the real thing break in the same places, and only the
 * exact widths differ.
 */
export const estimateText: Measurer = (text, { fontSize, maxWidth }) => {
  const words = text.split(/\s+/).filter(Boolean);
  const widthOf = (str: string) => str.length * fontSize * CHAR_RATIO;

  if (!maxWidth || words.length === 0) {
    const single = text.trim();
    return {
      width: widthOf(single),
      height: fontSize * LINE_RATIO,
      lines: single ? [single] : [],
    };
  }

  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    // A single word wider than the box still gets its own line: breaking
    // inside a word is worse than one line that overhangs.
    if (line && widthOf(candidate) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);

  return {
    width: Math.max(0, ...lines.map(widthOf)),
    height: Math.max(1, lines.length) * fontSize * LINE_RATIO,
    lines,
  };
};

export interface SeqLayoutOptions {
  /** Top-left of the whole diagram, in world coordinates. */
  originX: number;
  originY: number;
  /** A participant's head box never goes below this, or above it. */
  minColumnWidth: number;
  maxColumnWidth: number;
  /** The least space between two adjacent head boxes. */
  minGap: number;
  /** Vertical distance between consecutive steps. */
  rowHeight: number;
  /** The least depth of a head box; a wrapped label makes it taller. */
  minHeadHeight: number;
  measure: Measurer;
}

export const SEQ_DEFAULTS: SeqLayoutOptions = {
  originX: 0,
  originY: 0,
  minColumnWidth: 128,
  maxColumnWidth: 260,
  minGap: 72,
  rowHeight: 62,
  minHeadHeight: 52,
  measure: estimateText,
};

/** Type sizes, shared by the layout and by both renderers. */
export const SEQ_TYPE = {
  head: 13,
  message: 11,
  note: 11,
};

const HEAD_PAD_X = 24;
const HEAD_PAD_Y = 20;
const NOTE_PAD_X = 20;
const NOTE_PAD_Y = 14;
/** Clearance either side of a message label, between the two lifelines. */
const MESSAGE_PAD = 32;
/** The label tab at the top of a frame, and the breathing room below it. */
const BLOCK_HEADER = 26;
const BLOCK_FOOT = 14;
/** How far a frame reaches beyond the outermost lifeline it contains. */
const BLOCK_MARGIN = 28;
/** Each nesting level draws in a little from the one outside it. */
const BLOCK_INSET = 10;
/** Room for the divider label in an `alt`. */
const SECTION_GAP = 22;

/** How far a self-message loop reaches to the right of its own lifeline. */
export const SELF_REACH = 46;
/**
 * How far below its start a self-message returns.
 *
 * Shared by the build and the preview because it is the *same loop*: it was a
 * literal in each, and two copies of a number that has to agree is how a
 * preview comes to show a shape the board does not draw.
 */
export const SELF_DROP = 34;

export interface SeqLane {
  key: string;
  label: string;
  actor: boolean;
  /** The head box. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The label as it breaks inside the box. */
  lines: string[];
  /** The lifeline's x, which is the box's centre. */
  centreX: number;
  /** Where the lifeline runs from and to. */
  lineTop: number;
  lineBottom: number;
  /**
   * Top of the *second* head box, repeated at the foot of the lifeline.
   *
   * Mermaid draws the cast at both ends, and the reason is scrolling: on a
   * long exchange the top row is off the screen by the time it matters, so a
   * reader tracking the last few messages has no way to tell which column is
   * which. The repeat is what makes a tall diagram readable at the bottom.
   */
  footY: number;
}

export interface SeqArrowPlacement {
  kind: 'arrow';
  from: string;
  to: string;
  label: string;
  line: SeqLine;
  head: SeqHead;
  y: number;
  /** True when a participant messages itself, which is drawn as a loop. */
  self: boolean;
}

export interface SeqNotePlacement {
  kind: 'note';
  text: string;
  lines: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A frame around a range of messages, and its compartments.
 *
 * Emitted at the `end` rather than at the opener, because that is the first
 * moment its extent is known -- a frame's height is decided by what turned out
 * to be inside it.
 */
export interface SeqFramePlacement {
  kind: 'frame';
  block: SeqBlockType;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** How deeply nested, so the renderers can inset and tint by depth. */
  depth: number;
  /** `else` / `and` dividers: the y each one starts at, and its own label. */
  sections: { y: number; label: string }[];
}

export interface SeqLayout {
  lanes: SeqLane[];
  steps: (SeqArrowPlacement | SeqNotePlacement)[];
  /**
   * Drawn *under* the messages, so they are kept apart from `steps` rather
   * than ordered among them: a frame is a background, and a list that mixed
   * the two would have to be sorted by kind before it could be painted.
   */
  frames: SeqFramePlacement[];
  width: number;
  height: number;
}

/**
 * Columns in declaration order, rows in written order, both sized to their
 * contents.
 *
 * There is no optimisation of the *order* here and there should not be: the
 * participants are the reader's map of who is involved and the messages are
 * the conversation, so a layout engine that improved either would be
 * describing a different exchange.
 *
 * What is computed is the **space**. The first version used a fixed 150-unit
 * column and a fixed gap, which is fine until a participant is called
 * "Identity provider" or a message says "Exchange code + code_verifier" -- and
 * then the words run outside their boxes and across their neighbours, and the
 * diagram looks half-drawn rather than dense. So every column is as wide as
 * its own name, every gap is as wide as the widest message that has to cross
 * it, and every note is as tall as the text it wraps to.
 */
export function layoutSequence(
  diagram: SequenceDiagram,
  options: Partial<SeqLayoutOptions> = {},
): SeqLayout {
  const o = { ...SEQ_DEFAULTS, ...options };
  const measure = o.measure;

  // --- columns, each as wide as its own name -------------------------------
  const heads = diagram.participants.map((p) => {
    const natural = measure(p.label, { fontSize: SEQ_TYPE.head });
    const width = Math.min(
      o.maxColumnWidth,
      Math.max(o.minColumnWidth, Math.ceil(natural.width) + HEAD_PAD_X)
    );
    // Measured again at the width it will really get, which is the pass that
    // knows how many lines the cap above just created.
    const wrapped = measure(p.label, {
      fontSize: SEQ_TYPE.head,
      maxWidth: width - HEAD_PAD_X,
    });
    return { participant: p, width, wrapped };
  });

  /**
   * One depth for every head box.
   *
   * A row of boxes with different heights reads as a ragged strip rather than
   * as a cast list, and the lifelines would start at different depths -- so
   * the tallest label sets the height for all of them.
   */
  const headHeight = Math.max(
    o.minHeadHeight,
    ...heads.map((h) => Math.ceil(h.wrapped.height) + HEAD_PAD_Y)
  );

  // --- gaps, each as wide as what has to cross it --------------------------
  const gaps = new Array(Math.max(0, heads.length - 1)).fill(o.minGap);
  const indexOf = new Map(diagram.participants.map((p, i) => [p.key, i]));

  /**
   * Widened shortest-span-first.
   *
   * A message between neighbours can only be served by the one gap it crosses,
   * so it has to set that gap before a wider message is allowed to conclude
   * there is already room. Doing it the other way round lets a long label
   * spread its demand thinly across several gaps and leaves a neighbouring
   * pair still too close for its own short label.
   */
  const spans = diagram.steps
    .flatMap((step) => {
      if (step.kind !== 'message' || !step.label) return [];
      const from = indexOf.get(step.from);
      const to = indexOf.get(step.to);
      if (from === undefined || to === undefined || from === to) return [];
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      const width = measure(step.label, { fontSize: SEQ_TYPE.message }).width + MESSAGE_PAD;
      return [{ lo, hi, width }];
    })
    .sort((a, b) => a.hi - a.lo - (b.hi - b.lo));

  for (const span of spans) {
    // What the label has to fit into: the gaps it crosses, plus the columns it
    // passes over on the way.
    let available = 0;
    for (let k = span.lo; k < span.hi; k += 1) available += gaps[k];
    for (let k = span.lo + 1; k < span.hi; k += 1) available += heads[k].width;
    if (available >= span.width) continue;
    const share = (span.width - available) / (span.hi - span.lo);
    for (let k = span.lo; k < span.hi; k += 1) gaps[k] += share;
  }

  /**
   * A self-message loops out to the right, so it needs clearance from whatever
   * is next to it -- otherwise the loop and its label are drawn over the next
   * column's lifeline.
   */
  for (const step of diagram.steps) {
    if (step.kind !== 'message' || step.from !== step.to) continue;
    const i = indexOf.get(step.from);
    if (i === undefined || i >= gaps.length) continue;
    const label = step.label
      ? measure(step.label, { fontSize: SEQ_TYPE.message }).width + 16
      : 0;
    gaps[i] = Math.max(gaps[i], SELF_REACH + label + 16);
  }

  // --- place the columns ---------------------------------------------------
  const lanes: SeqLane[] = [];
  let x = o.originX;
  heads.forEach((head, i) => {
    lanes.push({
      key: head.participant.key,
      label: head.participant.label,
      actor: head.participant.actor,
      x,
      y: o.originY,
      width: head.width,
      height: headHeight,
      lines: head.wrapped.lines,
      centreX: x + head.width / 2,
      lineTop: o.originY + headHeight,
      // Both settled below, once the last row is known.
      lineBottom: o.originY + headHeight,
      footY: o.originY + headHeight,
    });
    x += head.width + (gaps[i] ?? 0);
  });

  const centreOf = new Map(lanes.map((l) => [l.key, l.centreX]));
  const steps: (SeqArrowPlacement | SeqNotePlacement)[] = [];
  const frames: SeqFramePlacement[] = [];

  /**
   * Frames currently open, innermost last.
   *
   * Each collects the participants mentioned inside it as the walk goes, which
   * is what decides its width: a frame spans the columns it actually talks
   * about, so an `alt` between two of five participants does not draw a box
   * across the whole diagram.
   */
  const open: Array<{
    block: SeqBlockType;
    label: string;
    top: number;
    depth: number;
    keys: Set<string>;
    sections: { y: number; label: string }[];
  }> = [];

  let y = o.originY + headHeight + o.rowHeight;

  /** Every open frame is told about a participant a step inside it touched. */
  const touch = (...keys: string[]) => {
    for (const frame of open) for (const key of keys) frame.keys.add(key);
  };

  for (const step of diagram.steps) {
    if (step.kind === 'block-start') {
      // The tab sits above the first thing inside, so the frame opens where
      // the last step left off and the content starts below the header.
      const top = y - o.rowHeight * 0.55;
      open.push({
        block: step.block,
        label: step.label,
        top,
        depth: open.length,
        keys: new Set<string>(),
        sections: [],
      });
      y += BLOCK_HEADER;
      continue;
    }

    if (step.kind === 'block-section') {
      const frame = open[open.length - 1];
      if (frame) {
        frame.sections.push({ y: y - o.rowHeight * 0.5, label: step.label });
        y += SECTION_GAP;
      }
      continue;
    }

    if (step.kind === 'block-end') {
      const frame = open.pop();
      if (!frame) continue;
      const bottom = y - o.rowHeight * 0.5 + BLOCK_FOOT;

      /**
       * A frame with nothing in it still has to be a box somewhere, so it
       * falls back to spanning every column -- which is also what an empty
       * `loop` means: it applies to the whole diagram.
       */
      const covered = frame.keys.size
        ? lanes.filter((l) => frame.keys.has(l.key))
        : lanes;
      const inset = frame.depth * BLOCK_INSET;
      const left = Math.min(...covered.map((l) => l.centreX)) - BLOCK_MARGIN + inset;
      const right = Math.max(...covered.map((l) => l.centreX)) + BLOCK_MARGIN - inset;

      frames.push({
        kind: 'frame',
        block: frame.block,
        label: frame.label,
        x: left,
        y: frame.top,
        width: Math.max(80, right - left),
        height: Math.max(BLOCK_HEADER + BLOCK_FOOT, bottom - frame.top),
        depth: frame.depth,
        sections: frame.sections,
      });

      /**
       * Far enough past the frame that the *next* one opens below it.
       *
       * A frame opens at `y - rowHeight * 0.55`, so simply adding the foot
       * padding left the next opener's top a few units *above* the closed
       * frame's bottom. Nothing looked wrong on the canvas -- the boxes are
       * side by side -- but reading the board back sorts these edges by y, so
       * the next `loop` was written before the previous `end` and the nesting
       * came out inverted. The gap is what keeps the two orders the same.
       */
      y = bottom + o.rowHeight * 0.55 + BLOCK_FOOT;
      continue;
    }

    if (step.kind === 'note') {
      touch(...step.over);
      const xs = step.over.map((k) => centreOf.get(k) ?? o.originX);
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      const laneWidth =
        lanes.find((l) => l.key === step.over[0])?.width ?? o.minColumnWidth;

      // A note over two participants spans between their lifelines; one over a
      // single participant is a box on its own; one placed to a side sits
      // clear of the lifeline rather than on it.
      const box =
        step.over.length > 1 ? right - left + laneWidth : Math.max(laneWidth, 140);
      const wrapped = measure(step.text, {
        fontSize: SEQ_TYPE.note,
        maxWidth: box - NOTE_PAD_X,
      });
      const height = Math.ceil(wrapped.height) + NOTE_PAD_Y;
      const centre =
        step.placement === 'left'
          ? left - box * 0.7
          : step.placement === 'right'
            ? left + box * 0.7
            : (left + right) / 2;

      steps.push({
        kind: 'note',
        text: step.text,
        lines: wrapped.lines,
        x: centre - box / 2,
        y: y - height / 2,
        width: box,
        height,
      });
      // A tall note pushes what follows it down, rather than being written
      // over by the next message.
      y += Math.max(o.rowHeight, height + 18);
      continue;
    }

    touch(step.from, step.to);
    const self = step.from === step.to;
    steps.push({
      kind: 'arrow',
      from: step.from,
      to: step.to,
      label: step.label,
      line: step.line,
      head: step.head,
      y,
      self,
    });
    // A loop needs the room a straight arrow does not.
    y += self ? o.rowHeight * 1.5 : o.rowHeight;
  }

  /**
   * Every lifeline runs to the same depth and ends in the same second head
   * box, which is what makes the columns read as columns rather than as a
   * ragged comb -- and what lets a reader at the bottom of a long exchange
   * still tell the participants apart.
   */
  const bottom = y + o.rowHeight * 0.5;
  for (const lane of lanes) {
    lane.lineBottom = bottom;
    lane.footY = bottom;
  }

  /**
   * The bounds have to contain the notes and the self-loops too.
   *
   * A note placed to the left of the first participant, or a loop off the
   * right of the last one, sits outside every head box -- and a fit computed
   * from the columns alone would cut it off.
   */
  const rights = [
    ...lanes.map((l) => l.x + l.width),
    ...lanes.map((l) => l.centreX + SELF_REACH),
    ...steps.map((st) => (st.kind === 'note' ? st.x + st.width : -Infinity)),
    ...frames.map((f) => f.x + f.width),
  ];
  const lefts = [
    ...lanes.map((l) => l.x),
    ...steps.map((st) => (st.kind === 'note' ? st.x : Infinity)),
    ...frames.map((f) => f.x),
  ];
  const right = rights.length ? Math.max(...rights) : o.originX + o.minColumnWidth;
  const left = lefts.length ? Math.min(...lefts, o.originX) : o.originX;

  return {
    lanes,
    steps,
    frames,
    width: right - left,
    // The foot boxes are the last thing drawn, so they are what the bounds end
    // at -- a fit computed to the lifelines alone would cut them in half.
    height: bottom + headHeight - o.originY,
  };
}
