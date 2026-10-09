import { describe, expect, it } from 'vitest';
import { budgetFor, pixelRatioCap } from './renderBudget';
import { textAsBlocks, TEXT_BLOCK_PX } from './lod';

describe('pixelRatioCap', () => {
  it('leaves a desktop with plenty of memory at its own ratio', () => {
    expect(pixelRatioCap(3, 8, 'desktop')).toBe(3);
    expect(pixelRatioCap(2, undefined, 'desktop')).toBe(2);
  });
  it('caps a phone and a 4 GB device at 2x, and 2 GB at 1.5x', () => {
    expect(pixelRatioCap(3, 8, 'phone')).toBe(2);
    expect(pixelRatioCap(3, 4, 'tablet')).toBe(2);
    expect(pixelRatioCap(3, 2, 'desktop')).toBe(1.5);
    expect(pixelRatioCap(1, 2, 'phone')).toBe(1);
  });
});

describe('budgetFor', () => {
  it('draws lite on a coarse pointer or 4 GB or less, never on a roomy desktop', () => {
    expect(budgetFor({ dpr: 2, deviceMemory: 8, deviceClass: 'desktop', coarse: false }).lite).toBe(false);
    expect(budgetFor({ dpr: 2, deviceMemory: undefined, deviceClass: 'desktop', coarse: false }).lite).toBe(false);
    expect(budgetFor({ dpr: 2, deviceMemory: 4, deviceClass: 'desktop', coarse: false }).lite).toBe(true);
    expect(budgetFor({ dpr: 2, deviceMemory: 8, deviceClass: 'tablet', coarse: true }).lite).toBe(true);
  });
});

describe('textAsBlocks', () => {
  it('turns type into blocks only below the on-screen threshold, and only when lite', () => {
    expect(textAsBlocks(16, 0.25, true)).toBe(true);
    expect(textAsBlocks(16, 1, true)).toBe(false);
    expect(textAsBlocks(TEXT_BLOCK_PX, 1, true)).toBe(false);
    expect(textAsBlocks(16, 0.1, false)).toBe(false);
  });
});
