import React, { Suspense, lazy } from 'react';
import { Check, ChevronDown, Crop, LayoutGrid, Play, Shrink, SmilePlus } from 'lucide-react';
import {
  FRAME_PRESETS,
  FRAME_PRESET_GROUPS,
  FRAME_THEMES,
  frameThemeFill,
  frameThemeOf,
  presetMatching,
} from '../../../engine/model/frames';
import type { FrameNode } from '../../../engine/model/schema';
import { useStore } from '../../../hooks/useStore';
import { useRoomPermissions } from '../../../hooks/useRoomPermissions';
import { notify } from '../../../engine/ui/notices';
import { requestPresentation, resizeFramesToFit } from '../../canvas/useContentShortcuts';
import { Emoji } from '../../emoji/Emoji';
import { FramePresetIcon } from '../../panel/sections/framePresetIcons';
import { RailButton } from '../RailBase';
import { openSlideView } from '../../slides/useSlides';
import { RailPopover } from '../RailPopover';
import { RailAnatomy } from './anatomy';
import { updateNode, type SingleRail } from './types';
import './frameRail.css';

const LazyPicker = lazy(() => import('../../emoji/EmojiPicker').then((m) => ({ default: m.EmojiPicker })));

/** A frame's size, as the preset it matches — with its icon — or its own numbers. */
const FrameSizeControl: React.FC<{ node: FrameNode; canEdit: boolean }> = ({ node, canEdit }) => {
  const match = presetMatching(node.width, node.height, node.preset);
  const label = match ? match.label : `${Math.round(node.width)} × ${Math.round(node.height)}`;
  if (!canEdit) {
    return (
      <span className="rail-kind">
        {match && <FramePresetIcon icon={match.icon} />}
        <span className="rail-kind__name">{label}</span>
      </span>
    );
  }
  return (
    <RailPopover
      label="Frame size"
      size="sm"
      align="start"
      trigger={
        <span className="rail-kind">
          {match && <FramePresetIcon icon={match.icon} />}
          <span className="rail-kind__name">{label}</span>
          <ChevronDown size={12} aria-hidden className="rail-kind__chevron" />
        </span>
      }
    >
      {(close) => (
        <div className="rail-list rail-list--wide" role="radiogroup" aria-label="Frame size">
          {FRAME_PRESET_GROUPS.map((group) => (
            <React.Fragment key={group}>
              <span className="ctx-popover__label">{group}</span>
              {FRAME_PRESETS.filter((p) => p.group === group).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={match?.id === p.id}
                  className="rail-list__item"
                  onClick={() => {
                    // Keep the orientation the frame already has.
                    const turned = node.width !== node.height && node.width > node.height !== p.width > p.height;
                    const inset = p.safeArea;
                    updateNode(
                      node.id,
                      turned
                        ? {
                            width: p.height,
                            height: p.width,
                            safeArea: inset ? { top: inset.left, left: inset.top, right: inset.bottom, bottom: inset.right } : undefined,
                            preset: p.id,
                          }
                        : { width: p.width, height: p.height, safeArea: inset, preset: p.id }
                    );
                    close();
                  }}
                >
                  <FramePresetIcon icon={p.icon} />
                  <span className="rail-list__label">{p.label}</span>
                  <span className="rail-list__meta">
                    {p.width} × {p.height}
                  </span>
                  {match?.id === p.id && <Check size={13} aria-hidden />}
                </button>
              ))}
            </React.Fragment>
          ))}
        </div>
      )}
    </RailPopover>
  );
};

