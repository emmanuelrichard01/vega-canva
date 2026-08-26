import { describe, expect, it } from 'vitest';
import { authorWidth, FOOTER_BAND, layoutFooter, TAG_BAND, textBox } from './stickyFooter';

const solo = (emoji: string) => [emoji, ['a']] as const;
const counted = (emoji: string) => [emoji, ['a', 'b', 'c']] as const;

describe('layoutFooter', () => {
  it('shows everything when there is room', () => {
    const out = layoutFooter([solo('👍'), solo('❤️')], 200);
    expect(out.visible.map((c) => c.emoji)).toEqual(['👍', '❤️']);
    expect(out.overflow).toEqual([]);
    // 28 + 4 each.
    expect(out.visible[1].offset).toBe(32);
    expect(out.addOffset).toBe(64);
  });

  it('gives a counted chip more room than a solo one', () => {
    const out = layoutFooter([counted('👍'), solo('❤️')], 200);
    expect(out.visible[0].width).toBe(40);
    expect(out.visible[1].offset).toBe(44);
  });

  it('keeps room for the badge that the overflow will need', () => {
    /**
     * Without this the last chip that fits takes the space the badge needed,
     * and the badge lands outside the note. The bug the whole reservation
     * exists for -- and the old code computed it into a variable and then
     * re-derived it inline, leaving the variable's own branch unreachable.
     */
    // Two solo chips need 64. A badge needs 28 more. At 70 only the first can
    // be placed, because placing the second leaves nowhere for the badge.
    const out = layoutFooter([solo('👍'), solo('❤️'), solo('🎉')], 70);
    expect(out.visible).toHaveLength(1);
    expect(out.overflow.map(([e]) => e)).toEqual(['❤️', '🎉']);
    // 32 used, then the badge, then the add button.
    expect(out.overflowOffset).toBe(32);
    expect(out.addOffset).toBe(60);
  });

  it('lets the final chip use the space no badge will need', () => {
    // Exactly two chips' worth of room and exactly two chips: the second is
    // last, so nothing can overflow behind it.
    const out = layoutFooter([solo('👍'), solo('❤️')], 64);
    expect(out.visible).toHaveLength(2);
    expect(out.overflow).toEqual([]);
  });

  it('keeps the order it was given rather than packing what fits', () => {
    // A wide chip that does not fit must not let a narrow one behind it jump
    // ahead: the same note would show its reactions in a different order at a
    // different width.
    const out = layoutFooter([counted('👍'), solo('❤️')], 40);
    expect(out.visible).toEqual([]);
    expect(out.overflow.map(([e]) => e)).toEqual(['👍', '❤️']);
  });

  it('overflows everything when there is no room at all', () => {
    const out = layoutFooter([solo('👍')], 0);
    expect(out.visible).toEqual([]);
    expect(out.overflow).toHaveLength(1);
    expect(out.addOffset).toBe(28);
  });

  it('is empty for a note nobody has reacted to', () => {
    expect(layoutFooter([], 200)).toEqual({
      visible: [], overflow: [], overflowOffset: 0, addOffset: 0,
    });
  });

  it('copies the ids it was handed', () => {
    const ids = ['a', 'b'];
    const out = layoutFooter([['👍', ids]], 200);
    ids.push('c');
    expect(out.visible[0].ids).toEqual(['a', 'b']);
  });
});

describe('authorWidth', () => {
  it('grows with the initials, so the first chip never lands on the name', () => {
    /**
     * It was the constant 52 — right for `AB`, wrong for `MWM`, where the
     * reaction chips started on top of the initials.
     */
    expect(authorWidth('MWM')).toBeGreaterThan(authorWidth('AB'));
  });

  it('leaves room for a single letter rather than collapsing', () => {
    expect(authorWidth('A')).toBeGreaterThan(20);
    expect(authorWidth('')).toBe(authorWidth('A'));
  });
});

describe('textBox', () => {
  it('reserves the footer band whether or not anyone has reacted', () => {
    /**
     * The bug this exists for: the band was reserved only when a note had
     * reactions, so the first person to react made the handwriting smaller --
     * the box lost eight pixels, the fitter found a size a step down, and every
     * line re-wrapped and re-centred.
     */
    expect(textBox(200, 200, 14, false)).toEqual({
      x: 14, y: 14, width: 172, height: 200 - 14 - 14 - FOOTER_BAND,
    });
  });

  it('takes the tag strip off the top when there are tags', () => {
    const bare = textBox(200, 200, 14, false);
    const tagged = textBox(200, 200, 14, true);
    expect(tagged.y - bare.y).toBe(TAG_BAND);
    expect(bare.height - tagged.height).toBe(TAG_BAND);
  });

  it('never hands the fitter a box with no height', () => {
    // A note dragged smaller than its own furniture. A negative height would
    // make the size search compare against nonsense.
    expect(textBox(60, 20, 14, true).height).toBe(1);
  });
});
