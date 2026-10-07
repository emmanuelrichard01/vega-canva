import { describe, it, expect } from 'vitest';
import { coastDistance, isFlick, momentumStep, rubberZoom, ZOOM_GIVE } from './cameraMotion';

describe('momentum', () => {
  it('coasts the same distance at 60Hz and 144Hz', () => {
    const at60 = coastDistance(2, 1 / 60);
    const at144 = coastDistance(2, 1 / 144);
    expect(at60).toBeGreaterThan(50);
    expect(Math.abs(at60 - at144) / at60).toBeLessThan(0.05);
  });

  it('decays with time, never reversing direction', () => {
    const step = momentumStep({ x: 1, y: -1 }, 0.1);
    expect(step.velocity.x).toBeGreaterThan(0);
    expect(step.velocity.x).toBeLessThan(1);
    expect(step.velocity.y).toBeLessThan(0);
  });

  it('clamps a long frame gap so a backgrounded tab does not teleport', () => {
    const big = momentumStep({ x: 1, y: 0 }, 5);
    const clamped = momentumStep({ x: 1, y: 0 }, 0.05);
    expect(big.dx).toBeCloseTo(clamped.dx);
  });

  it('only a quick release flicks', () => {
    expect(isFlick({ x: 0.05, y: 0 })).toBe(false);
    expect(isFlick({ x: 0, y: -0.3 })).toBe(true);
  });
});

describe('rubberZoom', () => {
  it('is free inside the range', () => {
    expect(rubberZoom(1, 2, 0.05, 5)).toBe(2);
  });

  it('resists past the limits and caps the overshoot exactly', () => {
    const once = rubberZoom(5, 6, 0.05, 5);
    expect(once).toBeGreaterThan(5);
    expect(once).toBeLessThan(6);
    let z = 5;
    for (let i = 0; i < 100; i++) z = rubberZoom(z, z * 2, 0.05, 5);
    expect(z).toBeCloseTo(5 * ZOOM_GIVE, 10);
    expect(rubberZoom(z, z * 2, 0.05, 5)).toBe(z);
  });

  it('gives at the bottom of the range too', () => {
    let z = 0.05;
    for (let i = 0; i < 100; i++) z = rubberZoom(z, z / 2, 0.05, 5);
    expect(z).toBeCloseTo(0.05 / ZOOM_GIVE, 10);
  });

  it('walks back out when the gesture reverses inside the overshoot, at the top', () => {
    const over = rubberZoom(5, 5.3, 0.05, 5);
    expect(over).toBeGreaterThan(5);
    const back = rubberZoom(over, over / 1.05, 0.05, 5);
    expect(back).toBeLessThan(over);
    // Enough reversal returns to the limit and then inside the range.
    let z = over;
    for (let i = 0; i < 60; i++) z = rubberZoom(z, z / 1.05, 0.05, 5);
    expect(z).toBeLessThan(5);
  });

  it('walks back out when the gesture reverses inside the overshoot, at the bottom', () => {
    const under = rubberZoom(0.05, 0.047, 0.05, 5);
    expect(under).toBeLessThan(0.05);
    const back = rubberZoom(under, under * 1.05, 0.05, 5);
    expect(back).toBeGreaterThan(under);
    let z = under;
    for (let i = 0; i < 60; i++) z = rubberZoom(z, z * 1.05, 0.05, 5);
    expect(z).toBeGreaterThan(0.05);
  });

  it('reverses immediately from a fully stretched overshoot', () => {
    let z = 5;
    for (let i = 0; i < 100; i++) z = rubberZoom(z, z * 2, 0.05, 5);
    expect(rubberZoom(z, z / 1.1, 0.05, 5)).toBeLessThan(z);
  });

  it('ignores a non-positive request', () => {
    expect(rubberZoom(1, 0, 0.05, 5)).toBe(1);
    expect(rubberZoom(1, Number.NaN, 0.05, 5)).toBe(1);
  });
});