/** The frame's page colour: a swatch that opens the theme row. */
const FrameThemeControl: React.FC<{ node: FrameNode }> = ({ node }) => {
  const current = frameThemeOf(node.appearance?.fill);
  const fill = node.appearance?.fill?.[0];
  const swatch = fill && fill.type === 'solid' ? fill.color : undefined;
  return (
    <RailPopover
      label="Background"
      align="start"
      trigger={<span className="frame-rail-swatch" data-none={!swatch || undefined} style={swatch ? { background: swatch } : undefined} />}
    >
      {(close) => (
        <div className="frame-rail-themes" role="radiogroup" aria-label="Frame background">
          {FRAME_THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={current?.id === t.id}
              aria-label={t.label}
              data-tooltip={t.label}
              className="frame-rail-theme"
              data-none={t.fill === null || undefined}
              style={t.fill ? { background: t.fill } : undefined}
              onClick={() => {
                updateNode(node.id, { appearance: { ...(node.appearance ?? {}), fill: frameThemeFill(t) } });
                close();
              }}
            />
          ))}
        </div>
      )}
    </RailPopover>
  );
};

/**
 * A frame: its size leads (with the preset's icon), then its page colour, then
 * what you do to a frame — give it an emoji, fit it, decide whether it clips,
 * present from it.
 */
export const FrameRail: SingleRail<FrameNode> = ({ node, conditional, tail, tailControls }) => {
  const { canEdit } = useRoomPermissions();
  const clips = node.clipContent !== false;
  return (
    <RailAnatomy
      kind={<FrameSizeControl node={node} canEdit={canEdit} />}
      kindControls={1}
      paint={canEdit ? <FrameThemeControl node={node} /> : undefined}
      paintControls={canEdit ? 1 : 0}
      verbs={[
        ...(canEdit
          ? [
              {
                id: 'icon',
                controls: 1,
                node: (
                  <RailPopover label={node.icon ? 'Change icon' : 'Add icon'} align="center" trigger={node.icon ? <Emoji native={node.icon} size={16} /> : <SmilePlus size={16} />}>
                    {(close) => (
                      <Suspense fallback={<div className="emoji-picker emoji-picker--loading" aria-busy="true" />}>
                        <LazyPicker
                          current={node.icon}
                          onPick={(icon) => {
                            updateNode(node.id, { icon });
                            close();
                          }}
                          onRemove={
                            node.icon
                              ? () => {
                                  updateNode(node.id, { icon: undefined });
                                  close();
                                }
                              : undefined
                          }
                          removeLabel="Remove icon"
                        />
                      </Suspense>
                    )}
                  </RailPopover>
                ),
              },
              {
                id: 'fit',
                controls: 1,
                node: (
                  <RailButton
                    label="Resize to fit"
                    hint="Fit the frame to what it holds"
                    onClick={() => {
                      const objects = useStore.getState().objects;
                      if (resizeFramesToFit([node], objects) > 0) return;
                      const empty = !Object.values(objects).some((n) => n.frameId === node.id);
                      notify({ tone: 'info', message: empty ? 'This frame is empty, so there is nothing to fit.' : 'This frame already fits what it holds.' });
                    }}
                  >
                    <Shrink size={16} />
                  </RailButton>
                ),
              },
              {
                id: 'clip',
                controls: 1,
                node: (
                  <RailButton
                    label={clips ? 'Stop clipping content' : 'Clip content'}
                    hint={clips ? 'Content is cut off at the frame edge' : 'Content can hang over the frame edge'}
                    pressed={clips}
                    onClick={() => updateNode(node.id, { clipContent: clips ? false : undefined })}
                  >
                    <Crop size={16} />
                  </RailButton>
                ),
              },
            ]
          : []),
        {
          id: 'present',
          controls: 1,
          node: (
            <RailButton label="Present" hint="Present from this frame" onClick={() => requestPresentation(node.id)}>
              <Play size={16} />
            </RailButton>
          ),
        },
        // Only a top-level frame is a slide; one inside another is part of it.
        ...(node.frameId
          ? []
          : [
              {
                id: 'slides',
                controls: 1,
                node: (
                  <RailButton label="Slide view" hint="Every slide as a grid, to order, skip and theme" onClick={() => openSlideView(node.id)}>
                    <LayoutGrid size={16} />
                  </RailButton>
                ),
              },
            ]),
      ]}
      conditional={conditional}
      tail={tail}
      tailControls={tailControls}
    />
  );
};
