import { describe, expect, it } from 'vitest';
import {
  EMOJI,
  EMOJI_CATEGORIES,
  SKIN_TONES,
  activeEmojiQuery,
  emojiByName,
  searchEmoji,
  withTone,
} from './emoji';

describe('the set is internally consistent', () => {
  it('has no duplicate shortcodes', () => {
    const names = EMOJI.map((x) => x.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has no duplicate characters', () => {
    const chars = EMOJI.map((x) => x.char);
    expect(new Set(chars).size).toBe(chars.length);
  });

  it('keeps every shortcode typeable', () => {
    // The name is what somebody types after `:`, and `activeEmojiQuery` only
    // accepts these characters — a name with a space or a dot in it could be
    // searched for but never reached by the trigger.
    for (const x of EMOJI) expect(x.name, x.name).toMatch(/^[a-z0-9_+-]+$/);
  });

  it('files every entry under a category the picker draws', () => {
    const known = new Set(EMOJI_CATEGORIES.map((c) => c.id));
    for (const x of EMOJI) expect(known.has(x.category), x.name).toBe(true);
  });

  it('gives every entry at least one keyword beyond its name', () => {
    // The name is often the least guessable thing about an emoji —
    // `white_check_mark` is not what anybody types looking for a tick.
    for (const x of EMOJI) expect(x.keywords.length, x.name).toBeGreaterThan(0);
  });
});

describe('search ranks by how well it matched, not by position', () => {
  it('puts an exact shortcode first', () => {
    expect(searchEmoji('heart')[0].name).toBe('heart');
  });

  it('puts a prefix above a buried substring', () => {
    /**
     * The tiers exist for exactly this. `he` appears inside `exploding_head`
     * and at the start of `heart`, and without the ranking the catalogue's own
     * order decides — which would put the wrong one under Enter.
     */
    const names = searchEmoji('he').map((x) => x.name);
    expect(names.indexOf('heart')).toBeLessThan(names.indexOf('exploding_head'));
  });

  it('finds an emoji by what it is for', () => {
    // The name is `white_check_mark`, which nobody types.
    expect(searchEmoji('done').map((x) => x.char)).toContain('✅');
    expect(searchEmoji('lgtm').map((x) => x.char)).toContain('👍');
    expect(searchEmoji('bug').map((x) => x.char)).toContain('🐛');
  });

  it('is case and space insensitive', () => {
    expect(searchEmoji('  FIRE ')[0].char).toBe('🔥');
  });

  it('returns nothing rather than everything for a miss', () => {
    expect(searchEmoji('zzzzzzz')).toHaveLength(0);
  });

  it('honours the limit', () => {
    expect(searchEmoji('', 5)).toHaveLength(5);
  });
});

describe('the : trigger stays out of ordinary prose', () => {
  const q = (text: string) => activeEmojiQuery(text, text.length);

  it('opens on a shortcode being typed', () => {
    expect(q('nice :fi')).toEqual({ query: 'fi', from: 5, to: 8 });
  });

  it('opens at the start of a line', () => {
    expect(q(':ta')?.query).toBe('ta');
  });

  it('ignores a URL', () => {
    /**
     * The single most common colon in a comment on a design tool, and the one
     * a naive trigger fires on every time: the colon in `https://` follows a
     * letter, so requiring whitespace before it settles the whole class.
     */
    expect(q('see https://example.com')).toBeNull();
    expect(q('https://ex')).toBeNull();
  });

  it('ignores a time', () => {
    expect(q('ships at 10:30')).toBeNull();
  });

  it('stays quiet after a bare label', () => {
    // `Note:` and `TODO:` are things people type. Two characters of shortcode
    // are required before anything opens.
    expect(q('Note:')).toBeNull();
    expect(q('Note: ')).toBeNull();
    expect(q('Note: t')).toBeNull();
  });

  it('closes once the query stops looking like a shortcode', () => {
    expect(q('a :not a shortcode')).toBeNull();
    expect(q('a :with.dot')).toBeNull();
  });

  it('reads the colon nearest the caret', () => {
    const text = 'ship :tada then :fi';
    expect(activeEmojiQuery(text, text.length)?.query).toBe('fi');
  });

  it('looks only behind the caret', () => {
    // Editing mid-sentence must not be interrupted by a shortcode that
    // happens to sit later in the line.
    expect(activeEmojiQuery('hello :fire', 5)).toBeNull();
  });
});

describe('skin tone applies where the character takes one', () => {
  it('appends the modifier to an emoji that supports it', () => {
    const thumb = emojiByName('thumbsup')!;
    expect(withTone(thumb, SKIN_TONES[3])).toBe(`👍${SKIN_TONES[3]}`);
  });

  it('leaves an emoji that does not support one alone', () => {
    /**
     * The reason `tone` is a fact about each entry rather than a rule about a
     * category: a modifier after a rocket is a pair no font has, and it draws
     * as the rocket followed by a coloured square.
     */
    const rocket = emojiByName('rocket')!;
    expect(withTone(rocket, SKIN_TONES[3])).toBe('🚀');
  });

  it('is a no-op at the default tone', () => {
    expect(withTone(emojiByName('wave')!, '')).toBe('👋');
  });

  it('only marks single-codepoint bases as tonable', () => {
    // The modifier goes straight after the base character. An entry built from
    // several real codepoints (a family, a couple, anything with a zero-width
    // joiner) needs more than an append, so none is marked. A trailing
    // variation selector does not count against this — it is dropped when the
    // tone is applied, since the modifier implies the colour presentation on
    // its own.
    for (const x of EMOJI.filter((v) => v.tone)) {
      expect([...x.char.replace(/️$/, '')].length, x.name).toBe(1);
    }
  });

  it('drops a variation selector before the modifier', () => {
    /**
     * `☝️` is U+261D followed by U+FE0F. A tone appended to the whole sequence
     * is base + VS16 + modifier, which is not a valid emoji sequence and draws
     * as two glyphs. The modifier has to follow the base immediately.
     *
     * This one was found by the test above rather than by reading: every
     * affected character still rendered, just as a hand followed by a
     * coloured square.
     */
    const up = emojiByName('point_up')!;
    expect(up.char).toBe('☝️');
    expect(withTone(up, SKIN_TONES[4])).toBe(`☝${SKIN_TONES[4]}`);
    expect(withTone(up, SKIN_TONES[4])).not.toContain('️');
  });
});

describe('lookups', () => {
  it('finds by shortcode, case insensitively', () => {
    expect(emojiByName('TADA')?.char).toBe('🎉');
  });

  it('answers nothing for an unknown name', () => {
    expect(emojiByName('not_an_emoji')).toBeUndefined();
  });
});
