import { describe, expect, it } from 'vitest';
import { LINE_SEAT, TOOL_SHORTCUTS } from '../tools/shortcuts';
import { TOOL_NAMES } from '../tools/toolNames';
import { FORCE_IDS } from '../physics/forces';
import { keyFor, LESSONS, lessonById, lessonForTool, type Lesson } from './lessons';

const byId = (id: string): Lesson => {
  const lesson = lessonById(id);
  if (!lesson) throw new Error(`no lesson ${id}`);
  return lesson;
};

describe('the lesson list', () => {
  it('never names a tool that does not exist', () => {
    /**
     * The guarantee that makes this safe to keep for a year. A lesson raised by
     * a tool id nobody dispatches is a lesson that silently never appears, and
     * the only way to find out is to arm every tool by hand. `toolNames.ts`
     * documents four rows of exactly this rot in the help screen it replaced.
     */
    /**
     * `LINE_SEAT` as well as the shortcut map. `shape-arrow` is a real tool
     * with no key of its own — it shares the line seat, and the line key
     * toggles between the two — so a set built from `TOOL_SHORTCUTS` alone
     * calls it fictional. That is what kept the line lesson naming only half
     * of the seat it teaches.
     */
    const real = new Set([...Object.keys(TOOL_SHORTCUTS), ...LINE_SEAT, ...FORCE_IDS]);
    for (const lesson of LESSONS) {
      if (lesson.trigger.on !== 'tool') continue;
      for (const tool of lesson.trigger.tools) {
        expect(real, `${lesson.id} names "${tool}"`).toContain(tool);
      }
    }
  });

  /**
   * Every tool either teaches something or is named here as needing nothing.
   *
   * ## Why the exemptions are a list rather than an absence
   *
   * The table above checks that no lesson names a tool that does not exist. It
   * cannot see the opposite and more likely rot: a **tool** that names no
   * lesson. That failure is silent in exactly the way this codebase keeps
   * warning about — nothing is broken, nothing logs, the tool simply never
   * explains itself, and the only way to find out is to arm all eighteen by
   * hand and watch for a card.
   *
   * It had already happened twice. `chart` — the one tool where placing it is
   * the easy part and everything after it is unguessable — had no lesson at
   * all, while `grid`, which is comparable in depth, had one from the start.
   * And `shape-arrow` was missed because it has no key of its own, so the
   * line lesson taught one half of a seat whose own third step tells you to
   * switch to the other half.
   *
   * So silence has to be *declared*. Adding a tool without a lesson now fails
   * here, and the fix is either to write the lesson or to add the tool to this
   * list with a reason — which is a decision someone made rather than one that
   * happened.
   */
  it('has a lesson for every tool whose gesture is not obvious', () => {
    /** Tools that need no lesson, and why each one does not. */
    const NEEDS_NONE: Record<string, string> = {
      select: 'Click a thing to select it. There is no second meaning to teach.',
      hand: 'Drag to pan. The cursor already says so.',
      eraser: 'Drag across what you want gone.',
      pen: 'Freehand: press and draw. The Bézier pen is the one with a gesture, and it has `pen-anchors`.',
      shape: 'Drag out a box. The shape *vocabulary* is a panel, taught where it is chosen rather than on arming the tool.',
    };

    const taught = new Set<string>();
    for (const lesson of LESSONS) {
      if (lesson.trigger.on !== 'tool') continue;
      for (const tool of lesson.trigger.tools) taught.add(tool);
    }

    const tools = [...new Set([...Object.keys(TOOL_SHORTCUTS), ...LINE_SEAT])];
    const unexplained = tools.filter((t) => !taught.has(t) && !(t in NEEDS_NONE));
    expect(
      unexplained,
      `these tools raise nothing and are not listed as needing nothing: ${unexplained.join(', ')}`
    ).toEqual([]);

    // And the exemption list may not outlive its tools, or it becomes a place
    // where a deleted tool's excuse sits forever looking like a decision.
    for (const exempt of Object.keys(NEEDS_NONE)) {
      expect(tools, `"${exempt}" is exempted but is not a tool`).toContain(exempt);
      expect(taught, `"${exempt}" is exempted but has a lesson`).not.toContain(exempt);
    }
  });

  it('teaches the whole of a seat that holds two tools', () => {
    // The line seat toggles between Line and Arrow on one key, and the lesson
    // for it says so in its own steps. Teaching only the half you happened to
    // start on means following that instruction dismisses the card.
    const taught = new Set<string>();
    for (const lesson of LESSONS) {
      if (lesson.trigger.on !== 'tool') continue;
      for (const tool of lesson.trigger.tools) taught.add(tool);
    }
    const covered = LINE_SEAT.filter((t) => taught.has(t));
    expect(covered.length === 0 || covered.length === LINE_SEAT.length, `the line seat is half-taught: ${covered.join(', ')}`).toBe(true);
  });

  it('gives every tool at most one lesson', () => {
    // Two lessons on one tool means one of them can never be raised, and which
    // one wins would depend on the order of a list nobody thinks of as ordered.
    const seen = new Set<string>();
    for (const lesson of LESSONS) {
      if (lesson.trigger.on !== 'tool') continue;
      for (const tool of lesson.trigger.tools) {
        expect(seen, `${tool} is claimed twice`).not.toContain(tool);
        seen.add(tool);
      }
    }
  });

  it('gives every lesson its own id', () => {
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
  });

  it('gives every lesson something to teach', () => {
    // A title with no steps is a claim with no gesture behind it, which is the
    // shape of teaching text that survives the feature it described.
    for (const lesson of LESSONS) {
      expect(lesson.title.length, lesson.id).toBeGreaterThan(0);
      expect(lesson.gist.length, lesson.id).toBeGreaterThan(0);
      expect(lesson.steps.length, lesson.id).toBeGreaterThan(0);
      for (const step of lesson.steps) {
        expect(step.act.length, lesson.id).toBeGreaterThan(0);
        expect(step.gives.length, lesson.id).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the em-dash out of what people read', () => {
    // The copy standard the rest of the app was brought to. Teaching text is
    // the easiest place for it to creep back, because it is the most prose-like
    // thing in the product.
    for (const lesson of LESSONS) {
      const all = [lesson.title, lesson.gist, ...lesson.steps.flatMap((s) => [s.act, s.gives])];
      for (const line of all) expect(line, lesson.id).not.toContain('—');
    }
  });

  it('teaches at least one thing about each tool the user cannot guess', () => {
    // Not a completeness check on the dock: most tools are guessable and
    // deliberately have none. These five are the ones the product is least
    // discoverable without, so their absence should fail loudly rather than
    // quietly.
    for (const tool of ['grid', 'shape-line', 'connector', 'bezier-pen', 'sticky']) {
      expect(lessonForTool(tool), tool).toBeDefined();
    }
    expect(lessonForTool('magnet')?.id).toBe('forces');
  });

  it('leaves the guessable tools alone', () => {
    // A coach mark on a tool whose whole behaviour is "drag out a rectangle" is
    // the thing that teaches people to dismiss coach marks unread.
    for (const tool of ['select', 'hand', 'eraser', 'shape']) {
      expect(lessonForTool(tool), tool).toBeUndefined();
    }
  });
});

describe('keyFor', () => {
  it('reads the binding rather than repeating it', () => {
    // If `G` is ever rebound, this follows. A lesson that wrote its own key
    // would be the one screen a confused person reaches for, and the one least
    // likely to have been updated.
    expect(keyFor(byId('grid-content'))).toBe(TOOL_SHORTCUTS.grid);
    expect(keyFor(byId('line-route'))).toBe(TOOL_SHORTCUTS['shape-line']);
  });

  it('says nothing rather than picking one of six', () => {
    // The forces lesson is raised by all six fields, which share no key.
    expect(keyFor(byId('forces'))).toBeUndefined();
  });

  it('says nothing for a lesson with no tool at all', () => {
    expect(keyFor(byId('boolean-shapes'))).toBeUndefined();
  });
});

describe('the tools that have lessons', () => {
  it('all have a name on the help screen too', () => {
    // A tool the coach teaches and the reference cannot name is a tool with two
    // half-descriptions. Force ids are not dock tools and are excluded.
    const forces = new Set<string>(FORCE_IDS);
    for (const lesson of LESSONS) {
      if (lesson.trigger.on !== 'tool') continue;
      for (const tool of lesson.trigger.tools) {
        if (forces.has(tool)) continue;
        expect(TOOL_NAMES[tool], `${tool} has no name`).toBeTruthy();
      }
    }
  });
});
