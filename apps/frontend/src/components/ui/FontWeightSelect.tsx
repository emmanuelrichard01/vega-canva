import React from 'react';
import { canvasFontFamily } from '../canvas/renderers/shared';
import { weightName, weightsFor } from '../../engine/text/fontCatalogue';

/**
 * The weight, chosen by name, from the weights the face actually has.
 *
 * ## Why this replaces a Bold toggle
 *
 * `Typography.fontWeight` has always been a number and the renderer has always
 * forwarded it, but the only control was a Bold button that wrote `700` or
 * `400`. Seven of the nine weights every variable face in the catalogue
 * carries were unreachable — present in the model, drawn correctly if a
 * document happened to contain them, and impossible to ask for.
 *
 * ## Why the list is per-family
 *
 * A weight a face does not have is **synthesised**: the browser thickens or
 * thins the outlines and draws something that is no longer the typeface. It
 * renders, it looks like type, and nothing reports it — which is exactly the
 * kind of wrong this codebase keeps finding. Bebas Neue has one weight; a
 * picker offering it nine is lying eight times.
 *
 * So the options come from `fontCatalogue`, where they were read off each
 * family's own stylesheet rather than assumed. A single-weight face shows one
 * option and says so instead of pretending to be a choice.
 *
 * ## Why each option is set in its own weight
 *
 * "Semi Bold" is a name for something you are trying to *see*. Rendering the
 * word at the weight it names turns the list into a specimen sheet, and the
 * difference between 500 and 600 — which is genuinely hard to describe — is
 * then simply visible.
 */
export const FontWeightSelect: React.FC<{
  family: string;
  value: number;
  mixed?: boolean;
  onChange: (weight: number) => void;
}> = ({ family, value, mixed, onChange }) => {
  const weights = weightsFor(family);
  const only = weights.length === 1;

  return (
    <div className="field weight-field">
      <select
        className="weight-select"
        value={mixed ? '' : String(value)}
        disabled={only}
        aria-label="Font weight"
        // The one case a disabled control has to explain itself: it is not off
        // because something is wrong, it is off because this face has one
        // weight and there is nothing to choose between.
        title={only ? `${family} has one weight` : 'Weight'}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ fontFamily: canvasFontFamily(family), fontWeight: mixed ? 400 : value }}
      >
        {mixed && <option value="">Mixed</option>}
        {weights.map((w) => (
          <option
            key={w}
            value={w}
            // Firefox is the only engine that styles option text, so this is a
            // bonus where it lands rather than the mechanism — the trigger
            // itself is set in the chosen weight, which is the part that has
            // to work everywhere.
            style={{ fontFamily: canvasFontFamily(family), fontWeight: w }}
          >
            {weightName(w)}
          </option>
        ))}
      </select>
    </div>
  );
};
