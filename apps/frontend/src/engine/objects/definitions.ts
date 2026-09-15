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
  defaultProperties: () => ({ width: 280, height: 64 }),
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
  type: 'connector',
  capabilities: {
    // A line, so: a stroke and an opacity, and nothing that needs an interior.
    // No fill (there is none to fill), no corner radius, no edge effects —
    // those all clip to an outline a connector does not have. Declaring any of
    // them would put a control in the panel that the renderer ignores.
    supportsStroke: true,
    supportsOpacity: true,
    supportsShadow: true,
  },
  defaultProperties: () => ({ width: 1, height: 1 }),
});

objectRegistry.register({
  type: 'comment',
  capabilities: {
    supportsComments: true,
  },
  defaultProperties: () => ({ width: 32, height: 32 }),
});

objectRegistry.register({
  type: 'chart',
  capabilities: {
    /**
     * Opacity and edge effects, and nothing else from the generic stack.
     *
     * The same trade `grid` makes, for the same reason. A chart's fill is a
     * *palette* -- one colour per series -- and a single swatch offering to
     * answer that with one value would look broken the moment there were two
     * series. Series colour is set in the Chart section, which understands the
     * question it is asking.
     *
     * `supportsEdgeEffects` is the sketch block, and it is declared here
     * because `ChartRenderer` genuinely honours it: bars are drawn with
     * `roughLoop` and runs with `roughPolyline`, seeded from the node id like
     * every other sketched object. Declaring it without that would be the dead
     * capability this registry exists to prevent.
     */
    supportsOpacity: true,
    supportsEdgeEffects: true,
  },
  defaultProperties: () => ({ width: 480, height: 320 }),
});

objectRegistry.register({
  type: 'table',
  capabilities: {
    /**
     * Opacity and the sketch block, as for a chart, and for the same reason:
     * a table's colours are a *theme* — header, body, stripe, rules — set in
     * the Table section, and one fill swatch cannot answer that. The sketch
     * block reaches `TableRenderer`, which draws its rules by hand, hatches
     * its fills and letters its cells in the sketch face.
     */
    supportsOpacity: true,
    supportsEdgeEffects: true,
  },
  defaultProperties: () => ({ width: 600, height: 144 }),
});

objectRegistry.register({
  type: 'grid',
  capabilities: {
    /**
     * Opacity, and nothing else from the generic appearance stack.
     *
     * Not a limitation to route around later — it is the trade the type makes.
     * A grid's fill is a *palette* and its corner radius is a rule applied to
     * forty modules, and both already have controls in the Grid section that
     * understand that. Declaring `supportsFill` here would put a single colour
     * swatch beside them offering to answer the same question with one value,
     * and whichever one you used last would look broken.
     *
     * Opacity is the exception because it genuinely is one number for the whole
     * object, and the renderer applies it to the group.
     */
    supportsOpacity: true,
  },
  defaultProperties: () => ({ width: 480, height: 360 }),
});
