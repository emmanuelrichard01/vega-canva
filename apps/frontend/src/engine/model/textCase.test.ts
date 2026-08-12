import { describe, it, expect } from 'vitest';
import { applyTextCase } from './textCase';

describe('applyTextCase', () => {
  it('leaves the text alone when there is no case set', () => {
    expect(applyTextCase('Hello there', undefined)).toBe('Hello there');
    expect(applyTextCase('Hello there', 'none')).toBe('Hello there');
  });

  it('upper- and lower-cases the whole string', () => {
    expect(applyTextCase('Hello there', 'upper')).toBe('HELLO THERE');
    expect(applyTextCase('Hello There', 'lower')).toBe('hello there');
  });

  it('title-cases the way CSS does — every word, and nothing else touched', () => {
    // Not English title case: `of` stays capitalised, because that is what
    // `text-transform: capitalize` does in the editor and the two have to
    // agree exactly.
    expect(applyTextCase('the state of the art', 'title')).toBe('The State Of The Art');
    // The rest of a word is left as typed, so an acronym survives.
    expect(applyTextCase('an API reference', 'title')).toBe('An API Reference');
  });

  it('finds the first letter of a word in scripts that are not ASCII', () => {
    expect(applyTextCase('élan vital', 'title')).toBe('Élan Vital');
  });

  it('treats a hyphen and a bracket as word boundaries, as the browser does', () => {
    expect(applyTextCase('re-entrant (again)', 'title')).toBe('Re-Entrant (Again)');
  });
});
