import { describe, expect, it } from 'vitest';
import { customAlphabet, nanoid } from 'nanoid';
import {
  ID_LENGTH,
  formatRoomCode,
  looksLikeRoomCode,
  roomCodeFor,
  roomFingerprint,
  roomIdFromCode,
} from './roomCode';

const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{12}[0-9A-HJKMNP-TV-Z*~$=U]$/;

describe('roomCode', () => {
  it('round-trips every id it accepts', () => {
    for (let i = 0; i < 500; i += 1) {
      const id = nanoid(ID_LENGTH);
      const code = roomCodeFor(id);
      expect(code, id).not.toBeNull();
      expect(roomIdFromCode(code!)).toBe(id);
    }
  });

  it('is thirteen symbols of Crockford Base32, never I L O or U in the body', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = roomCodeFor(nanoid(ID_LENGTH))!;
      expect(code).toHaveLength(13);
      expect(code).toMatch(CROCKFORD);
      // The letters the alphabet omits, in the twelve symbols that carry the
      // id. `U` is legal as the check symbol alone.
      expect(code.slice(0, 12)).not.toMatch(/[ILOU]/);
    }
  });

  it('loses nothing: distinct ids give distinct codes', () => {
    const seen = new Map<string, string>();
    for (let i = 0; i < 2000; i += 1) {
      const id = nanoid(ID_LENGTH);
      const code = roomCodeFor(id)!;
      const clash = seen.get(code);
      expect(clash === undefined || clash === id, `${code} for ${id} and ${clash}`).toBe(true);
      seen.set(code, id);
    }
  });

  it('reads a code back however it was written down', () => {
    const id = nanoid(ID_LENGTH);
    const code = roomCodeFor(id)!;

    expect(roomIdFromCode(formatRoomCode(code))).toBe(id);
    expect(roomIdFromCode(code.toLowerCase())).toBe(id);
    expect(roomIdFromCode(`  ${formatRoomCode(code)}  `)).toBe(id);
    expect(roomIdFromCode(code.split('').join(' '))).toBe(id);
  });

  it('reads the letters people substitute for digits', () => {
    // Crockford's rule, and the reason those letters are not in the alphabet.
    const id = nanoid(ID_LENGTH);
    const code = roomCodeFor(id)!;
    const mistyped = code.replace(/1/g, 'I').replace(/0/g, 'O');

    expect(roomIdFromCode(mistyped)).toBe(id);
  });

  it('refuses a code with a symbol changed', () => {
    // The point of the check symbol. Without it a typo is still a valid id,
    // so the app opens a different board -- an empty one, because it does not
    // exist -- and somebody believes their colleague's work is gone.
    let refused = 0;
    let tried = 0;

    for (let i = 0; i < 200; i += 1) {
      const code = roomCodeFor(nanoid(ID_LENGTH))!;
      for (let at = 0; at < 12; at += 1) {
        const other = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.replace(code[at], '');
        const swapped = other[(i * 7 + at) % other.length];
        const typo = code.slice(0, at) + swapped + code.slice(at + 1);
        tried += 1;
        if (roomIdFromCode(typo) === null) refused += 1;
      }
    }

    // A single changed symbol always changes the value modulo 37, because 37
    // is prime and larger than the 32 the symbol contributes.
    expect(tried).toBeGreaterThan(2000);
    expect(refused).toBe(tried);
  });

  it('refuses a code with two symbols transposed', () => {
    let refused = 0;
    let tried = 0;

    for (let i = 0; i < 300; i += 1) {
      const code = roomCodeFor(nanoid(ID_LENGTH))!;
      for (let at = 0; at < 11; at += 1) {
        if (code[at] === code[at + 1]) continue;
        const swapped =
          code.slice(0, at) + code[at + 1] + code[at] + code.slice(at + 2);
        tried += 1;
        if (roomIdFromCode(swapped) === null) refused += 1;
      }
    }

    expect(tried).toBeGreaterThan(2000);
    // Not a guarantee of the scheme, but it should catch nearly all of them.
    expect(refused / tried).toBeGreaterThan(0.95);
  });

  it('refuses anything that is not a code', () => {
    for (const bad of [
      '',
      'hello',
      'ABCD-EFGH-JKMN',       // twelve symbols, no check
      'ABCD-EFGH-JKMNPQ',     // fourteen
      '!!!!-!!!!-!!!!!',
      'ABCDEFGHJKMN1'.repeat(2),
    ]) {
      expect(roomIdFromCode(bad), bad).toBeNull();
    }
  });

  it('has no code for an id it did not make', () => {
    // Hand-edited links and much older builds. The board is fine and the link
    // still works; there is simply nothing honest to print as a code.
    expect(roomCodeFor('short')).toBeNull();
    expect(roomCodeFor(nanoid(9))).toBeNull();
    expect(roomCodeFor(nanoid(11))).toBeNull();
    expect(roomCodeFor('!!!!!!!!!!')).toBeNull();

    // Ten characters, but from outside nanoid's alphabet.
    const outside = customAlphabet('()[]{}<>*&', 10);
    expect(roomCodeFor(outside())).toBeNull();
  });

  it('recognises the shape without validating it', () => {
    expect(looksLikeRoomCode('ABCD-EFGH-JKMNP')).toBe(true);
    expect(looksLikeRoomCode('abcdefghjkmnp')).toBe(true);
    expect(looksLikeRoomCode('ABCD-EFGH')).toBe(false);
    expect(looksLikeRoomCode('https://example.com/room/abc')).toBe(false);
  });

  it('groups the code for reading', () => {
    expect(formatRoomCode('ABCDEFGHJKMNP')).toBe('ABCD-EFGH-JKMNP');
  });
});

