import { describe, expect, it } from 'vitest';
import { readFollowTarget, resolveFollowTarget, withFollowParam, withoutFollowParam } from './followLink';

describe('follow link', () => {
  it('adds the parameter without disturbing the rest of the address', () => {
    expect(withFollowParam('https://x.test/room/abc?role=viewer', 'author_1')).toBe(
      'https://x.test/room/abc?role=viewer&follow=author_1'
    );
  });
  it('reads it back, and refuses an empty or oversized one', () => {
    expect(readFollowTarget('?follow=author_1')).toBe('author_1');
    expect(readFollowTarget('?follow=')).toBeNull();
    expect(readFollowTarget('')).toBeNull();
    expect(readFollowTarget(`?follow=${'a'.repeat(200)}`)).toBeNull();
  });
  it('strips only its own parameter', () => {
    expect(withoutFollowParam('?follow=a&role=viewer')).toBe('?role=viewer');
    expect(withoutFollowParam('?follow=a')).toBe('');
  });
  it('finds the presenter by durable id, taking their newest tab', () => {
    const room = [
      { clientId: 1, id: 'author_a' },
      { clientId: 4, id: 'author_b' },
      { clientId: 9, id: 'author_b' },
    ];
    expect(resolveFollowTarget(room, 'author_b')).toBe(9);
    expect(resolveFollowTarget(room, 'author_z')).toBeNull();
  });
});
