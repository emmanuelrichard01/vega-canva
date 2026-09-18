import { describe, expect, it } from 'vitest';
import { activeSpotlight, describeAudience, followersOf, SPOTLIGHT_MS } from './spotlight';
import type { Collaborator } from './collaborators';

const person = (over: Partial<Collaborator> & { clientId: number }): Collaborator => ({
  id: `author_${over.clientId}`,
  name: `Person ${over.clientId}`,
  color: '#3B82F6',
  initials: 'P',
  cursor: null,
  smoothed: null,
  viewport: null,
  activity: null,
  tool: 'select',
  away: false,
  selection: [],
  throws: [],
  following: null,
  spotlightAt: null,
  ...over,
});

describe('followersOf', () => {
  it('finds the people whose camera is locked to you, and nobody else', () => {
    const room = [
      person({ clientId: 1, following: 7 }),
      person({ clientId: 2, following: 3 }),
      person({ clientId: 3, following: null }),
      person({ clientId: 4, following: 7 }),
    ];
    expect(followersOf(room, 7).map((p) => p.clientId)).toEqual([1, 4]);
  });

  it('keeps an idle follower, whose screen is still showing your board', () => {
    expect(followersOf([person({ clientId: 1, following: 7, away: true })], 7)).toHaveLength(1);
  });

  it('has no answer before this client has a id of its own', () => {
    expect(followersOf([person({ clientId: 1, following: 7 })], undefined)).toEqual([]);
  });
});

describe('activeSpotlight', () => {
  const now = 1_000_000;

  it('surfaces a live offer', () => {
    const found = activeSpotlight([person({ clientId: 1, spotlightAt: now - 1000 })], now, null);
    expect(found?.clientId).toBe(1);
  });

  it('lets an offer lapse rather than trusting a frozen tab', () => {
    expect(activeSpotlight([person({ clientId: 1, spotlightAt: now - SPOTLIGHT_MS - 1 })], now, null)).toBeNull();
  });

  it('says nothing when you are already following the person offering', () => {
    expect(activeSpotlight([person({ clientId: 1, spotlightAt: now })], now, 1)).toBeNull();
  });

  it('prefers the most recent offer, which is the one just said out loud', () => {
    const found = activeSpotlight(
      [person({ clientId: 1, spotlightAt: now - 20_000 }), person({ clientId: 2, spotlightAt: now - 500 })],
      now,
      null
    );
    expect(found?.clientId).toBe(2);
  });

  it('is silent in an ordinary room', () => {
    expect(activeSpotlight([person({ clientId: 1 }), person({ clientId: 2 })], now, null)).toBeNull();
  });
});

describe('describeAudience', () => {
  const named = (...names: string[]) => names.map((name, i) => person({ clientId: i + 1, name }));

  it('names one and two people, and counts the rest', () => {
    expect(describeAudience(named('Ada'))).toBe('Ada');
    expect(describeAudience(named('Ada', 'Bo'))).toBe('Ada and Bo');
    expect(describeAudience(named('Ada', 'Bo', 'Cy'))).toBe('Ada, Bo and 1 other');
    expect(describeAudience(named('Ada', 'Bo', 'Cy', 'Di'))).toBe('Ada, Bo and 2 others');
  });

  it('says nothing about nobody', () => {
    expect(describeAudience([])).toBe('');
  });
});
