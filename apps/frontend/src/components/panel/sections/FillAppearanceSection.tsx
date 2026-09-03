import React from 'react';
import { Palette } from 'lucide-react';
import { Accordion, Row } from '../panelPrimitives';
import { ColorPickerPopover } from '../../ui/ColorPickerPopover';
import { EyedropperButton } from '../../ui/EyedropperButton';
import { FillEditor } from '../../ui/FillEditor';
import { Slider } from '../../ui/Slider';
import {
  BLEND_MODES,
  type AnyNode,
  type Appearance,
  type BlendMode,
} from '../../../engine/model/schema';
import type { Shared } from '../../../engine/model/selection';
import { CornerRadiusRow } from '../CornerRadiusRow';

const BLEND_LABELS: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  'color-dodge': 'Color Dodge',
  'color-burn': 'Color Burn',
  'hard-light': 'Hard Light',
  'soft-light': 'Soft Light',
  difference: 'Difference',
  exclusion: 'Exclusion',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
};

interface FillAppearanceSectionProps {
  capabilities: {
    supportsFill?: boolean;
    supportsOpacity?: boolean;
    supportsRadius?: boolean;
    supportsStroke?: boolean;
  };
  appearance: Appearance | undefined;
  openShape: boolean;
  hasConnector: boolean;
  sharedPaint: <T>(read: (a: Appearance) => T) => Shared<T>;
  opacityShared: Shared<number | undefined>;
  setAppearance: (patch: Partial<Appearance>) => void;
  set: (updates: Partial<AnyNode>) => void;
  /*
    `nudgeEach` was here for the opacity stepper's arrows, which applied a
    *relative* change so a mixed selection kept its differences. A track has no
    arrows and sets an absolute value, so the prop went with them rather than
    staying as an unused parameter somebody would later wire back up.
  */
  setConnectorLikeColor: (color: string) => void;
}

export const FillAppearanceSection: React.FC<FillAppearanceSectionProps> = ({
  capabilities,
  appearance,
  openShape,
  hasConnector,
  sharedPaint,
  opacityShared,
  setAppearance,
  set,
  setConnectorLikeColor,
}) => {
  if (!capabilities.supportsFill && !capabilities.supportsOpacity && !capabilities.supportsRadius) {
    return null;
  }

  return (
    <Accordion title="Appearance" icon={<Palette size={13} />}>
      {capabilities.supportsFill && appearance && !openShape && (
        <Row label="Fill" hint="Solid colour or gradient. Click the swatch to change the kind.">
          <FillEditor
            paint={appearance.fill?.[0]}
            mixed={sharedPaint((a) => a.fill?.[0]).mixed}
            onChange={(fill) => setAppearance({ fill: [fill] })}
          />
        </Row>
      )}

      {capabilities.supportsRadius && !openShape && (
        <CornerRadiusRow
          value={sharedPaint((a) => a.cornerRadius)}
          onChange={(cornerRadius) => setAppearance({ cornerRadius })}
        />
      )}

      {/*
        Opacity is the canonical slider quantity, and it was a stepper.

        A number field is right where the value is a *measurement* — a width, a
        radius, a font size — because you usually arrive knowing it. Opacity is
        the other kind: you almost never want 63%, you want "a bit more see-
        through", and finding that with a stepper means pressing an arrow
        repeatedly while looking somewhere else. Every design tool makes this
        one a track for that reason.

        Nothing is lost by the change, which is what makes it safe: the readout
        is typable, so 63% is still one click and three keystrokes away.

        No tick marks. They were tried at a quarter, a half and three quarters
        and taken out: three of them cut the bar into four equal segments,
        which reads as four separate things rather than as one continuous
        quantity — and none of the three is a fact worth pointing at.

        No hint either. "How much of what is behind this object shows through"
        is a sentence explaining the word *opacity* to somebody who found the
        opacity control, and a row that carries one has a tooltip waiting over
        every part of it.
      */}
      {capabilities.supportsOpacity && (
        <Slider
          label="Opacity"
          unit="%"
          value={Math.round((opacityShared.value ?? 1) * 100)}
          min={0}
          max={100}
          onChange={(v) => set({ opacity: v / 100 })}
        />
      )}

      {!capabilities.supportsFill && capabilities.supportsStroke && appearance && (
        <Row label="Color">
          {/*
            A named class, not an inline flex with its own gap.

            This was `gap: 4` written by hand while every other pair in the
            panel sits on `--space-2`, so the swatch and the pipette were four
            pixels closer together than any comparable pair one row above —
            which is the whole of "the buttons look misaligned": nothing here
            is *wrong*, several things are each slightly their own. An inline
            style is also invisible to the token layer, so it could not follow
            a change to the scale even in principle. `0b83d28` moved the colour
            picker off inline styles for the same reason and this pair was
            missed.
          */}
          <div className="prop-pair">
            <ColorPickerPopover
              color={appearance.stroke?.color ?? 'transparent'}
              mixed={sharedPaint((a) => a.stroke?.color ?? 'transparent').mixed}
              onChange={(color) => setConnectorLikeColor(color)}
            />
            <EyedropperButton
              label="Pick a colour from the screen"
              onPick={(color) => setConnectorLikeColor(color)}
            />
          </div>
        </Row>
      )}

      {appearance && !hasConnector && (
        <Row label="Blend" hint="How this object's pixels combine with whatever is beneath it.">
          <select
            className="prop-select"
            value={sharedPaint((a) => a.blendMode ?? 'normal').mixed ? '__mixed' : appearance.blendMode ?? 'normal'}
            onChange={(e) => {
              if (e.target.value === '__mixed') return;
              setAppearance({
                blendMode: e.target.value === 'normal' ? undefined : (e.target.value as BlendMode),
              });
            }}
          >
            {sharedPaint((a) => a.blendMode ?? 'normal').mixed && (
              <option value="__mixed">Mixed</option>
            )}
            {BLEND_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {BLEND_LABELS[mode]}
              </option>
            ))}
          </select>
        </Row>
      )}
    </Accordion>
  );
};