describe('roomFingerprint', () => {
  it('is stable and distinguishes boards', () => {
    const a = nanoid(ID_LENGTH);
    const b = nanoid(ID_LENGTH);

    expect(roomFingerprint(a)).toBe(roomFingerprint(a));
    expect(roomFingerprint(a)).not.toBe(roomFingerprint(b));
  });

  it('is eight hex characters, always', () => {
    for (let i = 0; i < 500; i += 1) {
      expect(roomFingerprint(nanoid(ID_LENGTH))).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it('gives away far too little to be a way into a board', () => {
    // The whole point. A fingerprint is written into files people commit to
    // repositories; a room id is the capability to edit the live board. Thirty
    // two bits over a sixty-bit id means the value cannot single one out, and
    // a fingerprint that appears in a backup is shared by an enormous number
    // of boards that are not the one it came from.
    //
    // Demonstrated at a scale a test can run: truncate to twelve bits and
    // count how many distinct ids land on one value.
    const bucket = new Map<string, number>();
    for (let i = 0; i < 40000; i += 1) {
      const short = roomFingerprint(nanoid(ID_LENGTH)).slice(-3);
      bucket.set(short, (bucket.get(short) ?? 0) + 1);
    }
    // 40000 ids over 4096 values: every value should be reachable from many
    // different boards, and no value should dominate.
    expect(bucket.size).toBeGreaterThan(4000);
    expect(Math.max(...bucket.values())).toBeLessThan(60);
  });

  it('spreads ids that differ in one character', () => {
    // A hash that let neighbouring ids share a fingerprint would turn the
    // "is this the same board?" line into a coin toss between adjacent rooms.
    const base = 'aBc123XyZ0';
    const seen = new Set<string>();
    for (const ch of 'useandom26T198340PX75') {
      seen.add(roomFingerprint(base.slice(0, 9) + ch));
    }
    expect(seen.size).toBe(21);
  });

  it('does not collapse when the id is empty or odd', () => {
    expect(roomFingerprint('')).toMatch(/^[0-9a-f]{8}$/);
    expect(roomFingerprint('')).not.toBe(roomFingerprint('a'));
  });
});
