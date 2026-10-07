import React, { useSyncExternalStore } from 'react';
import { Check, ChevronDown, Crop, Download, ImageUp, Shrink } from 'lucide-react';
import { cropMode } from '../../../engine/interaction/cropMode';
import { slotReframe } from '../../../engine/interaction/slotReframe';
import { FRAME_PRESETS, FRAME_PRESET_GROUPS, presetMatching } from '../../../engine/model/frames';
import type { AnyNode, AudioNode, FrameNode, ImageNode } from '../../../engine/model/schema';
import { useStore } from '../../../hooks/useStore';
import { notify } from '../../../engine/ui/notices';
import { FillEditor } from '../../ui/FillEditor';
import { resizeFramesToFit } from '../../canvas/useContentShortcuts';
import { RailButton } from '../RailBase';
import { RailPopover } from '../RailPopover';
import { RailAnatomy } from './anatomy';
import { OpacityControl } from './controls';
import { downloadableSrc, pickImageFile, replaceImage } from './imageActions';
import { KindLabel } from './kind';
import { kindOf } from './kindOf';
import { appearanceOf, updateNode, type SingleRail } from './types';

/** A file name for a download: the object's title, or what it is. */
function fileNameFor(base: string, src: string, fallbackExt: string): string {
  const ext = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(src)?.[1] ?? fallbackExt;
  return `${base.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'download'}.${ext}`;
}

/** A link that saves `src`, disabled with a reason while there is nothing to save yet. */
const DownloadLink: React.FC<{ src: string | null; name: string; label: string }> = ({ src, name, label }) =>
  src ? (
    <a className="ctx-btn" href={src} download={name} data-tooltip={label} aria-label={label}>
      <Download size={16} />
    </a>
  ) : (
    <RailButton label={label} hint="Still uploading" disabled onClick={() => {}}>
      <Download size={16} />
    </RailButton>
  );

/**
 * A picture: crop or reframe it, swap it, take it away, see through it.
 *
 * A grid module owns its edges, so there the frame holds still and the
 * picture moves; the crop verb changes with who owns the edges.
 */
export const ImageRail: SingleRail<ImageNode> = ({ node, conditional, tail, tailControls }) => {
  const cropping = useSyncExternalStore(cropMode.subscribe, cropMode.getSnapshot, cropMode.getSnapshot);
  const reframing = useSyncExternalStore(slotReframe.subscribe, slotReframe.getSnapshot, slotReframe.getSnapshot);
  const isCropping = cropping?.nodeId === node.id;
  const isReframing = reframing?.nodeId === node.id;

  const crop = node.gridSlot ? (
    <RailButton
      label={isReframing ? 'Done reframing' : 'Reframe in module'}
      hint={isReframing ? 'Done reframing (Enter)' : 'Drag to move the picture, scroll to zoom'}
      pressed={isReframing}
      onClick={() => (isReframing ? slotReframe.commit() : slotReframe.enter({ nodeId: node.id, fit: node.gridSlot }))}
    >
      <Crop size={16} />
    </RailButton>
  ) : (
    <RailButton
      label={isCropping ? 'Done cropping' : 'Crop image'}
      hint={isCropping ? 'Done cropping (Enter)' : 'Crop image (double-click)'}
      pressed={isCropping}
      onClick={() =>
        isCropping
          ? cropMode.commit()
          : cropMode.enter({
              nodeId: node.id,
              node: { x: node.x, y: node.y, width: node.width, height: node.height },
              crop: node.crop,
            })
      }
    >
      <Crop size={16} />
    </RailButton>
  );

  return (
    <RailAnatomy
      verbs={[
        { id: 'crop', controls: 1, node: crop },
        {
          id: 'replace',
          controls: 1,
          node: (
            <RailButton
              label="Replace image"
              hint="Choose another picture for this spot, same size and place"
              onClick={() => {
                void pickImageFile().then((file) => file && replaceImage(node, file));
              }}
            >
              <ImageUp size={16} />
            </RailButton>
          ),
        },
        {
          id: 'opacity',
          controls: 1,
          node: <OpacityControl value={node.opacity ?? 1} onChange={(opacity) => updateNode(node.id, { opacity })} />,
        },
        {
          id: 'download',
          controls: 1,
          node: (
            <DownloadLink
              src={downloadableSrc(node.src)}
              name={fileNameFor(node.title ?? 'image', node.src ?? '', 'png')}
              label="Download image"
            />
          ),
        },
      ]}
      conditional={conditional}
      tail={tail}
      tailControls={tailControls}
    />
  );
};

/** A voice note: take the recording away. */
export const AudioRail: SingleRail<AudioNode> = ({ node, conditional, tail, tailControls }) => (
  <RailAnatomy
    verbs={[
      {
        id: 'download',
        controls: 1,
        node: (
          <DownloadLink
            src={downloadableSrc(node.src)}
            name={fileNameFor(`voice-note-${node.author.name}`, node.src ?? '', 'webm')}
            label="Download recording"
          />
        ),
      },
    ]}
    conditional={conditional}
    tail={tail}
    tailControls={tailControls}
  />
);

/** A frame's size, as the preset it matches: Desktop, Story, A4 — or its own numbers. */
const FrameSizeControl: React.FC<{ node: FrameNode }> = ({ node }) => {
  const match = presetMatching(node.width, node.height);
  return (
    <RailPopover
      label="Frame size"
      align="start"
      trigger={
        <span className="rail-kind">
          <span className="rail-kind__name">{match ? match.label : `${Math.round(node.width)} × ${Math.round(node.height)}`}</span>
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
                    updateNode(node.id, { width: p.width, height: p.height, safeArea: p.safeArea });
                    close();
                  }}
                >
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

/** A frame: its size leads, then its ground, then fitting it to what it holds. */
export const FrameRail: SingleRail<FrameNode> = ({ node, conditional, tail, tailControls }) => {
  const { appearance, setAppearance } = appearanceOf(node);
  return (
    <RailAnatomy
      kind={<FrameSizeControl node={node} />}
      kindControls={1}
      paint={<FillEditor paint={appearance.fill?.[0]} onChange={(fill) => setAppearance({ fill: [fill] })} />}
      paintControls={1}
      verbs={[
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
      ]}
      conditional={conditional}
      tail={tail}
      tailControls={tailControls}
    />
  );
};

/** Anything without a rail of its own: what it is, and the tail. */
export const DefaultRail: SingleRail<AnyNode> = ({ node, subject, conditional, tail, tailControls }) => {
  const kind = kindOf(node, subject);
  return (
    <RailAnatomy
      kind={<KindLabel icon={kind.icon} name={kind.name} />}
      conditional={conditional}
      tail={tail}
      tailControls={tailControls}
    />
  );
};
