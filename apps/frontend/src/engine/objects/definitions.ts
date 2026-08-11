import { objectRegistry } from './registry';
import { DEFAULT_FRAME } from '../model/frames';

/**
 * Per-type capability declarations.
 *
 * These drive which sections the Properties panel and floating toolbar offer.
 * The rule is that a capability may only be declared true if a control for it
 * actually reaches the renderer — declaring a capability the renderer ignores
 * produces a control that silently does nothing, which is worse than offering
 * no control at all.
 */

objectRegistry.register({
  type: 'shape',
  capabilities: {
    supportsFill: true,
    supportsStroke: true,
    supportsRadius: true,
    supportsOpacity: true,
    supportsShadow: true,
    // Spread is drawn by stroking the same path with a `2 * spread` line, so
    // it needs a shape whose silhouette a stroke can grow. See
    // `shadowSpreadProps`.
    supportsShadowSpread: true,
    supportsEdgeEffects: true,
    // Shapes carry an optional centered text label (double-click to edit).
    supportsTypography: true,
  },
  defaultProperties: () => ({ width: 120, height: 120 }),
});

objectRegistry.register({
  type: 'path',
  capabilities: {
    supportsFill: true,
    supportsStroke: true,
    supportsOpacity: true,
    supportsShadow: true,
  },
  defaultProperties: () => ({}),
});

objectRegistry.register({
  type: 'text',
  capabilities: {
    supportsTypography: true,
    supportsOpacity: true,
    supportsShadow: true,
  },
  defaultProperties: () => ({ width: 240, height: 40 }),
});

objectRegistry.register({
  type: 'sticky',
  capabilities: {
    // Deliberately NOT supportsTypography. StickyRenderer hardcodes
    // `fontFamily="Caveat, cursive"` and `fontStyle="bold"`, so the font
    // picker plus the bold/italic/underline and alignment controls that the
    // Typography accordion renders were all inert for stickies. Size and
    // color are offered through the dedicated Sticky accordion instead,
    // which does reach the renderer.
    supportsOpacity: true,
    // Deliberately NOT supportsShadow either, for the same reason.
    // `StickyRenderer` draws its own — the soft lift that makes a note read as
    // paper on a board is part of what a sticky *is* — and a second,
    // user-controlled shadow on top would sit beside it rather than replace
    // it. A control whose result is two shadows is worse than no control.
    supportsReactions: true,
    supportsComments: true,
  },
  defaultProperties: () => ({ width: 200, height: 200 }),
});

objectRegistry.register({
  type: 'image',
  capabilities: {
    supportsOpacity: true,
    supportsShadow: true,
    supportsRadius: true,
  },
  defaultProperties: () => ({ width: 300, height: 300 }),
});

objectRegistry.register({
  type: 'audio',
  capabilities: {
    supportsOpacity: true,
    supportsComments: true,
  },
  defaultProperties: () => ({ width: 240, height: 64 }),
});

objectRegistry.register({
  type: 'frame',
  capabilities: {
    // A frame's fill is its background, and the background of anything
    // exported from it — so it was the one appearance property that mattered
    // most and the only node type with no way to set it. `ObjectRenderer`
    // reads `appearance.fill[0].color` and `appearance.cornerRadius`, so all
    // three of these reach the renderer.
    supportsFill: true,
    supportsRadius: true,
    supportsOpacity: true,
    // Deliberately not `supportsStroke`: the frame draws its own soft shadow
    // to lift it off the board and reads no stroke at all, so the control
    // would sit there doing nothing.
  },
  defaultProperties: () => ({ ...DEFAULT_FRAME }),
});

objectRegistry.register({
  type: 'comment',
  capabilities: {
    supportsComments: true,
  },
  defaultProperties: () => ({ width: 32, height: 32 }),
});
