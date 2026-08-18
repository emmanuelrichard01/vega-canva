import { describe, it, expect } from 'vitest';
import { APPEARANCE_TYPES } from './appearanceTypes';
// Through the barrel, which is the only entry point that guarantees the
// registry has actually been populated — see `index.ts`.
import { objectRegistry } from './index';

/**
 * The properties panel gates every paint section on two separate things: the
 * capability the registry declares, and `appearance` being non-null — which
 * comes from a hand-maintained list of types in the panel itself.
 *
 * `connector` was absent from that list. The registry declared
 * `supportsStroke` and `supportsShadow`, the panel asked for both, and the
 * null gate switched them off — so selecting an arrow offered no way to
 * change the one thing an arrow is made of, while the controls sat in the
 * source looking present.
 *
 * Two sources of truth for the same question is the bug. This makes the
 * registry the one that wins: declare a paint capability on a type and the
 * list has to know about it, or the suite fails here rather than in a panel
 * nobody thought to open.
 */
/**
 * Exactly the capabilities whose panel sections are *also* gated on
 * `appearance` being non-null.
 *
 * Not every paint capability is. Opacity and corner radius are top-level node
 * fields, so `sticky` and `audio` render an Opacity control while carrying no
 * appearance block at all — correctly, and a broader list here flagged both
 * as bugs when neither is one. A guard that fires on things that are fine is
 * one people learn to edit rather than believe.
 */
const NEEDS_APPEARANCE = ['supportsFill', 'supportsStroke', 'supportsShadow'] as const;

describe('APPEARANCE_TYPES', () => {
  it('covers every type whose paint sections are gated on an appearance block', () => {
    const missing = objectRegistry
      .getAll()
      .filter((def) => {
        const caps = def.capabilities as Record<string, boolean | undefined>;
        return NEEDS_APPEARANCE.some((c) => caps[c]) && !APPEARANCE_TYPES.has(def.type);
      })
      .map((def) => def.type);
    expect(missing).toEqual([]);
  });

  it('does not claim types that have no appearance-gated capability', () => {
    const stale: string[] = [];
    for (const type of APPEARANCE_TYPES) {
      const def = objectRegistry.get(type);
      if (!def) {
        stale.push(type);
        continue;
      }
      const caps = def.capabilities as Record<string, boolean | undefined>;
      if (!NEEDS_APPEARANCE.some((c) => caps[c])) stale.push(type);
    }
    expect(stale).toEqual([]);
  });
});
