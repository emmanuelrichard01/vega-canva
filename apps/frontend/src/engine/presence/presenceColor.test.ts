import { describe, expect, it } from 'vitest';
import {
  PALETTE_SIZE,
  getColorForUser,
  resolvePresenceColor,
  type ColorClaim,
} from './ColorPalette';

/**
 * A room, resolved the way the real one is: everybody runs the same rule
 * against the same roster, and the roster is whatever everybody last published.
 *
 * Run to a fixed point rather than once, because that is the actual behaviour —
 * a change of roster re-triggers the effect on every peer, so the interesting
 * question is not "what does one pass give" but "does it settle, and on what".
 */
function settle(people: Array<{ id: string; clientId: number }>, rounds = 10) {
  let colors = new Map(people.map((p) => [p.clientId, getColorForUser(p.id)]));

  for (let round = 0; round < rounds; round += 1) {
    const next = new Map<number, string>();
    for (const person of people) {
      const peers: ColorClaim[] = people
        .filter((other) => other.clientId !== person.clientId)
        .map((other) => ({ clientId: other.clientId, color: colors.get(other.clientId)! }));
      next.set(person.clientId, resolvePresenceColor(person.id, person.clientId, peers));
    }
    const changed = people.some((p) => next.get(p.clientId) !== colors.get(p.clientId));
    colors = next;
    if (!changed) return { colors, rounds: round + 1, settled: true };
  }
  return { colors, rounds, settled: false };
}

const distinct = (colors: Map<number, string>) => new Set(colors.values()).size === colors.size;

describe('no two people in a room share a colour', () => {
  it('is not something a hash could have promised', () => {
    /**
     * The bug, stated as arithmetic. `getColorForUser` maps an id into the
     * palette, so collisions arrive at the rate the birthday problem dictates
     * — and colour is the *only* thing that says who somebody is here: the
     * cursor, the selection ring, the avatar, the layer panel's editing pill
     * and the radar's pings all carry it and no name. Two people sharing one
     * is two people merged into one on every surface at once.
     *
     * This finds a real colliding pair rather than asserting the abstract
     * possibility, so the test fails if the palette or hash ever changes in a
     * way that removes the case it is about.
     */
    const ids = Array.from({ length: 200 }, (_, i) => `user-${i}`);
    const collision = ids.find((a, i) =>
      ids.slice(i + 1).some((b) => getColorForUser(a) === getColorForUser(b))
    );
    expect(collision).toBeDefined();
  });

  it('gives everyone their own colour, up to the size of the palette', () => {
    for (const size of [2, 3, 5, 9, PALETTE_SIZE]) {
      const room = Array.from({ length: size }, (_, i) => ({
        id: `person-${i}`,
        clientId: 1000 + i,
      }));
      const { colors, settled } = settle(room);
      expect(settled, `${size} people did not settle`).toBe(true);
      expect(distinct(colors), `${size} people share a colour`).toBe(true);
    }
  });

  it('settles rather than swapping forever', () => {
    /**
     * The failure mode a naive rule has. If "move when somebody else has my
     * colour" is symmetric, two people both move, both land on each other's
     * old colour, and the room oscillates for as long as it is open — visibly,
     * because every peer repaints.
     *
     * Only *lower* client ids block a colour, which is a strict total order,
     * so a cycle cannot form. Whoever was there first keeps what they have.
     */
    const room = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, clientId: 500 - i }));
    const { settled, rounds } = settle(room);
    expect(settled).toBe(true);
    // And quickly: each pass fixes at least the lowest unresolved client.
    expect(rounds).toBeLessThanOrEqual(4);
  });

  it('does not move somebody who was already there', () => {
    // The newcomer moves, not the person mid-sentence. A colour changing under
    // someone while they work is the same confusion the fix is for.
    const first = { id: 'ada', clientId: 100 };
    const wanted = getColorForUser(first.id);
    // Somebody arriving later who wants the same colour.
    const second = { clientId: 900 };

    expect(
      resolvePresenceColor(first.id, first.clientId, [{ clientId: second.clientId, color: wanted }])
    ).toBe(wanted);
    expect(
      resolvePresenceColor('ada', second.clientId, [{ clientId: first.clientId, color: wanted }])
    ).not.toBe(wanted);
  });

  it('keeps the colour you usually have when nobody has taken it', () => {
    // Recognisable from one session to the next is the reason the preference
    // is a hash at all, and a resolver that reshuffled everyone on every join
    // would throw that away to solve a problem that was not there.
    expect(resolvePresenceColor('grace', 5, [])).toBe(getColorForUser('grace'));
    expect(resolvePresenceColor('grace', 5, [{ clientId: 1, color: '#000000' }])).toBe(
      getColorForUser('grace')
    );
  });

  it('is stable for one person across a reload', () => {
    // The client id changes on every connection; the colour must not follow it
    // around, or a refresh looks like somebody new joining.
    expect(resolvePresenceColor('linus', 1, [])).toBe(resolvePresenceColor('linus', 999999, []));
  });

  it('degrades rather than thrashing past the palette', () => {
    /**
     * More people than colours means some colour repeats — arithmetic, not
     * policy. What matters is that the room still *settles*: an overflowing
     * room that kept re-picking would repaint every cursor forever, which is
     * far worse than two people sharing a blue.
     */
    const room = Array.from({ length: PALETTE_SIZE + 6 }, (_, i) => ({
      id: `person-${i}`,
      clientId: 2000 + i,
    }));
    const { colors, settled } = settle(room);
    expect(settled).toBe(true);
    // Everyone the palette can seat is still distinct.
    expect(new Set(colors.values()).size).toBeGreaterThanOrEqual(PALETTE_SIZE);
  });

  it('has enough colours for a room anyone would actually open', () => {
    // Ten was inside the size of a real session — a workshop piling into a
    // board is the point of the product, not an edge case.
    expect(PALETTE_SIZE).toBeGreaterThanOrEqual(16);
  });
});
