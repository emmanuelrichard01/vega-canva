import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  nextVisibleStep,
  placeCard,
  resolveAnchor,
  stepAllowed,
  stepBody,
  stepsFor,
  TOUR,
  TOUR_GAP,
  type Box,
  type TourSide,
  type TourStep,
} from './tour';
import { OUTLINE_PAD, roundedOutline } from './tourSketch';

/** Every source file under `src`, so an anchor can be looked for in all of them. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe('the tour', () => {
  /**
   * Given room to run.
   *
   * It reads every source file under `src`, which is genuinely seconds of I/O
   * and competes with a hundred and eighty other files for the disk. It passes
   * in about three on its own and tips past the five-second default under a
   * full run -- a fact about the runner's contention rather than about the
   * test, so the timeout is the thing that should move.
   */
  it('points at elements that actually exist', { timeout: 20_000 }, () => {
    /**
     * The guarantee that makes string anchors safe.
     *
     * A `data-tour` value nobody writes is a step that silently skips itself,
     * and the only way to notice is to run the tour and count. This is the same
     * class of rot `toolNames.ts` opens by warning about, caught the same way:
     * by checking the claim against the thing it claims about.
     *
     * It reads the source rather than rendering, because rendering the whole
     * shell would need a document, a Y.Doc and a canvas, and would still only
     * prove the anchors exist in whatever state that render happened to be in.
     */
    // Relative to this file rather than to the working directory, which is
    // whatever the runner happened to be started from.
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

    /**
     * Every anchor the source carries, gathered in one pass.
     *
     * This read every file and `join`ed them into a single string, then
     * searched that string once per step. Correct, and it grew with the tree
     * until it timed out: building a multi-megabyte string to run a dozen
     * substring searches over it costs far more than the searches do.
     * Collecting the anchors file by file is the same answer at a fraction of
     * the work, and it stops creeping every time somebody adds a component.
     */
    const carried = new Set<string>();
    const propped = new Set<string>();
    let hasTourProp = false;
    for (const file of sources(root)) {
      if (file.endsWith('tour.test.ts')) continue;
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/data-tour="([^"]+)"/g)) carried.add(match[1]);
      // A template-literal anchor is a *prefix* — `data-tour={`seat-${id}`}` —
      // so what is recorded is the part before the interpolation.
      for (const match of text.matchAll(/data-tour=\{`([^`$]*)/g)) carried.add(match[1]);
      // A component that writes `data-tour={tour}` (the board's columns) is
      // handed the anchor as a `tour` prop where it is used.
      if (text.includes('data-tour={tour}')) hasTourProp = true;
      for (const match of text.matchAll(/\btour="([^"]+)"/g)) propped.add(match[1]);
    }

    if (hasTourProp) propped.forEach((a) => carried.add(a));

    /** Every class name and quoted attribute value a fallback selector names. */
    const fragments = (selector: string) => [
      ...[...selector.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]),
      ...[...selector.matchAll(/="([^"]+)"/g)].map((m) => m[1]),
    ];
    const texts = sources(root)
      .filter((f) => !f.endsWith('tour.test.ts') && !f.endsWith('tour.ts'))
      .map((f) => readFileSync(f, 'utf8'));

    for (const step of TOUR) {
      const hooked =
        carried.has(step.anchor) ||
        [...carried].some((prefix) => prefix.length > 0 && step.anchor.startsWith(prefix));
      if (hooked) continue;
      // Not hooked yet: the fallback has to name something the source writes.
      expect(step.fallback, `step "${step.id}" anchors to "${step.anchor}", which nothing carries, and has no fallback`).toBeTruthy();
      for (const fragment of fragments(step.fallback!)) {
        expect(
          texts.some((t) => t.includes(fragment)),
          `step "${step.id}" falls back on "${fragment}", which nothing writes`
        ).toBe(true);
      }
    }
  });

  it('gives every step its own id', () => {
    expect(new Set(TOUR.map((s) => s.id)).size).toBe(TOUR.length);
  });

  it('keeps every step short, for every role', () => {
    /** A tour that explains is a tour people skip; one that locates is one they finish. */
    const roles = ['editor', 'commenter', 'viewer'] as const;
    for (const step of TOUR) {
      for (const role of roles) {
        const body = stepBody(step, role);
        expect(body.split(/\.\s/).length, `${step.id}/${role}: "${body}"`).toBeLessThanOrEqual(2);
        expect(body.length, `${step.id}/${role}`).toBeLessThanOrEqual(120);
        expect(body, step.id).not.toContain('—');
      }
      expect(step.title, step.id).not.toContain('—');
    }
  });

  it('fits the whole walk in about a minute', () => {
    // Roughly 200 words a minute of reading, plus a beat per step to look.
    for (const role of ['editor', 'commenter', 'viewer'] as const) {
      const words = stepsFor(role).reduce((n, i) => n + stepBody(TOUR[i], role).split(/\s+/).length, 0);
      const seconds = (words / 200) * 60 + stepsFor(role).length * 2;
      expect(seconds, role).toBeLessThanOrEqual(60);
    }
  });
});

