import { describe, it, expect } from 'vitest';
import { toDisplayForm, toStoredForm, parseMessage, extractMentions } from './threads';

/**
 * The two forms of a message body, and the round trip between them.
 *
 * The composer holds the display form (`@Dana Ito`) and the document holds the
 * stored form (`@[Dana Ito](author_7)`). Before this split, the textarea held
 * the stored form directly — so picking a name from the picker dropped
 * `@[Dana Ito](1873456102)` into the box and left it there while you finished
 * the sentence.
 */
describe('display and stored forms', () => {
  it('shows a name where the document holds a token', () => {
    const { text, mentions } = toDisplayForm('hey @[Dana Ito](author_7) can you look');
    expect(text).toBe('hey @Dana Ito can you look');
    expect(mentions.get('Dana Ito')).toBe('author_7');
  });

  it('puts the ids back on the way out', () => {
    const mentions = new Map([['Dana Ito', 'author_7']]);
    expect(toStoredForm('hey @Dana Ito can you look', mentions)).toBe(
      'hey @[Dana Ito](author_7) can you look'
    );
  });

  it('round-trips a body with several mentions', () => {
    const stored = '@[Dana Ito](a1) and @[Mike](b2) — both of you';
    const { text, mentions } = toDisplayForm(stored);
    expect(text).toBe('@Dana Ito and @Mike — both of you');
    expect(toStoredForm(text, mentions)).toBe(stored);
  });

  /**
   * The reason re-encoding sorts by length. "Dana" matches the opening of
   * "Dana Ito", so shortest-first would encode the prefix and strand " Ito".
   */
  it('prefers the longer name when one prefixes another', () => {
    const mentions = new Map([
      ['Dana', 'short'],
      ['Dana Ito', 'long'],
    ]);
    expect(toStoredForm('@Dana Ito', mentions)).toBe('@[Dana Ito](long)');
    expect(toStoredForm('@Dana', mentions)).toBe('@[Dana](short)');
  });

  it('leaves an @name nobody picked as plain text', () => {
    // Typing "@someone" without accepting a suggestion chooses nobody, and
    // must not become a mention of nobody.
    expect(toStoredForm('email @nobody about it', new Map())).toBe('email @nobody about it');
    expect(parseMessage('email @nobody about it').every((s) => s.kind === 'text')).toBe(true);
  });

  it('survives a body with no mentions at all', () => {
    const { text, mentions } = toDisplayForm('just a comment');
    expect(text).toBe('just a comment');
    expect(mentions.size).toBe(0);
    expect(toStoredForm(text, mentions)).toBe('just a comment');
  });

  it('keeps an @ that is not a mention', () => {
    const mentions = new Map([['Dana', 'a1']]);
    expect(toStoredForm('write to dana@example.com', mentions)).toBe('write to dana@example.com');
  });

  /**
   * The stored form is what `mentionsMe` and the inbox flag read, so the id
   * has to survive the trip the composer takes it on.
   */
  it('keeps the id reachable for mentionsMe after a round trip', () => {
    const { text, mentions } = toDisplayForm('ping @[Dana Ito](author_7)');
    expect(extractMentions(toStoredForm(text, mentions))).toEqual(['author_7']);
  });
});
