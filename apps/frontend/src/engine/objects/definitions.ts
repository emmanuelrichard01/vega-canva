import { objectRegistry } from './registry';

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
    supportsShadow: true,
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
  type: 'comment',
  capabilities: {
    supportsComments: true,
  },
  defaultProperties: () => ({ width: 32, height: 32 }),
});