describe('roles', () => {
  it('walks editors through the whole layout, in order', () => {
    expect(stepsFor('editor').map((i) => TOUR[i].id)).toEqual([
      'board', 'dock', 'insert', 'all-tools', 'properties', 'share', 'zoom', 'music',
    ]);
  });

  it('never shows a viewer or a commenter the editing tools', () => {
    for (const role of ['viewer', 'commenter'] as const) {
      const ids = stepsFor(role).map((i) => TOUR[i].id);
      expect(ids).not.toContain('insert');
      expect(ids).not.toContain('all-tools');
      expect(ids.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('says the dock differently to somebody who cannot draw', () => {
    const dock = TOUR.find((s) => s.id === 'dock')!;
    expect(stepBody(dock, 'viewer')).not.toBe(stepBody(dock, 'editor'));
    expect(stepBody(dock, 'commenter')).toMatch(/comment/i);
    expect(stepAllowed(dock, 'viewer')).toBe(true);
  });
});

describe('resolveAnchor', () => {
  const step: TourStep = { id: 's', anchor: 'zoom', fallback: '.zoom-ctl', title: 'Zoom', body: 'x', side: 'top' };
  const el = (name: string, box: Box) => ({ name, box: () => box });
  const shown = { x: 10, y: 10, width: 80, height: 32 };
  const hidden = { x: 0, y: 0, width: 0, height: 0 };

  it('prefers the data-tour hook over the fallback', () => {
    const query = (sel: string) =>
      sel === '[data-tour="zoom"]' ? [el('hook', shown)] : sel === '.zoom-ctl' ? [el('fallback', shown)] : [];
    expect(resolveAnchor(step, query)?.name).toBe('hook');
  });

  it('uses the fallback while nothing carries the hook', () => {
    const query = (sel: string) => (sel === '.zoom-ctl' ? [el('fallback', shown)] : []);
    expect(resolveAnchor(step, query)?.name).toBe('fallback');
  });

  it('skips matches that are not laid out, and takes the one on screen', () => {
    // The open panel and the collapsed pill both carry `layers`; one is hidden.
    const query = (sel: string) => (sel === '[data-tour="zoom"]' ? [el('pill', hidden), el('panel', shown)] : []);
    expect(resolveAnchor(step, query)?.name).toBe('panel');
  });

  it('finds nothing when nothing is on screen', () => {
    expect(resolveAnchor(step, () => [el('ghost', hidden)])).toBeNull();
    expect(resolveAnchor({ ...step, fallback: undefined }, () => [])).toBeNull();
  });
});

describe('the pen outline', () => {
  it('stays outside the spotlit element on every side, wide or round', () => {
    const cases: Array<[Box, number]> = [
      [{ x: 100, y: 700, width: 820, height: 52 }, 16], // the dock
      [{ x: 20, y: 20, width: 36, height: 36 }, 18], // a round button
      [{ x: 400, y: 300, width: 300, height: 600 }, 12], // a panel
    ];
    for (const [box, radius] of cases) {
      for (const p of roundedOutline(box, radius, OUTLINE_PAD)) {
        const outside =
          p.x <= box.x + 0.01 || p.x >= box.x + box.width - 0.01 || p.y <= box.y + 0.01 || p.y >= box.y + box.height - 0.01;
        expect(outside, `${JSON.stringify(p)} inside ${JSON.stringify(box)}`).toBe(true);
      }
    }
  });
});

describe('nextVisibleStep', () => {
  const all = () => true;
  const none = () => false;
  const only = (...anchors: string[]) => (s: TourStep) => anchors.includes(s.anchor);

  it('stays put when the step it is asked about is present', () => {
    expect(nextVisibleStep(0, 1, all)).toBe(0);
    expect(nextVisibleStep(3, -1, all)).toBe(3);
  });

  it('skips a run of absent steps going forward', () => {
    const last = TOUR.length - 1;
    expect(nextVisibleStep(0, 1, only(TOUR[last].anchor))).toBe(last);
  });

  it('skips a run of absent steps going back', () => {
    // The direction is honoured: pressing Back through steps that have gone
    // keeps going back rather than bouncing forward past what was being
    // returned to.
    expect(nextVisibleStep(TOUR.length - 1, -1, only(TOUR[0].anchor))).toBe(0);
  });

  it('gives up rather than running off either end', () => {
    /**
     * The stranding bug. `back()` at step 0 was a no-op, so a missing anchor
     * there left the tour running with nothing on screen and its key handler
     * still swallowing Escape. `null` is what lets the caller end it instead.
     */
    expect(nextVisibleStep(-1, -1, all)).toBeNull();
    expect(nextVisibleStep(TOUR.length, 1, all)).toBeNull();
    expect(nextVisibleStep(0, -1, none)).toBeNull();
    expect(nextVisibleStep(0, 1, none)).toBeNull();
  });

  it('finds nothing when no anchor is on screen, in either direction', () => {
    // Focus mode takes every panel at once, which is exactly this.
    for (let i = 0; i < TOUR.length; i++) {
      expect(nextVisibleStep(i, 1, none), `${i} forward`).toBeNull();
      expect(nextVisibleStep(i, -1, none), `${i} back`).toBeNull();
    }
  });
});

describe('placeCard', () => {
  const CARD = { width: 300, height: 180 };
  const VIEW = { width: 1400, height: 900 };
  const middle = { x: 600, y: 400, width: 200, height: 100 };

  it('honours the side it was asked for when there is room', () => {
    for (const side of ['top', 'bottom', 'left', 'right'] as TourSide[]) {
      expect(placeCard(middle, CARD, VIEW, side).side, side).toBe(side);
    }
  });

  it('centres the card on the anchor along the free axis', () => {
    const above = placeCard(middle, CARD, VIEW, 'top');
    expect(above.x + CARD.width / 2).toBeCloseTo(middle.x + middle.width / 2, 6);
    expect(above.y + CARD.height + TOUR_GAP).toBeCloseTo(middle.y, 6);

    const beside = placeCard(middle, CARD, VIEW, 'right');
    expect(beside.y + CARD.height / 2).toBeCloseTo(middle.y + middle.height / 2, 6);
    expect(beside.x - TOUR_GAP).toBeCloseTo(middle.x + middle.width, 6);
  });

  it('flips to the opposite side rather than running off the screen', () => {
    // The dock: at the foot of the window, asking for a card above it, which is
    // right. The same anchor at the top of the window has to go below instead.
    const atTop = { x: 600, y: 4, width: 200, height: 40 };
    expect(placeCard(atTop, CARD, VIEW, 'top').side).toBe('bottom');

    const atLeft = { x: 6, y: 400, width: 52, height: 300 };
    expect(placeCard(atLeft, CARD, VIEW, 'left').side).toBe('right');
  });

  it('turns a corner when neither side along one axis fits', () => {
    /**
     * The radar's case. It sits in the bottom-left corner: there is no room to
     * its left and none below it either, so the card has to leave the axis it
     * was asked about rather than being clamped into a wall.
     */
    const corner = { x: 16, y: VIEW.height - 60, width: 150, height: 40 };
    const p = placeCard(corner, CARD, VIEW, 'left');
    expect(['right', 'top']).toContain(p.side);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y + CARD.height).toBeLessThanOrEqual(VIEW.height);
  });

  it('never leaves the viewport, even when nothing fits', () => {
    // A window smaller than the card. Clamping in the asked-for direction is
    // the honest answer: half a card pointing the right way still reads as
    // pointing, and a card placed by a rule nobody can predict does not.
    const tiny = { width: 320, height: 200 };
    for (const side of ['top', 'bottom', 'left', 'right'] as TourSide[]) {
      const p = placeCard({ x: 10, y: 10, width: 100, height: 40 }, CARD, tiny, side);
      expect(p.x, side).toBeGreaterThanOrEqual(0);
      expect(p.y, side).toBeGreaterThanOrEqual(0);
      expect(p.side, side).toBe(side);
    }
  });
});
